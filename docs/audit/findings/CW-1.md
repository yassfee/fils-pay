### CW-1 · A payout disbursement record is written per webhook delivery, not per batch · Severity: Medium
**Category:** Bug

**What's wrong:** The `settlement.paid` pre-delivery effect inserts a `settlement_payout_disbursements` row (a payout-rail instruction) for every delivery row whose `attempt_count` is 0, and the table has no uniqueness on `settlement_batch_id`, so one paid batch gets one instruction per endpoint, per replay, per racing dispatcher and per duplicate outbox row.

**Why it happens:** `apps/api/src/webhooks/dispatcher.ts:37-42` wires the effect; `dispatcher.ts:160-163` runs it when `attempt_count === 0`, a stale read taken by an unlocked SELECT (`:221-228`, MK "no SKIP LOCKED") and only incremented after the HTTP send; `apps/api/src/webhooks/payoutDisbursement.ts:15-16` inserts with a fresh `'disb_'||gen_random_uuid()` and no `ON CONFLICT`; `db/migrations/0057_settlement_payout_disbursements.sql:17-18` has only a non-unique index. Hidden by 0057:20 "Written inside PayoutBatch's transaction, one row per paid batch" (false: the api dispatcher writes it), `index.ts:29` ("SKIP LOCKED in the claim query", none exists), and `payoutDisbursement.test.ts:40` (FH: "only checks the insert, not who calls it or how often").

**What it breaks:** Batch net payout 471,300 fils (471.300 BD), merchant with two active endpoints: two disbursement rows totalling 942,600 fils, i.e. 471.300 BD of duplicate payout instructions. The ledger has one payout leg pair, so the table and the ledger disagree by (N-1) × net.

**Why Medium, not High:** the table is not a posting. Migration 0057:1-8 says it is "Not a chart-of-accounts posting" and that PayoutBatch's `merchant_payable`/`platform_cash` legs "remain the sole authoritative accounting record of a payout". Nothing reads it: the only reference in `apps/` is this INSERT (`payoutDisbursement.ts:15`); no API, report, web page or Go code selects from it, and the webhook payload does not carry its reference. So today the duplicates mislead anyone who queries the table, and would double-pay only if a future payout-rail integration acted on it. The case file's INC-2026-08-21 ("two 'your payout is on the way' messages ... two processes checked at the same time") is the duplicate notification itself, which is NOTIFY-1, not this table; only `docs/ADMIN.md:107` (an unverified doc) links the two.

**Why it needed a fix:** the table is named and documented as the payout-rail instruction record ("one row per paid batch", 0057:20), and its fan-out makes it wrong by construction; a record that any future disbursement step would read must hold one row per batch.

**Fix:** new `db/migrations/0087_settlement_payout_disbursements_unique_batch.sql` (removes existing duplicates keeping the earliest `(created_at, id)`; `CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch ON settlement_payout_disbursements (settlement_batch_id)`), and `apps/api/src/webhooks/payoutDisbursement.ts:16-17`:
```diff
-     VALUES ($1, $2, 'disb_' || gen_random_uuid())`,
+     VALUES ($1, $2, 'disb_' || gen_random_uuid())
+     ON CONFLICT (settlement_batch_id) DO NOTHING`, // CW-1: once per batch, not per webhook delivery
```
Commit `14db87c`. Lines: prod +12/-1 (TS +2/-1, SQL +10), test +34/-0; net with the CW-1b follow-up below: prod +9/-1.

**Why this is the smallest correct fix:** The invariant is "one instruction per batch", so it belongs on the batch key in the database, which closes every fan-out path at once (multiple endpoints, replays, two replicas, restart mid-pass, duplicate `settlement.paid` outbox rows from Go). Why not only a compare-and-swap lease on the delivery row (dossier step 3): it stops racing dispatchers but not the per-endpoint/per-replay fan-out. Why not move the effect into Go `PayoutBatch`: correct long term, but a cross-lane redesign (>30 lines). The duplicate webhook *sends* from two racing dispatchers are a separate dispatcher-concurrency issue (not changed here).

**Proof:** `dispatcher.test.ts` "settlement.paid to a merchant with two endpoints records one disbursement": before `{ n: '2', … }` vs expected `{ n: '1', total: '471300' }`; after passes. `payoutDisbursement.test.ts` "recordPayoutDisbursementEffect is idempotent per batch": before `expected 1, actual 3`; after passes.

**Regression risk:** The migration deletes historical duplicate disbursement rows; finance should review them before production apply (the dossier's caveat). No other code reads/writes the table (grep). Covered by `payoutDisbursement.test.ts`, `dispatcher.test.ts`, `archiveReplay.test.ts` (16/16).

**Trap note:** 0057:20 is an applied migration and is not edited; the 0087 header states the real writer. Not owned here: `index.ts:29,35-36` claims (SKIP LOCKED, stop() waits), `docs/ARCHITECTURE.md:50-51`, ADMIN.md:108 root cause; the Go producer half (`payout_notify.go` NOT EXISTS + INSERT, no unique outbox index) is lane D's NOTIFY-1. A merchant with no endpoint still gets no disbursement record (the effect only runs on delivery); moving it to `PayoutBatch` is recommended to lane D.

**Follow-up (advisor review, commit "fix(CW-1b)"): never delete financial records.** The first version of 0087 deleted
duplicate historic disbursement rows to make a full unique index possible. That destroys evidence finance may need when
reviewing past payouts. 0087 (never applied outside our test databases) now creates a **partial** unique index
`ON (settlement_batch_id) WHERE created_at >= '2026-10-30 00:00:00+03'` and deletes nothing; the insert's
`ON CONFLICT` names the same predicate. New batches get exactly one record; historic duplicates stay for review.
Finance cleanup item: `SELECT settlement_batch_id, count(*), sum(amount_fils) FROM settlement_payout_disbursements
GROUP BY 1 HAVING count(*) > 1;`. Residual: a replay for a batch paid before the fix date can still add one new record
(it is not covered by the partial index); replays of old batches are an admin action. Test:
`payoutDisbursement.test.ts` "historic duplicate disbursement rows are kept; only new rows are unique per batch":
before `duplicate key value violates unique constraint`, after 3 rows kept. Lines: SQL +3/−5, TS +1/−1, test +17/−0.
