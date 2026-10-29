### AUTH-3 · Admin API-key rotation never revokes the old key · H4 · Severity: High

**What's wrong:** `POST /v1/admin/merchants/:id/api-keys/:keyId/rotate` issued a new key but left the old one live. "Rotation" therefore added credentials instead of replacing them, and rotating the same key again minted a third live key.

**Why it happens:** `apps/api/src/admin/apiKeys.ts:18-47` locks the old row (`FOR UPDATE`), calls `issueApiKeyInTx` (INSERT only), writes the audit row and returns. Nothing updates the old row, even though 0037 added `revoked_reason` precisely "to make rotate atomic". `apiKeys/verify.ts` accepts any key with `revoked_at IS NULL`. The `revoke_after` column (0056) has no reader or writer, so no overlap window exists either. The test `routes/admin.test.ts:800` asserted the bug: "the previous key stays active", `revoked_at` null.

**What it breaks:** A merchant reports a leaked key and finance rotates it. The leaked key still returns 200 on `GET /v1/transactions` and every other API-key route, indefinitely. The incident response does nothing, and the audit log records an `api_key_rotate` as if it had.

**Why it needed a fix:** H4 says the key rotation flow "doesn't do what you'd expect". Rotation is how a compromised credential is cut off, and leaving the old key live defeats it.

**Fix:** `apps/api/src/admin/apiKeys.ts:30-31`
```diff
     if (row.revoked_at) {
       throw new ConflictError("api_key_already_revoked");
     }
+    // AUTH-3 (H4): rotation revokes the old key in the same transaction (no overlap window in the design).
+    await client.query(`UPDATE api_keys SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = $1`, [input.apiKeyId]);
```
Commit: this commit. Lines: prod +2/-0, test +6/-7 (corrected assertions in `routes/admin.test.ts`).

**Why this is the smallest correct fix:** The row is already locked and checked for merchant ownership and non-revocation in the same transaction, so a single `UPDATE` by id makes rotation atomic (revoke the old key, issue the new one, write the audit row) and re-rotation now returns the existing 409 `api_key_already_revoked`. *Why not wire `revoke_after` for a grace period?* YA's note on the test says "there was never a grace period in the design. rotation = revoke". A grace period would also need changes to `verify.ts` and a sweep, and is a product decision, not a fix.

**Proof:** `API key rotation issues a new key atomically and audits it; the previous key is revoked` (`apps/api/src/routes/admin.test.ts`, corrected) fails before the fix with `assert.equal(after.statusCode, 401, "the previous key is revoked by rotation (H4)")` → `200 !== 401`. It passes after the fix, along with `oldRow.revoked_at` set and `revoked_reason === "rotated"`.

**Regression risk:** The new key, the audit row, the 409 on an already-revoked key and the 404 on another merchant's key are unchanged. `routes/admin.test.ts` passes 41/41.

**Trap note:** The test at `admin.test.ts:798-800` was named "...the previous key stays active", carried the note "grace period ... intended (am, 2026-05)", and asserted 200, `revoked_at` null and `revoked_reason` null. All of those encoded the bug. They are corrected with comments citing H4, and YA's line ("rotation = revoke") is kept.
