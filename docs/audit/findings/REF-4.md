### REF-4 · A refund without a reason violates chk_refunds_reason_not_null after the acquirer has paid · FP-300 (☐1 "works from start to end") · Severity: High

**What's wrong:** `processRefund` binds `input.reason ?? null` into `INSERT INTO refunds (..., reason, ...)`, and migration 0070 forbids NULL there, so every refund sent without a reason fails in phase 3 with check_violation 23514.

**Why it happens:** `apps/api/src/payments/processRefund.ts:189` names the `reason` column explicitly and passes NULL. Migration `0070_refund_reason_default.sql:6` adds `DEFAULT 'unspecified'`, but a column DEFAULT applies only when the column is left out of the INSERT; an explicit NULL skips it. `:8-9` adds `CHECK (reason IS NOT NULL) NOT VALID`; NOT VALID skips only the rows that already exist, and every new row is checked. The faulty assumption was that the DEFAULT would cover a NULL bind.

**What it breaks:** `reason` is optional (`ProcessRefundInput.reason?`) and none of the callers or tests send it. A 10,000 fils refund is approved by the acquirer in phase 2 (money leaves). The phase 3 INSERT then throws, so the whole journal rolls back: no `refunds` row, no ledger reversal, `refunded_fils` stays 0, there is no timeline event and no webhook, and the API answers 500. The idempotency key stays `in_progress`, so a retry gets 409. The 10,000 fils is gone from the books.

**Why it needed a fix:** On a fully migrated database no refund without a reason can ever complete. Each attempt sends money out with no ledger record, so FP-300 cannot work from start to end.

**Fix:** `apps/api/src/payments/processRefund.ts:189`
```diff
-        input.reason ?? null,
+        input.reason ?? "unspecified",
```
Commit: this commit. Lines: prod +1/-1, test +4/-2.

**Why this is the smallest correct fix:** It changes one token at the point where NULL is made, and it uses the same value 0070 already chose as the default.
- Why not drop `reason` from the column list: then a reason the caller does give would never be stored.
- Why not drop or relax the CHECK in a new migration: "a refund always has a reason" is a sound rule, and weakening the schema to fit a bug is the wrong direction.
- Why not make `reason` required in the API: that changes the contract and breaks every existing caller.

**Proof:** On the migrated test DB, before the fix 11 refund tests in `payments/processRefund.test.ts` and `refunds/initiateMerchantRefund.test.ts` failed with `new row for relation "refunds" violates check constraint "chk_refunds_reason_not_null"`. The fix is one constraint fix, and it turned all 11 green. `a full refund of a fully captured transaction lands on refunded` now also asserts `reason === "unspecified"`. Result: processRefund + initiateMerchantRefund + refundValidation + refundState give 34 pass, 0 fail.

**Regression risk:** None found. A caller-supplied reason is still stored unchanged, and the request hash still uses `input.reason ?? null` (`:48`), so idempotent replays are not affected. Covered by the 4 refund test files above.

**Trap note:** The comment at `0070:3-4` ("add a constraint to catch application code that accidentally passes NULL") presents the CHECK as a safety net, but `processRefund` passes NULL by construction. The tests were evidently written against a schema without 0070, which had never applied before. Migration 0070 is applied history and is left unchanged. The first test now pins the default value.
