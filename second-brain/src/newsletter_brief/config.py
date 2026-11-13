import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    google_client_secrets: Path = ROOT / os.getenv("GOOGLE_CLIENT_SECRETS", "credentials.json")
    google_token_path: Path = ROOT / os.getenv("GOOGLE_TOKEN_PATH", "token.json")
    db_path: Path = ROOT / os.getenv("DB_PATH", "data/newsletter_brief.sqlite")
    max_items_per_day: int = int(os.getenv("MAX_ITEMS_PER_DAY", "30"))
    raw_dir: Path = ROOT / "data" / "raw"
    usage_log: Path = ROOT / "data" / "llm_usage.jsonl"
    redirect_cache: Path = ROOT / "data" / "cache" / "redirects.sqlite"
    # LLM stage runs `claude -p` on the user's Claude subscription. Empty = auto-detect.
    claude_bin: str = os.getenv("CLAUDE_BIN", "")
    triage_model: str = os.getenv("TRIAGE_MODEL", "sonnet")
    polish_model: str = os.getenv("POLISH_MODEL", "sonnet")
    # SEC asks automated clients to declare a contact in the User-Agent. Set in .env (gitignored); never hard-code.
    sec_contact: str = os.getenv("SEC_CONTACT", "")


settings = Settings()
