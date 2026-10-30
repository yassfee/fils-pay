### DECOY-REFADJ · Dead "refund adjustment" client that would send refunds ÷10 · FP-300 (☐3) · Severity: Low (reported, not changed)
**Category:** Reported, not changed

**What's wrong:** `notifySettlementRefundAdjustment` (`apps/api/src/admin/settlementClient.ts:282-299`) looks like the ready-made way to net refunds into payouts. It posts to `/internal/refund-adjustment`, a route the Go service does not have (no match under `apps/settlement`), and it sends `amountFils: Math.round(input.amountFils / 10)` while sending `feeReversedFils` unscaled.

**Why it happens:** the docblock (`:276-280`) claims settlement "expects amounts in ... 2-decimal BHD, i.e. fils / 10". That is false: Go works in int64 fils everywhere, and only the scheme-file amount is 2-decimal (ADR-0002). The function has no callers.

**What it would break:** wired into FP-300, a 3,333-fil refund would reach settlement as 333 (a 10x under-netting, with the fee reversal unscaled, so the two would not even agree), against a route that returns 404.

**Why it's not changed:** it is dead code, so changing it fixes nothing. The FP-300 build nets refunds inside Go `CloseBatch` from the `refunds` table and never calls this client. Recorded so nobody wires it later. Lines: 0.

**Trap note:** the docblock's "fils / 10" is the same "1 BD = 100" confusion as the quarantined AI configs and the CSV import bug (IMP-1).
