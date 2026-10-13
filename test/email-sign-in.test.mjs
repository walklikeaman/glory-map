import assert from "node:assert/strict";
import test from "node:test";

import { emailLinkMessage, signInEmail } from "../app/lib/email-sign-in.mjs";

test("an address is trimmed and lower-cased before the link is sent", () => {
  assert.equal(signInEmail("  Reader@Example.COM "), "reader@example.com");
  assert.equal(signInEmail("first.last+maps@sub.example.co.uk"), "first.last+maps@sub.example.co.uk");
});

test("something that is not an address is refused before Supabase sees it", () => {
  for (const value of ["", "reader", "reader@", "@example.com", "reader@example", "two words@example.com", null, 42]) {
    assert.equal(signInEmail(value), null, String(value));
  }
  assert.equal(signInEmail(`${"a".repeat(250)}@example.com`), null);
});

test("the reader is told where the link went, or why it did not", () => {
  assert.match(emailLinkMessage("reader@example.com", null), /reader@example\.com/);
  assert.match(emailLinkMessage("r@e.co", { status: 429, message: "x" }), /Too many links/);
  assert.match(emailLinkMessage("r@e.co", { message: "Email rate limit exceeded" }), /Too many links/);
  assert.equal(emailLinkMessage("r@e.co", { status: 500, message: "boom" }), "The link could not be sent. Please try again.");
});
