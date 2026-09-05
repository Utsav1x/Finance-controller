# Ledgerly — AI Finance Controller

Reconciles three sources in one pass — the internal **order ledger**, the payment gateway's
**settlement report**, and the **bank statement** — then reports its precision, its recall, and
every record it could not resolve. Including the matches it got wrong.

Built for **Track 04 — AI Finance Controller**. The bar for that track is throughput plus measured
accuracy plus an honest exception list, and one cherry-picked match proving nothing. Everything
below is arranged around the second and third of those.

```bash
pnpm install
pnpm verify     # the full check suite — no server, no API key
pnpm dev        # http://localhost:3000
```

No API key, no database server, no native build. The AI layer is optional and the app says so.

---

## The number, and why it can be trusted

```
  seed 42 · 220 orders · 511 records · reconciled in 7ms (72,797 records/s)

  level    precision   recall    F1       TP / FP / FN
  L1       100.0%      100.0%    1.000    220 / 0 / 0
  L2       100.0%      100.0%    1.000     44 / 0 / 0
  all      100.0%      100.0%    1.000    264 / 0 / 0

  auto-matched   237/264  (89.8%)      ← resolved with no human
  to review       27      (10.2%)      ← right record, still worth a look
  missed           0
  FALSE POSITIVE   0
```

**Match rate measures how often the engine felt finished. Precision measures how often it was
right.** A matcher that pairs every record with its nearest neighbour scores magnificently on the
first and is worthless. So:

- The generator writes **ground truth** as it builds the data, before the engine sees any of it.
  Only `lib/recon/metrics.ts` ever reads it.
- Runs are graded on asserted `(left, right)` **pairs** against true pairs, which yields real
  true positives, false negatives and — the figure most demos have no way to compute —
  **false positives**.
- Every run is reproducible from an integer seed stored in the run record.

### How to check we are not cheating

Load the **reckless** profile on `/rules` and re-run, or:

```bash
pnpm bench -- 220 reckless
```

Precision must fall and false positives must appear (currently `99.2%`, `2 FP`). If wide-open
tolerances still produce a perfect score, the grader is not grading and no figure above means
anything. `pnpm verify` asserts this, and fails the suite if it stops being true.

---

## The loop

A payment gateway does not pay you per order. It pays you **per payout batch**: a cycle's worth of
payments, net of the commission, net of GST on that commission, net of any refunds and chargebacks
that settled alongside them — arriving as one bank credit two business days later, or four if the
weekend intervenes.

So nothing matches one-to-one, and a naive `amount == amount` join finds almost nothing.

### Ten failure modes, planted deliberately

| Class | What the engine has to survive |
|---|---|
| Fee drift | The rate quietly changed. Everything matches; the cash is short. |
| Timing gap | Settled Friday, credited Tuesday. A weekend is not a variance. |
| Partial refund | A refund nets off inside the payout. |
| Chargeback | A dispute deducted from an otherwise clean batch. |
| Duplicate capture | One reference on two orders. A reference join matches both and reports success. |
| Payout never landed | Reported by the gateway, absent from the bank. Real money, missing. |
| Unidentified credit | Money in from elsewhere. Forcing it onto a settlement is how precision dies. |
| Rounding drift | A few paise of per-line rounding, enough to break equality. |
| Unreadable narration | The reference survived the export, but not intact. |
| Split payout | One batch, two credits. No single line looks right; together they are exact. |

Half the unidentified credits are **decoys** — a credit from a second gateway, same day, sized
within 1.5% of a real payout. They are the only records that can cost the engine precision, and
they are why the false-positive count is worth printing.

---

## Four tiers, cheapest and most certain first

```
Tier 0  Normalize   business-day calendar, integer paise, references pulled out of narrations
Tier 1  Reference   the batch UTR found intact — all legs carrying it must SUM to the batch
Tier 2  Amount+date one credit inside the tolerance band and the date window, clearly best
Tier 3  Scored      partial reference support combined with amount and date; bounded subset-sum
Tier 4  Adjudicate  only the leftovers, with every delta precomputed, and "no" is a valid answer
```

Each tier only sees what the one before could not resolve. That ordering is what makes the result
auditable: most matches are explained by a rule you can read, and the scorecard's **tier
attribution** shows exactly how much work the model actually did.

On the default dataset the deterministic tiers resolve everything (`tier1 253 · tier2 5 · tier3 6`)
and **zero model calls are made**. That is reported rather than hidden — an AI feature that isn't
needed on easy data should say so.

### The adjudicator's constraints

1. It only ever sees records the rules failed on.
2. It is *given* arithmetic, never asked for it — every delta and day gap is precomputed.
3. A verdict below the confidence floor becomes an exception. An adjudicator that always finds a
   match is a random number generator with good manners.

A tier-4 match is never marked `matched`, only `review`. A model verdict is a proposal with a
reason, and it is shown to a human as one.

---

## Without an API key

The engine, the scorecard, the exception queue, the cash view and the exports all work with no
credentials. Set `GOOGLE_AI_API_KEY` in `.env.local` to enable:

- **Tier-4 adjudication** — leftovers get a verdict, a confidence and a rationale.
- **Ask the Ledger** — questions answered by running typed queries over the run's records and
  citing them, not by retrieval over prose. If the rows don't contain the answer it says so
  instead of inventing a number.

Missing the key is a **supported mode**, not a broken one: affected records land on the exception
list with reason code `LLM_UNAVAILABLE`. The match rate drops; nothing is silently dropped.

---

## The app

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/dashboard` | Headline metrics, the exception queue, tier attribution, cash accounted for |
| `/run` | Run console — configure the batch, run it, watch the pipeline |
| `/runs`, `/runs/[id]` | Every run kept; the workspace with full evidence trails |
| `/exceptions` | The honest list — reason, money at risk, rejected candidates, accept/reject |
| `/scorecard` | Precision, recall, F1, FP, per-class recall, tier attribution, throughput, cost |
| `/ask` | Ask the ledger |
| `/cash` | Position and a 13-week forward view, built only from reconciled records |
| `/rules` | Tolerances, including the reckless profile |
| `/data` | Data studio — seed, size, preview of what will be planted; CSV and journal exports |

**Journal entries** (`/api/export?kind=journal`) cover only payouts that reconciled. Proposing an
entry for a settlement the bank never received would put unproven money into the books.

---

## Stack

Next.js 16 · React 19 · Tailwind v4 · TypeScript. Persistence is **`node:sqlite`**, the runtime's
own driver — deliberately not `better-sqlite3`, which needs a native toolchain and is the most
common reason a cloned project doesn't run on Windows. Clone, install, run.

```
lib/data/generator.ts     seeded three-source generator + ground truth
lib/recon/               normalize · tier1-exact · tier2-batch · tier3-fuzzy · engine · metrics
lib/ai/                  provider · adjudicator (tier 4) · qa-agent (typed queries)
lib/db/                  node:sqlite schema, client, queries
scripts/                 bench.ts · verify.ts
```

Amounts are **integer paise** everywhere. Floating point here is not merely imprecise, it
manufactures exceptions: 200 settlement lines summed as floats drift by a paisa, the total misses
the bank credit by that drift, and a perfectly good match is reported as an unexplained variance.

Dates are **business dates**, not instants — a `YYYY-MM-DD` day key plus a business-day calendar
with Indian bank holidays, shared by the generator and the engine. Millisecond arithmetic would
make every weekend look like a two-day variance.

---

## Where else this applies

The engine is a two-or-three-source *identifier + amount + date* matcher. Swap the sources and it
covers marketplace seller settlements, Stripe/bank/QuickBooks three-way, NBFC loan disbursal
against bank debits, payroll (bulk NEFT against the payroll register), and GST ITC matching against
GSTR-2B. The adjacent value is the same in all of them: month-end close acceleration, audit
sampling with a ready evidence trail, and leakage detection — silent fee creep, payouts that never
landed, orphan debits.

All data is synthetic. No real merchant, bank or gateway records are involved.
