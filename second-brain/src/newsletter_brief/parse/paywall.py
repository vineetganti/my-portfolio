"""Drop paywalled stories from newsletter HTML. Rule from the user: ignore paywalled articles, no teaser fallback.

Medium's digests tag each member-only story card with <img alt="Member-only content">. A card is the smallest
ancestor of that marker that holds exactly one story link; the whole card (title, teaser, author) is removed so
neither the text nor the link ever reaches the LLM.
"""
import re

from bs4 import BeautifulSoup

STORY_ID = re.compile(r"-([0-9a-f]{10,12})(?:\?|\")")  # Medium story urls end in -<10-12 hex chars>
MARKER = re.compile(r"member-only", re.I)


def _story_ids(node) -> set[str]:
    return set(STORY_ID.findall(str(node)))


def remove_member_only(soup: BeautifulSoup) -> int:
    """Remove member-only story cards in place. Returns how many were removed."""
    removed = 0
    for img in soup.find_all("img", alt=MARKER):
        node = img
        while node.parent is not None and len(_story_ids(node.parent)) <= 1:
            node = node.parent
        if node is not img and len(_story_ids(node)) == 1 and node.parent is not None:
            node.decompose()
            removed += 1
    return removed
