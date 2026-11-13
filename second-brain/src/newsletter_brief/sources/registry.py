"""Source registry: every place content comes from, and which public feed it belongs to.

The website will show these feeds, engineering first. `section` splits a feed into labelled groups.
Engineering sources come from engineering_feeds.json (verified by scripts/probe_feeds.py); email sources
mirror the sender allowlist; planned sources are not built yet.
"""
import json
from dataclasses import dataclass
from pathlib import Path

# Display order matters: this is the order of sections on the site.
FEEDS: dict[str, str] = {
    "engineering": "Engineering and AI labs",
    "tech": "Tech",
    "markets": "Markets and economy",
    "regulation": "Regulation (India)",
    "world": "World",
    "science": "Science and research",
    "aerospace-defence": "Aerospace and defence",
}
ENGINEERING_SECTIONS: dict[str, str] = {
    "ai-lab": "AI labs and research",
    "bigtech": "Big tech engineering",
    "infra": "Infrastructure and developer platforms",
    "product": "Product and startup engineering",
    "india": "Indian scale engineering",
    "archive": "From the archive: older reads from dormant blogs",  # filled by daily.py, never by a source's own section
}


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    feed: str  # key of FEEDS
    kind: str  # rss | email | page | none
    url: str  # feed url, sender entry (email), or page url
    section: str = ""
    status: str = "planned"  # verified | candidate | no_feed | planned | parked
    active: bool = True
    full_text_in_feed: bool | None = None
    note: str = ""
    include: tuple[str, ...] = ()  # kind "sitemap" or "page": URL path prefixes worth reading; "{year}" means this and last year
    depth: int = 0  # kind "page": exact number of path segments of an article URL (0 = any); category pages sit at other depths


def _engineering() -> list[Source]:
    data = json.loads((Path(__file__).with_name("engineering_feeds.json")).read_text(encoding="utf-8"))
    return [
        Source(id=d["id"], name=d["name"], feed="engineering", kind=d["kind"], url=d["url"], section=d["section"],
               status=d["status"], active=d.get("active", True), full_text_in_feed=d.get("full_text_in_feed"), note=d.get("note", ""),
               include=tuple(d.get("include", ())), depth=d.get("depth", 0))
        for d in data
    ]


EMAIL_AND_PLANNED: list[Source] = [
    # Email newsletters (match the sender allowlist)
    Source("tldr", "TLDR", "tech", "email", "@tldrnewsletter.com", status="verified"),
    Source("substack", "Substack newsletters", "tech", "email", "@substack.com", status="verified", note="Lenny's, The Sequence, Refactoring; also notification mail"),
    Source("medium-digest", "Medium daily digest", "tech", "email", "@medium.com", status="verified", note="member-only stories are dropped; free ones are mostly company engineering blogs, which are read directly instead"),
    Source("langfuse", "Langfuse updates", "tech", "email", "marc@updates.langfuse.com", status="verified"),
    Source("learn-practice-play", "Learn Practice Play", "tech", "email", "paul@learnpracticeplay.com", status="candidate"),
    Source("seekingalpha", "Seeking Alpha", "markets", "email", "@seekingalpha.com", status="verified"),
    Source("economic-times", "Economic Times", "markets", "email", "newsletter@economictimesnews.com", status="verified"),
    Source("finshots", "Finshots", "markets", "email", "morning@finshots.in", status="verified"),
    Source("nytimes", "New York Times", "world", "email", "@nytimes.com", status="verified"),
    Source("hindu-epaper", "The Hindu ePaper", "world", "email", "updates@epth.hindugroup.org.in", status="parked", note="email has no articles, only tracked links to a likely login-gated e-paper"),
    # Planned primary sources (see docs/sources.md)
    Source("sebi", "SEBI circulars, master circulars, regulations", "regulation", "page", "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0", status="planned"),
    Source("rbi", "RBI press releases, notifications, speeches", "regulation", "rss", "https://rbi.org.in/Scripts/rss.aspx", status="planned"),
    Source("fed", "US Federal Reserve", "markets", "rss", "https://www.federalreserve.gov/feeds/feeds.htm", status="planned"),
    Source("eia", "US EIA", "markets", "rss", "https://www.eia.gov/tools/rssfeeds/", status="planned"),
    Source("edgar", "SEC EDGAR (S-1, 8-K, 10-K by SIC code)", "markets", "rss",
           "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=S-1&company=&dateb=&owner=include&start=0&count=10&output=atom",
           status="verified", note="adapter built and run end to end 2026-11-02 (sources/edgar.py): new S-1s, SIC energy/tech filter, main document. Polish sees only the first ~40k chars of a filing"),
    Source("niti", "NITI Aayog division reports", "regulation", "page", "https://www.niti.gov.in/publications/division-reports",
           status="verified", note="adapter built and run end to end 2026-11-02 (sources/niti.py): listing, PDF download, text extraction. Old /publications URL is a 404"),
    # Checked 2026-11-02 and NOT ingestible with plain requests (captcha or JavaScript-only); captchas are not bypassed
    Source("cppp", "CPPP tenders (eprocure.gov.in/cppp)", "regulation", "none", "https://eprocure.gov.in/cppp/", status="no_feed", note="JavaScript-only app shell, no data in the HTML"),
    Source("gem", "GeM tenders", "regulation", "none", "https://gem.gov.in/", status="no_feed", note="captcha; email alerts need an Aadhaar and PAN account (user's call)"),
    Source("google-patents", "Google Patents", "tech", "none", "https://patents.google.com/", status="no_feed", note="JavaScript shell, no data in the HTML, no official API known"),
    Source("ipindia", "India Patent Office public search", "tech", "none", "https://iprsearch.ipindia.gov.in/PublicSearch/", status="no_feed", note="captcha"),
]

# Science and research feeds, probed once each on 2026-11-03 (scripts/probe_feeds.py style; results in docs/sources.md).
# (id, name, topic, url, status, note). Topic is the section: litho | space | astronomy | psychology | quantum | ocw | arxiv
_SCIENCE: list[tuple[str, str, str, str, str, str]] = [
    ("nasa-news", "NASA news", "space", "https://www.nasa.gov/feed/", "verified", "10 entries, full text in feed"),
    ("esa-space-science", "ESA space science", "space", "https://www.esa.int/rssfeed/Our_Activities/Space_Science", "verified", "summaries"),
    ("spacenews", "SpaceNews", "space", "https://spacenews.com/feed/", "verified", "trade news, not a primary source; some items paywalled"),
    ("planetary-society", "The Planetary Society", "space", "https://www.planetary.org/rss/articles", "verified", "feed gives titles only (about 100 chars); fetch the page"),
    ("eso-press", "ESO press releases", "astronomy", "https://www.eso.org/public/news/feed/", "verified", "low volume (1 in 30 days)"),
    ("noirlab-news", "NOIRLab news", "astronomy", "https://noirlab.edu/public/news/feed/", "verified", "low volume"),
    ("esa-webb", "ESA/Webb news", "astronomy", "https://esawebb.org/news/feed/", "verified", "low volume"),
    ("nature-astronomy", "Nature Astronomy", "astronomy", "https://www.nature.com/natastron.rss", "verified", "RSS 1.0; abstracts only, most articles paywalled"),
    ("semiengineering", "Semiconductor Engineering", "litho", "https://semiengineering.com/feed/", "verified", "full text in feed; trade press covering EUV and lithography"),
    ("ieee-spectrum-semis", "IEEE Spectrum: semiconductors", "litho", "https://spectrum.ieee.org/feeds/topic/semiconductors.rss", "verified", "slow (5 in 30 days)"),
    ("eetimes", "EE Times", "litho", "https://www.eetimes.com/feed/", "verified", "titles and short summaries"),
    ("nature-nanotech", "Nature Nanotechnology", "litho", "https://www.nature.com/nnano.rss", "verified", "RSS 1.0; abstracts only, mostly paywalled"),
    ("nature-electronics", "Nature Electronics", "litho", "https://www.nature.com/natelectron.rss", "verified", "RSS 1.0; abstracts only, mostly paywalled"),
    ("nature-photonics", "Nature Photonics", "litho", "https://www.nature.com/nphoton.rss", "verified", "RSS 1.0; abstracts only, mostly paywalled"),
    ("nature-human-behaviour", "Nature Human Behaviour", "psychology", "https://www.nature.com/nathumbehav.rss", "verified", "RSS 1.0; abstracts only, mostly paywalled"),
    ("elife-neuroscience", "eLife neuroscience", "psychology", "https://elifesciences.org/rss/subject/neuroscience.xml", "verified", "open access; 28 in 30 days"),
    ("frontiers-psychology", "Frontiers in Psychology", "psychology", "https://www.frontiersin.org/journals/psychology/rss", "verified", "open access; high volume, quality varies; needed a parser fix for its lowercase date tag"),
    ("greater-good", "Greater Good Science Center", "psychology", "https://greatergood.berkeley.edu/rss/articles", "verified", "popular science from UC Berkeley, full text"),
    ("psyche", "Psyche", "psychology", "https://psyche.co/feed", "verified", "essays, not research"),
    ("quanta", "Quanta Magazine", "quantum", "https://www.quantamagazine.org/feed/", "verified", "physics and computer science journalism"),
    ("nature-npj-qi", "npj Quantum Information", "quantum", "https://www.nature.com/npjqi.rss", "verified", "RSS 1.0; open access journal"),
    ("nature-physics", "Nature Physics", "quantum", "https://www.nature.com/nphys.rss", "verified", "RSS 1.0; abstracts only, mostly paywalled"),
    ("google-quantum-ai", "Google Quantum AI blog", "quantum", "https://blog.google/innovation-and-ai/models-and-research/quantum-computing/rss/", "verified", "found 2026-11-06; the old quantumai.google guess was a 404"),
    ("space-com", "Space.com", "space", "https://www.space.com/feeds.xml", "verified", "general space news, 50 entries; popular press, not a primary source"),
    ("quantum-journal", "Quantum (journal)", "quantum", "https://quantum-journal.org/feed/", "verified", "open access, 30 entries"),
    ("quantum-frontiers", "Quantum Frontiers (Caltech IQIM)", "quantum", "https://quantumfrontiers.com/feed/", "verified", "researcher blog"),
    ("scott-aaronson", "Shtetl-Optimized (Scott Aaronson)", "quantum", "https://scottaaronson.blog/?feed=rss2", "verified", "researcher blog; opinionated"),
    ("aws-quantum", "AWS Quantum Technologies blog", "quantum", "https://aws.amazon.com/blogs/quantum-computing/feed/", "verified", "vendor blog; 2 in 30 days"),
    ("mit-news", "MIT News", "ocw", "https://news.mit.edu/rss/feed", "verified", "stands in for OCW, which has no live feed; 50 entries in 30 days, general MIT news"),
    ("arxiv-quant-ph", "arXiv quant-ph", "arxiv", "https://rss.arxiv.org/rss/quant-ph", "candidate", "arXiv feeds were EMPTY when probed (Tuesday 05:00 UTC, between announcements); not yet seen with items. Abstracts only; high volume needs a cap"),
    ("arxiv-astro-ph-im", "arXiv astro-ph.IM", "arxiv", "https://rss.arxiv.org/rss/astro-ph.IM", "candidate", "empty when probed (see arxiv-quant-ph)"),
    ("arxiv-astro-ph-ep", "arXiv astro-ph.EP", "arxiv", "https://rss.arxiv.org/rss/astro-ph.EP", "candidate", "empty when probed"),
    ("arxiv-physics-space-ph", "arXiv physics.space-ph", "arxiv", "https://rss.arxiv.org/rss/physics.space-ph", "candidate", "empty when probed"),
    ("arxiv-physics-optics", "arXiv physics.optics", "arxiv", "https://rss.arxiv.org/rss/physics.optics", "candidate", "empty when probed; closest category to lithography optics"),
    ("arxiv-cond-mat-mes-hall", "arXiv cond-mat.mes-hall", "arxiv", "https://rss.arxiv.org/rss/cond-mat.mes-hall", "candidate", "empty when probed"),
    ("arxiv-q-bio-nc", "arXiv q-bio.NC", "arxiv", "https://rss.arxiv.org/rss/q-bio.NC", "candidate", "empty when probed; arXiv has no psychology category, this is neuroscience and cognition"),
    ("arxiv-cs-hc", "arXiv cs.HC", "arxiv", "https://rss.arxiv.org/rss/cs.HC", "candidate", "empty when probed"),
    # No usable feed (probed 2026-11-03)
    ("jpl-news", "NASA JPL news", "space", "https://www.jpl.nasa.gov/feeds/news/", "no_feed", "HTTP 403 to automated requests; not evaded"),
    ("nasa-apod", "NASA Astronomy Picture of the Day", "astronomy", "https://apod.nasa.gov/apod.rss", "no_feed", "returned an HTML page, not a feed"),
    ("webb-stsci", "Webb telescope (STScI)", "astronomy", "https://webbtelescope.org/rss", "no_feed", "returned an HTML page, not a feed"),
    ("hubble-nasa", "Hubble (NASA)", "astronomy", "https://science.nasa.gov/mission/hubble/feed/", "no_feed", "returned an HTML page, not a feed"),
    ("asml-news", "ASML news", "litho", "https://www.asml.com/en/news/rss", "no_feed", "404 at the guessed address; real feed not found"),
    ("imec-news", "imec news", "litho", "https://www.imec-int.com/en/rss.xml", "no_feed", "404 at the guessed address; real feed not found"),
    ("spie-news", "SPIE newsroom", "litho", "https://spie.org/news/rss", "no_feed", "returned malformed HTML, not a feed"),
    ("apa-news", "APA press releases", "psychology", "https://www.apa.org/news/press/releases/feed", "no_feed", "returned an HTML page, not a feed"),
    ("mit-ocw", "MIT OpenCourseWare", "ocw", "https://ocw.mit.edu/", "no_feed", "old feed address 404s, the pheedo address no longer resolves, the site publishes no feed; courses are static, so a page or sitemap poll would be needed (unverified)"),
    ("microsoft-quantum", "Microsoft Azure Quantum blog", "quantum", "https://azure.microsoft.com/en-us/blog/quantum/feed/", "verified", "dormant: newest entry 2026-06-02"),
    ("qiskit-medium", "Qiskit blog (Medium)", "quantum", "https://medium.com/feed/qiskit", "verified", "dormant: newest entry 2024-01-25, the blog moved"),
]


# Science sources with no feed, read by polling the listing page (sources/pagepoll.py). Probed 2026-11-06.
SCIENCE_PAGES: list[Source] = [
    Source("ibm-quantum", "IBM Quantum blog", "science", "page", "https://www.ibm.com/quantum/blog", "quantum", "candidate",
           include=("/quantum/blog/",), depth=3, note="no feed; articles are /quantum/blog/<slug>"),
    Source("bps-digest", "BPS Research Digest", "science", "page", "https://www.bps.org.uk/research-digest", "psychology", "candidate",
           include=("/research-digest/",), depth=2, note="no feed; articles are /research-digest/<slug>"),
    Source("tsmc-news", "TSMC press room", "science", "page", "https://pr.tsmc.com/english/latest-news", "litho", "candidate",
           include=("/english/news/",), depth=3, note="no feed (/rss 404); articles are /english/news/<number>; 11 links live 2026-11-11"),
]


def _science() -> list[Source]:
    return SCIENCE_PAGES + [Source(id=i, name=n, feed="science", kind="rss" if s != "no_feed" else "none", url=u, section=t, status=s,
                   active=i not in ("microsoft-quantum", "qiskit-medium"), note=note)
            for i, n, t, u, s, note in _SCIENCE]


_AERO = "aerospace-defence"
# Probed 2026-11-03. RSS where one exists, otherwise the site's own sitemap (kind "sitemap") filtered to its news paths.
# Sitemap sources are "candidate" until a live run has proven their pages extract; lastmod is noisy on these sites
# (Saab: 501 job postings and Boeing: 222 template pages touched in 30 days), hence the include prefixes.
AEROSPACE_DEFENCE: list[Source] = [
    Source("breaking-defense", "Breaking Defense", _AERO, "rss", "https://breakingdefense.com/feed/", "news", "verified", note="15 entries, all dated"),
    Source("defensescoop", "DefenseScoop", _AERO, "rss", "https://defensescoop.com/feed/", "news", "verified"),
    Source("defense-news", "Defense News", _AERO, "rss", "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", "news", "verified"),
    Source("twz", "The War Zone", _AERO, "rss", "https://www.twz.com/feed", "news", "verified", note="29 entries"),
    Source("airandspaceforces", "Air & Space Forces Magazine", _AERO, "rss", "https://www.airandspaceforces.com/feed/", "news", "verified"),
    Source("flightglobal", "FlightGlobal", _AERO, "rss", "https://www.flightglobal.com/rss", "news", "verified", note="partly paywalled; the paywall rule skips those"),
    Source("nasa-aeronautics", "NASA aeronautics", _AERO, "rss", "https://www.nasa.gov/aeronautics/feed/", "research", "verified"),
    Source("airbus", "Airbus", _AERO, "rss", "https://www.airbus.com/en/rss.xml", "industry", "verified", note="low volume (1 in 30 days)"),
    Source("space-india", "Space India", _AERO, "rss", "https://space-india.com/feed/", "news", "verified", note="Indian space sector news; found 2026-11-06"),
    Source("bharat-shakti", "Bharat Shakti", _AERO, "rss", "https://bharatshakti.in/feed/", "news", "verified", note="Indian defence news; found 2026-11-06"),
    Source("lockheed", "Lockheed Martin news", _AERO, "sitemap", "https://www.lockheedmartin.com/sitemap-en-us.xml", "industry", "candidate",
           include=("/en-us/news/",), note="2,117 URLs, all with lastmod"),
    Source("boeing", "Boeing features", _AERO, "sitemap", "https://www.boeing.com/sitemap.xml", "industry", "candidate",
           include=("/features/{year}/",), note="lastmod looks bulk-touched (1,066 of 1,937 pages in 30 days): the text-hash gate matters here"),
    Source("rtx", "RTX news", _AERO, "sitemap", "https://www.rtx.com/sitemap.xml", "industry", "candidate", include=("/news/news-center/", "/news/{year}/")),
    Source("darpa", "DARPA news", _AERO, "sitemap", "https://www.darpa.mil/sitemap.xml", "research", "candidate",
           include=("/news/{year}/",), note="program pages (/research/programs, 175 touched in 30 days) are deliberately left out as too noisy"),
    Source("saab", "Saab newsroom", _AERO, "sitemap", "https://www.saab.com/sitemap.xml", "industry", "candidate", include=("/newsroom/",),
           note="10,901 URLs; English newsroom only (the /sv/ copies and 501 job postings are excluded)"),
    Source("anduril", "Anduril news", _AERO, "sitemap", "https://www.anduril.com/sitemap.xml", "industry", "candidate", include=("/news/",), active=False,
           note="inactive: the pages are a JavaScript app (one <p> in the HTML, extraction under 800 chars), unreadable without a headless browser, which is not built"),
    Source("northrop", "Northrop Grumman", _AERO, "sitemap", "https://www.northropgrumman.com/sitemap.xml", "industry", "candidate", active=False,
           note="sitemap exists (the first one listed is video-only); URL shapes not analysed yet, so inactive"),
    Source("aviation-week", "Aviation Week", _AERO, "rss", "https://aviationweek.com/rss.xml", "news", "verified", active=False,
           note="dormant: newest entry 2026-03-31, and mostly paywalled"),
    # Probed 2026-11-03, not usable
    Source("dod-releases", "US DoD releases", _AERO, "none", "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=10", "news", "no_feed",
           note="feed parses but has 0 entries; the site may have moved (war.gov)"),
    Source("sipri", "SIPRI", _AERO, "none", "https://www.sipri.org/", "research", "no_feed", note="RSS 404; the sitemap is an index of 58 children, too many hops"),
    Source("faa", "FAA newsroom", _AERO, "none", "https://www.faa.gov/newsroom", "industry", "no_feed", note="RSS 404; the sitemap is an index of 14 children"),
    Source("general-dynamics", "General Dynamics", _AERO, "none", "https://www.gd.com/", "industry", "no_feed", note="robots.txt and sitemap answer 403; not evaded"),
    Source("bae-systems", "BAE Systems", _AERO, "none", "https://www.baesystems.com/", "industry", "no_feed", note="sitemap answers 403; not evaded"),
    Source("drdo", "DRDO", _AERO, "none", "https://www.drdo.gov.in/", "research", "no_feed", note="connection timed out from here"),
    Source("isro", "ISRO", _AERO, "none", "https://www.isro.gov.in/", "research", "no_feed", note="no robots.txt or sitemap (404); needs a listing-page poll"),
    Source("hal", "Hindustan Aeronautics", _AERO, "none", "https://hal-india.co.in/", "industry", "no_feed", note="sitemap lists a single URL"),
]

SOURCES: list[Source] = _engineering() + EMAIL_AND_PLANNED + _science() + AEROSPACE_DEFENCE


def by_feed(feed: str, *, usable_only: bool = False) -> list[Source]:
    out = [s for s in SOURCES if s.feed == feed]
    return [s for s in out if s.status in ("verified", "candidate") and s.active] if usable_only else out
