import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

// CW-8: outside production the api must boot on its built-in dev webhook key.
// Every other test passes its own key, so the fallback was never exercised.
test("non-production boot without WEBHOOK_SECRET_ENCRYPTION_KEY falls back to a 32-byte dev key", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/filspay", NODE_ENV: "development" });
  assert.equal(Buffer.from(config.webhookSecretEncryptionKey, "base64").length, 32);
});
