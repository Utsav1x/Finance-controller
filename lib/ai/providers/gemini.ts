import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import type { AIProvider, GenerateOptions, Usage } from './types'

/**
 * Gemini implementation.
 *
 * Generation runs through a fallback chain rather than one model. Free-tier
 * quota is granted per model per day and current-generation models get small
 * allowances, so a day of building otherwise ends with a dead app. When one
 * model's daily quota is spent the next in the chain still has its own.
 */

const CONFIGURED_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash'

const MODEL_CHAIN = [
  CONFIGURED_MODEL,
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
].filter((m, i, all) => all.indexOf(m) === i)

/** Rough free-tier-adjacent flash pricing, USD per million tokens. Reported, never billed. */
const PRICE_IN = 0.075 / 1_000_000
const PRICE_OUT = 0.3 / 1_000_000

export function estimateCost(usage: Usage): number {
  return usage.inputTokens * PRICE_IN + usage.outputTokens * PRICE_OUT
}

function isDailyQuotaError(message: string): boolean {
  return /PerDay|RequestsPerDay/i.test(message) || /no longer available to new users/i.test(message)
}

function isTransient(message: string): boolean {
  return /503|overloaded|high demand|429|rate limit/i.test(message)
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'
  private readonly client: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  /** 503 and 429 are temporary and usually clear in seconds. */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const delays = [1000, 3000, 7000]
    let lastError: unknown

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        if (!isTransient(message) || attempt === delays.length) throw error
        console.warn(`[ai] ${label} transient failure, retrying in ${delays[attempt]}ms`)
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
    throw lastError
  }

  private async call(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateOptions,
    json: boolean,
  ): Promise<{ text: string; usage: Usage }> {
    const generationConfig: GenerationConfig = {
      temperature: options.temperature ?? (json ? 0 : 0.3),
      maxOutputTokens: options.maxTokens ?? 2048,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    }

    let lastError: unknown
    for (const modelName of MODEL_CHAIN) {
      try {
        return await this.withRetry(modelName, async () => {
          const model = this.client.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
            generationConfig,
          })
          const result = await model.generateContent(userPrompt)
          const meta = result.response.usageMetadata
          return {
            text: result.response.text(),
            usage: {
              calls: 1,
              inputTokens: meta?.promptTokenCount ?? 0,
              outputTokens: meta?.candidatesTokenCount ?? 0,
            },
          }
        })
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        if (isDailyQuotaError(message)) {
          console.warn(`[ai] ${modelName} daily quota spent, falling through`)
          continue
        }
        throw error
      }
    }
    throw lastError ?? new Error('[ai] every model in the chain failed')
  }

  async generateText(systemPrompt: string, userPrompt: string, options: GenerateOptions = {}) {
    return this.call(systemPrompt, userPrompt, options, false)
  }

  async generateJSON<T>(systemPrompt: string, userPrompt: string, options: GenerateOptions = {}) {
    const { text, usage } = await this.call(systemPrompt, userPrompt, options, true)
    try {
      return { data: JSON.parse(text) as T, usage }
    } catch {
      // Models occasionally wrap JSON in a fence despite the mime type.
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenced) return { data: JSON.parse(fenced[1]) as T, usage }
      throw new Error(`[ai] response was not valid JSON: ${text.slice(0, 200)}`)
    }
  }
}
