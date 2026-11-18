import { test } from "node:test";
import assert from "node:assert/strict";
import { BadOutputError, isTransientAiError, withFallbacks } from "../src/retry.js";

const busy = () => Object.assign(new Error("503 gemini-3.8-flash is currently experiencing high demand"), { status: 503 });
const noSleep = async () => {};
const attempts = [{ model: "main" }, { model: "main", delayMs: 3000 }, { model: "lite" }];

test("busy main model: retried once, then the fallback model is used", async () => {
  const tried: string[] = [];
  const out = await withFallbacks(attempts, async (m) => {
    tried.push(m);
    if (m === "main") throw busy();
    return `summary from ${m}`;
  }, { sleep: noSleep });
  assert.equal(out, "summary from lite");
  assert.deepEqual(tried, ["main", "main", "lite"]);
});

test("a successful retry doesn't touch the fallback", async () => {
  let calls = 0;
  const out = await withFallbacks(attempts, async (m) => (++calls === 1 ? Promise.reject(busy()) : m), { sleep: noSleep });
  assert.equal(out, "main");
  assert.equal(calls, 2);
});

test("bad output also moves on; permanent errors (e.g. bad key) fail at once", async () => {
  const tried: string[] = [];
  assert.equal(
    await withFallbacks(attempts, async (m) => {
      tried.push(m);
      if (m === "main") throw new BadOutputError("not JSON");
      return "ok";
    }, { sleep: noSleep }),
    "ok",
  );
  assert.deepEqual(tried, ["main", "main", "lite"]);

  let calls = 0;
  const badKey = Object.assign(new Error("API key not valid"), { status: 400 });
  await assert.rejects(withFallbacks(attempts, async () => (calls++, Promise.reject(badKey)), { sleep: noSleep }), /API key not valid/);
  assert.equal(calls, 1);
});

test("all attempts busy: the last error is reported", async () => {
  await assert.rejects(withFallbacks(attempts, async () => Promise.reject(busy()), { sleep: noSleep }), /high demand/);
  assert.ok(isTransientAiError(Object.assign(new Error("Rate limit exceeded"), { status: 429 })));
  assert.ok(!isTransientAiError(new Error("Invalid argument")));
});
