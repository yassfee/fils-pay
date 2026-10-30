### API-10 · A partially captured transaction keeps the status `partially_captured` after any refund, even a full one · FP-300 ☐5 · Severity: Low (reported, not changed)

**Category:** Reported, not changed

**What's wrong:** authorize 10,000 fils, capture 4,000 (`partially_captured`), refund all 4,000. The refund succeeds and the ledger is right, but the transaction's status stays `partially_captured`: the dashboard list, the transactions report (`/v1/reporting/transactions`, filterable by status) and the admin recompute all show a fully refunded payment as an open partial capture.

**Why it happens:** `nextStatusAfterRefund` (`apps/api/src/payments/refundState.ts:32-49`) returns `partially_captured` whenever `capturedFils < amountFils`, before it looks at `refundedTotalFils`. Both callers use it: the refund path (`payments/processRefund.ts:174-206`) and the admin status recompute (`admin/transactionStatusRecompute.ts:38`). Migration `0043_transactions_refunded_fils.sql:9-11` describes `partially_refunded` as "the state between the first partial refund and the last one" and keeps `refunded` for the end state, which this precedence never reaches for a partial capture. The advisor's flow map (`handoff/ARCHITECTURE_FLOWS.md:120`) lists the same line as "fix first".

**What it breaks:** reporting by status: a "refunded" filter misses these payments and an "open partial captures" view includes them. The money is unaffected: the refund ceiling is `captured − refunded` (REF-3), the ledger legs and the fee reversal do not read the status.

**Why it is reported, not changed:** the precedence is deliberate and documented in the function (`refundState.ts:33-41`: the refunded statuses are "reserved for transactions whose authorization is fully consumed" so that the uncaptured headroom stays capturable), and the two notes next to it contradict each other about what finance wants (FH, Sep: Huda's rule is "refunded when every fils we captured went back"; FH, 21/07: "Huda confirmed finance wants headroom kept open"). Both are remembered conversations, and Yousif's handover says to trust what Huda sends in writing over what anyone remembers her saying (`docs/HANDOVER.md`, People). The status is also the capture gate. `captureTransaction` accepts only `authorized` or `partially_captured` (`payments/capture.ts:136`), so returning `refunded` or `partially_refunded` here would also stop a merchant from capturing the rest of the authorization after a refund. Whether that should be allowed is a product rule no trusted source states (the case file, ADR-0001/0002 and Yousif's lines are silent on multi-capture after a refund), and capture is on the checkout path we keep frozen in this wave. The test next to it (`refundState.test.ts:59`, FH: "wrote these from the spec in ARCHITECTURE.md") pins only the no-refund case, which is correct, so no test encodes the gap.

**The change we would make once the capture rule is decided:** move the `capturedFils < amountFils` branch below the refund checks (refunds first, then `partially_captured` only when nothing is refunded), 2 lines moved, plus the capture gate's status list if multi-capture after a refund is wanted.

**Proof:** reading `refundState.ts:47-49` (the first branch returns before `refundedTotalFils` is read) for the input `{ amountFils: 10000, capturedFils: 4000, refundedTotalFils: 4000 }`.

**Regression risk:** none (no change).

Lines: prod +0/-0 (proposed 2 lines moved), test +0/-0
