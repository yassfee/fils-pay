### CRED-1 · Manual credit ledger legs are dated to the operator-typed effective date (back- or future-dated, unbounded) · (also lead ADMIN-CRED-3) · Severity: Medium

**Lead:** Team 45 heads-up list (P6), verified by us, and our 03_findings CRED-1 (also ADMIN-CRED-3).

**What's wrong:** `postCreditToLedger` wrote all four legs of a manual credit (base pair and MDR-reversal pair) with `occurred_at` = Asia/Bahrain midnight of the request's `effectiveDate` instead of the posting time. Validation only checks that the date is a real calendar date, so an operator can drop money into any past business day, including closed and reconciled ones, or into a future one.

**Why it happens:** `apps/api/src/admin/credits.ts:157-158` and `:170-171` (before) used `($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain'` with `$4 = credit.effectiveDate`. `parseCreditRequestInput` (`creditRequestValidation.ts:76-82`) runs only the ISO format and calendar checks, although its doc (`:13`) promises "future dates are rejected". Every ledger-window reader selects by `occurred_at`, e.g. the reconciliation report's `merchant_payable` window (`apps/api/src/settlement/query.ts:289-294`), while `merchant_balances` is bumped immediately. Every other admin posting (`ledgerAdjustments.ts`) uses `now()`.

**What it breaks:** On 2026-10-29 an operator posts a 45.000 BD credit with `effectiveDate = 2026-09-10`. September is already reconciled, yet its `merchant_payable` window grows by 45,000 fils (the gap for 2026-09-01..2026-10-01 moves from 0 to +45,000), and the credit never appears in October. A credit dated 2027-01-01 is in the cached balance today but in no current window. 49.000 BD stays under the 50.000 BD maker-checker limit, so one operator can reopen a closed month alone. The test reproduces it: a credit with an effective date two days back is journaled at `2026-10-27T21:00:00Z` instead of now.

**Why it needed a fix:** The ledger is the source of truth that the reconciliation tie-out and the business-day windows (midnight to midnight Asia/Bahrain) rely on. Posting into a past day changes a closed, reconciled period after the fact (the same class of harm as case file F5, "Those should never change"). Yousif's handover states the intended contract: "The effective date is metadata; ledger rows go in at now()" (`docs/HANDOVER.md:60-61`).

**Fix:** `apps/api/src/admin/credits.ts:149,154-156,167-169`, then `apps/api/src/admin/creditRequestValidation.ts:83-85`:
```diff
+  if (rawDate > new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)) { // CRED-1: today is Asia/Bahrain (UTC+3, no DST)
+    throw new BadRequestError("invalid_effective_date", "effectiveDate must not be after today (Asia/Bahrain)");
+  }
```
and the ledger date:
```diff
-  // Both legs post at Asia/Bahrain midnight of the credit's effective date —
-  // the same business-day anchor settlement uses — so a credit shows up in
-  // the reconciliation window for the period it was booked against rather
-  // than the period the operator happened to click the button in.
+  // CRED-1: legs post at now() like every other posting; effectiveDate is metadata on credit_requests (HANDOVER).
...
-       ($1, $2, 'merchant_credit_contra', 'debit',  $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: base'),
-       ($1, $2, 'merchant_payable',       'credit', $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: base')`,
-    [entryGroupId, credit.merchantId, credit.baseAmountFils, credit.effectiveDate],
+       ($1, $2, 'merchant_credit_contra', 'debit',  $3, now(), 'manual credit: base'),
+       ($1, $2, 'merchant_payable',       'credit', $3, now(), 'manual credit: base')`,
+    [entryGroupId, credit.merchantId, credit.baseAmountFils],
```
The MDR-reversal pair gets the same two-line change plus its parameter list. `effective_date` stays on `credit_requests` and in every API response.

**Why this is the smallest correct fix:** the date is chosen in one function; three statement lines per leg pair change, nothing else. *Why not bound the date (e.g. today or up to 35 days back, the lead's alternative)?* A bounded back-date still rewrites a closed day; only `now()` keeps closed windows closed, and it is what the handover specifies. *Future dates (second commit, advisor decision):* the doc at `creditRequestValidation.ts:13` promised "future dates are rejected" but nothing enforced it; an operator could still record a credit "for" a day that has not happened. One guard compares the date with today in Asia/Bahrain (UTC+3, no DST), the business-day clock; using the server's UTC date would wrongly refuse Bahrain's today between 00:00 and 03:00 local. `now()` is the transaction start, the same clock capture, refunds and adjustments use.

**Proof:** `CRED-1: both legs are posted at now(); a back-dated effectiveDate is metadata only` (`apps/api/src/admin/credits.test.ts`, effective dates -2 and -40 days; all four legs must fall between two DB `clock_timestamp()` reads around the call). Before the fix: `2026-10-28 manual credit: base: occurred_at 2026-10-27T21:00:00.000Z is not now()`. After: passes. `credits.test.ts`, `creditRequestValidation`/`creditThreshold` tests and `routes/adminCredits.test.ts` pass (44 + 12).

Future dates: `CRED-1: an effective date after today (Asia/Bahrain) is rejected; Bahrain today is accepted` (`apps/api/src/admin/creditRequestValidation.test.ts`, +2, +30, +400 days). Before: `Missing expected exception.` After: 400 `invalid_effective_date`; Bahrain today still parses. The ledger test's +30 day case moved here (it is now refused before posting). Credit validation, unit and route tests pass (34/34).

**Regression risk:** a credit meant "for" an earlier period now shows in the window it was posted in, which is how the ledger treats every other correction. The previous test (`credits.test.ts:185-208`) pinned the back-dated timestamp on the strength of an initials note ("MK: this test is the spec for backdated credits. finance sign-off 12.01.2026"); it was corrected to the handover's contract, citing `HANDOVER.md:60-61`. Past back-dated credits stay where they are (LED-1: the ledger is append-only).

**Trap note:** the removed code comment, `docs/ARCHITECTURE.md:38-39` ("posted with the effective date of the period they correct"), `docs/ADMIN.md:51-52`, the 0060 comment and the admin console text all describe back-dating; they rank below Yousif's handover line. `creditRequestValidation.test.ts:111` (YA) mentions a "not older than 35 days" test that does not exist.

**Follow-up UI-3 (ours, merged into this row):** after this fix the legs post at `now()`, but the "Issue credit" help text still said "The effective date is the accounting date the ledger legs are booked against." An operator reading it would expect a credit dated 2026-09-10 to land in September; it posts today. Fix (`7251aa6`, `MerchantDetailPage.tsx:361-362`, prod +2/-2): the text now reads "The effective date is recorded on the credit; the ledger legs are booked at the moment it posts." Proof (text-only): `docs/audit/evidence/ui/admin-credit-effective-date-copy-before.png` and `-after.png`.

Lines: prod +7/-10 (of which comment +1/-4) for the ledger date, then +3/-0 for the future-date guard, then +2/-2 for the help text (UI-3); test +20/-20, then +13/-3
