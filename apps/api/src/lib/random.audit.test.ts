/** Audit regression tests for security randomness (AUTH-4, case ref H8). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDigits, randomFromAlphabet } from "./random.js";

// AUTH-4 (H8): OTP codes and payment-link tokens must come from a CSPRNG, not the
// predictable Math.random. With Math.random pinned, output must still vary.
test("AUTH-4: randomDigits and randomFromAlphabet do not depend on Math.random", () => {
  const original = Math.random;
  Math.random = () => 0;
  try {
    const otps = new Set(Array.from({ length: 20 }, () => randomDigits(6)));
    const tokens = new Set(Array.from({ length: 20 }, () => randomFromAlphabet("abcdefghijklmnopqrstuvwxyz", 12)));
    assert.ok(otps.size > 1, `OTP codes followed Math.random: ${[...otps].join(",")}`);
    assert.ok(tokens.size > 1, `tokens followed Math.random: ${[...tokens].join(",")}`);
  } finally {
    Math.random = original;
  }
});
