from newsletter_brief.parse.html_to_text import Resolver, html_to_text
from newsletter_brief.parse.links import extract_links, extract_links_from_text
from newsletter_brief.parse.redirects import resolve_offline
from newsletter_brief.schemas import ParsedEmail, RawEmail


def parse_email(email: RawEmail, resolve: Resolver = resolve_offline) -> ParsedEmail:
    if email.html:
        body, links = html_to_text(email.html, resolve), extract_links(email.html, resolve)
    else:
        body = email.text or ""
        links = extract_links_from_text(body)
    return ParsedEmail(
        email_id=email.id,
        sender_addr=email.sender_addr,
        subject=email.subject,
        body_text=body,
        links=links,
    )
