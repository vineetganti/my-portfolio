"""Fetch newsletter emails from Gmail (read-only) and turn them into RawEmail.

Gmail API reference: users.messages.list / users.messages.get
https://developers.google.com/gmail/api/reference/rest/v1/users.messages

Flow: list() returns only ids -> get(format="full") per id -> walk the nested MIME
tree -> base64url-decode the text/html and text/plain parts.

Every raw message is cached as data/raw/<id>.json, so parsing can be re-run offline
and the files double as the eval set later.
"""
import base64
import json
import random
import re
import time
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

from googleapiclient.errors import HttpError

from newsletter_brief.config import settings
from newsletter_brief.schemas import RawEmail


FETCH_PAUSE_S = 0.7  # 60 units * (60 / 0.7) ≈ 5,100 units/min, under the 6,000 limit


def _header(payload: dict, name: str) -> str:
    for h in payload.get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _decode_body(part: dict) -> str:
    data = part.get("body", {}).get("data")
    if not data:
        return ""
    raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))  # Gmail strips padding
    match = re.search(r'charset="?([\w-]+)', _header(part, "Content-Type"), re.I)
    try:
        return raw.decode(match.group(1) if match else "utf-8", errors="replace")
    except LookupError:  # unknown charset name
        return raw.decode("utf-8", errors="replace")


def _find_bodies(part: dict, found: dict[str, str]) -> None:
    """Depth-first walk of the MIME tree; keep the first text/html and text/plain seen."""
    mime = part.get("mimeType", "")
    if mime in ("text/html", "text/plain") and mime not in found:
        text = _decode_body(part)
        if text:
            found[mime] = text
    for child in part.get("parts", []):
        _find_bodies(child, found)


def _parse_date(payload: dict, internal_date_ms: str | None) -> datetime:
    try:
        return parsedate_to_datetime(_header(payload, "Date"))
    except (TypeError, ValueError):
        # Malformed or missing Date header: fall back to Gmail's own receive time.
        return datetime.fromtimestamp(int(internal_date_ms or 0) / 1000, tz=timezone.utc)


def to_raw_email(message: dict) -> RawEmail:
    """Convert one users.messages.get(format="full") response into a RawEmail."""
    payload = message["payload"]
    sender = _header(payload, "From")
    bodies: dict[str, str] = {}
    _find_bodies(payload, bodies)
    return RawEmail(
        id=message["id"],
        sender=sender,
        sender_addr=parseaddr(sender)[1].lower(),
        subject=_header(payload, "Subject"),
        date=_parse_date(payload, message.get("internalDate")),
        html=bodies.get("text/html"),
        text=bodies.get("text/plain"),
        has_list_unsubscribe=bool(_header(payload, "List-Unsubscribe")),
    )


def _is_rate_limited(err: HttpError) -> bool:
    return err.resp.status == 429 or (err.resp.status == 403 and b"rateLimitExceeded" in err.content)


def _execute(request, max_attempts: int = 6):
    """Run an API request, sleeping and retrying when Gmail's per-minute quota is hit."""
    for attempt in range(max_attempts):
        try:
            return request.execute()
        except HttpError as err:
            if not _is_rate_limited(err) or attempt == max_attempts - 1:
                raise
            # Exponential backoff plus up to 1s of jitter, as Google's error guide recommends.
            # Starts at 5s (not 1s) because the quota window is a full minute.
            wait = min(2**attempt * 5 + random.random(), 60)
            print(f"Gmail rate limit hit, waiting {wait:.0f}s (attempt {attempt + 1}/{max_attempts})")
            time.sleep(wait)


def _list_ids(service, query: str) -> list[str]:
    ids: list[str] = []
    page_token = None
    while True:
        resp = _execute(service.users().messages().list(userId="me", q=query, pageToken=page_token))
        ids += [m["id"] for m in resp.get("messages", [])]
        page_token = resp.get("nextPageToken")
        if not page_token:
            return ids


def fetch_emails(query: str = "newer_than:1d", use_cache: bool = True) -> list[RawEmail]:
    from newsletter_brief.ingest.auth import gmail_service  # lazy: keeps offline parsing import-light

    service = gmail_service()
    settings.raw_dir.mkdir(parents=True, exist_ok=True)
    emails = []
    for msg_id in _list_ids(service, query):
        path: Path = settings.raw_dir / f"{msg_id}.json"
        if use_cache and path.exists():
            message = json.loads(path.read_text(encoding="utf-8"))
        else:
            message = _execute(service.users().messages().get(userId="me", id=msg_id, format="full"))
            path.write_text(json.dumps(message, indent=2), encoding="utf-8")
            # messages.get(format="full") costs 60 units; the per-user limit is 6,000/min,
            # so ~100 uncached fetches a minute is the ceiling. Pace to stay under it.
            time.sleep(FETCH_PAUSE_S)
        emails.append(to_raw_email(message))
    return emails


def build_query(base: str, senders: list[str]) -> str:
    """e.g. 'newer_than:1d from:(a@x.com OR b@y.com)'. Empty allowlist -> match nothing."""
    if not senders:
        raise ValueError("Allowlist is empty; refusing to fetch the whole mailbox.")
    return f"{base} from:({' OR '.join(senders)})"


def fetch_newsletters(base_query: str = "newer_than:1d") -> list[RawEmail]:
    """Fetch only mail from allowlisted senders."""
    from newsletter_brief.ingest.allowlist import list_senders

    return fetch_emails(build_query(base_query, list_senders()))


def load_raw_emails() -> list[RawEmail]:
    """Re-parse everything saved in data/raw/ without touching the API."""
    return [
        to_raw_email(json.loads(p.read_text(encoding="utf-8")))
        for p in sorted(settings.raw_dir.glob("*.json"))
    ]
