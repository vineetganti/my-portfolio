"""Cheap, literal fact checks on model output. They catch invented figures, not wrong meaning."""
import re

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
ISO = re.compile(r"\b(?:19|20)\d\d-\d\d(?:-\d\d)?\b")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace(",", "")).strip()


def _rounds_to(claimed: str, token: str) -> bool:
    """True when `token` (a decimal in the source) rounds to `claimed` at the claimed precision (73.3 -> 73, 126.9 -> 127)."""
    if "." not in token:
        return False
    places = len(claimed.split(".")[1]) if "." in claimed else 0
    return round(float(token) + 1e-9, places) == round(float(claimed), places)


def unverified_numbers(source_text: str, generated: str) -> list[str]:
    """Numbers in `generated` that the source does not support.

    Supported means: the same whole number token appears in the source (so a claimed "7" is not 'found' inside "2026-07"
    or "1,700"), or a decimal token in the source rounds to it (73.3 supports "about 73"). ISO dates in the generated text
    are ignored (the model reformats dates). Unit conversions ("9.8 million" for "$9,800,000") are still flagged; that is
    a known false-alarm class.
    """
    source_tokens = {t.rstrip(".") for t in NUM.findall(_norm(source_text))}
    claimed = {n.rstrip(".") for n in NUM.findall(ISO.sub(" ", generated).replace(",", ""))}
    return sorted(c for c in claimed if c not in source_tokens and not any(_rounds_to(c, t) for t in source_tokens))
