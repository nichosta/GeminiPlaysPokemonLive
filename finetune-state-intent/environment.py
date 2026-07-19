"""State→intent SFT environment (E2 after-lane).

Self-contained freesolo environment for the (state, intent) lane. This folder
is published INDEPENDENTLY of the wiki-QA lane (`finetune/`) so the two envs
never share a push source — `flash env push .` from here uploads ONLY the
intent data, and the QA folder's `train.jsonl` can never leak into this env
(the contamination that previously put 558 QA rows in the frlg-state-intent
snapshot).

- trains on dataset/train.jsonl ({input: state, output: <intent+rationale JSON>})
- uses system_message.txt (E2's SYSTEM_PROMPT, copied from the QA lane's
  system_message_intent.txt) so train/inference framing match the eval
  (finetune-state-intent/intentEval.js), which defaults to the same file.
- rewards TOOL-NAME match, not raw substring. The QA lane's substring reward
  is fine for short wiki-QA golds but brittle here: the gold is a JSON object
  whose rationale wording and arg key-order vary, so an exact-substring check
  would under-reward correct intents. This reward parses the model's response
  JSON and the gold JSON and scores 1.0 iff intent.name matches (the headline
  metric the eval measures too).

flash loads `load_environment()` from this file directly — no file-swapping
needed. Push with:
    flash env push --name frlg-state-intent .
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


def intent_name(text: str) -> str | None:
    obj = _first_json_object(text)
    intent = (obj or {}).get("intent") if isinstance(obj, dict) else None
    if isinstance(intent, dict):
        return intent.get("name")
    return None


def intent_name_reward(example: TaskExample, response_text: str) -> RewardResult:
    expected_name = intent_name(str(example.output or ""))
    got_name = intent_name(response_text or "")
    score = 1.0 if expected_name and got_name == expected_name else 0.0
    return RewardResult(score=score, threshold=1.0)


class IntentEnv(EnvironmentSingleTurn):
    dataset = load_jsonl(DEFAULT_DATASET_PATH)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        msgs = []
        if SYSTEM_MESSAGE:
            msgs.append({"role": "system", "content": SYSTEM_MESSAGE})
        msgs.append({"role": "user", "content": example.input})
        return msgs

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return intent_name_reward(example, response_text)


def load_environment(dataset_path: str | None = None, **kwargs) -> IntentEnv:
    env = IntentEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    return env
