"""Shared data shapes. Stage 1 only: raw email in, parsed email out.

Summary/brief-item schemas get added in Stage 2.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RawEmail(BaseModel):
    id: str
    sender: str  # full "Name <addr>" From header
    sender_addr: str  # bare address, lowercased; this is the allowlist key
    subject: str
    date: datetime
    html: str | None = None
    text: str | None = None
    has_list_unsubscribe: bool = False


class Link(BaseModel):
    text: str
    url: str  # canonical form (tracking stripped)


class ParsedEmail(BaseModel):
    email_id: str
    sender_addr: str
    subject: str
    body_text: str
    links: list[Link]


# ---- Stage 2: LLM output (validated against these; also sent to `claude -p --json-schema`) ----
ItemType = Literal["article", "tool", "paper", "video", "regulation", "filing", "news", "promo", "other"]
Category = Literal["llm_internals", "distributed_systems", "core_engineering", "ai_research", "applied_guide", "case_study",
                   "product_or_business", "other"]


class TriageItemOut(BaseModel):
    """One item the model extracted from a newsletter. Exactly what the model is asked to return."""

    title: str
    url: str  # must be copied from the email's link list; code rejects anything else
    type: ItemType
    topics: list[str]
    summary_2_lines: str
    why_it_matters: str
    relevance: int = Field(ge=0, le=5)
    is_promotional: bool
    confidence: Literal["low", "medium", "high"]
    category: Category  # what kind of learning material this is; the first four are the user's top-tier areas
    breakthrough: bool  # the text itself reports a new capability or result that materially changes what is possible
    open_source: bool  # announces or contributes open-source code, models, weights, datasets or standards
    highlight_note: str  # one sentence of evidence from the text; empty when neither flag is set


SkipReason = Literal["sponsor", "promotion", "navigation", "social", "duplicate", "not_content"]


class SkippedLink(BaseModel):
    """A link the model chose not to turn into an item, with why. Makes silent misses auditable."""

    url: str
    reason: SkipReason


class TriageBatch(BaseModel):
    items: list[TriageItemOut]
    skipped: list[SkippedLink] = Field(default_factory=list)


class TriageItem(TriageItemOut):
    """Model output plus fields set by our code, never by the model."""

    doc_id: str
    source: str


class PolishedNote(BaseModel):
    """Pass 2: written only for items the user approved; becomes the Notion page body."""

    title: str
    summary: str
    key_takeaways: list[str]
    entities: list[str]
    dates_and_deadlines: list[str]
    implications: str
    open_questions: list[str]
    topics: list[str]
    confidence: Literal["low", "medium", "high"]


class Document(BaseModel):
    """Source-agnostic unit of content: an email, an RSS item, a listing page entry. Pipeline stages after
    parsing work on this, so every source plugs in the same way."""

    id: str  # stable: source id plus a hash of the canonical url
    source_id: str  # key in sources.registry
    source_type: Literal["email", "rss", "page"]
    title: str
    url: str
    published: datetime | None = None
    body_text: str
    links: list[Link] = Field(default_factory=list)
    full_text: bool = True  # False when the body is only a summary/teaser
