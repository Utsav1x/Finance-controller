# How a run is graded

The one thing worth being precise about. Everything else in this project is a matter of taste;
this is the part that decides whether the headline number means anything.

## Ground truth

`lib/data/generator.ts` records every true relationship **as it builds the data**, before the
engine exists in the process:

- `l1Pairs` — `(orderId, settlementLineId)` for every real order → gateway payment.
- `l2Pairs` — `(settlementId, bankLineId)` for every payout that genuinely reached the bank. A
  split payout contributes **one pair per leg**.
- `plantedClass` — `recordId → failure mode`, for records deliberately made difficult.

Records that should *not* match have no pair at all: a duplicate capture, an orphan credit, a
payout that never landed. That absence is the point — it is what lets a false positive exist as a
measurable thing.

`lib/recon/metrics.ts` is the only module that reads any of this. The engine never does.

## Precision, recall, F1

Computed over **pairs**, not records.

```
predicted = { (left, right) : every match the engine asserted and did not mark as an exception }
actual    = { (left, right) : every true pair from ground truth }

TP = |predicted ∩ actual|
FP = |predicted| − TP          matches asserted that are simply wrong
FN = |actual| − TP             true pairs never found

precision = TP / |predicted|
recall    = TP / |actual|
F1        = 2PR / (P + R)
```

Reported separately for L1, L2 and overall, because they fail differently: L1 is a reference join
and should be near-perfect, while L2 is the aggregation problem where the difficulty lives.

## Match rate is a different number

`autoMatchRate = (true pairs the engine resolved with state 'matched') / (all true pairs)`

Three states, and the distinction matters:

| State | Meaning |
|---|---|
| `matched` | Resolved. No human needed. This is the only thing counted in the auto-match rate. |
| `review` | The right record was found, and something about it still warrants a look — a fee that moved, a payout that arrived late, a split the engine had to infer, or any tier-4 verdict. |
| `exception` | Not resolved. On the honest list with a reason. |

**A tier-4 (model) match is never `matched`, only ever `review`.** A model verdict is a proposal
with a reason, and it is presented to a human as one.

## Per-class recall

The bar differs by class, because the *correct outcome* differs. Scoring everything as "did it
match?" would reward the engine for matching things that are not there.

| Class | Handled means |
|---|---|
| `FEE_DRIFT` | Matched **and** flagged with a `FEE_DRIFT` variance. A silent correct match here is a leak nobody was told about. |
| `MISSING_CREDIT` | An exception with that exact code on the settlement. Matching it would be a failure dressed as a success. |
| `ORPHAN_CREDIT` | An exception with that exact code on the bank line. |
| `DUPLICATE_CAPTURE` | An exception with that exact code on the surplus order. |
| `PARTIAL_REFUND`, `CHARGEBACK` | The payout the reversal rode in on was resolved correctly — either matched, or correctly reported as never having landed. |
| `TIMING_GAP`, `ROUNDING`, `NARRATION_NOISE`, `SPLIT_PAYOUT` | The record ended up in a correct pair. These should all still reconcile. |

That last row of the `PARTIAL_REFUND` / `CHARGEBACK` rule was added after `pnpm verify` caught the
grader penalising the engine for being right: a refund that settled into a payout which itself
never reached the bank has no match to make, and reporting the payout as missing is the correct
outcome for the refund too.

## Tier attribution

Which tier resolved each match is recorded and charted. It answers a question a match rate cannot:

- Tier 4 carrying almost nothing → the rules are doing the job and the model is a garnish.
- Tier 4 carrying almost everything → the match rate is a model's opinion, not a measurement.

Both readings are useful. Neither is visible without this.

## The adversarial check

A grader that cannot report failure is decoration. `RECKLESS_TOLERANCES` widens the amount band to
5%, the date window to 14 days and drops the accept score to 0.35:

```bash
pnpm bench -- 220 reckless
```

False positives **must** appear. `pnpm verify` asserts this and fails the suite if precision stays
at 100%. The decoy orphan credits — same-day credits from a second gateway, sized within 1.5% of a
real payout — exist specifically to be the bait.

Current behaviour on seed 42: precision falls from `100.0%` to `99.2%` with `2 FP` and `5` missed.

## What this does not prove

The data is synthetic and this project wrote both sides of it. What the numbers establish is that
the engine handles ten named failure modes correctly, that its accuracy is measured rather than
asserted, and that the measurement is capable of reporting failure. What they do not establish is
performance on a real merchant's statement, where the failure modes will include some nobody
thought to plant. The exception list is the design's answer to that: anything unrecognised should
land there rather than being matched to the nearest available record.
