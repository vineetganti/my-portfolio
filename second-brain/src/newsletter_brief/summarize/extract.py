"""The two LLM passes.

Pass 1 (triage):  one call per newsletter -> validated TriageItems, feeds the brief for every new email.
Pass 2 (polish):  runs ONLY for items the user approved -> PolishedNote, becomes the Notion page body.
"""
from newsletter_brief.config import settings
from newsletter_brief.schemas import Document, ParsedEmail, PolishedNote, SkippedLink, TriageBatch, TriageItem
from newsletter_brief.summarize.backend import ClaudeCliBackend, LLMBackend
from newsletter_brief.summarize.prompts import DOC_TRIAGE_SYSTEM, MAX_BODY_CHARS, POLISH_SYSTEM, TRIAGE_SYSTEM, TRUNCATION_MARK


def _triage_prompt(parsed: ParsedEmail) -> str:
    links = "\n".join(f"- {l.text or '(no text)'} -> {l.url}" for l in parsed.links)
    return (
        f"From: {parsed.sender_addr}\nSubject: {parsed.subject}\n\n"
        f"--- EMAIL BODY ---\n{_clip(parsed.body_text)}\n\n"
        f"--- LINKS ---\n{links}\n"
    )


def triage_email(parsed: ParsedEmail, backend: LLMBackend | None = None, model: str | None = None) -> list[TriageItem]:
    return triage_with_audit(parsed, backend, model)[0]


def triage_with_audit(
    parsed: ParsedEmail, backend: LLMBackend | None = None, model: str | None = None
) -> tuple[list[TriageItem], list[SkippedLink]]:
    """Items plus the model's skip decisions (only for links that really were in the email)."""
    backend = backend or ClaudeCliBackend()
    result = backend.run(
        system=TRIAGE_SYSTEM,
        prompt=_triage_prompt(parsed),
        schema=TriageBatch.model_json_schema(),
        model=model or settings.triage_model,
        effort="low",
    )
    batch = TriageBatch.model_validate(result.data)
    allowed = {l.url for l in parsed.links}
    # The model may only point at links that were in the email. Anything else is dropped, not trusted.
    items = [
        TriageItem(**item.model_dump(), doc_id=parsed.email_id, source=parsed.sender_addr)
        for item in batch.items
        if item.url in allowed
    ]
    return items, [sk for sk in batch.skipped if sk.url in allowed]


def _clip(text: str) -> str:
    return text if len(text) <= MAX_BODY_CHARS else text[:MAX_BODY_CHARS] + TRUNCATION_MARK


def triage_document(doc: Document, backend: LLMBackend | None = None, model: str | None = None, examples: str = "") -> TriageItem | None:
    """Pass 1 for a single-article document (RSS item etc.). The item's url and ids come from the document, never the model."""
    backend = backend or ClaudeCliBackend()
    result = backend.run(
        system=DOC_TRIAGE_SYSTEM,
        prompt=f"Source: {doc.source_id}\nTitle: {doc.title}\nURL: {doc.url}\n\n--- ARTICLE TEXT ---\n{_clip(doc.body_text)}\n{examples}",
        schema=TriageBatch.model_json_schema(),
        model=model or settings.triage_model,
        effort="low",
    )
    batch = TriageBatch.model_validate(result.data)
    if not batch.items:
        return None
    # url and title are facts about the document, not model output: a link's headline must be the article's own
    first = batch.items[0].model_dump() | {"url": doc.url, "title": doc.title}
    return TriageItem(**first, doc_id=doc.id, source=doc.source_id)


def polish(title: str, url: str, text: str, backend: LLMBackend | None = None, model: str | None = None) -> PolishedNote:
    backend = backend or ClaudeCliBackend()
    result = backend.run(
        system=POLISH_SYSTEM,
        prompt=f"Title: {title}\nSource: {url}\n\n--- DOCUMENT ---\n{_clip(text)}\n",
        schema=PolishedNote.model_json_schema(),
        model=model or settings.polish_model,
    )
    return PolishedNote.model_validate(result.data)
