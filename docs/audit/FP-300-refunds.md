# FP-300 · Refunds: design (smallest complete version)

*Status: approved by the advisor (G4a) with 7 changes folded in, 2026-10-29. Source spec: advisor pre-analysis §5, adjusted to the traced code
(handoff/ARCHITECTURE_FLOWS.md §4). Money is integer fils everywhere (1 BD = 1000 fils).*

## 1. What FP-300 is and why it "touches everything"
The unfinished feature is **merchant refunds, full and partial**. Evidence: `POST /v1/refunds` is a 501 stub
(`apps/api/src/routes/refunds.ts:23`), the helpers `processRefund` / `initiateMerchantRefund` exist but are unwired,
the schema exists (0042 refunds, 0043 refunded_fils, 0044 timeline types, 0052 refunds_enabled, 0070-0072), the
`refund.succeeded` outbox event is produced but can't be delivered, and the RefundDrawer UI is parked. A refund must
move money correctly through six places: API → ledger → fees → webhook → reports/timeline/reconciliation → payouts.

**Done when (case file):** ☐1 works end to end through the API · ☐2 ledger right to the fil · ☐3 fees and payouts
right · ☐4 right webhook · ☐5 timeline, reports, reconciliation · ☐6 live on Dilmune Cloud.

## 2. Prerequisite fixes (land first; each is its own proven commit)
| Lane | Fixes the refund build depends on |
|---|---|
| A auth | AUTH-1 (pending session ≠ login), AUTH-2 (tenant-bound OTP), ADMIN-IMP-1 (impersonation read-only) |
| B core | REF-4 (reason default), REF-3 (captured ceiling), REF-2 (merchant-scoped lookup), REF-1 (lock + atomic reserve), REF-6 (stable acquirer key) |
| C hooks | CW-3 (sign the bytes sent), CW-9 (refund.succeeded envelope + eligibility), OBX-POISON/DOUBLE |
| D Go | NET-1 (integer net), SPLIT-1 (remainder), CLOSE-1/SCHED-1 (Bahrain day), MDR-1 (paid batches frozen) |
| E | ADMIN-TEST-1/REF-5 (sandbox flag, chargebacks stay non-refundable) — **done** |

## 3. API contract
```
POST /v1/refunds                     (prefix registered at app.ts:64; handler routes/refunds.ts)
preHandler  requireMerchantAuth, requireMerchantRole("owner","finance"); impersonation is read-only (ADMIN-IMP-1)
Header      Idempotency-Key  (required; same rule as routes/transactions.ts:51-55)
Body        {"transactionId":"<uuid>","amountFils":3333,"reason":"customer_request"}
            amountFils is a positive integer (ADR-0001: API payloads carry integer fils; parseBhdToFils is for
            forms/CSV). No implicit full refund.
```
- Idempotency keys are scoped per merchant (`idempotency.ts`: merchant_id, endpoint, key). API keys are accepted the
  way `requireMerchantAuth` already accepts them (no extra lines; AUTH-3 fixes rotation).
- `merchantId` comes **only** from `request.merchantAuth`. The body is read field by field (no spread). The
  "Claude drafted" handler in the file's comments is **not** used: it spreads `request.body` after `merchantId`
  (tenant override) and invents `randomUUID()` keys (every retry = a new refund, FP-209).
- Responses: 200 with the refund (`id, transactionId, amountFils, feeReversedFils, refundedTotalFils,
  transactionStatus`). Same key and body → replay of the stored response; same key with a different body → the existing
  idempotency conflict. **Existing error codes are kept** (tests assert them): `refunds_on_hold`,
  `transaction_not_refundable`, 402 `refund_declined`, plus 400 `invalid_request` / `idempotency_key_required`,
  401, 403, 404 `transaction_not_found` (also for another merchant's transaction), 422 for amount > refundable.

## 4. Core flow (reuse `initiateMerchantRefund` → `processRefund`)
1. **Phase 1 (txn):** claim the idempotency key (hash of transactionId, amountFils, reason); `SELECT … WHERE id=$1 AND
   merchant_id=$2 FOR UPDATE` (REF-2, REF-1); refunds_enabled; status ∈ {captured, partially_captured,
   partially_refunded} (never chargeback); `1 ≤ amount ≤ captured_fils − refunded_fils` (REF-3); **reserve** with
   `refunded_fils = refunded_fils + r` guarded by `≤ captured_fils`.
2. **Phase 2 (no txn):** `acquirer.refund` with a key stable across retries (REF-6).
3. **Phase 3 (txn):** refunds row (`reason ?? 'unspecified'`, REF-4), fee reversal (§5), ledger legs, status from the
   locked row, `transaction_events` timeline row, outbox `refund.succeeded`, complete the key. Declined → release the
   reservation; error → keep it (fail closed; same-key retry reuses the acquirer key).
4. **DB guard (new migration):** `CHECK (refunded_fils <= captured_fils)` on transactions.
5. **Known limitation:** a crash during phase 2 with no client retry leaves a reservation (refunded_fils raised) with no
   refunds row. It fails closed (no double payout). Reconciliation lists "reserved but not completed" transactions
   (refunded_fils ≠ Σ succeeded refunds), so ops can retry with the same key or release it.

## 5. Ledger and fee reversal (☐2, ☐3)
Legs (as coded in processRefund; accounts from 0007), `occurred_at = now()`:

| Leg | Account | Dir | Amount |
|---|---|---|---|
| refund: gross | merchant_payable | debit | r |
| refund: gross | card_scheme_clearing | credit | r |
| refund: MDR fee reversal (if f > 0) | platform_fee_revenue | debit | f |
| refund: MDR fee reversal | merchant_payable | credit | f |

- **F = the fee actually charged at capture**, read from the ledger: Σ platform_fee_revenue credits − debits for the
  transaction, excluding `refund:%` legs (REF-7). Never recompute it from today's mdr_bps or tier.
- **Cumulative rounding (REF-8):** `f_k = calculateRefundFee(F, R_k, C) − Σ_{j<k} f_j`, where C = captured_fils, R_k =
  refunded total including this refund, and the prior sum = `SUM(refunds.fee_reversed_fils)` read under the lock. The
  partials telescope to exactly F at R = C.
- Worked example (capture fee today = MDR − tier, no discount; FEES-3 pending): C = 10,000, F = 275 (275 bps).
  Refunds 3,333 + 3,333 + 3,334: f = 92 + 91 + 92 = **275 = F** (per-partial rounding today gives 92+92+92 = 276, one
  fil too many). After the full refund merchant_payable, platform_fee_revenue and card_scheme_clearing all net to 0.

## 6. Webhook (☐4)
processRefund already enqueues `refund.succeeded` (payload merchantId, refundId, amountFils, feeReversedFils,
refundedTotalFils, newStatus) inside phase 3. CW-9 adds the envelope case **before** the eligibility entry, otherwise the
dispatcher stalls. CW-3 signs the exact bytes posted. Proof: a local receiver verifies the HMAC over the raw body.

## 7. Timeline, reports, reconciliation (☐5)
- **Timeline:** phase 3 writes `transaction_events` `refund_partial` (R < C) or `refunded` (R = C), amount −r (0044).
- **Reports:** new migration adds `refund_count INTEGER`, `refund_gross_fils BIGINT` (default 0) to
  merchant_daily_volume; add `refund.succeeded` to `REPORTING_EVENT_TYPES` with a case that calls the existing
  `applyDailySummaryRollup` (applyEvent.ts:164), bucketed by the **Bahrain** date. Fix view 0072's join (REF-9) in the
  same migration (`r.transaction_id`). `refund_count` and `refund_gross_fils` are **returned by the report/analytics
  API**, not only stored, so ☐5 is visible.
- **Reconciliation (api/settlement/query.ts):** first REC-1 (exclude payout legs inside the window; integer fees), or the
  gap can never be 0. Then refunds appear as **their own line**: unbatched succeeded refunds as −(r − f) pending,
  netted ones inside their batch, plus the "reserved but not completed" list (§4.5). Target gap 0 fils.

## 8. Settlement netting into payouts (Go, ☐3)
In `CloseBatch`, inside the same txn and the Bahrain window: claim unbatched refunds (`refunds.settlement_batch_id IS
NULL`, `occurred_at < window end`, `idx_refunds_merchant_unbatched`), oldest first, while the running net stays ≥ 0
(remaining refunds roll into the next batch). Stamp `refunds.settlement_batch_id`. net = Σ(gross − fee) − Σ(r − f)
(int64; f from `refunds.fee_reversed_fils`, never recomputed). New BIGINT columns `refund_gross_fils`,
`refund_fee_reversed_fils` on settlement_batches. Split parents: net first, then the SPLIT-1 allocation. test_mode
merchants are never closed. `notifySettlementRefundAdjustment` (settlementClient.ts:292) is a **decoy**: it calls a Go
route that does not exist and sends the amount ÷10. It is recorded as a finding, not wired and not deleted.

**Scheme file (scope decision):** refunds go to the acquirer through `acquirer.refund`, not the clearing file, so they
are not added to `scheme_export_lines` (CHECK amount ≥ 0; one line per batch + transaction). Conditions: reconciliation
shows refunds as their own line, and the card_scheme_clearing refund credits tie to acquirer-confirmed refunds. The
assumption and the organizer question are stated in FINDINGS and TEAM_REPORT.

## 9. Tests (each starts red) and demo
| # | Test | Box |
|---|---|---|
| T1 | two concurrent refunds, sum > captured → exactly one succeeds, one acquirer call | ☐1 ☐2 |
| T2 | merchant A refunds B's transaction → 404 | ☐1 |
| T3 | full + partials 3,333/3,333/3,334 → status refunded, Σf = F, accounts net 0 | ☐2 ☐3 |
| T4 | same key replay → identical body; over-refund → 422; support role / pending session → 403 / 401 | ☐1 |
| T5 | webhook delivered and HMAC verifies over the raw bytes | ☐4 |
| T6 | timeline row, merchant_daily_volume refund row on the Bahrain day, reconciliation gap 0 | ☐5 |
| T7 | Go CloseBatch with refunds: integer net, refunds stamped, negative net rolls forward, splits sum exactly | ☐3 |
| T8 | `routes/transactions.test.ts:291-299` 501 assertion replaced by a real refund | ☐1 |
Demo: `handoff/DEMO_SCRIPT.md` runs the same steps with curl against the local stack and then the hosted URL (☐6).

## 10. Build plan and ownership (after the prerequisite merges)
- **TS builder** (worktree from audit/handover): route, REF-7/REF-8 fee math, CHECK migration, reporting migration and
  consumer case plus API exposure, REC-1 and the refund lines in the reconciliation query, 501 test flip, E2E test.
  Migrations 0098-0099 (fix lanes stay ≤ 0089).
- **Go builder** (worktree): CloseBatch netting plus its migration (0097), T7.
- Out of scope: RefundDrawer UI (optional), scheme-file refund lines, API-key refunds (only after AUTH-3, by decision).

## 11. Open decisions
1. **FEES-3/FEES-5 fee base:** capture books MDR − tier with **no** discount, while Go settlement charges MDR on the
   discounted amount. Refunds reverse what the ledger charged, so the refund math is unaffected, but batch fees ≠
   ledger fees until one formula wins. Options for the user: **A (recommended)** CloseBatch sums the fee capture already
   booked (one source of truth; payouts always equal the ledger; the formula question shrinks to the single capture
   function). **B** change Go to the TS formula.
2. `refunds_enabled = NULL` means allowed (current code); kept.
3. Refunds in the scheme file: ask the organizers.
