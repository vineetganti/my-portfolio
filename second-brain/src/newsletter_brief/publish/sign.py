"""Detached Ed25519 signatures for the public files.

The private key never leaves this machine (data/keys/, which git ignores). The website holds only the public key and must
verify a file's signature before it shows anything from it: a file edited in storage, swapped, or uploaded by someone
else fails verification. The signature is the base64 of the raw 64 bytes, stored next to the file as `<name>.sig`.
"""
import base64
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from newsletter_brief.config import ROOT

KEY_DIR = ROOT / "data" / "keys"
PRIVATE, PUBLIC, PUBLIC_RAW = "private.pem", "public.pem", "public.raw.b64"  # the raw form is what a browser verifier takes


def generate_keys(key_dir: Path | None = None, force: bool = False) -> Path:
    """Create the key pair. Refuses to overwrite: replacing the key means re-keying the site."""
    key_dir = key_dir or KEY_DIR
    key_dir.mkdir(parents=True, exist_ok=True)
    if (key_dir / PRIVATE).exists() and not force:
        raise FileExistsError(f"{key_dir / PRIVATE} exists; replacing it would invalidate the key the website trusts")
    key = Ed25519PrivateKey.generate()
    (key_dir / PRIVATE).write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                      serialization.NoEncryption()))
    pub = key.public_key()
    (key_dir / PUBLIC).write_bytes(pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    raw = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    (key_dir / PUBLIC_RAW).write_text(base64.b64encode(raw).decode() + "\n", encoding="ascii", newline="\n")
    return key_dir


def sign_file(path: Path, key_dir: Path | None = None) -> Path:
    key_dir = key_dir or KEY_DIR
    key = serialization.load_pem_private_key((key_dir / PRIVATE).read_bytes(), password=None)
    sig_path = path.with_name(path.name + ".sig")
    sig_path.write_text(base64.b64encode(key.sign(path.read_bytes())).decode() + "\n", encoding="ascii", newline="\n")
    return sig_path


def verify_bytes(data: bytes, signature_b64: str, key_dir: Path | None = None) -> bool:
    """True only if `signature_b64` is a valid signature of exactly `data` by this key pair. Anything else is False.
    Used on files fetched from the live site, where there is no local file to read."""
    key_dir = key_dir or KEY_DIR
    try:
        pub = serialization.load_pem_public_key((key_dir / PUBLIC).read_bytes())
        if not isinstance(pub, Ed25519PublicKey):
            return False
        pub.verify(base64.b64decode(signature_b64.strip()), data)
        return True
    except (InvalidSignature, OSError, ValueError):
        return False


def verify_file(path: Path, key_dir: Path | None = None) -> bool:
    """True only if `<path>.sig` is a valid signature of the file's exact bytes by this key pair. Anything else is False."""
    try:
        return verify_bytes(path.read_bytes(), path.with_name(path.name + ".sig").read_text(encoding="ascii"), key_dir)
    except OSError:
        return False
