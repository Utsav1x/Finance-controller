/**
 * Tier 4 — the adjudicator.
 *
 * Three constraints shape this, and all three exist to stop the model from
 * being the weakest link in a number the product asks people to trust:
 *
 *   1. **It only ever sees leftovers.** By the time a batch reaches here the
 *      deterministic tiers have failed on it. Sending everything to a model
 *      would be slower, cost more, and — because it replaces a rule you can
 *      read with a judgement you cannot — make the match rate unauditable.
 *
 *   2. **It is given arithmetic, not asked for it.** Every delta and day gap is
 *      computed before the prompt is built. Models are unreliable at summing
 *      twelve rupee figures and entirely reliable at reasoning about a
 *      difference you hand them.
 *
 *   3. **"No" is a first-class answer.** The prompt says so explicitly, and a
 *      verdict below the confidence floor becomes an exception regardless of
 *      how it is phrased. An adjudicator that always finds a match is a random
 *      number generator with good manners.
 */

import { z } from 'zod'
import type {
  Adjudicator,
  AdjudicationRequest,
  AdjudicationVerdict,
  AdjudicatorUsage,
} from '@/lib/recon/engine'
import { getAIProvider, estimateCost } from './providers'
import { formatMoney } from '@/lib/format-money'

const SYSTEM_PROMPT = `You are the adjudication step of a payment reconciliation engine for an Indian e-commerce merchant.

A settlement batch is one payout from a payment gateway: many card/UPI payments, net of the gateway fee, GST on that fee, and any refunds or chargebacks that settled in the same cycle. It normally arrives as ONE bank credit, two to three business days later, with the batch's UTR in the narration.

Deterministic rules have already tried and failed on the batches below. You see only what they could not resolve. For each batch, decide whether any candidate bank credit — or a SUM of several — is that payout.

Evidence you are given, already computed. Do not recompute it:
  netPaise      what the gateway says it paid out
  creditPaise   what the bank credit was for
  deltaPaise    creditPaise - netPaise (negative = the credit is short)
  dayGap        business days from the settlement date to the value date
  score         the engine's own 0-1 confidence, which was too low to accept

How to weigh it:
- A narration naming a DIFFERENT payment gateway or an unrelated payer is decisive evidence AGAINST, no matter how close the amount is. Merchants receive money from many sources.
- A large deltaPaise with no reference support is a coincidence, not a match.
- A split payout is real: two credits on the same or adjacent day that SUM to netPaise, especially when one carries the reference and the other says the reference was not provided.
- A negative dayGap is impossible — money cannot arrive before the payout was made.
- A batch containing refunds or chargebacks pays out LESS than its payments imply. That is expected, not suspicious.

Returning decision "no_match" is correct and useful. The unresolved item goes to a human queue with your reasoning attached, which is a better outcome than a wrong match a human never thinks to check. Do not stretch to find a match.

Return ONLY JSON of this shape:
{"verdicts":[{"settlementId":"SET-0001","decision":"match"|"no_match","matchedIds":["BNK-00012"],"confidence":0.0-1.0,"reasonCode":"SPLIT_PAYOUT"|"TIMING_GAP"|"ROUNDING"|"NARRATION_NOISE"|"ORPHAN_CREDIT"|"MISSING_CREDIT"|"NO_CANDIDATE","rationale":"one sentence a finance reviewer can act on"}]}

matchedIds must be [] when decision is "no_match". confidence is your own belief, not the engine's score.

Keep every rationale under 25 words. Return one verdict per batch and nothing else — no preamble, no commentary between objects.`

const VerdictSchema = z.object({
  settlementId: z.string(),
  decision: z.enum(['match', 'no_match']),
  matchedIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  reasonCode: z.string().default(''),
  rationale: z.string().default(''),
})

const ResponseSchema = z.object({
  verdicts: z.array(VerdictSchema),
})

function renderRequest(r: AdjudicationRequest): string {
  const composition = [
    `${r.composition.payments} payment(s)`,
    r.composition.refunds > 0 ? `${r.composition.refunds} refund(s)` : null,
    r.composition.chargebacks > 0 ? `${r.composition.chargebacks} chargeback(s)` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const candidates =
    r.candidates.length === 0
      ? '    (no candidate bank credit came close enough to be worth showing)'
      : r.candidates
          .map(
            (c) =>
              `    - ${c.lineId} | ${c.valueDate} | credit ${formatMoney(c.creditPaise)} | delta ${c.deltaPaise} paise | dayGap ${c.dayGap} | score ${c.score}\n      narration: "${c.narration}"`,
          )
          .join('\n')

  return `BATCH ${r.settlementId}
    settled on ${r.settledOn}, UTR ${r.utr}
    composition: ${composition}
    netPaise ${r.netPaise} (${formatMoney(r.netPaise)})
  candidates:
${candidates}`
}

export function createAdjudicator(): Adjudicator | null {
  const provider = getAIProvider()
  if (!provider) return null

  return {
    name: provider.name,

    async adjudicate(
      requests: AdjudicationRequest[],
    ): Promise<{ verdicts: AdjudicationVerdict[]; usage: AdjudicatorUsage }> {
      if (requests.length === 0) {
        return {
          verdicts: [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 },
        }
      }

      const usage: AdjudicatorUsage = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estCostUsd: 0,
      }
      const verdicts: AdjudicationVerdict[] = []

      // Batched into groups rather than one call per record. Each prompt repeats
      // ~600 tokens of instructions, so one call per batch would spend most of
      // the quota re-reading the same rules. Four rather than six: the output
      // budget is shared with the model's reasoning tokens, and a group large
      // enough to truncate loses every verdict in it.
      const GROUP_SIZE = 4
      for (let i = 0; i < requests.length; i += GROUP_SIZE) {
        const group = requests.slice(i, i + GROUP_SIZE)
        const prompt = group.map(renderRequest).join('\n\n')

        let data: unknown
        try {
          const call = await provider.generateJSON<unknown>(SYSTEM_PROMPT, prompt, {
            temperature: 0,
            maxTokens: 8192,
          })
          data = call.data
          usage.calls += call.usage.calls
          usage.inputTokens += call.usage.inputTokens
          usage.outputTokens += call.usage.outputTokens
        } catch (error) {
          // One bad group must not cost the others their verdicts. An earlier
          // version let a single truncated response throw out of the loop and
          // lose all sixteen batches, which then reported as "the adjudicator
          // was unavailable" — describing a total outage when fifteen of the
          // sixteen would have been answered correctly.
          console.warn(
            `[adjudicator] group ${i / GROUP_SIZE + 1} failed, its batches go to the exception list:`,
            error instanceof Error ? error.message : String(error),
          )
          continue
        }

        const parsed = ResponseSchema.safeParse(data)
        if (!parsed.success) {
          console.warn('[adjudicator] response failed validation, skipping group', parsed.error.message)
          continue
        }

        for (const v of parsed.data.verdicts) {
          // A verdict naming a batch we did not ask about is discarded rather
          // than trusted — it means the model lost track of the list.
          if (!group.some((g) => g.settlementId === v.settlementId)) continue

          // Likewise for invented bank line ids.
          const known = new Set(
            group.find((g) => g.settlementId === v.settlementId)!.candidates.map((c) => c.lineId),
          )
          verdicts.push({
            ...v,
            matchedIds: v.matchedIds.filter((id) => known.has(id)),
          })
        }
      }

      usage.estCostUsd = estimateCost({
        calls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })

      return { verdicts, usage }
    },
  }
}
