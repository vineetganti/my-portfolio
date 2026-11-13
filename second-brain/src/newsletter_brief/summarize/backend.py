"""LLM backend: `claude -p` on the user's Claude subscription.

Safety posture (documents are untrusted input):
- no tools at all (`--tools ""`), so nothing in a document can make the model act
- empty throwaway working directory, no user/project settings, no MCP servers, no skills
- output must validate against a JSON schema, and callers validate again with pydantic
- ANTHROPIC_API_KEY is stripped from the child's environment, because an API key silently
  overrides the subscription and bills the API instead
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from newsletter_brief.config import settings

# Never reach the child: the API key overrides the subscription; the rest tie a child process
# to *this* interactive session. CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) is kept,
# it is how unattended/scheduled runs authenticate.
_STRIP_EXACT = {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_PID", "CLAUDE_AGENT_SDK_VERSION"}
_KEEP_PREFIXED = {"CLAUDE_CODE_OAUTH_TOKEN"}


class LLMError(RuntimeError):
    pass


@dataclass
class LLMResult:
    data: dict
    model: str
    cost_usd: float | None = None
    usage: dict = field(default_factory=dict)
    duration_ms: int | None = None


class LLMBackend(Protocol):
    def run(self, *, system: str, prompt: str, schema: dict, model: str, effort: str | None = None) -> LLMResult: ...


def find_claude() -> str:
    """CLAUDE_BIN, else `claude` on PATH, else the newest binary bundled with the VS Code extension."""
    if settings.claude_bin:
        return settings.claude_bin
    on_path = shutil.which("claude")
    if on_path:
        return on_path
    pattern = str(Path.home() / ".vscode" / "extensions" / "anthropic.claude-code-*" / "resources" / "native-binary" / "claude*")

    def version_key(path: str) -> tuple[int, ...]:
        m = re.search(r"claude-code-([\d.]+)", path)
        return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)

    candidates = sorted(glob.glob(pattern), key=version_key)
    if candidates:
        return candidates[-1]  # path changes on every extension update; install the CLI to avoid this
    raise LLMError("claude CLI not found. Install Claude Code, or set CLAUDE_BIN in .env.")


def child_env(base: dict[str, str] | None = None, allow_api_key: bool = False) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for key in list(env):
        if key in _KEEP_PREFIXED:
            continue
        if (key in _STRIP_EXACT and not (allow_api_key and key == "ANTHROPIC_API_KEY")) or key.startswith("CLAUDE_CODE_"):
            del env[key]
    return env


class ClaudeCliBackend:
    def __init__(
        self,
        claude_bin: str | None = None,
        runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
        allow_api_key: bool = False,
        timeout_s: int = 300,
        workdir: Path | None = None,
        log_usage: bool = True,
    ):
        self.claude_bin = claude_bin or find_claude()
        self.runner = runner
        self.allow_api_key = allow_api_key
        self.timeout_s = timeout_s
        self.workdir = workdir
        self.log_usage = log_usage

    def check_auth(self) -> dict:
        """Fail loudly unless we are on the subscription (authMethod 'claude.ai')."""
        proc = self.runner(
            [self.claude_bin, "auth", "status"], capture_output=True, text=True, encoding="utf-8",
            env=child_env(allow_api_key=self.allow_api_key), timeout=60,
        )
        try:
            status = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise LLMError(f"could not read `claude auth status`: {proc.stdout[:200]!r} {proc.stderr[:200]!r}")
        if not status.get("loggedIn"):
            raise LLMError("Not logged in. Run `claude` once and sign in with your Claude account.")
        if status.get("authMethod") != "claude.ai" and not self.allow_api_key:
            raise LLMError(f"Expected subscription login (claude.ai), got {status.get('authMethod')!r}.")
        return status

    def run(self, *, system: str, prompt: str, schema: dict, model: str, effort: str | None = None) -> LLMResult:
        cmd = [
            self.claude_bin, "-p",
            "--output-format", "json",
            "--json-schema", json.dumps(schema),
            "--tools", "",  # disable every tool
            "--no-session-persistence",
            "--disable-slash-commands",
            "--setting-sources", "",  # no user/project/local settings (hooks, permissions, instructions)
            "--strict-mcp-config",  # and no MCP servers, since none are passed
            "--system-prompt", system,
            "--model", model,
        ]
        if effort:
            cmd += ["--effort", effort]

        with tempfile.TemporaryDirectory(prefix="nb-llm-") as tmp:
            cwd = self.workdir or Path(tmp)
            try:
                proc = self.runner(
                    cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                    cwd=cwd, env=child_env(allow_api_key=self.allow_api_key), timeout=self.timeout_s,
                )
            except subprocess.TimeoutExpired:
                raise LLMError(f"claude -p timed out after {self.timeout_s}s")
        if proc.returncode != 0:
            raise LLMError(f"claude -p exited {proc.returncode}: {(proc.stderr or proc.stdout)[:500]}")

        result = self._parse(proc.stdout)
        if result.get("is_error"):
            raise LLMError(f"claude reported an error: {str(result.get('result'))[:500]}")
        data = result.get("structured_output")
        if data is None:  # docs: a run without valid structured output has no such field
            raise LLMError(f"no structured_output in response; text was: {str(result.get('result'))[:300]!r}")

        out = LLMResult(
            data=data, model=model, cost_usd=result.get("total_cost_usd"),
            usage=result.get("usage") or {}, duration_ms=result.get("duration_ms"),
        )
        if self.log_usage:
            self._log(out)
        return out

    @staticmethod
    def _parse(stdout: str) -> dict:
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            raise LLMError(f"claude -p did not return JSON: {stdout[:300]!r}")
        if isinstance(parsed, list):  # some output modes return an event list; take the result event
            parsed = next((e for e in reversed(parsed) if isinstance(e, dict) and e.get("type") == "result"), {})
        return parsed

    @staticmethod
    def _log(result: LLMResult) -> None:
        settings.usage_log.parent.mkdir(parents=True, exist_ok=True)
        line = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": result.model, "cost_usd": result.cost_usd,
            "input_tokens": result.usage.get("input_tokens"), "output_tokens": result.usage.get("output_tokens"),
            "duration_ms": result.duration_ms,
        }
        with settings.usage_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
