### UI-3 · Admin "Issue credit" help text says the ledger legs are booked on the effective date; they post at now() · Severity: Low

**Category:** Bug

**What's wrong:** the "Issue credit" section of the admin merchant page tells finance: "The effective date is the accounting date the ledger legs are booked against." Since CRED-1 that is false: every credit leg posts at `now()` (when the credit is issued, or approved above the limit), and the effective date is only recorded on the credit request. An operator who back-dates a credit to land it in a closed day, trusting the text, books it into today instead without being told.

**Why it happens:** the copy (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:361-362`) describes the pre-CRED-1 behaviour. CRED-1 changed `postCreditToLedger` to post at `now()` (`apps/api/src/admin/credits.ts:151`, comment "legs post at now() like every other posting; effectiveDate is metadata on credit_requests (HANDOVER)"), and nobody updated the form. This is the same pattern as IMP-BANNER (console text describing behaviour a server fix removed).

**What it breaks:** finance reads the console to decide which accounting day a correction will hit; the text promises a back-dated booking that does not happen, so a period they intended to correct stays as it was while today's figures move.

**Why it needed a fix:** Yousif's handover states the contract: "The effective date is metadata; ledger rows go in at now()" (`docs/HANDOVER.md`, Credits), and the server follows it. The only place an operator reads about the effective date must not say the opposite.

**Fix:** `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:361-362`
```diff
-        it, it posts immediately. The effective date is the accounting date the ledger legs are
-        booked against.
+        it, it posts immediately. The effective date is recorded on the credit; the ledger legs are
+        booked at the moment it posts.
```

**Why this is the smallest correct fix:** two lines of copy, no behaviour change; the server is right (CRED-1, handover). *Why not remove the effective-date field?* It is still stored and shown in the Credits list as the request's accounting date; only the claim about the ledger was wrong.

**Proof:** reproducible before/after check (text-only change): the lane's UI harness on a throwaway seeded database, admin merchant page for Alpha Retail Co. BEFORE: "The effective date is the accounting date the ledger legs are booked against." AFTER: "The effective date is recorded on the credit; the ledger legs are booked at the moment it posts." Screenshots: `docs/audit/evidence/ui/admin-credit-effective-date-copy-before.png`, `…-after.png`. Server behaviour checked on the same database: a 40.000 BD credit with `effectiveDate: 2026-09-10` posted (`201`, `status: posted`) with its ledger legs at `2026-10-30T15:26:52Z`, i.e. now, not 10 Sep; CRED-1's tests (`admin/credits.test.ts`, `routes/adminCredits.test.ts`) cover the same `now()` dating.

**Regression risk:** text only.

Lines: prod +2/-2, test +0/-0 (text-only; before/after evidence instead)
