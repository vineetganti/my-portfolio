import pytest

from newsletter_brief.schemas import Document
from newsletter_brief.sources.registry import Source
from newsletter_brief.sources.rss import FeedEntry, entry_to_document, looks_paywalled, parse_feed
from newsletter_brief.summarize.backend import LLMResult
from newsletter_brief.summarize.extract import triage_document

RSS = b"""<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Post A</title><link>https://blog.dev/a?utm_source=rss</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate>
<content:encoded><![CDATA[<p>Full <a href="https://x.dev/y?utm_medium=z">article</a> body.</p>]]></content:encoded></item>
<item><title>Post B</title><link>https://blog.dev/b</link><description>short</description></item></channel></rss>"""
ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Entry</title>
<link rel="alternate" href="https://blog.dev/e"/><published>2026-10-30T10:00:00Z</published><content>Body text</content></entry></feed>"""
SRC = Source("blog", "Blog", "engineering", "rss", "https://blog.dev/feed", section="bigtech")


def test_parse_rss_and_atom():
    kind, entries = parse_feed(RSS)
    assert kind == "rss" and [e.title for e in entries] == ["Post A", "Post B"]
    assert entries[0].date.year == 2026 and "article" in entries[0].body_html and entries[1].date is None
    kind, entries = parse_feed(ATOM)
    assert kind == "atom" and entries[0].link == "https://blog.dev/e" and entries[0].body_html == "Body text"
    with pytest.raises(ValueError):
        parse_feed(b"<html></html>")


def test_entry_to_document_canonicalizes_and_converts():
    entry = parse_feed(RSS)[1][0]
    doc = entry_to_document(SRC, entry)
    assert doc.url == "https://blog.dev/a" and doc.id.startswith("blog:") and doc.source_type == "rss"
    assert "[article](https://x.dev/y)" in doc.body_text and doc.links[0].url == "https://x.dev/y"
    assert doc.full_text is False  # a short body counts as a summary


def test_paywall_heuristic_and_missing_fields_skipped():
    cut = FeedEntry("T", "https://m.com/t", None, "<p>Teaser.</p><a href='x'>Continue reading on Medium</a>")
    assert looks_paywalled(cut) and entry_to_document(SRC, cut) is None
    long_with_phrase = FeedEntry("T", "https://m.com/t", None, "<p>" + "word " * 600 + "</p> continue reading on x")
    assert not looks_paywalled(long_with_phrase)  # long bodies are not treated as cut off
    assert entry_to_document(SRC, FeedEntry("T", "", None, "<p>x</p>")) is None  # no link
    empty = entry_to_document(SRC, FeedEntry("T", "https://m.com/t", None, ""))  # some feeds send no body at all
    assert empty is not None and empty.full_text is False and empty.body_text == ""


class Backend:
    def __init__(self, data):
        self.data, self.calls = data, []

    def run(self, **kw):
        self.calls.append(kw)
        return LLMResult(data=self.data, model=kw["model"])


def test_triage_document_takes_url_and_ids_from_the_document_not_the_model():
    doc = Document(id="blog:abc", source_id="blog", source_type="rss", title="T", url="https://blog.dev/a", body_text="text")
    item = dict(title="A title the model made up", url="https://evil.example/x", type="article", topics=["ai"], summary_2_lines="s",
                why_it_matters="w", relevance=4, is_promotional=False, confidence="high", category="applied_guide", breakthrough=False, open_source=False, highlight_note="")
    backend = Backend({"items": [item]})
    result = triage_document(doc, backend=backend)
    assert result.url == "https://blog.dev/a" and result.doc_id == "blog:abc" and result.source == "blog"
    assert result.title == "T"  # the document's own title, never the model's
    assert "text" in backend.calls[0]["prompt"]
    assert triage_document(doc, backend=Backend({"items": []})) is None


RDF_FEED = b"""<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="x"><title>Journal</title></channel>
  <item rdf:about="https://example.org/a"><title>Paper A</title><link>https://example.org/a</link>
  <description>Abstract A</description><dc:date>2026-10-30</dc:date></item></rdf:RDF>"""

LOWERCASE_DATE_FEED = b"""<rss version="2.0"><channel><title>t</title><item><link>https://example.org/b</link>
  <title>Paper B</title><pubdate>2026-11-02T00:00:00Z</pubdate><description>Abstract B</description></item></channel></rss>"""


def test_rss_1_0_items_are_read_even_though_they_sit_in_another_namespace():
    kind, entries = parse_feed(RDF_FEED)
    assert kind == "rss" and [(e.title, e.link, e.body_html) for e in entries] == [("Paper A", "https://example.org/a", "Abstract A")]
    assert entries[0].date is not None and entries[0].date.day == 30


def test_a_lowercase_pubdate_tag_still_gives_a_date():
    _, entries = parse_feed(LOWERCASE_DATE_FEED)
    assert entries[0].date is not None and entries[0].date.month == 11
