"""Starter Freesolo environment.

Edit dataset/train.jsonl and the reward code, then upload with
`flash env push --name my-env .`.

A managed run should use the returned [environment] id from
`flash env push --name my-env .`.

This starter keeps a tiny smoke-test dataset in dataset/train.jsonl. Replace it
with your real training rows before a real run.
"""

from __future__ import annotations

import json
from pathlib import Path

from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult


DEFAULT_DATASET_PATH = Path(__file__).parent / "dataset" / "train.jsonl"
SYSTEM_MESSAGE_PATH = Path(__file__).parent / "system_message.txt"

# Single source of truth for the system prompt — the eval harness
# (finetune/qaEval.js --system-file) reads this same file so train/inference
# framing stay identical. Empty file => no system message.
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


def exact_match_reward(example: TaskExample, response_text: str) -> RewardResult:
    expected = str(example.output or "").strip()
    score = 1.0 if expected and expected in response_text else 0.0
    return RewardResult(score=score, threshold=1.0)


class StarterEnv(EnvironmentSingleTurn):
    dataset = load_jsonl(DEFAULT_DATASET_PATH)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        msgs = []
        if SYSTEM_MESSAGE:
            msgs.append({"role": "system", "content": SYSTEM_MESSAGE})
        msgs.append({"role": "user", "content": example.input})
        return msgs

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return exact_match_reward(example, response_text)


def load_environment(dataset_path: str | None = None, **kwargs) -> StarterEnv:
    env = StarterEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    return env
