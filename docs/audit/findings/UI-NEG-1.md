### UI-NEG-1 · The merchant dashboard crashes on any negative amount, so opening a refunded transaction or a negative reconciliation gap kills the whole app · FP-300 · Severity: High

**Lead:** Team 45 heads-up list (N3), verified by us.

**What's wrong:** The dashboard's only money formatter, `bhd()` in `apps/web/src/format.ts:12`, calls `toFils(amountFils)` without `{ allowNegative: true }`. `toFils` (`packages/money/src/fils.ts:49-52`) throws a `RangeError` on any negative number. React has no error boundary on these routes, so the throw replaces the whole app with "Unexpected Application Error!".

**Why it happens:** Refund events are stored as negative deltas (`apps/api/src/payments/processRefund.ts:239`, `toFils(-requestedAmount, { allowNegative: true })`). The transaction detail page renders each timeline event's amount with `bhd()` (`TransactionDetailPage.tsx:242`), and the reconciliation page renders signed figures, such as the gap and the netted refunds, the same way (`ReconciliationPage.tsx:115,125,131`). The comment pair at `format.ts:9-10` raised the question and dismissed it ("MK: amounts are never negative in the dashboard. ignore"). The test at `dashboard.test.ts:39` claimed "covers negatives too" but had no negative case.

**What it breaks:** After any refund (FP-300), a merchant who opens that transaction sees the crash page instead of the timeline that case-file box 5 requires ("the refund shows on the transaction timeline"). Example: a 3,333-fils refund is stored as −3,333, and `bhd(-3333)` throws `RangeError: toFils: expected a non-negative amount, got -3333`. The reconciliation page crashes the same way whenever a figure is negative.

**Why it needed a fix:** FP-300's done-when asks for refunds visible on the timeline and in the reports. A crash on exactly those screens fails the feature in front of a user.

**Fix:** `apps/web/src/format.ts:12`
```diff
-  return `${formatBhd(toFils(amountFils))} BHD`;
+  return `${formatBhd(toFils(amountFils, { allowNegative: true }))} BHD`; // UI-NEG-1: refund events and gaps are signed
```

**Why this is the smallest correct fix:** `formatBhd` already formats negatives correctly (`fils.ts:233-238`: sign, then the absolute value with 3 decimals), and the admin console's formatter already passes `allowNegative`. One argument at the single shared formatter fixes every page that uses it. Rejected alternatives: guarding each call site (many edits, and easy to miss one); `Math.abs` at the call sites (loses the sign, so a refund would look like a charge); an error boundary alone (it hides the crash but still shows no amount).

**Proof:** `dashboard.test.ts` "UI-NEG-1: bhd renders a negative amount (a refund event, a negative gap) instead of throwing" (`bhd(-3333)` gives `"-3.333 BHD"`, `bhd(-1)` gives `"-0.001 BHD"`). Before: `not ok … name: 'RangeError'`. After: web suite 9/9 pass; `tsc -p apps/web --noEmit` is clean.

**Regression risk:** None for non-negative amounts: the same path and the same output. Negative values now render with a leading "-", matching `formatBhd`'s documented behaviour.

**Trap note:** `format.ts:9-10` (FH asks, MK dismisses with "ignore") and `dashboard.test.ts:39` ("covers negatives too", with no negative case) both pointed away from the bug.

Lines: prod +1/-1, test +5/-0.
