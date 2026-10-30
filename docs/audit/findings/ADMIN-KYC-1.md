### ADMIN-KYC-1 · Bulk KYC approve ignores the current status and writes no review rows · Severity: High

**What's wrong:** `POST /v1/admin/merchants/bulk-approve` set `onboarding_status='approved', kyc_passed=true` on every id it was given. Merchants that were `rejected`, or still `submitted` with no documents, were approved too. No `merchant_kyc_reviews` row was written, so the KYC source of truth showed no approval for them.

**Why it happens:** `apps/api/src/admin/bulkKyc.ts:27-30` is a raw `UPDATE merchants ... WHERE id = ANY($1)` with no status predicate and no review insert. The faulty assumptions sit in the comments around it: the result docstring (`bulkKyc.ts:11-13`: "Only merchants that moved from under_review to approved. Already-approved or rejected ids are skipped"), ADMIN.md ("Only merchants currently under_review are affected"), `0016` AM ("bulk approve goes through the same review function, one row per merchant. checked with FH"), `review.ts:34` MK ("bulk writes the review trail too") and `routes/admin.test.ts:475` ("per-merchant merchant_kyc_reviews rows are written as well", which the test never checks). Migration `0016:1-6` itself says no other path may write `kyc_passed` without inserting the review row.

**What it breaks:** a finance admin selects all rows on the merchant list (the header checkbox selects every loaded row) and clicks bulk approve. A merchant that compliance rejected becomes `approved`, passes `authorize.ts:87` and can take card payments and receive payouts. `merchant_kyc_reviews` still shows only the rejection, so nobody can see who approved it.

**Why it needed a fix:** this bypasses the KYC gate and leaves no audit trail for an approval. That is an admin action that does not respect the review controls (H3 family).

**Fix:** `apps/api/src/admin/bulkKyc.ts:29,34-39`
```diff
-        WHERE id = ANY($1::uuid[])
+        WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'
...
+    // ADMIN-KYC-1: the per-merchant review trail (0016: the single source of truth for KYC approval)
+    await client.query(
+      `INSERT INTO merchant_kyc_reviews (merchant_id, outcome, reviewer_identifier, reviewer_admin_user_id, notes)
+       SELECT m, 'approved', a.email, a.id, $3 FROM unnest($1::uuid[]) AS m, admin_users a WHERE a.id = $2`,
+      [approvedMerchantIds, input.adminUserId, input.notes ?? null],
+    );
```
Lines: prod +7/-1 (6 code, 1 comment), test +48/-0.

**Why this is the smallest correct fix:** the status predicate makes the UPDATE do what its docstring and the route already promise, and `RETURNING` then lists only merchants that actually moved. A single set-based insert in the same transaction writes the review row for exactly those ids, with the same columns `recordKycReviewInTx` writes (reviewer email and admin id, as the single-merchant route does at `adminMerchants.ts:157-158`). The input contract does not change because the email comes from `admin_users`. Under concurrency, a second bulk call blocks on the row lock and then re-checks the predicate, so it skips merchants that are already approved and writes no duplicate reviews. *Why not loop `recordKycReviewInTx`?* That needs a separate SELECT ... FOR UPDATE, a loop and an email lookup (about 12 lines), and `recordKycReviewInTx` itself does not check status. *Why only the predicate?* The approvals would still have no review trail.

**Proof:** `ADMIN-KYC-1: bulk approve skips non-under_review merchants and writes a review row per approval` (`apps/api/src/admin/bulkKyc.audit.test.ts`) failed before the fix at `assert.deepEqual(res.approvedMerchantIds, [pending])`: the rejected and submitted ids were approved too. After the fix it passes. Only the under_review merchant moves, and exactly one review row exists, carrying the admin's email and id.

**Regression risk:** low. The existing route tests (`routes/admin.test.ts`, which sets both merchants to under_review) pass: 42/42 including the new test. Callers that sent already-approved ids now get those ids left out of `approvedMerchantIds`, which matches the documented contract.

**Trap note:** four separate comments (docstring, ADMIN.md, the migration AM note and the review.ts MK note) plus a test docstring each claim the safety this code never had.
