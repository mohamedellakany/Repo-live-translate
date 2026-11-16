import type { TranslateRequest, TranslationProvider } from "../types.js";

/** Deterministic provider for automated tests. */
export class MockProvider implements TranslationProvider {
  readonly name = "mock";
  /** MOCK_TRANSLATION_DELAY_MS simulates a real provider's response time (used for usage benchmarks). */
  private readonly delayMs = Number(process.env.MOCK_TRANSLATION_DELAY_MS) || 0;
  async translate({ text, to }: TranslateRequest): Promise<string> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return `[${to}] ${text}`;
  }
}
