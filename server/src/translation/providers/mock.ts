import type { TranslateRequest, TranslationProvider } from "../types.js";

/** Deterministic provider for automated tests. */
export class MockProvider implements TranslationProvider {
  readonly name = "mock";
  async translate({ text, to }: TranslateRequest): Promise<string> {
    return `[${to}] ${text}`;
  }
}
