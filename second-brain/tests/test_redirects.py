import httpx
import pytest

from newsletter_brief.parse.canonicalize import canonicalize, is_content_link
from newsletter_brief.parse.redirects import Resolver, is_tracker, resolve_offline, unwrap_offline

TLDR = "https://tracking.tldrnewsletter.com/CL0/https:%2F%2Ftldr.tech%2Fdata%3Futm_source=tldrdata/1/0100abc/sig-123"
SES = "https://x.r.us-east-1.awstrack.me/L0/https:%2F%2Ffinshots.in%3Futm_source=emailHeader%26utm_medium=m/1/0100/sig"
SENDGRID = "https://u1.ct.sendgrid.net/ls/click?upn=u001.abcdef"


def test_unwrap_offline_embedded_targets():
    assert unwrap_offline(TLDR) == "https://tldr.tech/data?utm_source=tldrdata"
    assert unwrap_offline(SES) == "https://finshots.in?utm_source=emailHeader&utm_medium=m"
    assert unwrap_offline("https://blog.dev/post") is None
    assert unwrap_offline("https://tracking.tldrnewsletter.com/CL0/not-a-url/1/x/y") is None


def test_resolve_offline_unwraps_strips_and_filters():
    assert resolve_offline(TLDR, "TLDR Data") == "https://tldr.tech/data"
    assert resolve_offline("https://nl.com/x", "Facebook") is None  # social label
    assert resolve_offline("https://nl.com/x", "Unsubscribe") is None
    assert resolve_offline(SENDGRID, "Read more") == SENDGRID  # opaque: kept as-is without network
    assert is_content_link("https://blog.dev/x", "Facebook ads explained")  # only an exact label counts


def test_tokens_and_host_specific_params_stripped():
    assert canonicalize("https://open.substack.com/pub/a/p/b?inbox=true&r=8y0al&token=SECRET&utm_source=x") == "https://open.substack.com/pub/a/p/b"
    assert canonicalize("https://medium.com/@a/post?source=email-123") == "https://medium.com/@a/post"
    assert canonicalize("https://example.com/search?source=web") == "https://example.com/search?source=web"  # generic "source" kept


def test_is_tracker_rules():
    assert is_tracker(SENDGRID) and is_tracker("https://substack.com/redirect/2/abc?j=x")
    assert not is_tracker("https://substack.com/p/some-post")
    assert not is_tracker("https://blog.dev/post")


class Transport:
    """Mock web: records every host requested; `routes` maps URL -> (status, location)."""

    def __init__(self, routes):
        self.routes, self.seen = routes, []
        self.client = httpx.Client(transport=httpx.MockTransport(self.handle), follow_redirects=False)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.seen.append((request.method, request.url.host))
        status, location = self.routes.get(url, (404, None))
        return httpx.Response(status, headers={"location": location} if location else {})


def resolver(tmp_path, routes):
    t = Transport(routes)
    return Resolver(cache_path=tmp_path / "c.sqlite", client=t.client, sleep=lambda s: None), t


def test_follows_tracker_chain_but_never_contacts_destination(tmp_path):
    r, t = resolver(tmp_path, {
        SENDGRID: (302, "https://substack.com/redirect/2/zzz"),
        "https://substack.com/redirect/2/zzz": (302, "https://blog.dev/real-article?utm_source=nl"),
    })
    assert r(SENDGRID, "Read the post") == "https://blog.dev/real-article"
    assert {host for _, host in t.seen} == {"u1.ct.sendgrid.net", "substack.com"}  # blog.dev never requested


def test_stops_before_an_unsubscribe_hop(tmp_path):
    r, t = resolver(tmp_path, {SENDGRID: (302, "https://shop.example.com/unsubscribe?u=1")})
    assert r(SENDGRID, "here") is None
    assert all(host != "shop.example.com" for _, host in t.seen)


def test_never_requests_unsubscribe_or_social_labelled_links(tmp_path):
    r, t = resolver(tmp_path, {SENDGRID: (302, "https://blog.dev/x")})
    assert r(SENDGRID, "Unsubscribe") is None
    assert r(SENDGRID, "Facebook") is None
    assert t.seen == []


def test_social_destination_is_dropped(tmp_path):
    r, _ = resolver(tmp_path, {SENDGRID: (302, "https://www.facebook.com/somepage")})
    assert r(SENDGRID, "Follow us") is None


def test_head_405_falls_back_to_get(tmp_path):
    calls = []

    def handle(request):
        calls.append(request.method)
        return httpx.Response(405) if request.method == "HEAD" else httpx.Response(302, headers={"location": "https://blog.dev/x"})

    r = Resolver(cache_path=tmp_path / "c.sqlite", client=httpx.Client(transport=httpx.MockTransport(handle)), sleep=lambda s: None)
    assert r(SENDGRID, "Read") == "https://blog.dev/x"
    assert calls == ["HEAD", "GET"]


def test_non_redirecting_tracker_is_unresolvable_and_cached(tmp_path):
    r, t = resolver(tmp_path, {SENDGRID: (200, None)})
    assert r(SENDGRID, "Read") is None
    n = len(t.seen)
    assert r(SENDGRID, "Read") is None and len(t.seen) == n  # second call served from cache


def test_success_cached_but_network_errors_are_not(tmp_path):
    r, t = resolver(tmp_path, {SENDGRID: (302, "https://blog.dev/x")})
    assert r(SENDGRID, "Read") == "https://blog.dev/x"
    n = len(t.seen)
    assert r(SENDGRID, "Read") == "https://blog.dev/x" and len(t.seen) == n

    def boom(request):
        raise httpx.ConnectError("down")

    bad = Resolver(cache_path=tmp_path / "d.sqlite", client=httpx.Client(transport=httpx.MockTransport(boom)), sleep=lambda s: None)
    assert bad(SENDGRID, "Read") is None
    assert bad.db.execute("SELECT COUNT(*) FROM redirect_cache").fetchone()[0] == 0  # retried next run


def test_embedded_then_tracker_chain(tmp_path):
    wrapped = "https://tracking.tldrnewsletter.com/CL0/" + SENDGRID.replace(":", "%3A").replace("/", "%2F").replace("?", "%3F").replace("=", "%3D") + "/1/a/b"
    r, t = resolver(tmp_path, {SENDGRID: (302, "https://blog.dev/final")})
    assert r(wrapped, "Read") == "https://blog.dev/final"


def test_malformed_location_does_not_crash_and_is_refused(tmp_path):
    def handle(request):
        return httpx.Response(302, headers={"location": "https://"})  # unparseable

    r = Resolver(cache_path=tmp_path / "c.sqlite", client=httpx.Client(transport=httpx.MockTransport(handle)), sleep=lambda s: None)
    assert r(SENDGRID, "Read") is None


def test_cta_and_homepage_destinations_are_not_content():
    assert not is_content_link("https://x.substack.com/subscribe", "anything")
    assert not is_content_link("https://medium.com/plans", "anything")
    assert not is_content_link("https://medium.com", "Medium")  # bare homepage
    assert not is_content_link("https://chat.whatsapp.com/abc", "Chat")
    assert not is_content_link("https://blog.dev/x", "Upgrade to paid")
    assert is_content_link("https://blog.dev/subscribe-to-less-email-guide", "A guide")  # slug, not a /subscribe page


def test_second_tracker_host_is_followed_and_stale_cache_ignored(tmp_path):
    spark = "https://nyt.et.e.sparkpost.com/f/newsletter/abc~~/AAAA~/xyz"
    wrapped = "https://nl.nytimes.com/f/newsletter/abc~~/AAAA~/xyz"
    r, t = resolver(tmp_path, {wrapped: (302, spark), spark: (302, "https://www.nytimes.com/2026/11/02/world/story.html")})
    # simulate an old cache entry that recorded the second tracker as if it were the destination
    r.db.execute("INSERT INTO redirect_cache VALUES (?, ?)", (wrapped, spark))
    assert r(wrapped, "A story") == "https://www.nytimes.com/2026/11/02/world/story.html"
    assert {h for _, h in t.seen} == {"nl.nytimes.com", "nyt.et.e.sparkpost.com"}


def test_ad_and_signup_cta_dropped():
    assert not is_content_link("https://nl.nytimes.com/f/a/xyz", "Ad")
    assert not is_content_link("https://substack.com/signup", "Start writing")
    assert is_content_link("https://blog.dev/ad-tech-explained", "Ad tech, explained")


def test_medium_source_param_stripped_on_any_domain_but_real_source_kept():
    assert canonicalize("https://netflixtechblog.com/post-6b0811a1c015?source=rss----2615bd06b42e---4") == "https://netflixtechblog.com/post-6b0811a1c015"
    assert canonicalize("https://eng.example.com/p?source=email-abc-digest") == "https://eng.example.com/p"
    assert canonicalize("https://example.com/search?source=web") == "https://example.com/search?source=web"
