"""Turn a messy link into a canonical URL, or decide it isn't content.

Redirect resolving (Substack/Mailchimp) needs network, so it lives in a separate
function and canonicalize() stays pure and fast to test.
"""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS: set[str] = {
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src",
    "igshid", "_hsenc", "_hsmi", "mkt_tok",
    "token",  # per-recipient login tokens (Substack etc.): must never end up in a stored or public URL
}
# Params that only mean "tracking" on specific sites (a generic "source" or "r" could be real).
HOST_TRACKING_PARAMS: dict[str, set[str]] = {
    "medium.com": {"source"},
    "substack.com": {"r", "isfreemail", "submitlike", "inbox", "redirect", "action"},
}
SOCIAL_LABELS = {
    "facebook", "twitter", "x", "instagram", "linkedin", "youtube", "telegram", "spotify",
    "whatsapp", "pinterest", "tiktok", "threads", "reddit", "snapchat", "discord",
}
TRACKING_PREFIXES = ("utm_", "mc_", "__s")

SOCIAL_HOSTS = {
    "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com",
    "tiktok.com", "threads.net", "reddit.com", "t.me", "whatsapp.com", "wa.me",
}
NON_CONTENT_TEXT = (
    "unsubscribe", "view in browser", "view this email", "view online",
    "manage preferences", "update your preferences", "email preferences",
    "privacy policy", "terms of service", "forward to a friend", "share this",
    "manage your subscription", "advertise with us", "reach 8 million", "create your own role",
    "subscribe here", "sign up here", "upgrade to paid", "become a paid", "resubscribe", "join the whatsapp",
)
# Whole-label boilerplate (exact match, so "Sign up for our API beta" is not caught).
BOILERPLATE_LABELS = {"sign up", "subscribe", "advertise", "apply here", "view online", "read online", "refer a friend",
                      "ad", "advertisement", "sponsored", "careers", "about", "help center", "contact us"}
# Hosts that only ever carry the newsletter's own ads/job postings (seen in the user's mail).
NON_CONTENT_HOSTS = {"advertise.tldr.tech", "jobs.ashbyhq.com"}
# Where subscribe/upgrade CTAs land once a wrapper is resolved.
NON_CONTENT_PATHS = ("/subscribe", "/plans", "/upgrade", "/signup")
NON_CONTENT_URL_PARTS = ("unsubscribe", "optout", "opt-out", "manage-preferences", "email-preferences")


# Medium appends ?source=rss-<id>... / email-<id>... / post_page-... on ANY domain (netflixtechblog.com is a custom domain).
MEDIUM_SOURCE_VALUE = re.compile(r"^(rss|email|post_page|collection_home|home_page|topic_page|user_profile|read_next)[-_]", re.I)


def _is_tracking(key: str, host: str = "", value: str = "") -> bool:
    k = key.lower()
    if k in TRACKING_PARAMS or k.startswith(TRACKING_PREFIXES):
        return True
    if k == "source" and MEDIUM_SOURCE_VALUE.match(value):
        return True
    return any(k in params for h, params in HOST_TRACKING_PARAMS.items() if host == h or host.endswith("." + h))


def canonicalize(url: str) -> str:
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(k, host, v))
    return urlunsplit((
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path.rstrip("/"),
        urlencode(query),
        "",  # drop fragment
    ))


def is_content_link(url: str, text: str) -> bool:
    """False for unsubscribe, 'view in browser', social, mailto:, etc."""
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ("http", "https"):
        return False
    host = (parts.hostname or "").removeprefix("www.")
    if any(host == h or host.endswith("." + h) for h in SOCIAL_HOSTS):
        return False
    lowered_text = text.strip().lower()
    if host in NON_CONTENT_HOSTS or lowered_text in SOCIAL_LABELS or lowered_text in BOILERPLATE_LABELS or any(t in lowered_text for t in NON_CONTENT_TEXT):
        return False
    path = parts.path.rstrip("/").lower()
    if (not path and not parts.query) or path.endswith(NON_CONTENT_PATHS):  # bare homepage, or a subscribe/plans page
        return False
    lowered_url = url.lower()
    return not any(p in lowered_url for p in NON_CONTENT_URL_PARTS)
