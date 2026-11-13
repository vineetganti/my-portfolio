"""Email HTML -> clean text for the LLM, keeping each link's text together with its URL.

Output uses inline markdown links: "[link text](canonical url)". Links that are not
content (unsubscribe, social, mailto:) keep their text but lose the URL.
"""
import re
from typing import Callable

from bs4 import BeautifulSoup, NavigableString, Tag

from newsletter_brief.parse.paywall import remove_member_only
from newsletter_brief.parse.redirects import resolve_offline

DROP_TAGS = ("script", "style", "head", "noscript", "svg", "title")
BLOCK_TAGS = ("p", "div", "br", "tr", "table", "ul", "ol", "li", "blockquote",
              "h1", "h2", "h3", "h4", "h5", "h6", "hr", "section", "article")
# Preheader / hidden text that newsletters stuff with filler characters.
HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(px)?\s*[;\"']|opacity\s*:\s*0\s*[;\"']", re.I)
INVISIBLE_CHARS = dict.fromkeys(map(ord, "​‌‍⁠﻿͏­"), None)


def link_label(a: Tag) -> str:
    """Visible text of a link, falling back to an image's alt text (image-only links)."""
    text = a.get_text(" ", strip=True)
    if not text:
        img = a.find("img")
        text = (img.get("alt") or "").strip() if img else ""
    return re.sub(r"\s+", " ", text)


Resolver = Callable[[str, str], str | None]  # (url, link text) -> final url, or None to drop the URL


def html_to_text(html: str, resolve: Resolver = resolve_offline) -> str:
    soup = BeautifulSoup(html, "html.parser")
    remove_member_only(soup)
    for tag in soup(DROP_TAGS):
        tag.decompose()
    for tag in soup.find_all(True):
        if tag.attrs is not None and (tag.has_attr("hidden") or HIDDEN_STYLE.search(tag.get("style", "") + ";")):
            tag.decompose()

    for a in soup.find_all("a"):
        label = link_label(a)
        href = (a.get("href") or "").strip()
        final = resolve(href, label) if label and href else None
        a.replace_with(NavigableString(f"[{label}]({final})" if final else label))

    for tag in soup.find_all(BLOCK_TAGS):
        tag.insert_before("\n")
        if tag.name == "li":  # each insert_before lands closer to the tag, so bullet goes second
            tag.insert_before("- ")
        tag.insert_after("\n")

    text = soup.get_text("").translate(INVISIBLE_CHARS).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
