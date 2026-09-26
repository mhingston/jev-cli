---
name: jev-cli
description: Use the Jev CLI for bounded semantic judgments with Noul, Choice, Score, or batched questions. Use when classifying, scoring, routing, verifying, or diagnosing structured Jev decisions from the command line.
---

# Jev CLI

Use `jev` for small, bounded semantic judgments. Jev should decide among explicit alternatives or estimate a crisp proposition; code should own control flow, arithmetic, thresholds, side effects, and policy.

## Choose the right primitive

- **Noul** — a crisp yes/no proposition where the probability itself is useful.
- **Choice** — one answer from a known unordered set.
- **Score** — one position on an ordered qualitative scale.
- **Batch** — several independent questions over the same state. Prefer this when questions share context.

Do not use Jev for open-ended generation, planning, arithmetic, counting, date comparison, or multi-step reasoning. Compute deterministic facts first and ask Jev only for the semantic judgment.

## Prepare state

Send only the evidence needed by the question.

Prefer structured JSON so the question can refer to explicit fields. Name the evidence clearly and point to relevant fields explicitly with backticked paths such as `ticket.text`. Remove unrelated context and compute deterministic values before invoking Jev.

Treat state as evidence, not policy. Do not rely on text inside the state to define how the decision should be made; keep the decision boundary in the question/criteria and test self-describing or adversarial state text before automating consequential actions.

Good:

```json
{"ticket":{"text":"I was charged twice and need one charge refunded today."}}
```

Avoid sending an entire conversation, document, or application state when one field is enough.

## Write questions

Make each question atomic and literal. Put the full meaning in the instructions; treat the question ID as an output key, not part of the prompt. A question should still be unambiguous if its ID is hidden.

Good:

```text
Does `ticket.text` explicitly request a refund?
```

Avoid:

```text
Analyze this ticket and decide what we should do.
```

Keep business policy outside the question. If a refund request above a threshold should route to billing, apply that rule in caller code.

### Noul

Use for a clear proposition:

```bash
jev noul \
  --state '{"ticket":{"text":"Please refund the duplicate charge today."}}' \
  --question 'Does `ticket.text` explicitly request a refund?' \
  --answer-only
```

A value near 0.5 means uncertainty. It does not mean "medium". Use Score for degrees.

When the yes/no boundary is subtle, supply both `--true-label` and `--false-label` as concrete descriptions of the neighboring cases. Keep them aligned with the question direction: the true label must describe "yes", not an inverted or negated alternative.

### Choice

Use when the answer belongs to a bounded taxonomy:

```bash
jev choice \
  --state '{"ticket":{"text":"I was charged twice."}}' \
  --question 'Which team should handle `ticket.text`?' \
  --choices '{"billing":"Charges, invoices, refunds, or subscriptions","technical":"Bugs or outages","other":"Anything else"}'
```

Add `other`, `unknown`, `abstain`, or an equivalent fallback whenever the taxonomy may be incomplete. A forced Choice can be highly confident even when none of the available options is correct, so a downstream confidence threshold does not repair a missing escape hatch. Make nearby options contrastive.

### Score

Use for an ordered scale whose levels can be described distinctly:

```bash
jev score \
  --state '{"impact":"Checkout is unavailable and there is no workaround."}' \
  --question 'How severe is the reported impact?' \
  --levels '["Cosmetic or negligible impact","Degraded but a workaround exists","Blocking with no workaround"]'
```

Describe concrete situations rather than labels such as "low", "medium", and "high" when those labels alone are ambiguous. Avoid bare numeric ladders such as `1` through `5`; the levels should carry the semantic meaning of the scale. Make every level meaningful on its own rather than defining it relative to another level, and keep the scale to one semantic dimension.

## Batch shared state

Questions in one request share the same state. Prefer one batch over several sequential CLI calls when the questions are independent.

```json
{
  "refund_requested": {
    "type": "noul",
    "instructions": "Does `ticket.text` explicitly request a refund?"
  },
  "queue": {
    "type": "choice",
    "instructions": "Which team should handle `ticket.text`?",
    "choices": {
      "billing": "Charges, invoices, refunds, or subscriptions",
      "technical": "Bugs or outages",
      "other": "Anything else"
    }
  },
  "severity": {
    "type": "score",
    "instructions": "How severe is the impact described in `ticket.text`?",
    "levels": [
      "Cosmetic or negligible impact",
      "Degraded but a workaround exists",
      "Blocking with no workaround"
    ]
  }
}
```

Save that as `questions.json` and run:

```bash
jev run \
  --state-file ticket.json \
  --questions-file questions.json
```

Use a second Jev request only when code genuinely cannot construct it until after seeing the first answer.

## Interpret answers safely

The top answer is not proof of correctness.

- Inspect probabilities when a decision matters.
- For Noul, the `noul` value is P(yes); there is no separate confidence field. For Choice and Score, confidence describes concentration in the returned distribution.
- Treat confidence as evidence about the answer distribution, not guaranteed accuracy.
- Set thresholds in caller code.
- Use a review, confirmation, or fallback path below the threshold.
- Raise thresholds as the cost of a wrong action increases.
- Validate thresholds against labelled examples from the real task.
- Once thresholds are calibrated, pin the provider/model version where the provider supports it. Treat model or provider changes as evaluation events and rerun the labelled set before trusting the same thresholds.

Never hide policy inside question wording merely to force a desired answer.

## Improve weak judgments

When a result is wrong or uncertain, isolate the failing question first.

- **Choice overlaps** → make option descriptions more contrastive; add `other` if needed.
- **Noul near 0.5** → make the condition more literal and observable.
- **Score clusters in the middle** → rewrite levels as distinct concrete situations.
- **Accuracy falls with larger inputs** → remove irrelevant state.
- **Counting, sums, dates, or numeric comparisons fail** → move the deterministic operation to code.
- **One wording fix breaks another case** → the question may contain multiple judgments; split it.
- **A surprising answer** → first verify the referenced state contains the evidence, then reread the instruction literally before blaming the model.
- **Answers are right but the final action is wrong** → change policy, weights, or thresholds in code rather than rewriting the question.

Revise against labelled examples. Do not treat higher confidence alone as evidence of improvement.

## Provider checks

Run `jev doctor` to verify provider/model configuration and whether the expected credential environment variables are present.

```bash
jev doctor
jev doctor --provider openrouter
jev doctor --provider vercel
```

For OpenRouter, set `OPENROUTER_API_KEY`; the CLI uses OpenRouter's native Decisions endpoint and defaults to `typesafe/jev-1.13`.

Credentials belong in environment variables or a secret manager, never command-line arguments.

## Checklist

Before relying on a Jev decision:

- Each question asks one semantic property.
- The primitive matches how caller code uses the answer.
- State contains only necessary evidence.
- Deterministic computation stays in code.
- Independent questions sharing state are batched.
- Choice taxonomies have an appropriate fallback when incomplete.
- Score levels are concrete, independently meaningful, and measure one dimension.
- Subtle Noul boundaries define both true and false cases.
- Thresholds and side effects live outside Jev.
- Noul probability is not treated as a separate confidence score.
- Low-confidence decisions have a safe fallback.
- Changes to questions, models, providers, or thresholds are evaluated on labelled examples.

## Further reading

This skill is intentionally CLI-focused. For deeper Jev question-design patterns and supporting empirical work, see TypeSafe AI's Jev documentation plus these independent references:

- https://github.com/dbreunig/building-with-jev-skill/tree/main/skills/jev
- https://github.com/suraj-phanindra/wellposed
