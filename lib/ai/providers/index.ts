/**
 * Provider factory.
 *
 * Returns `null` rather than throwing when no key is configured. That choice is
 * load-bearing: the engine treats a missing adjudicator as a supported mode and
 * reports what it could not resolve, so the whole product runs, grades and
 * demonstrates itself with no credentials at all. Throwing here would make an
 * API key a prerequisite for reproducing an accuracy claim.
 */

import { GeminiProvider } from './gemini'
import type { AIProvider } from './types'

export type { AIProvider, GenerateOptions, Usage } from './types'
export { estimateCost } from './gemini'

type ProviderName = 'gemini'

let cached: AIProvider | null | undefined

export function getAIProvider(): AIProvider | null {
  if (cached !== undefined) return cached

  const name = (process.env.AI_PROVIDER ?? 'gemini') as ProviderName
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim()

  if (!apiKey) {
    console.warn('[ai] GOOGLE_AI_API_KEY not set — running deterministic tiers only')
    cached = null
    return cached
  }

  switch (name) {
    case 'gemini':
      cached = new GeminiProvider(apiKey)
      break
    default:
      console.warn(`[ai] unknown provider "${name}" — running deterministic tiers only`)
      cached = null
  }

  if (cached) console.log(`[ai] provider initialized: ${cached.name}`)
  return cached
}

export function hasAIProvider(): boolean {
  return getAIProvider() !== null
}
