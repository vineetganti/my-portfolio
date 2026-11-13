from newsletter_brief.parse.html_to_text import html_to_text
from newsletter_brief.parse.links import extract_links

PAID = '<table><tr><td><a href="https://medium.com/@a/paid-story-aaaaaaaaaaaa?source=x">Paid Story</a> A teaser. <img alt="Member-only content" src="s.png"> 5 min read</td></tr></table>'
FREE = '<table><tr><td><a href="https://medium.com/@b/free-story-bbbbbbbbbbbb?source=x">Free Story</a> Another teaser. 7 min read</td></tr></table>'
HTML = f"<html><body>{PAID}{FREE}</body></html>"


def test_member_only_card_removed_from_text_and_links():
    text = html_to_text(HTML)
    assert "Paid Story" not in text and "A teaser" not in text
    assert "Free Story" in text and "free-story-bbbbbbbbbbbb" in text
    assert [l.text for l in extract_links(HTML)] == ["Free Story"]


def test_no_marker_means_nothing_removed():
    assert "Paid Story" in html_to_text(PAID.replace("Member-only content", "decoration"))
