from newsletter_brief.parse.html_to_text import html_to_text
from newsletter_brief.parse.links import extract_links

HTML = """
<html><head><title>x</title><style>p{color:red}</style></head><body>
<div style="display:none">&zwnj;&nbsp;&zwnj; hidden preheader</div>
<h1>Weekly Issue</h1>
<p>Read <a href="https://Blog.dev/agents?utm_source=nl&id=7#top">how we run agents</a> today.</p>
<ul><li>First</li><li>Second</li></ul>
<a href="https://nl.com/unsubscribe?u=1">Unsubscribe</a>
<a href="https://blog.dev/agents?id=7">agents again, longer label</a>
<a href="https://shop.com/x"><img src="a.png" alt="Big sale banner"></a>
<script>alert(1)</script>
</body></html>
"""


def test_text_is_clean_with_markdown_links():
    text = html_to_text(HTML)
    assert "hidden preheader" not in text and "alert" not in text and "color:red" not in text
    assert "Read [how we run agents](https://blog.dev/agents?id=7) today." in text
    assert "- First\n- Second" in text.replace("\n\n", "\n")
    assert "Unsubscribe" in text and "unsubscribe?u=1" not in text  # text kept, URL dropped


def test_links_are_canonical_deduped_and_filtered():
    links = extract_links(HTML)
    urls = [l.url for l in links]
    assert urls.count("https://blog.dev/agents?id=7") == 1
    assert next(l for l in links if l.url.endswith("id=7")).text == "agents again, longer label"
    assert "https://nl.com/unsubscribe?u=1" not in urls
    assert any(l.text == "Big sale banner" for l in links)  # image-only link uses alt text
