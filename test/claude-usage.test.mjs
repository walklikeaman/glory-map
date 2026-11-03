import test from "node:test";
import assert from "node:assert/strict";

import { createUsageMeter } from "../app/lib/claude-usage.mjs";

test("usage is summed per model and priced from the list", () => {
  const meter = createUsageMeter();
  meter.record("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 });
  meter.record("claude-haiku-5-5", { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100_000 });
  const [row] = meter.summary();
  assert.equal(row.calls, 2);
  assert.equal(row.output, 200_000);
  assert.equal(row.dollars, 0.1 + 0.1);
});

test("a model with no known price reports its tokens and no invented dollars", () => {
  const meter = createUsageMeter();
  meter.record("claude-unknown", { input_tokens: 5, output_tokens: 5 });
  assert.equal(meter.summary()[0].dollars, null);
});
