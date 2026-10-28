export interface TranslateRequest {
  text: string;
  from: string; // ISO 639-1
  to: string; // ISO 639-1
  /** Previous finalized sentences (source language), oldest first. Optional context for smarter providers. */
  context?: string[];
  signal?: AbortSignal;
}

export interface TranslationProvider {
  readonly name: string;
  translate(req: TranslateRequest): Promise<string>;
}

export class TranslationError extends Error {
  constructor(message: string, readonly provider: string, readonly status?: number) {
    super(message);
  }
}
