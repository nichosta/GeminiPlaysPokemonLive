# TRAINING.md — how to actually improve a model with Flash

> **If you are an AI agent asked to train a model here, read this first.**
> `flash env setup` dropped this file next to your `environment.py` and `configs/`.
> It is the playbook Freesolo's own training agents follow to turn a *finished*
> run into a model that *measurably improved*. The mechanics live in the hosted
> docs (https://freesolo.co/docs); this file is the judgment that sits on top of them.

A run that reaches `done` is **not** the same as a run that worked. Submitting a run
is not a result. The whole job is to design the learning signal, read what the run
actually produced, and decide — honestly — whether the model got better.

---

## Using Flash

Flash is a **managed** training service with a thin CLI/client. You author an
environment (the task + its reward), publish it, and submit SFT, GRPO, or on-policy
**distillation** runs from a TOML config. Flash allocates the cheapest fitting managed GPU class, runs the job,
streams logs back, and serves the result. You never handle infrastructure credentials —
you authenticate once with a freesolo API key, and everything below is a `flash` CLI
command.

### Install & authenticate

```bash
pip install freesolo-flash          # installs the `flash` CLI (import name is also `flash`)
flash login --api-key fslo_...       # or: export FREESOLO_API_KEY=fslo_...  (create a key at https://freesolo.co)
flash whoami                         # confirm the identity behind your key
flash models                         # supported base model ids
flash gpus                           # managed GPU classes with estimated $/hr
```

### The project layout (`flash env setup` created this)

```text
environment.py          # the task: how to prompt the model and how to score it
dataset/train.jsonl     # training rows, one JSON object per line: {"input": ..., "output": ...}
configs/sft.toml        # an SFT run config
configs/rl.toml         # a GRPO (RL) run config
configs/opd.toml        # an on-policy distillation run config
TRAINING.md             # this file
```

### 1. Author the environment

`environment.py` defines the task. A single-turn env subclasses
`EnvironmentSingleTurn`, turns a row into a prompt, and scores the model's response
with a `RewardResult` (see *Reward design* below). `load_environment()` is the entry
point Flash calls:

```python
from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult

class MyEnv(EnvironmentSingleTurn):
    dataset = load_jsonl("dataset/train.jsonl")   # rows -> TaskExample(input=..., output=...)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        return [{"role": "user", "content": example.input}]

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        expected = str(example.output or "").strip()
        score = 1.0 if expected and expected in response_text else 0.0
        return RewardResult(score=score, threshold=1.0)

def load_environment(**kwargs) -> MyEnv:
    return MyEnv()
```

For tool use, dialogue, or games, subclass `EnvironmentMultiTurn` instead and drive the
conversation across turns. The reward is the same `RewardResult` contract either way.

### 2. Publish the environment

A managed run references a **published** environment by id — so push your folder first:

```bash
flash env push --name my-env .       # uploads this project; prints an env id like "your-org/my-env"
flash env list                       # local env sources you can push
```

To train against an env someone else published, just set its slug as `[environment] id` —
no separate step is needed. Paste the returned id into `[environment] id` in **both** configs.
Re-push after any
edit to `environment.py` or `dataset/` so the managed run uses your change.

### 3. Configure the run (TOML)

```toml
model = "Qwen/Qwen3.5-4B"   # see `flash models`
# model_revision = "main"   # optional ref resolved to an immutable hugging face commit before submit
algorithm = "sft"           # "sft" (supervised), "grpo" (RL), or "opd" (on-policy distillation)
# thinking = true           # opt-in reasoning mode, for models that support it
# seed = 42                 # reproducible per-run seed; omitted defaults to 42

[environment]
id = "your-org/my-env"      # the id printed by `flash env push`
# secrets = ["SERPAPI_API_KEY"]   # only the NAMES of env vars your environment reads;
                                   # values are pulled from your shell/.env at submit time,
                                   # never stored in the spec

[train]
epochs = 1                  # one pass over the retained train rows
max_examples = 2            # rows to train on (the starter dataset has 2)
# max_steps = 100           # positive values set the exact optimizer-update horizon
# save_at_steps = [10, 50, 100]  # requires max_steps; overrides save_every
lora_rank = 32
lora_alpha = 64
# All SFT/GRPO knobs live under [train]. Do not add [sft] or [grpo] tables.
```

GPU and HF artifacts are **managed by default**: `gpu.type` is a non-pinning managed
hint and `train.hf_repo` remains platform-managed. For controlled
experiments, `[gpu] provider` restricts allocation to one provider and `[gpu] exact_type`
pins one active validated GPU class; otherwise the allocator picks the cheapest fitting
class. Run artifacts are stored in a private environment-scoped repo with content-addressed
Flash code snapshots. Set `seed` only at the top level; `[worker_env]` cannot override
`SEED`, `RUN_ID`, `HF_REPO`, or `FLASH_ARM`. Compose or tweak configs without editing files: `--config
extra.toml` (deep-merge) and `--set key=value` (e.g. `--set train.epochs=3`).

### 4. Submit

```bash
flash train configs/sft.toml --dry-run     # validate the config on the server — no GPU, no charge
flash train configs/sft.toml --cost        # pre-flight USD estimate, then exit
flash train configs/sft.toml               # submit and follow logs (Ctrl-C detaches)
flash train configs/sft.toml --background  # submit and return immediately
```

### 5. Monitor

```bash
flash status <run-id>            # state + accrued cost
flash log <run-id>               # reward/loss trend + worker console/error logs + any traceback
flash log <run-id> --follow      # stream a live run to completion
flash runs                       # all your runs and their state/cost
flash cancel <run-id>            # stop a run
```

### 6. Deploy & chat

```bash
flash checkpoints <run-id>       # deployable per-step RL checkpoints
flash deploy <run-id>            # serve the trained adapter
flash deploy <run-id>/step-N     # serve an intermediate checkpoint
flash chat <run-id> -m "hello"   # chat with the deployed adapter
flash deployments                # active serving endpoints
flash undeploy <run-id>          # tear the endpoint down
flash export --adapter-id <run-id> --repository <you>/<repo>  # copy adapter weights to your HF repo
```

The rest of this file is about doing the above *well* — designing a reward that teaches,
and deciding honestly whether a run improved.

---

## The loop

Work in tight, attributable iterations. Each one is a hypothesis:

```
1. Reconstruct state — what's the best run so far, and what have you already tried?
2. Form a hypothesis — pick ONE lever and say WHY it will move the metric.
3. Change that ONE lever.
4. Validate — `flash train configs/sft.toml --dry-run` (server-side preview: catches config
   errors, serving rank/context caps, and warm-start rank mismatches for free — no GPU, no charge;
   a paid run on a broken config or an all-zero reward is wasted budget).
5. Submit — `flash train configs/sft.toml`.
6. Judge — read the metric trend AND a sample of real rollouts (see below).
7. Keep the best run; revert the change if it didn't beat the noise band. Repeat.
```

**Lever priority (highest impact first):** reward design → data / curriculum →
training knobs. The reward is the teacher; spend your effort there before touching
hyperparameters.

**One controlled change at a time.** Bundling changes makes the effect
unattributable. Never re-run a setting that already failed at a negligibly
different value.

---

## Before you trust a run — the checklist

A run is only evidence of improvement when **all** of these hold:

- [ ] The run reached `done` (confirmed via `flash status <run-id>`), not merely submitted.
- [ ] The SFT loss fell or the reward trend rose (GRPO `reward`) — **beyond the noise band**, not within it.
- [ ] You **probed the trained adapter on real inputs** (`flash deploy` + `flash chat`), including cases it should fail — not just the metrics.
- [ ] The score is real behavior, not empty/truncated/templated outputs, skipped rows, leakage, a swallowed exception, or a format-only win.
- [ ] If you track a clean success signal separately from the shaped reward (an explicit `RewardMetric`), *that* moved too.

If any box is unchecked, the run is not done improving — keep training, don't declare success.

---

## Common Flash issues and mitigations

Most bad Flash runs fail in a small number of predictable ways. Check these before
spending another GPU run:

| Issue | Symptom | Mitigation |
| --- | --- | --- |
| Environment id is blank or stale | `flash train --dry-run` fails, or the worker uses old reward/data | Run `flash env push --name my-env .` after every environment/data edit and paste the returned id into every config you submit. |
| Local-only env path in config | Config validation says there is no local path mode | Publish first, then use the returned slug in `[environment] id`. `flash train` only runs published env ids, not local paths. |
| Config knobs are in the wrong table | Validation rejects `[grpo]`, `[sft]`, or unknown `[train]` keys | Put `epochs`, `group_size`, `max_completion_tokens`, `temperature`, `max_context_tokens`, LoRA, and other training knobs under `[train]`. |
| Trying to pin managed infrastructure | `gpu.type`, `train.hf_repo`, or `model_policy` changes do not do what you expected | Treat GPU choice, model policy, and the run artifact repo as managed. Tune the model, algorithm, environment, and `[train]` knobs instead. |
| Secrets are not available on the worker | Reward code works locally but remote logs show missing API keys or auth failures | List secret names under `[environment] secrets = [...]`, export those env vars locally before submit, or put them in local `.env` / `.env.local`. Never put secret values in `[worker_env]` or hard-code them in the config. |
| Wrong model / thinking setting | Config validation fails, or chat behavior does not match the run | Config validation is authoritative for model and thinking compatibility. Thinking is a run-level choice, and `flash chat` does not expose an override flag. |
| Thinking reward grades the wrong text | Rewards accidentally score hidden reasoning, or ignore reasoning you meant to inspect | By default, score the answer text. In thinking mode the response object is still string-compatible, but also exposes `.completion`, `.thinking`, and `.raw` when a reward intentionally needs those fields. |
| All-zero or flat GRPO reward | `reward` stays near 0 and outputs do not improve | Make the reward dense: give partial credit for parse/format/execution/correctness tiers, and log a separate clean `success` metric. Do not keep rerunning an all-zero reward. |
| Reward rises but behavior is worse | Short, templated, malformed, or reward-hacked outputs score well | Deploy the adapter and probe real examples. Add hard validity gates before judge calls, penalize degenerate shortcuts, and judge the outcome rather than the surface string. |
| OPD makes the student worse, not better | The distilled adapter scores *below* its SFT/base start even though the per-token loss fell | The teacher, not a knob, is the ceiling. Reverse-KL only pulls the student toward the managed GLM-5.2 teacher, so a teacher that is weak or wrong on *your* task transfers its mistakes. Vet it first: roll GLM-5.2 through your own environment on a held-out split and confirm it clearly beats your student before submitting. If it doesn't, use GRPO or SFT instead — OPD cannot exceed a teacher that can't do the task. |
| Output is truncated | Correct-looking answers cut off mid-response or JSON is incomplete | Increase `max_completion_tokens` for GRPO/OPD rollouts or `max_context_tokens` for total prompt+completion context only after seeing truncation. Oversizing them by default just burns memory/cost. |
| Infrastructure, CUDA, OOM, vLLM, or kernel failure | Run errors before useful metrics, often during setup/model load | Treat this as infrastructure pressure, not proof the model is too large. Read `flash log <run-id>`, reduce footprint (`max_context_tokens`, `max_completion_tokens`, `group_size`) if needed, and let Flash retry/allocate another fitting GPU class. |
| Run looks stuck after disconnecting | Terminal stopped streaming but the job may still be alive | Ctrl-C detaches. Use `flash log <run-id> --follow` to reattach, `flash log <run-id>` for the console/error output, or `flash cancel <run-id>` if you intentionally want to stop it. |
| Final checkpoint regresses | Last step is worse than an earlier checkpoint | Run `flash checkpoints <run-id>`, deploy a specific step with `flash deploy <run-id>/step-N`, and compare with held-out probes before exporting or relying on the final adapter. |
| Export fails before upload | CLI says no HuggingFace token | Pass `flash export --api-key hf_...`, or set `HF_TOKEN` in your shell, `.env`, or `.env.local`. Exports are private unless you pass `--public`. |
| SFT loss improves but quality does not | Train loss falls while held-out behavior stalls or degrades | Keep a held-out split outside training. Deploy and score that split; if quality drops, reduce epochs or improve data instead of adding more passes. |
| Cost surprises | A quick experiment uses more GPU time than intended | Start with `--dry-run` and `--cost`, keep `epochs` and `max_examples` small for smoke tests, and scale only after reward/data wiring is proven. Setup time is reported for observability; customer cost is based on training-loop GPU time. |

---

## Judge the run, don't just finish it

- **Judge the trend, not a single number.** The proof of training is the curve:
  loss falling (SFT) or `reward` rising over steps (GRPO). Record the base/early
  value and the final value. A flat or noisy trend with no improvement is not success.
- **Read the model's outputs, not just the metrics.** A rising reward can come from
  reward-hacking or a degenerate output the reward still credits — metrics alone never
  establish that the model got better. Flash does not expose training-time rollouts
  through the CLI (`flash log` gives you the metric trend and the worker's console/error
  logs, not the sampled generations), so to read real outputs **deploy the adapter and
  probe it**: `flash deploy <run-id>` then `flash chat <run-id> -m "..."` on at least a
  few real inputs, including ones it should get wrong.

  ```bash
  flash status <run-id>            # state + accrued cost
  flash log <run-id>               # metric trend + worker console/error logs (+ traceback)
  flash log <run-id> --follow      # stream a live run until completion
  flash deploy <run-id>            # serve the adapter, then `flash chat` it to read real outputs
  ```

- **Decide with the noise band.** When comparing two runs or two checkpoints, record
  the eval-split size `N` and the metric's approximate sampling noise — about
  `1.96·√(p(1-p)/N)` for a rate metric `p`. Treat a difference *inside* that band as
  **no change** — neither improvement nor regression. A within-noise gain is not a win.

---

## Reward design (GRPO) — your highest-impact lever

The reward defines what the model learns; its quality sets the ceiling on what GRPO
can reach. Rewards are rubric / `score_response` functions in your `environment.py`.

### Make it graded and dense — avoid the all-zero cold start

If `reward` is flat at ~0.000, every rollout in the group scored the same, the
advantage is zero, and the policy gets **no gradient**. That is a reward-design bug,
not a model to keep training. Reshape the reward to credit **ordered partial
progress** so even an untrained base model earns a small nonzero score and better
attempts score strictly higher:

```text
well-formed / parses → schema- & safety-valid → executes / runs → correct / relevant
```

Gate only the **top** tiers against gaming; keep the lower tiers dense. GRPO needs
*within-group variance* to learn — if every rollout in a group scores identically,
there is nothing to optimize.

### Separate the shaped reward from a clean success signal

A good GRPO reward is usually **shaped** — partial credit so the model always has a
gradient to climb. But a shaped score is the wrong thing to judge *final quality* on:
it can rise from reward-hacking while the outcome you care about stays flat. Report the
shaped value as `score`, and surface the clean pass/fail as an **explicit
`RewardMetric`** so it shows up in the run's metric breakdown — a bare `threshold` is
used for grading but is *not* logged on its own, so it gives you nothing to judge:

```python
from freesolo.environments import RewardResult, RewardMetric

def score_response(self, example, response_text) -> RewardResult:
    score = graded_score(example, response_text)         # shaped 0-1 — what GRPO optimizes
    return RewardResult(
        score=score,
        threshold=1.0,                                   # success = score >= threshold
        metrics=(RewardMetric(name="success", score=float(score >= 1.0)),),  # logged: judge on this
    )
```

`score` is what GRPO optimizes (it becomes the run's `total`). Each `RewardMetric` you
attach is logged by name in the per-scorer breakdown — that is how the clean success
rate becomes visible. Use the shaped `score` to confirm the model is learning *at all*,
and judge the run on the explicit `success` metric.

When `thinking = true`, score the final answer unless you intentionally need the
reasoning trace. Flash passes a string-compatible response object to `score_response`;
`str(response_text)` is the answer text, while `response_text.completion`,
`response_text.thinking`, and `response_text.raw` are available for rewards that
explicitly inspect the separated completion, reasoning, or original raw model output.

### Reward rules that prevent silent failure

- **Return `0.0` explicitly — never let scoring raise.** An uncaught exception in
  scoring fails the whole run. Guard every parse and lookup and return
  `RewardResult(score=0.0, error=...)` for missing evidence, a parse failure, or an
  unsafe/unsupported output.
- **Gate LLM judges behind the hard checks.** Run deterministic validity checks first
  and return `score=0.0` on any parse/schema/safety failure, so the policy can't
  reward-hack a lenient judge with malformed-but-plausible text.
- **Judge the realistic outcome, not the raw string.** Give a judge the runtime
  output, tool result, or executed-query records. For database / search / retrieval
  tasks, grade the *returned records*, not the query text — the query is only
  secondary validity evidence.
- **A small format penalty beats a hard zero for shaping.** A useful trick:
  `reward = format_coef * (correct_format - 1) + correct_answer` with `format_coef≈0.1`
  — a tiny penalty for bad formatting, full credit for a correct, well-formatted answer.
- **Anti-patterns.** Don't reward length or verbosity. Don't ship a reward that is
  always 0 or always 1 (no signal). Simpler rewards usually beat clever ones — a
  mediocre *stable* reward beats a "perfect" reward you keep tweaking. Changing the
  reward resets progress, so keep the best checkpoint before you do.

---

## SFT conventions

Pick SFT when you already have good answers and want the model to imitate them.

- **Data quality is the ceiling.** SFT can only be as good as the answers you show it.
  A small set of high-quality examples beats a large mediocre one. Keep response format
  consistent (if you want JSON, *every* example is JSON) and keep the prompt format the
  same as inference time.
- **Watch the loss fall — and check overfitting yourself.** Flash SFT logs **training
  loss only**; it runs no mid-training held-out eval (evaluation is deferred to the
  deploy/serving side). A falling train loss alone can be memorization, so keep an eval
  split the run never trains on, then **deploy the adapter and score it on that split**
  (`flash deploy` + `flash chat`). If held-out quality stalls or drops while train loss
  keeps falling, reduce `epochs` or add more data — not more passes.
- **Start `max_context_tokens` small and grow it on evidence.** Begin from the smallest
  `max_context_tokens` that plausibly fits prompt + completion, and only raise it when you see
  truncation (outputs cut off mid-thought, degraded loss). A bigger context just costs
  more.
- **For Qwen3.5 thinking multi-turn SFT, put reasoning only in the final assistant
  turn.** Qwen3.5's chat template strips literal `<think>` blocks from prior assistant
  history and pre-opens `<think>\n` in the next generation prompt. If every assistant
  turn in a gold multi-turn transcript includes `<think>...</think>`, training sees a
  different tag layout than inference and can learn doubled or misplaced thinking
  tags. Keep intermediate assistant turns as the actual code/tool/action text only;
  put `<think>...</think>` plus the final answer in the final assistant target. Flash's
  completion-only SFT masking uses the longest shared token prefix, so the template's
  pre-opened `<think>\n` is treated as prompt text instead of training the model to
  emit another opener.
- **SFT is a great warm start for GRPO.** SFT first to teach the format and a competent
  baseline, then GRPO to optimize past it. Across that lineage keep the **same base
  model**. Warm-start CONTINUES the one SFT adapter in place — GRPO/OPD keep training
  the same LoRA (VL and text-only alike), so the run trains and serves at the SFT
  adapter's rank-`r` and just has to fit the selected model's serving `max_lora_rank` (some
  serving models allow rank 128, larger serving paths cap at 64). Do **NOT** set `lora_rank`
  for a warm-start: the source adapter's rank/alpha metadata is authoritative. Flash reads the
  rank from the source adapter and uses it for cost, GPU allocation, and GRPO-sleep sizing, so
  setting `lora_rank` alongside `init_from_adapter` is rejected at submit; it also rejects a
  source adapter whose rank exceeds the serving cap.

```toml
# configs/rl.toml — warm-start GRPO from the SFT run's adapter
algorithm = "grpo"

[train]
# the SFT run id (as printed by `flash status`); add /step-N to warm-start from a
# specific checkpoint listed by `flash checkpoints <run-id>`
init_from_adapter = "<sft-run-id>"
# do NOT set lora_rank / lora_alpha for a warm-start: the source adapter's rank and alpha
# metadata are authoritative, and setting lora_rank alongside init_from_adapter is rejected
```

SFT, GRPO, and OPD all accept **epoch-driven** configs (`epochs`). For GRPO/OPD,
an epoch is one pass over the retained prompt pool after `max_examples` and prompt-budget filtering;
optimizer-step counts are derived from those epochs. A positive `[train] max_steps` replaces that
derived count with an exact update horizon for every algorithm. `[train] save_at_steps`
requires a positive `max_steps` so its horizon is authoritative even when SFT packing changes the
realized batch shape. When non-empty, exact save steps suppress periodic `save_every` checkpoints, and the
run fails if a requested exact save cannot be saved and published.

---

## On-policy distillation (`algorithm = "opd"`)

Pick distillation when a much stronger **teacher** model can grade your student's work
token-by-token. The student samples on-policy (like GRPO), a managed teacher (GLM 5.2 by default,
or another via `[train] teacher_model`) scores each of the *student's* completions, and a dense per-token
loss teaches the student to match the teacher — far more sample-efficient than reward-based RL and
with no reward to design. It supports `epochs` like SFT/GRPO and produces a LoRA served exactly like SFT.

- **Vet the teacher on your task before you distil — this is a precondition, not a formality.**
  Reverse-KL can only pull the student *toward* the selected teacher, so OPD's ceiling is
  roughly the teacher's own competence at your task. If the teacher is weak, frequently wrong, or
  solves the task with a strategy your environment can't reward, distillation faithfully transfers
  those flaws and **drives the student *below* its SFT/base starting point instead of above it** — a
  low per-token loss just means it matched a bad teacher. So measure the teacher the way you'd score
  a candidate *before submitting*: roll your chosen teacher through your own environment on a held-out
  split and read both its score and a sample of its trajectories. Only run OPD when the teacher clearly
  beats your student (and your target bar) *and* solves the task the way you want the student to. When
  the teacher is at or below your student on the task, OPD is the wrong tool — reach for GRPO
  (reward-driven, can exceed any single teacher) or SFT on curated data instead. `[train] teacher_model`
  lets you pick the teacher that best fits your task without changing anything else.
- **Pick the teacher with `[train] teacher_model`; the key stays managed.** The teacher defaults to
  the managed **GLM 5.2** and is selectable from a fixed, managed allow-list:
  `glm-5.2` (default), `deepseek-v4-pro`, `kimi-k2.6`. Every option is
  a Fireworks-hosted model reached with the platform's own key, so there is nothing to export or
  declare — an opd run submits like any other, and a `FIREWORKS_API_KEY` in your shell is ignored.
  Arbitrary bring-your-own teacher models or keys are not supported (the allow-list is curated to
  teachers verified to echo-score the student's tokens). The key is never stored in the spec or needed
  at serving time; teacher token cost varies by model and is shown in the pre-flight estimate.
- **The student (Qwen / MiniCPM) and the teacher have different tokenizers.** Flash
  bridges the vocabulary mismatch with **groupwise reverse-KL** (the collinear-ai *spider* / Tinker
  method): it aligns the two tokenizations by shared decoded-text spans and applies per-span reverse
  KL using only realized-token logprobs — no vocabulary projection, so it covers every token exactly
  and works for any student tokenizer. When the tokenizers happen to agree it reduces to plain
  per-token reverse KL (Thinking Machines, *On-Policy Distillation*). Nothing to configure.
- **Works for multi-turn envs too.** Against an `EnvironmentMultiTurn`, opd rolls out each episode
  (driving `step_episode` / observations just like GRPO) and distils EVERY assistant turn against the
  teacher, each conditioned on the transcript up to that turn — the episode's total reverse-KL over
  the student's generated tokens is the sum of its per-turn reverse-KLs. Env/observation tokens are
  never distilled (they're context, not the student's output). Set `[train] max_context_tokens` to bound the
  transcript; the teacher must cover it (the allow-listed teachers' contexts far exceed the default budget).
- **Judge it like SFT.** Distillation logs a falling per-token loss; a low loss alone is not proof.
  Keep a held-out split, `flash deploy` the adapter, and score it — confirm the student actually
  moved toward the teacher's behavior, not just its surface tokens.

```toml
# configs/opd.toml
model = "Qwen/Qwen3.5-4B"
algorithm = "opd"

[environment]
id = "your-org/my-env"

[train]
epochs = 1
max_examples = 2
lora_rank = 32
# teacher_model = "glm-5.2"                             # managed teacher to distil from; one of
#                                                       # glm-5.2 (default) | deepseek-v4-pro | kimi-k2.6
#                                                       # (key stays managed)
# kl_penalty_coef = 1.0                                 # reverse-KL scale
```

The cross-tokenizer reverse-KL is computed over shared decoded-text spans and so **cannot supervise
the zero-width stop token**. No auxiliary EOS loss is applied. `truncated_rollouts` records completions
that reached the length cap without EOS or a configured stop. Warm-starting from an SFT adapter can
still improve initial termination behavior.

A verbose teacher can also inflate the *content* the student distils toward through long per-turn
reasoning and extra multi-turn looping, so episodes still forfeit against the length/turn budget
regardless of stop-token behavior. Because the teacher scores the
student's rollouts **conditioned on your environment's own system prompt**, you can shrink its target
distribution at the source: give the prompt used for OPD rollouts a **hard, specific reasoning
budget** — e.g. "reason in at most two or three sentences, then act; once you have started, do not
reconsider" — rather than a vague "be brief." The phrasing matters. A soft brevity request can
**backfire on a thinking teacher**, trimming the median while *inflating* the long tail (the model
spirals when told to be brief on a problem it finds hard), which is exactly the tail that drives
runaway. Constrain the content with the prompt and monitor `truncated_rollouts` for length-cap
failures. This assumes the teacher is still strong at the task (vet it first, above).

### Reverse-KL over-sharpens — cut steps and watch entropy (every model)

Reverse-KL is **mode-seeking**: it sharpens the student's next-token distribution toward the
teacher's dominant mode, and it keeps sharpening for as long as you train. This affects **every OPD
run, at every size** — the whole Flash catalog is small by frontier standards (0.8B-9B dense plus a
3B-active MoE), so treat over-sharpening as a default risk, not a small-model edge case. The student's
per-token entropy falls as training proceeds; past the point where it has learned the task, extra
steps only over-sharpen — *lowering* accuracy. Push it far enough and the distribution peaks so hard
that **greedy (temperature=0) decoding falls into a repetition loop** that repeats a phrase to the
length cap and never emits your answer. The loss looks healthy the whole run (reverse-KL is being
minimized *by* the collapse), so it is invisible in the loss curve and only surfaces at serving —
where **temperature=0 is the default**, so it hits real callers, not just a sampled eval.

**Severity scales with size**: on the largest catalog models over-training mostly just leaves
accuracy on the table (a late checkpoint slightly worse than an earlier one); on the smallest it
turns into the full-blown greedy loop. But the fix is the same everywhere, and cutting steps helped
*every* size tested. Four levers, each attacking the same over-sharpening — the first two apply to
every run, the last two matter more the smaller the model:

- **Train fewer steps (highest leverage, every size).** The student typically peaks early — often
  around ~20 optimizer steps — and every step after is pure over-sharpening that *lowers* accuracy
  while *raising* the loop rate. Cut `max_examples` (or `epochs`) so the run stops before the collapse,
  and deploy an early **checkpoint** (`flash checkpoints <run>`, `flash deploy <run>/step-N`) rather
  than the final adapter. This helped at every size tested — a 4B went 42% acc / 44% loop at full
  length -> **74% / 0% at step 20**, and even models that never looped came out equal-or-better at the
  earlier checkpoint. When in doubt, sweep a few checkpoints and pick the best, don't assume the last
  step is the best.
- **Lower the rank (more, the smaller the model).** A rank-32 adapter is a large relative perturbation
  to a small model, giving reverse-KL more capacity to over-sharpen. Dropping `lora_rank` to 16 (or 8)
  often clears the loop outright (a 4B sft->opd went 42%/44% at rank 32 -> 76%/2% at rank 16). Since
  the whole catalog is small, prefer a modest rank (16) as the default for OPD and only raise it with a
  reason.
- **Match the teacher to the student.** A *stronger* teacher is not universally better — the harder
  it is for the student to match, the harder the collapse. On a 2B, a closer/weaker teacher can beat a
  frontier one outright; a frontier `teacher_model` only earns its keep once the student is large
  enough to track it (~9B+). Early-stopping also largely neutralizes this gap, since the teacher-driven
  over-sharpening only compounds over many steps.
- **Diagnose it in-band.** Watch the per-step **mean completion entropy** in the run's telemetry — a
  steady decline toward zero is the collapse happening. Confirm at serving by evaluating at
  **temperature=0** and flagging `finish_reason=length` completions that never emit your answer token,
  and compare an early checkpoint against the final one to watch the loop emerge over steps.

### Distilling from base with no format anchor

`opd` straight from a base model (no SFT warm-start) faithfully distils the teacher's *reasoning* but
the student never learns your **answer format** — it terminates (`finish_reason=stop`) without ever
emitting the boxed/tagged answer, so completions score unparseable even when the reasoning is fine.
On-policy distillation reinforces the student's *own* tokens, so if the base never produces the
format there is nothing to reinforce (and a downstream GRPO pass can't rescue it — with no
correctly-formatted rollout to reward, RL has no signal to climb). Two fixes:

- **Warm-start from an SFT adapter** (`[train] init_from_adapter`) — the SFT installs the output
  format first, then OPD refines the content. This is the reliable default for structured-answer tasks.
- **Constrain the rollouts with `[train] structured_outputs`** (guided decoding) to a schema whose
  **answer field comes first** — the model learns to commit a parseable answer *before* any reasoning
  that might run long, so the answer survives even if the reasoning still loops. This separates the
  *format* problem (fixed here) from the *loop* problem (fixed by the levers above).

---

## GRPO knobs that matter

Set these in `[train]`. Each is `None` by default — the worker's tuned recipe fills
in a sensible value, so only override with a reason.

| Knob | Convention |
| --- | --- |
| `group_size` | Completions sampled per prompt (default 8). More = more signal and more cost; drop to 4 to trim cost. The group needs *within-group variance* for an advantage to exist. |
| `max_completion_tokens` | Completion budget per rollout. Size it to the expected output length — too small silently truncates good answers and poisons the reward; too large just costs more. |
| `temperature` | Rollout sampling temperature. Keep it near 1.0 for GRPO — too low collapses diversity (and the model can collapse within a few steps); raise it to widen exploration against uniform-reward groups. |
| `kl_penalty_coef` | Keeps the trained model from drifting too far from the base. Raise it to anchor against entropy collapse; lower it for more freedom to move. |
| `thinking_length_penalty_coef` | Per-reasoning-token reward deduction — curb overthinking, but watch it doesn't push the model into terse degeneracy. |
| `learning_rate` | Change it in small steps. Too high destabilizes RL and degrades output quality; if the model is collapsing, lower it. |
| `batch_size` | The effective prompts-per-step. Too small and the reward trend is pure noise; size it so the trend is readable. |
| `structured_outputs` | Guided decoding for every GRPO/OPD rollout: a JSON schema (inline table or JSON string), `regex`, or `choice`. The sampler then *cannot* emit off-format text, so the reward measures content instead of formatting. Works with `thinking = true`: the grammar is held until the `</think>` boundary (via a reasoning-aware decoding gate), so the model reasons freely first and only its answer is constrained. |

For pure multi-turn GRPO, Flash gives each Flash-owned vLLM generation request a managed
10-to-60-minute absolute deadline and at most two physical attempts. A timed-out request is
aborted before retry. Enforcement is cooperative between engine polls, and there is no total
episode elapsed-time cutoff. This policy does not time out OPD, TRL-native tool loops, or
environment calls.

> **The reward-hacking signature:** a smoothed reward rising while mean generated
> length collapses. Whenever any shortness or format pressure is active, verify the
> gate by scoring a few truncated or opener-only probe responses — they should score low.

---

## Curriculum — start easy, scale up

Starting too hard produces zero learning signal; the model never succeeds, the reward
stays at 0, and there is nothing to climb. Start where the base model can *partially*
succeed, then raise difficulty as it improves. The "Goldilocks zone" — where most
rollouts score somewhere between all-fail and all-pass — is where GRPO has the most
signal.

- If nearly every prompt is solved (most groups score ~1.0): **increase difficulty** —
  harder prompts, tighter format/reward, more epochs, or more data.
- If nearly nothing is solved (most groups score ~0.0): **decrease difficulty** —
  easier or few-shot prompts, a more lenient (denser) reward, or warm-start with SFT.
- In between: good signal — keep iterating at this difficulty.

---

## Diagnose before you re-run

When the reward stalls, a chunk of outputs fail, or the checkpoint underperforms,
don't treat failures as one bucket. Read a sample of the **actual failing
generations** (raw outputs, not just scores), classify the dominant mode, and apply a
targeted fix rather than leaning on the reward gate to slowly select against it. Then
**re-measure that mode** to confirm it dropped.

| Failure mode | What you see | Targeted fix |
| --- | --- | --- |
| Repetition / looping collapse | the same phrase repeats until truncation | repetition or length penalty; lower `temperature` |
| Overthinking / verbose reasoning | reasoning eats the whole token budget | `thinking_length_penalty_coef`; tighten the prompt with a *hard, specific* budget ("reason in at most N sentences, then act") — a vague "be brief" can backfire on a thinking model and lengthen the tail |
| Completion truncation | answers cut off mid-thought | raise `max_completion_tokens` / `max_context_tokens` |
| OPD rollouts never stop (high `truncated_rollouts`) | on-policy completions run to the length cap without an EOS; raising the cap barely helps | No auxiliary EOS loss is applied. Warm-start from SFT and shrink what has to terminate: constrain the *teacher's* reasoning at the source with a hard, specific budget in the env prompt used for OPD rollouts (the teacher scores the student conditioned on it); a vague "be brief" can backfire on a thinking teacher. First confirm the teacher itself terminates and is strong on the task; a bad teacher is distilled in, not out. |
| Unparsed / over-escaped output | reward can't read the answer | robust parser; return `0.0` on parse fail; format gate |
| Wrapper / markdown around structured output | prose around the JSON/answer | a format gate; `stop_sequences` |
| Uniform-reward groups | every rollout in a group scores the same → no gradient | shape the reward for partial credit; raise `temperature` |
| Too-hard prompts | the base never succeeds, reward stays at 0 | curriculum / easier prompts; warm-start with SFT |
| Judge-rewarded degenerate output | short, templated answers a judge still rates well | a minimum-substance zero-gate ahead of the judge |

---

## When a run stalls

A plateau is not automatically a capability ceiling. Before you call it one:

1. **Probe with best-of-N.** Run a best-of-N / pass@k probe at a coverage temperature
   (well above greedy) on a less-fitted checkpoint.
2. **Read the result.** High best-of-N but a collapsed greedy output and low sample
   diversity is **entropy collapse**, not a ceiling — and it's fixable: anchor harder
   with `kl_penalty_coef`, lower the `learning_rate`, or widen exploration. Only if the
   probe shows no headroom is it a genuine ceiling.
3. **Change a different lever.** If there's real headroom, try a *different* lever from
   the one that just failed — a different knob, reward shape, or data family — one
   controlled change at a time.

Actively research established GRPO/SFT techniques (exploration / entropy control, KL
scheduling, reward shaping, curriculum / difficulty filtering, rejection-sampling SFT
on high-reward rollouts) rather than guessing — and count a technique as helpful only
on a beyond-noise improvement.

---

## Scale the evidence

- **A smoke test is not proof.** A single-digit derived step count, a tiny dataset, or a handful
  of rollouts only validates the wiring. Scale `epochs`, the dataset size,
  and `group_size` to the model and the data you actually have before you trust a
  result. Don't cite budget alone as the reason for an underpowered run.
- **Use the data you have.** Deliberately assign every usable row to training or to a
  held-out eval split; if a planned holdout is so small that one example swings the
  metric by several points, enlarge it during split design rather than gating on noise.

---

## Treat crashes as infra, not model size

> A CUDA / OOM / vLLM / kernel / infrastructure error is an **infrastructure** problem, not a
> sign the model is too big. Lower `max_context_tokens`, `max_completion_tokens`, or `group_size` to shrink
> the run's footprint and let the allocator retry onto the next fitting GPU class — do
> **not** switch to a smaller model to make a crash disappear. That silently destroys
> quality.

---

## Command reference

```bash
flash env setup                       # scaffold environment.py, dataset/, configs/, this file
flash env push --name my-env .        # publish the environment; paste the returned id into [environment]
flash env pull your-org/my-env        # download a published environment into the current folder
flash env delete your-org/my-env -y   # delete a published environment
flash train configs/sft.toml --dry-run # validate the config on the server (no GPU, no charge)
flash train configs/sft.toml --cost    # pre-flight USD estimate, then exit
flash train configs/sft.toml           # submit and follow logs (Ctrl-C detaches; --background to skip following)
flash status <run-id>                 # state + accrued cost
flash log <run-id>                    # reward/loss trend + worker console/error logs
flash log <run-id> --follow           # stream a live run to completion
flash runs                            # list your runs and their state/cost
flash cancel <run-id>                 # stop a live run
flash checkpoints <run-id>            # list deployable RL checkpoints
flash deploy <run-id>                 # serve the trained adapter
flash deploy <run-id>/step-N          # serve a specific RL checkpoint
flash chat <run-id> -m "probe"        # stream a reply from the deployed adapter
flash deployments                     # list active serving deployments
flash undeploy <run-id>               # tear down an active deployment
flash export --adapter-id <run-id> --repository <you>/<repo>  # export final adapter
flash export --adapter-id <run-id>/step-N --repository <you>/<repo>  # export a checkpoint
```

See the full reference at https://freesolo.co/docs.
