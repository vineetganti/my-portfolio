from types import SimpleNamespace

import httpx
import pytest

from newsletter_brief.schemas import Document
from newsletter_brief.sources import article, edgar, niti

# ---------------- article fetch ----------------
PARAS = "".join(f"<p>Paragraph {i}: engineers measured the system under load number {i * 7} and found that caching "
                f"reduced tail latency by {i + 10} percent while queue depth stayed flat across the rollout.</p>" for i in range(14))
GOOD = f"<html><head><title>T</title></head><body><article><h1>Real article</h1>{PARAS}</article></body></html>"


def client_for(routes: dict):
    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/robots.txt"):
            return httpx.Response(200, text=routes.get("robots", "User-agent: *\nAllow: /"))
        status, body = routes.get(url, (404, ""))
        return httpx.Response(status, text=body)

    return httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=True)


def test_article_ok_and_skip_reasons():
    ok = article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (200, GOOD)}))
    assert ok.reason == "ok" and "tail latency" in ok.text
    gated = GOOD.replace("<head>", '<head><script type="application/ld+json">{"isAccessibleForFree": false}</script>')
    assert article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (200, gated)})).reason == "paywalled"
    assert article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (402, "")})).reason == "paywalled"
    assert article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (403, "")})).reason == "blocked"
    short = "<html><body><p>Subscribe to continue reading this story.</p></body></html>"
    assert article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (200, short)})).reason == "paywalled"
    assert article.fetch_article("https://b.dev/a", client_for({"https://b.dev/a": (200, "<p>tiny</p>")})).reason == "too_short"


def test_article_respects_robots_and_never_requests_a_disallowed_page():
    seen = []

    def handle(request):
        seen.append(str(request.url))
        return httpx.Response(200, text="User-agent: *\nDisallow: /private" if request.url.path == "/robots.txt" else GOOD)

    c = httpx.Client(transport=httpx.MockTransport(handle))
    assert article.fetch_article("https://b.dev/private/x", c).reason == "robots"
    assert "https://b.dev/private/x" not in seen


def test_ensure_full_text_replaces_summary_or_skips():
    doc = Document(id="x", source_id="s", source_type="rss", title="T", url="https://b.dev/a", body_text="short", full_text=False)
    full, why = article.ensure_full_text(doc, client_for({"https://b.dev/a": (200, GOOD)}))
    assert why == "ok" and full.full_text and "tail latency" in full.body_text
    assert article.ensure_full_text(doc, client_for({"https://b.dev/a": (403, "")})) == (None, "blocked")
    assert article.ensure_full_text(full, client_for({}))[0] is full  # already full: no request


# ---------------- NITI ----------------
LISTING = """<html><body><div><a href="/sites/default/files/2026-10/Report-One.pdf" title="Report One Title"></a> ( Size: 1 MB Type: PDF )</div>
<div><a href="https://www.niti.gov.in/sites/default/files/2026-09/Report-Two.pdf">Report Two</a></div>
<div><a href="/sites/default/files/2026-10/Report-One.pdf" title="dup"></a></div><a href="/about">not a pdf</a></body></html>"""


def test_niti_listing_parse_titles_dates_and_dedupe():
    reports = niti.parse_listing(LISTING)
    assert [r.title for r in reports] == ["Report One Title", "Report Two"]
    assert reports[0].url == "https://www.niti.gov.in/sites/default/files/2026-10/Report-One.pdf"
    assert (reports[0].published.year, reports[0].published.month) == (2026, 10)


def test_niti_href_with_trailing_space_is_cleaned():
    html = '<a href="/sites/default/files/2026-10/NITIsandhan-October-2026.pdf " title="T"></a>'
    assert niti.parse_listing(html)[0].url == "https://www.niti.gov.in/sites/default/files/2026-10/NITIsandhan-October-2026.pdf"


def test_niti_skips_pdf_without_text_layer(monkeypatch):
    monkeypatch.setattr(niti, "pdf_to_text", lambda data, max_pages=80: ("scan", 1, False))
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"%PDF-1.4 fake")))
    doc, why = niti.report_to_document(niti.Report("T", "https://x.gov.in/a.pdf", None), c)
    assert doc is None and why == "no_text_layer"


def test_niti_document_from_pdf_text(monkeypatch):
    monkeypatch.setattr(niti, "pdf_to_text", lambda data, max_pages=80: ("word " * 400, 12, True))
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"%PDF-1.4 fake")))
    doc, why = niti.report_to_document(niti.Report("T", "https://x.gov.in/a.pdf", None), c)
    assert doc.id.startswith("niti:") and doc.body_text.endswith("[TEXT TRUNCATED: page cap reached]") and "12 pages" in why


# ---------------- EDGAR ----------------
FEED = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>S-1 - SunPower Inc. (0001838987) (Filer)</title><link href="https://www.sec.gov/Archives/edgar/data/1838987/000183898726000012/0001838987-26-000012-index.htm"/><updated>2026-10-30T19:06:52-04:00</updated></entry>
<entry><title>S-1 - SunPower Inc. (0001838987) (Subject)</title><link href="https://www.sec.gov/Archives/edgar/data/1838987/000183898726000012/0001838987-26-000012-index.htm"/><updated>2026-10-30T19:06:52-04:00</updated></entry>
<entry><title>not a filing title</title><link href="x"/></entry></feed>"""
INDEX = """<table><tr><td>1</td><td>Form S-1</td><td><a href="/ix?doc=/Archives/edgar/data/1/0001-26-000001/main-s1.htm">main-s1.htm</a></td><td>S-1</td><td>9 MB</td></tr>
<tr><td>2</td><td>Exhibit</td><td><a href="/Archives/edgar/data/1/ex.htm">ex.htm</a></td><td>EX-5.1</td><td>1 KB</td></tr></table>"""


def test_edgar_parse_dedupes_per_accession_and_skips_junk():
    filings = edgar.parse_current_filings(FEED)
    assert len(filings) == 1 and filings[0].company == "SunPower Inc." and filings[0].cik == 1838987
    assert filings[0].accession == "0001838987-26-000012" and filings[0].form == "S-1"


def test_edgar_primary_document_unwraps_inline_xbrl_viewer_link():
    url = edgar.primary_document_url(INDEX, "S-1", "https://www.sec.gov/Archives/edgar/data/1/0001-26-000001/0001-26-000001-index.htm")
    assert url == "https://www.sec.gov/Archives/edgar/data/1/0001-26-000001/main-s1.htm"
    assert edgar.primary_document_url(INDEX, "10-K", "https://www.sec.gov/x") is None


def test_edgar_classify_uses_verified_sic_sets():
    assert edgar.classify("1311") == "energy" and edgar.classify("7372") == "tech" and edgar.classify("2834") is None
    assert edgar.classify(None) is None


def test_edgar_refuses_to_run_without_a_declared_contact(monkeypatch):
    monkeypatch.setattr(edgar, "settings", SimpleNamespace(sec_contact=""))
    with pytest.raises(RuntimeError, match="SEC_CONTACT"):
        edgar.user_agent()
    monkeypatch.setattr(edgar, "settings", SimpleNamespace(sec_contact="me@example.com"))
    assert "me@example.com" in edgar.user_agent()
