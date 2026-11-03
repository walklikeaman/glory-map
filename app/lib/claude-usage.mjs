// What a batch run on Claude actually cost, measured from the API's own usage counts.
//
// The owner decides on a catalogue-wide run with the bill of a small one in front of them
// (03.11), so the pilot has to report dollars, not just "it worked".

import Anthropic from "@anthropic-ai/sdk";

// $ per million tokens, input / output, Claude API list prices (03.11).
export const CLAUDE_PRICES = Object.freeze({
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
});

export function createUsageMeter() {
  const byModel = new Map();
  return {
    record(model, usage) {
      const row = byModel.get(model) ?? { calls: 0, input: 0, output: 0 };
      row.calls += 1;
      row.input += (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)
        + (usage?.cache_read_input_tokens ?? 0);
      row.output += usage?.output_tokens ?? 0;
      byModel.set(model, row);
    },
    summary() {
      return [...byModel].map(([model, row]) => {
        const price = CLAUDE_PRICES[model];
        const dollars = price ? (row.input * price.input + row.output * price.output) / 1e6 : null;
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
