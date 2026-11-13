import json
import subprocess

import pytest

from newsletter_brief.schemas import Link, ParsedEmail
from newsletter_brief.summarize.backend import ClaudeCliBackend, LLMError, child_env
from newsletter_brief.summarize.extract import triage_email


class FakeRunner:
    """Stands in for subprocess.run; records the call and replays a canned response."""

    def __init__(self, stdout="", returncode=0, stderr=""):
        self.cp = subprocess.CompletedProcess([], returncode, stdout=stdout, stderr=stderr)
        self.calls = []

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        return self.cp


def backend(runner):
    return ClaudeCliBackend(claude_bin="claude", runner=runner, log_usage=False)


def ok_response(data):
    return json.dumps({"type": "result", "is_error": False, "structured_output": data, "total_cost_usd": 0.01, "usage": {"input_tokens": 5, "output_tokens": 7}})


def run(runner):
    return backend(runner).run(system="sys", prompt="the document", schema={"type": "object"}, model="sonnet", effort="low")


def test_command_is_locked_down():
    runner = FakeRunner(ok_response({"a": 1}))
    result = run(runner)
    cmd, kwargs = runner.calls[0]
    assert result.data == {"a": 1} and result.cost_usd == 0.01
    assert cmd[cmd.index("--tools") + 1] == ""  # all tools disabled
    for flag in ("--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"):
        assert flag in cmd
    assert cmd[cmd.index("--setting-sources") + 1] == ""
    assert json.loads(cmd[cmd.index("--json-schema") + 1]) == {"type": "object"}
    assert kwargs["input"] == "the document"  # untrusted text goes via stdin, never into the command line
    assert "the document" not in cmd


def test_env_drops_api_key_but_keeps_subscription_token():
    env = child_env({"ANTHROPIC_API_KEY": "k", "CLAUDE_CODE_OAUTH_TOKEN": "t", "CLAUDE_CODE_SESSION_ID": "s", "CLAUDECODE": "1", "PATH": "p"})
    assert env == {"CLAUDE_CODE_OAUTH_TOKEN": "t", "PATH": "p"}
    assert "ANTHROPIC_API_KEY" in child_env({"ANTHROPIC_API_KEY": "k"}, allow_api_key=True)


def test_errors_are_raised_not_swallowed():
    with pytest.raises(LLMError, match="exited 1"):
        run(FakeRunner(returncode=1, stderr="boom"))
    with pytest.raises(LLMError, match="no structured_output"):
        run(FakeRunner(json.dumps({"is_error": False, "result": "plain text"})))
    with pytest.raises(LLMError, match="reported an error"):
        run(FakeRunner(json.dumps({"is_error": True, "result": "rate limited"})))
    with pytest.raises(LLMError, match="did not return JSON"):
        run(FakeRunner("not json"))


def test_check_auth_requires_subscription_login():
    good = FakeRunner(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "subscriptionType": "pro"}))
    assert backend(good).check_auth()["subscriptionType"] == "pro"
    with pytest.raises(LLMError, match="subscription"):
        backend(FakeRunner(json.dumps({"loggedIn": True, "authMethod": "api_key"}))).check_auth()
    with pytest.raises(LLMError, match="Not logged in"):
        backend(FakeRunner(json.dumps({"loggedIn": False}))).check_auth()


def item(url, **kw):
    base = dict(title="t", url=url, type="article", topics=["ai"], summary_2_lines="s", why_it_matters="w", relevance=4, is_promotional=False, confidence="high", category="applied_guide", breakthrough=False, open_source=False, highlight_note="")
    return {**base, **kw}


def test_triage_drops_invented_urls_and_sets_source():
    parsed = ParsedEmail(
        email_id="e1", sender_addr="lenny@substack.com", subject="s", body_text="body",
        links=[Link(text="real", url="https://real.dev/a")],
    )
    runner = FakeRunner(ok_response({"items": [item("https://real.dev/a"), item("https://evil.example/invented")]}))
    items = triage_email(parsed, backend=backend(runner))
    assert [i.url for i in items] == ["https://real.dev/a"]
    assert items[0].source == "lenny@substack.com" and items[0].doc_id == "e1"


def test_triage_rejects_schema_violations():
    parsed = ParsedEmail(email_id="e1", sender_addr="a@b.com", subject="s", body_text="b", links=[])
    bad = ok_response({"items": [item("https://x.dev", relevance=9)]})  # relevance must be 0-5
    with pytest.raises(Exception):
        triage_email(parsed, backend=backend(FakeRunner(bad)))
