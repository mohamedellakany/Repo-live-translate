import { config } from "../config.js";

/** Name used for the pay-as-you-go Azure key, so its usage is counted separately from the free one. */
export const PAID_PROVIDER = "azure-paid";

/**
 * The order providers are tried in, and each one's monthly limit (characters; 0 = no limit).
 * Main (free) until its switch point → fallback (free) up to its limit → paid key up to its cap.
 */
export function providerChain(): { name: string; limit: number; allowance: number; label: string }[] {
  const chain: { name: string; limit: number; allowance: number; label: string }[] = [
    {
      name: config.TRANSLATION_PROVIDER,
      limit: config.TRANSLATION_SWITCH_AT,
      allowance: config.TRANSLATION_MONTHLY_LIMIT,
      label: `${config.TRANSLATION_PROVIDER} (free)`,
    },
  ];
  const fb = config.TRANSLATION_FALLBACK_PROVIDER;
  if (fb && fb !== config.TRANSLATION_PROVIDER) {
    chain.push({ name: fb, limit: config.TRANSLATION_FALLBACK_LIMIT, allowance: config.TRANSLATION_FALLBACK_LIMIT, label: `${fb} (free)` });
  }
  if (config.AZURE_TRANSLATOR_PAID_KEY) {
    chain.push({ name: PAID_PROVIDER, limit: config.TRANSLATION_PAID_LIMIT, allowance: config.TRANSLATION_PAID_LIMIT, label: "azure (pay-as-you-go)" });
  }
  return chain;
}

/** Monthly limit for a provider name (0 = no limit). */
export const limitFor = (name: string) => providerChain().find((p) => p.name === name)?.limit ?? 0;
/** The allowance to show/warn against (for the main free provider: its full allowance, e.g. 2,000,000). */
export const allowanceFor = (name: string) => providerChain().find((p) => p.name === name)?.allowance ?? 0;
