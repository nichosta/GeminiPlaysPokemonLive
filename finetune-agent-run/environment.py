"""Agent-trace distillation SFT environment (E3/E4).

Self-contained freesolo environment for the (live game state, tool_call) lane.
This folder is published INDEPENDENTLY of the wiki-QA lane (`finetune/`) and the
state-intent lane (`finetune-state-intent/`) so no env's push source ever
mixes with another's — `flash env push .` from here uploads ONLY this lane's
data.

Unlike the other two lanes, this dataset is genuine behavior distillation: the
gold `tool_call` is what a LIVE gemini-3.5-flash run actually chose while
playing (llminteract/traceLogger.js -> staticdata/extractAgentTraces.js ->
buildAgentDataset.js), filtered to outcome.status == "ok" turns only so the
student never learns gemini's mistakes (invalid_args / failed / interrupted /
budget_exhausted turns are excluded upstream — see
staticdata/extractAgentTraces.js's header for the exact rule, including that
this drops every low-health interrupt).

- trains on dataset/train.jsonl ({input: state, output: <tool_call+commentary JSON>})
- uses system_message.txt (the D1 tool-interface doc framed for a live state
  prompt) so train/inference framing match the eval (agentTraceEval.js),
  which defaults to the same file.
- rewards TOOL-NAME match, not raw substring, for the same reason as the
  intent lane: the gold is a JSON object whose commentary wording and arg
  key-order vary, so an exact-substring check would under-reward correct calls.

flash loads `load_environment()` from this file directly — no file-swapping
needed. Push with:
    flash env push --name frlg-agent-traces .
then paste the returned id into configs/sft.toml's [environment] id.
"""

from __future__ import annotations

import json
from pathlib import Path

from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult


DEFAULT_DATASET_PATH = Path(__file__).parent / "dataset" / "train.jsonl"
SYSTEM_MESSAGE_PATH = Path(__file__).parent / "system_message.txt"

SYSTEM_MESSAGE = (
    SYSTEM_MESSAGE_PATH.read_text().strip()
    if SYSTEM_MESSAGE_PATH.exists()
    else ""
)


def load_jsonl(path: str | Path):
    rows = []
    with Path(path).open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _first_json_object(s: str) -> dict | None:
    """Pull the outermost {...} via brace counting (models may wrap JSON)."""
    if not s:
        return None
    s = s.strip()
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start : i + 1])
                except Exception:
                    return None
    return None


def tool_call_name(text: str) -> str | None:
    obj = _first_json_object(text)
    call = (obj or {}).get("tool_call") if isinstance(obj, dict) else None
    if isinstance(call, dict):
        return call.get("name")
    return None


def tool_name_reward(example: TaskExample, response_text: str) -> RewardResult:
    expected_name = tool_call_name(str(example.output or ""))
    got_name = tool_call_name(response_text or "")
    score = 1.0 if expected_name and got_name == expected_name else 0.0
    return RewardResult(score=score, threshold=1.0)


class AgentTraceEnv(EnvironmentSingleTurn):
    dataset = load_jsonl(DEFAULT_DATASET_PATH)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        msgs = []
        if SYSTEM_MESSAGE:
            msgs.append({"role": "system", "content": SYSTEM_MESSAGE})
        msgs.append({"role": "user", "content": example.input})
        return msgs

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return tool_name_reward(example, response_text)


def load_environment(dataset_path: str | None = None, **kwargs) -> AgentTraceEnv:
    env = AgentTraceEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    return env
