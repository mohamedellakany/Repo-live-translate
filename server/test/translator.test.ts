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

test("usage is reported only for requests actually sent to a provider", async () => {
  const t = new Translator(fake("azure"));
  const seen: [string, number][] = [];
  t.onUsage = (provider, chars) => seen.push([provider, chars]);
  await t.translate({ kind: "final", text: " مرحبا ", from: "ar", to: "en" });
  await t.translate({ kind: "final", text: "مرحبا", from: "ar", to: "en" }); // cache hit
  await t.translate({ kind: "final", text: "hello", from: "en", to: "en" }); // same language, nothing sent
  assert.deepEqual(seen, [["azure", 5]]);
});

const refusing = (name: string, status: number) => ({
  name,
  calls: 0,
  async translate() {
    this.calls++;
    throw Object.assign(new Error(`HTTP ${status}: quota exceeded`), { status });
  },
});

test("each provider is used until its monthly limit, in order: main, fallback, paid", async () => {
  const azure = fake("azure");
  const google = fake("google");
  const paid = fake("azure-paid");
  const t = new Translator(azure, undefined, [google, paid]);
  assert.equal(t.providerName, "azure, then google, then azure-paid");
  const full = new Set<string>();
  t.hasRoom = (name) => !full.has(name);
  assert.equal(await t.translate({ kind: "final", text: "واحد", from: "ar", to: "en" }), "azure:واحد");
  full.add("azure");
  assert.equal(await t.translate({ kind: "final", text: "اثنان", from: "ar", to: "en" }), "google:اثنان");
  full.add("google");
  assert.equal(await t.translate({ kind: "final", text: "ثلاثة", from: "ar", to: "en" }), "azure-paid:ثلاثة");
  full.add("azure-paid");
  // Everything at its limit: back to the main provider (it may still accept, or refuse).
  assert.equal(await t.translate({ kind: "final", text: "أربعة", from: "ar", to: "en" }), "azure:أربعة");
  assert.deepEqual([azure.calls, google.calls, paid.calls], [2, 1, 1]);
});

test("a refused request (quota or key) moves on to the next provider; other errors don't", async () => {
  const seen: string[] = [];
  const t = new Translator(refusing("azure", 403), undefined, [refusing("google", 429), fake("azure-paid")]);
  t.onUsage = (provider) => seen.push(provider);
  assert.equal(await t.translate({ kind: "final", text: "مرحبا", from: "ar", to: "en" }), "azure-paid:مرحبا");
  assert.deepEqual(seen, ["azure-paid"]);

  const broken = new Translator(refusing("azure", 500), undefined, [fake("google")]);
  await assert.rejects(broken.translate({ kind: "final", text: "مرحبا", from: "ar", to: "en" }), /HTTP 500/);
});

test("a provider at its limit is skipped, even as a backup (no surprise bills)", async () => {
  const paid = fake("azure-paid");
  const t = new Translator(refusing("azure", 403), undefined, [paid]);
  t.hasRoom = (name) => name !== "azure-paid";
  await assert.rejects(t.translate({ kind: "final", text: "مرحبا", from: "ar", to: "en" }), /quota exceeded/);
  assert.equal(paid.calls, 0);
});

test("after switching, if the fallback refuses, the main provider is tried again", async () => {
  const azure = fake("azure");
  const t = new Translator(azure, undefined, [refusing("google", 403)]);
  t.hasRoom = (name) => name !== "azure"; // main at its switch point
  assert.equal(await t.translate({ kind: "final", text: "مرحبا", from: "ar", to: "en" }), "azure:مرحبا");
  assert.equal(azure.calls, 1);
});
