/**
 * The provider contract.
 *
 * Same shape as the rest of the suite so an integration can be lifted between
 * projects, minus embeddings — nothing here retrieves over prose. Reconciliation
 * questions are answered by querying structured records, not by finding
 * passages that sound relevant, and a vector search would only add a way to be
 * confidently wrong about a number.
 */

export interface GenerateOptions {
  /** 0–1. Lower is more deterministic. Adjudication runs near zero. */
  temperature?: number
  maxTokens?: number
}

export interface Usage {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface AIProvider {
  readonly name: string

  generateText(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateOptions,
  ): Promise<{ text: string; usage: Usage }>

  /**
   * JSON-mode response. The system prompt must describe the schema; the caller
   * validates. Returning parsed-but-unvalidated data is how a model's stray
   * field ends up written to the ledger as fact.
   */
  generateJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateOptions,
  ): Promise<{ data: T; usage: Usage }>
}
