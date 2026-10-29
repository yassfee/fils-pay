### CW-5 · Acquirer callbacks are never deduplicated · FP-201 · Severity: High

**What's wrong:** `applyAcquirerCallback` does an unconditional `INSERT INTO acquirer_callback_notes`; nothing checks `callback_id` and the table has no unique constraint, so every acquirer redelivery adds another identical fraud-review note.

**Why it happens:** `apps/api/src/acquirer/callbacks.ts:37-50` has no `ON CONFLICT`; `db/migrations/0051_acquirer_callback_notes.sql:8-12,18` leaves `callback_id` unconstrained; `withCallbackRetry` (`callbacks.ts:62-78`) re-runs the insert on any error. The `processed_events` table that HANDOVER.md:63-64, the CHANGELOG (1.6.0, 1.9.0) and 0051:29-31 (MK "FP-238 adds a unique index here as well — done") rely on exists in no migration or code path; postmortem action #9 claims a replay test that `callbacks.test.ts` never had.

**What it breaks:** Acquirer B retries a callback up to 5 times with the same callbackId when our 2xx is late. A single "confirmed_fraud" verdict can appear 2-6 times on one payment's timeline (FP-201); with CW-7's missing freshness check (now fixed) a captured callback could be replayed indefinitely. Worked example from the test: 2 sequential + 3 concurrent deliveries of one callback → 5 rows.

**Why it needed a fix:** FP-201 duplicates confuse support/finance, and any future state-changing callback built on this pattern would be applied twice (the 2026-05-14 incident class).

**Fix:** new `db/migrations/0086_acquirer_callback_notes_dedupe.sql` (deletes existing duplicates keeping the earliest `(created_at, id)`, then `CREATE UNIQUE INDEX uq_acquirer_callback_notes_txn_callback ON acquirer_callback_notes (transaction_id, callback_id)`), and `apps/api/src/acquirer/callbacks.ts:40-41`:
```diff
-     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
+     VALUES ($1, $2, $3, $4, $5, $6, $7)
+     ON CONFLICT (transaction_id, callback_id) DO NOTHING`, // CW-5: acquirer redeliveries (FP-201)
```
Commit: this commit. Lines: prod +12/-1 (TS +2/-1, SQL +10), test +14/-0.

**Why this is the smallest correct fix:** The database is the only place that is race-free (the concurrent half of the test proves a SELECT-then-INSERT check would not be). Per-transaction key matches the FP-201 symptom and stays safe if the acquirer reuses ids across transactions. The route still returns 200 on a redelivery so the acquirer stops retrying. Why not a `processed_events` table: new table + code path for the same guarantee. Why not drop `withCallbackRetry`: the insert is now idempotent, so the retry is harmless.

**Proof:** `acquirer/callbacks.test.ts` "applyAcquirerCallback records a redelivered callback once (sequential and concurrent)": before `expected 1, actual 5`; after passes. `routes/acquirerCallbacks.test.ts` still green (11/11 across both files).

**Regression risk:** The migration's DELETE removes historical duplicate notes (identical redeliveries; earliest kept). Unique index build takes a brief lock on a small table (CONCURRENTLY is not possible inside `db/migrate.ts`'s transaction). Covered by both callback test files.

**Trap note:** The false "deduplicated" claims (CHANGELOG, HANDOVER.md:63, 0051:29-31 MK, postmortem #1/#9) are not editable here (docs/applied migration outside this lane); this note and the migration header record the correction.
