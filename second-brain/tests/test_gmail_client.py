import base64

from newsletter_brief.ingest.gmail_client import to_raw_email


def b64(s: str, encoding: str = "utf-8") -> str:
    # Gmail uses base64url and strips the "=" padding
    return base64.urlsafe_b64encode(s.encode(encoding)).decode().rstrip("=")


def headers(**kw):
    return [{"name": k.replace("_", "-"), "value": v} for k, v in kw.items()]


def test_nested_multipart_alternative_inside_mixed():
    message = {
        "id": "abc",
        "internalDate": "1762060000000",
        "payload": {
            "mimeType": "multipart/mixed",
            "headers": headers(
                From='"The Batch" <Hello@Deeplearning.AI>',
                Subject="Issue 42",
                Date="Mon, 02 Nov 2026 08:00:00 +0000",
                List_Unsubscribe="<https://x.com/unsub>",
            ),
            "parts": [
                {
                    "mimeType": "multipart/alternative",
                    "parts": [
                        {"mimeType": "text/plain", "body": {"data": b64("plain body")}},
                        {"mimeType": "text/html", "body": {"data": b64("<p>html body é</p>")}},
                    ],
                },
                {"mimeType": "application/pdf", "body": {"attachmentId": "zzz"}},
            ],
        },
    }
    email = to_raw_email(message)
    assert email.sender_addr == "hello@deeplearning.ai"
    assert email.subject == "Issue 42"
    assert email.html == "<p>html body é</p>"
    assert email.text == "plain body"
    assert email.has_list_unsubscribe


def test_single_part_message_and_bad_date_falls_back_to_internal_date():
    message = {
        "id": "def",
        "internalDate": "1762060000000",
        "payload": {
            "mimeType": "text/html",
            "headers": headers(From="a@b.com", Subject="s", Date="not a date"),
            "body": {"data": b64("<b>hi</b>")},
        },
    }
    email = to_raw_email(message)
    assert email.html == "<b>hi</b>"
    assert email.text is None
    assert not email.has_list_unsubscribe
    assert email.date.year == 2025  # 1762060000 s since epoch -> Nov 2025


def test_declared_charset_is_used():
    message = {
        "id": "ghi",
        "internalDate": "0",
        "payload": {
            "mimeType": "text/plain",
            "headers": headers(From="a@b.com", Subject="s", Date="Mon, 02 Nov 2026 08:00:00 +0000"),
            "body": {"data": b64("café", "latin-1")},
        },
    }
    message["payload"]["headers"].append({"name": "Content-Type", "value": 'text/plain; charset="iso-8859-1"'})
    assert to_raw_email(message).text == "café"


def _http_error(status: int, reason: str):
    import httplib2
    from googleapiclient.errors import HttpError

    body = ('{"error": {"errors": [{"reason": "%s"}]}}' % reason).encode()
    return HttpError(httplib2.Response({"status": status}), body)


class FlakyRequest:
    def __init__(self, failures):
        self.failures = list(failures)
        self.calls = 0

    def execute(self):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return {"ok": True}


def test_rate_limit_is_retried(monkeypatch):
    from newsletter_brief.ingest import gmail_client

    monkeypatch.setattr(gmail_client.time, "sleep", lambda s: None)
    req = FlakyRequest([_http_error(403, "rateLimitExceeded"), _http_error(429, "x")])
    assert gmail_client._execute(req) == {"ok": True}
    assert req.calls == 3


def test_other_errors_are_not_retried(monkeypatch):
    import pytest

    from newsletter_brief.ingest import gmail_client

    monkeypatch.setattr(gmail_client.time, "sleep", lambda s: None)
    req = FlakyRequest([_http_error(403, "insufficientPermissions")])
    with pytest.raises(Exception):
        gmail_client._execute(req)
    assert req.calls == 1
