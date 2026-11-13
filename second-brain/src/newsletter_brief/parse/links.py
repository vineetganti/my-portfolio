"""Extract the content links of an email as a clean, de-duplicated list."""
import re

from bs4 import BeautifulSoup

from newsletter_brief.parse.canonicalize import canonicalize, is_content_link
from newsletter_brief.parse.html_to_text import Resolver, link_label
from newsletter_brief.parse.paywall import remove_member_only
from newsletter_brief.parse.redirects import resolve_offline
from newsletter_brief.schemas import Link

URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


def extract_links(html: str, resolve: Resolver = resolve_offline) -> list[Link]:
    found: dict[str, str] = {}  # canonical url -> best label
    soup = BeautifulSoup(html, "html.parser")
    remove_member_only(soup)
    for a in soup.find_all("a", href=True):
        label = link_label(a)
        href = a["href"].strip()
        url = resolve(href, label) if label else None
        if not url:
            continue
        if len(label) > len(found.get(url, "")):  # keep the most descriptive text
            found[url] = label
    return [Link(text=text, url=url) for url, text in found.items()]


def extract_links_from_text(text: str) -> list[Link]:
    """Fallback for plain-text-only emails: no link text available, so it is left empty."""
    urls = dict.fromkeys(canonicalize(u) for u in URL_RE.findall(text) if is_content_link(u, ""))
    return [Link(text="", url=u) for u in urls]
