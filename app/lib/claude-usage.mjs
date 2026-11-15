// What a batch run on Claude actually cost, measured from the API's own usage counts.
//
// The owner decides on a catalogue-wide run with the bill of a small one in front of them
// (03.11), so the pilot has to report dollars, not just "it worked".

import Anthropic from "@anthropic-ai/sdk";

// $ per million tokens, input / output / cache read, Claude API list prices (03.11, cache
// reads 15.11). A cache write costs 1.25x input (5-minute TTL) on every model.
export const CLAUDE_PRICES = Object.freeze({
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
});
export const CACHE_WRITE_MULTIPLIER = 1.25;

// Dollars for the input side of one response's usage: uncached tokens at list price,
// cache writes at 1.25x, cache reads at the model's read price (0.1x when not listed).
// Counting cache writes at 1x would let a cached run report less than it cost.
export function inputDollars(usage, price) {
  const read = price.cacheRead ?? price.input * 0.1;
  return ((usage?.input_tokens ?? 0) * price.input
    + (usage?.cache_creation_input_tokens ?? 0) * price.input * CACHE_WRITE_MULTIPLIER
    + (usage?.cache_read_input_tokens ?? 0) * read) / 1e6;
}

export function createUsageMeter() {
  const byModel = new Map();
  return {
    record(model, usage) {
      const row = byModel.get(model) ?? { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      row.calls += 1;
      row.input += usage?.input_tokens ?? 0;
      row.cacheWrite += usage?.cache_creation_input_tokens ?? 0;
      row.cacheRead += usage?.cache_read_input_tokens ?? 0;
      row.output += usage?.output_tokens ?? 0;
      byModel.set(model, row);
    },
    summary() {
      return [...byModel].map(([model, row]) => {
        const price = CLAUDE_PRICES[model];
        const dollars = price
          ? inputDollars({
            input_tokens: row.input,
            cache_creation_input_tokens: row.cacheWrite,
            cache_read_input_tokens: row.cacheRead,
          }, price) + row.output * price.output / 1e6
          : null;
        return { model, ...row, dollars };
      });
    },
  };
}

// An SDK client that records the usage of every `messages.parse` call into `meter`.
export function meteredAnthropic(meter) {
  return class MeteredAnthropic extends Anthropic {
    constructor(options) {
      super(options);
      const parse = this.messages.parse.bind(this.messages);
      this.messages.parse = async (body, options) => {
        const message = await parse(body, options);
        meter.record(message.model ?? body.model, message.usage);
        return message;
      };
    }
  };
}
