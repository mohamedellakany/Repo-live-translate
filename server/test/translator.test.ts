import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://localhost:54329/lisancast_test";
const { Translator } = await import("../src/translation/index.js");

const fake = (name: string) => ({
  name,
  calls: 0,
  async translate({ text }: { text: string }) {
    this.calls++;
    return `${name}:${text}`;
  },
});

test("previews use the preview provider, finished sentences the main one, with separate caches", async () => {
  const main = fake("deepl");
  const preview = fake("azure");
  const t = new Translator(main, preview);
  assert.equal(t.providerName, "deepl (previews: azure)");

  assert.equal(await t.translate({ kind: "partial", text: "مرحبا بكم", from: "ar", to: "en" }), "azure:مرحبا بكم");
  // The same text, now finished, must go to the main provider, not reuse the cached preview.
  assert.equal(await t.translate({ kind: "final", text: "مرحبا بكم", from: "ar", to: "en" }), "deepl:مرحبا بكم");
  // Repeats are served from each provider's own cache.
  await t.translate({ kind: "final", text: "مرحبا بكم", from: "ar", to: "en" });
  await t.translate({ kind: "partial", text: "مرحبا بكم", from: "ar", to: "en" });
  assert.equal(main.calls, 1);
  assert.equal(preview.calls, 1);
});

test("without a preview provider, everything uses the main one", async () => {
  const main = fake("deepl");
  const t = new Translator(main);
  assert.equal(t.providerName, "deepl");
  assert.equal(await t.translate({ kind: "partial", text: "سلام", from: "ar", to: "en" }), "deepl:سلام");
});
