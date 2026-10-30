# FilsPay audit: findings

We audited the FilsPay monorepo (TypeScript API, Go settlement daemon, reporting consumer, Postgres schema) against the organizers' case file.
Ground truth was the case file, then the wired code path, then the migrations; comments, docs, AI configs and test assertions were treated as claims to verify.
Every bug was handled the same way: a failing test first, then the smallest fix at the single narrowest point, then the same test passing.
Each bug is one commit `fix(<ID>/<case refs>): …` on branch `audit/handover`; line counts below are computed from `git log --numstat 89daa69..audit/handover` (net per bug when a fix took more than one commit, see below).
Production lines = code, SQL migrations and ops files; test files (`*.test.ts`, `*_test.go`) and docs are counted separately.

**112 bugs fixed (+ 2 broken tests repaired) · 1085 production lines changed · every fix proven by a failing-then-passing test**

- 117 `fix(...)` commits for those 112 bugs (follow-up commits CW-1b and PL-1b are counted under CW-1 and PL-1). Median production lines per bug: **7**. Bugs fixed in ≤ 6 production lines: **52 of 112**.
- A bug fixed in more than one commit is counted by its **net** production change: `git diff <first>^ <last>` over that bug's production files, used only when no other commit touched those files in between. PL-1 +10/−5 net (per-commit sum +43/−38: `104c871` + `f487401`); CW-1 +9/−1 net (per-commit sum +17/−9: `14db87c` + `ec100ed`); AUTH-13 +8/−0 net (per-commit sum +10/−2: `97e6a46` + `bcdfff3`). TEAM_REPORT's change log keeps the per-commit history.
- By severity: Critical 9, High 50, Medium 33, Low 20.
- Proof exceptions: MIG-1 (migrations) and B8 (a committed secret) have no unit test; they are proven by a reproducible runtime check in their notes (fresh `migrate` applies every file; `git ls-files ops` / `git grep` finds no secret value).
- REC-1's commit `b4e6b95` also carries the FP-300 reconciliation lines (refunds on their own lines), so its +29/−28 is included in the per-bug total.
- Test suites on a fresh database (79 migrations): **TS 550/550** (api 463, reporting 17, web 14, admin 3, money 40, events 4, scripts 9) and **Go 7/7 packages**. Baseline before the audit: TS 414/430.

- **Net production footprint vs. the handed-over main (`8b58b0f`):** 129 files, **+1342/−502 = 1844 lines** (superseded attempts such as PL-1's first version drop out). This includes the FP-300 feature code and the ops/compose infrastructure; the per-bug total above counts bug fixes only.

### Judge's quick tour: the 10 most severe bugs

1. [**AUTH-1**](#f-auth-1) · G4, H8 · Critical · Pending (pre-OTP) session cookie authenticates every merchant route · prod +1/−1
2. [**IMP-1**](#f-imp-1) · F7 · Critical · CSV adjustment import reads BD as 2-decimal "cents" (10x too small) · prod +3/−4
3. [**AUTH-2**](#f-auth-2) · H8 · Critical · Login binds the OTP and session to an email-only lookup (cross-tenant takeover) · prod +1/−2
4. [**REF-3**](#f-ref-3) · H1 · Critical · Refund ceiling uses the authorized amount, not the captured amount · prod +1/−1
5. [**REF-2**](#f-ref-2) · FP-300 · Critical · Any merchant can refund another merchant's transaction · prod +2/−2
6. [**ADMIN-IMP-1**](#f-admin-imp-1) · H3 · Critical · Admin impersonation grants can write as the merchant (super_admin becomes owner) · prod +4/−2
7. [**REF-1**](#f-ref-1) · FP-209 · Critical · Concurrent refunds both pay out (unlocked check, acquirer outside the txn, absolute write) · prod +10/−8
8. [**ADMIN-CRED-1**](#f-admin-cred-1) · H3 · Critical · Credit creation has no role gate: a support admin can post credits · prod +2/−1
9. [**PL-1**](#f-pl-1) · INCIDENT 2026-05-14 · Critical · A slow payment lets a second buyer re-claim the link and both are charged · prod +10/−5 (net of 2 commits; first version superseded)
10. [**MIG-1**](#f-mig-1) · FP-300 (☐1, ☐6), F4 · High · A fresh database cannot be built: migrations 0054/0055 abort · prod +7/−9

**Infrastructure (not counted as bugs):**

| commit | what | prod lines |
|---|---|---|
| `89daa69` | chore(audit): quarantine poisoned AI assistant configs (base commit; 3 renames) | +0/−0 |
| `4c6816e` | fix(AUTH-6,OPS-1): make `docker compose up` work: Dockerfiles, env_file, seed order | +47/−11 |
| `ff169c7` | chore(ops): hosted-box compose override, production env template, smoke test | +68/−0 |
| `66af2d3` | chore(ops): keep shell scripts LF so ops/smoke.sh runs on the Linux box from a Windows clone | +1/−0 |
| `158b4a0` | chore(ops): FP-300 end-to-end demo script (boxes 1-5; BASE_URL for the hosted run) | +190/−0 |
| `fe69eff` | chore(ops): demo never disables the ledger trigger; deterministic acquirer for demos; LED-1 runtime evidence | +6/−6 |
| `dfbebd7` | chore(ops): seed passwords overridable for hosted deploy | +8/−2 |
| `db2d8f9` | chore(CAP-4): renumber the hot-path index migration 0100 -> 0101 | +0/−0 |

`4c6816e` is labelled `fix(AUTH-6,OPS-1)` but is the compose/Dockerfile work that makes the stack run; it is listed here, not in the bug totals.

**FP-300 feature and test commits so far:** `f76d86b` DB guard refunded_fils <= captured_fils (migration 0098) (prod +4/−0, test +8/−0); `8afc127` net succeeded refunds into the merchant's next settlement payout (prod +17/−2, test +145/−0); `e6f6160` keep refund netting when RecalculateMDR re-prices a closed batch (prod +1/−1, test +36/−0); `c1d13e2` wire POST /v1/refunds to initiateMerchantRefund (prod +25/−21, test +10/−8); `5e9cbd9` route-level refund tests for POST /v1/refunds (prod +0/−0, test +215/−0); `198e5cf` refunds roll into merchant_daily_volume on the Bahrain day (prod +16/−3, test +107/−0); `b4e6b95` tie out to 0 fils, refunds on their own lines (prod +29/−28, test +130/−0); `79eaf16` refund.succeeded webhook delivered, HMAC verified over raw bytes; ☐5 consumer replay (prod +0/−0, test +138/−1).

## Summary table (most severe first)

| # | ID | title | case refs | severity | prod lines | test lines | commit |
|---|---|---|---|---|---|---|---|
| 1 | AUTH-1 | Pending (pre-OTP) session cookie authenticates every merchant route | G4, H8 | Critical | +1/−1 | +38/−1 | `87a6b42` |
| 2 | IMP-1 | CSV adjustment import reads BD as 2-decimal "cents" (10x too small) | F7 | Critical | +3/−4 | +20/−8 | `55fa663` |
| 3 | AUTH-2 | Login binds the OTP and session to an email-only lookup (cross-tenant takeover) | H8 | Critical | +1/−2 | +74/−0 | `079dd2c` |
| 4 | REF-3 | Refund ceiling uses the authorized amount, not the captured amount | H1 | Critical | +1/−1 | +21/−3 | `bf476ed` |
| 5 | REF-2 | Any merchant can refund another merchant's transaction | FP-300 | Critical | +2/−2 | +20/−2 | `0283a8e` |
| 6 | ADMIN-IMP-1 | Admin impersonation grants can write as the merchant (super_admin becomes owner) | H3 | Critical | +4/−2 | +61/−0 | `8d10830` |
| 7 | REF-1 | Concurrent refunds both pay out (unlocked check, acquirer outside the txn, absolute write) | FP-209 | Critical | +10/−8 | +43/−1 | `799ff25` |
| 8 | ADMIN-CRED-1 | Credit creation has no role gate: a support admin can post credits | H3 | Critical | +2/−1 | +17/−0 | `eed6c09` |
| 9 | PL-1 | A slow payment lets a second buyer re-claim the link and both are charged | INCIDENT 2026-05-14 | Critical | +10/−5 (net of 2 commits; first version superseded) | +62/−0 | `104c871` (PL-1), `f487401` (PL-1b) |
| 10 | MIG-1 | A fresh database cannot be built: migrations 0054/0055 abort | FP-300 (☐1, ☐6), F4 | High | +7/−9 | +0/−0 | `197c3e2` |
| 11 | B8 | A live acquirer signing secret is committed in a tracked env file | FP-240, H3 | High | +5/−6 | +0/−0 | `d95d570` |
| 12 | NET-1 | Net payout computed through float32 BD | FP-300 ☐3 | High | +2/−4 | +25/−1 | `27187a2` |
| 13 | CW-3 | Outbound webhook signature does not cover the bytes actually sent | FP-240, FP-300 ☐4 | High | +4/−2 | +9/−2 | `96d0f80` |
| 14 | REF-4 | A refund without a reason violates chk_refunds_reason_not_null after the acquirer has paid | FP-300 (☐1 "works from start to end") | High | +1/−1 | +4/−2 | `013f6da` |
| 15 | SCHEME-1 | Scheme amount is the untruncated gross rounded half-up by NUMERIC(10,2) | F1, ADR-0002 | High | +2/−2 | +49/−1 | `d1e6cbb` |
| 16 | ADMIN-TEST-1 | "Recompute statuses" silently takes sandbox merchants live | G3, H7 | High | +1/−2 | +71/−0 | `cb1d51a` |
| 17 | SCHEME-2 | ADR-0002 truncation residue is never journaled at close | F1, F2, ADR-0002 | High | +7/−0 | +37/−0 | `ffdf52b` |
| 18 | CW-2 | Acquirer callbacks accepted without a signature by default | FP-240 | High | +2/−11 | +9/−12 | `85f6d2f` |
| 19 | REF-5 | Status recompute turns chargebacks back into refundable captures | H7, H1, FP-300 | High | +1/−1 | +24/−0 | `7f51175` |
| 20 | BAL-1 | Admin "rebuild cached balances" rebuilds from scheme export lines, not the ledger | F4, FP-203 | High | +3/−3 | +5/−5 | `aae0aed` |
| 21 | F2-SWEEP | The March residue sweep doubles the gap every time it is re-run | F2 | High | +4/−2 | +32/−0 | `8f1550d` |
| 22 | MDR-1 | MDR recalculation re-prices PAID batches in place | F5 | High | +2/−2 | +39/−0 | `3df94da` |
| 23 | CW-5 | Acquirer callbacks are never deduplicated | FP-201 | High | +12/−1 | +14/−0 | `b43c940` |
| 24 | CLOSE-1 | run-batch closes and pays a business day that has not ended | H5 | High | +4/−1 | +25/−0 | `56cdd1f` |
| 25 | HOLD-1 | Nightly hold janitor deletes every hold on a night with nothing expired | (no case ref; data integrity) | High | +4/−5 | +52/−2 | `97226a1` |
| 26 | REF-6 | Acquirer refund idempotency key changes on every retry | FP-300 (☐2 "money is right in the ledger") | High | +1/−1 | +24/−0 | `9b6da21` |
| 27 | CW-1 | A payout disbursement record is written per webhook delivery, not per batch | INC-2026-08-21 | High | +9/−1 (net of 2 commits; first version superseded) | +50/−0 | `14db87c` (CW-1), `ec100ed` (CW-1b) |
| 28 | ADMIN-CRED-2 | Credit maker-checker compares display names instead of admin user ids | H3 | High | +1/−1 | +21/−1 | `dde9aab` |
| 29 | PL-3 | Payment-link cancel is a cross-merchant IDOR | G5 | High | +9/−8 | +16/−0 | `8279360` |
| 30 | AUTH-4 | OTP codes and payment-link tokens come from Math.random | H8 | High | +4/−2 | +19/−0 | `d42c5eb` |
| 31 | PL-2 | Public pay route checks expiry against the client-supplied submittedAt | FP-187 | High | +5/−9 | +21/−5 | `0d292af` |
| 32 | AUTH-5 | OTP attempt limit is check-then-act: parallel guesses bypass max_attempts | H8 | High | +6/−12 | +68/−0 | `2a52b5f` |
| 33 | OBX-POISON | A missing rollup row makes the parity check throw and wedges the reporting consumer | FP-300 ☐5 | High | +2/−1 | +36/−0 | `08b0e59` |
| 34 | SPLIT-1 | Split children are rounded separately, so the remainder is lost (or invented) | F3, H2 | High | +21/−1 | +66/−0 | `2b6d181` |
| 35 | AUTH-3 | Admin API-key rotation never revokes the old key | H4 | High | +2/−0 | +6/−7 | `cfcd6f6` |
| 36 | NOTIFY-1 | settlement.paid enqueue is check-then-insert with no unique key, so concurrent runs double-notify | INC-2026-08-21 | High | +19/−4 | +48/−0 | `664f548` |
| 37 | OBX-DOUBLE | Unlocked cursor read lets concurrent reporting passes double-apply events | FP-300 ☐5 | High | +4/−3 | +34/−0 | `a63a29e` |
| 38 | SUM-1 | Settlement summary sums the running captured total once per capture event | H6, FP-300 ☐5 | High | +1/−1 | +43/−0 | `cf8075a` |
| 39 | IDEM-1 | Capture idempotency hash omits the transaction id, so a reused key on another transaction replays a fake success | FP-300 (☐2 "money is right in the ledger") | High | +1/−1 | +16/−2 | `696a028` |
| 40 | EXP-1 | CSV export buffers a merchant's whole history in memory in a 512 MB container | H9 | High | +8/−2 | +13/−0 | `c05f50d` |
| 41 | REF-7 | A refund reverses the gross MDR fee, ignoring the negotiated-discount rebate | H1 | High | +2/−2 | +107/−0 | `31b3db3` |
| 42 | REF-1b | A refund racing a declined refund can lock the transaction as `refunded` for good | FP-209 / H1 | High | +5/−5 | +35/−0 | `d8ddb9f` |
| 43 | REC-1 | Reconciliation can never tie out: payout legs counted inside the window, pending fees are float re-estimates, refunds missing | H1 / FP-300 | High | +29/−28 | +130/−0 | `b4e6b95` |
| 44 | VOL-1 | Platform volume counter is INT4 / int32 and wraps past the fee-tier threshold | none (money rule: integer fils in BIGINT/int64, case file + ADR-0001) | High | +9/−6 | +78/−0 | `43e737e` |
| 45 | AUTHZ-1 | A merchant 'support' user can capture and void transactions (no role gate) | H3 | High | +5/−7 | +84/−0 | `b6c0f4a` |
| 46 | RPT-SCOPE-1 | Any merchant can read any split child's transactions through the report filter |  | High | +5/−5 | +31/−0 | `4743bb1` |
| 47 | IMP-2 | CSV adjustment import is not idempotent: the same file posts twice | F7 (adjustment import), 2026-09-04 double upload | High | +10/−4 | +38/−0 | `f3d59e7` |
| 48 | ADJ-1 | "Adjust balance" writes the merchant_balances cache only, with no ledger entry | F4 / FP-203 (balance must come from the ledger) | High | +2/−2 | +22/−0 | `4517985` |
| 49 | ADMIN-KYC-1 | Bulk KYC approve ignores the current status and writes no review rows |  | High | +7/−1 | +48/−0 | `abd6c81` |
| 50 | CW-4 | Merchant webhook URLs can target internal hosts, and delivery follows redirects (SSRF) | none (security; webhook delivery runs inside the platform network) | High | +4/−1 | +68/−0 | `6d08e08` |
| 51 | FEES-3 | Payment-link captures never get the negotiated discount; the webhook and timeline report the pre-discount fee | FP-300 ☐3 | High | +13/−14 | +147/−0 | `220cb20` |
| 52 | AUTH-12 | A suspended or closed merchant keeps transacting through live sessions, API keys and payment links |  | High | +5/−4 | +39/−0 | `f0f932a` |
| 53 | AUTH-13 | The OTP attempt cap is defeated by logging in again: every login mints a fresh 5-guess challenge, without limit | H8 | High | +8/−0 (net of 2 commits; first version superseded) | +78/−0 | `97e6a46` (AUTH-13), `bcdfff3` (AUTH-13) |
| 54 | UI-NEG-1 | The merchant dashboard crashes on any negative amount, so opening a refunded transaction or a negative reconciliation gap kills the whole app | FP-300 | High | +1/−1 | +5/−0 | `158f140` |
| 55 | OBX-SKIP | Reporting outbox watermark follows id order, not commit order: late-committing events are skipped forever | FP-300 ☐5 | High | +9/−3 | +35/−0 | `d66de70` |
| 56 | ADMIN-IDEM-1 | A double-submitted admin credit or balance adjustment posts to the ledger twice |  | High | +29/−7 | +51/−0 | `c8e00cc` |
| 57 | CAP-2 | Under overload the API queues every request until it times out instead of turning the excess away |  | High | +11/−0 | +58/−0 | `fe36e11` |
| 58 | CAP-4 | Every capture scans the whole ledger four times and the whole holds table once, so checkout capacity falls as the ledger grows |  | High | +4/−0 | +33/−0 | `ebc46d2` |
| 59 | CAP-6 | A crash between the capture commit and "link paid" leaves captured money on a link that can be paid again | INCIDENT 2026-05-14 | High | +11/−2 | +83/−0 | `4d2527c` |
| 60 | CW-8 | The API cannot boot in development: the built-in webhook key is 34 bytes | FP-300 (☐6), G4 | Medium | +1/−1 | +10/−0 | `bf810ef` |
| 61 | CW-9 | refund.succeeded is enqueued but never delivered as a webhook | FP-300 ☐4 | Medium | +19/−2 | +27/−0 | `152e27e` |
| 62 | CW-7 | Inbound acquirer HMAC is computed over re-serialized JSON, with no freshness check | FP-240, FP-201 | Medium | +14/−11 | +46/−11 | `1cca258` |
| 63 | SCHED-1 | Daemon takes "today" from the UTC date, so the Bahrain close runs at 03:00 + delay | G1, H5 | Medium | +6/−4 | +22/−0 | `649e4dd` |
| 64 | EST-1 | Lifetime payout total is a REAL accumulated through float32 | G2 | Medium | +6/−1 | +35/−1 | `d88497a` |
| 65 | SUM-2 | No index serves batched capture events by time, so the settlement summary scans transaction_events | H6 | Medium | +7/−0 | +24/−0 | `c55c71e` |
| 66 | FEES-4 | Dashboard fee shows the most recently entered schedule, not the one in force | F6 | Medium | +5/−13 | +6/−5 | `5a329f6` |
| 67 | REF-8 | Partial refunds round the fee reversal per partial, so they can reverse more fee than was charged | H1 | Medium | +5/−4 | +25/−0 | `01e6cd7` |
| 68 | REF-6b | Acquirer simulator caches transport errors, so a same-key refund retry can never succeed | FP-209, FP-300 (☐1) | Medium | +1/−1 | +22/−0 | `de6d70a` |
| 69 | AUTH-7 | OTP resend resets the guess budget | H8 | Medium | +3/−2 | +25/−0 | `730526d` |
| 70 | CW-6 | Webhook replays mint a new Webhook-Delivery-Id, so receivers cannot dedupe them | INC-2026-08-21 | Medium | +12/−20 | +12/−7 | `cffcb17` (CW-6), `cbbeb38` (CW-6b) |
| 71 | ADMIN-IMP-2 | Impersonation grants survive admin disable and logout | H3 | Medium | +9/−3 | +31/−0 | `88a5616` |
| 72 | LED-1 | The ledger can be edited and deleted as long as each group still balances | F2 | Medium | +13/−0 | +43/−0 | `3c35a5e` |
| 73 | FEES-5 | Settlement re-prices each capture with its own formula, so the batch fee drifts from the ledger and strands fils in merchant_payable | FP-300 ☐3 | Medium | +11/−22 | +248/−16 | `5542c53` |
| 74 | PL-6 | Public payment-link read leaks the merchant's live API key prefix and SHA-256 hash |  | Medium | +1/−16 | +6/−2 | `5759285` |
| 75 | IDEM-2 | Authorize idempotency fingerprint is an unkeyed SHA-256 over the full PAN and CVV, stored at rest |  | Medium | +2/−1 | +34/−0 | `b31f3a6` |
| 76 | CFG-1 | Any unknown NODE_ENV (for example "prod") silently boots as development: OTP codes in responses, non-Secure cookies, production checks skipped | H8 | Medium | +1/−0 | +7/−0 | `b421c00` |
| 77 | IMP-3 | CSV import splits a thousands-separated amount and posts its first digit group | F7 | Medium | +3/−0 | +12/−1 | `f181469` |
| 78 | CRED-1 | Manual credit ledger legs are dated to the operator-typed effective date (back- or future-dated, unbounded) | (also lead ADMIN-CRED-3) | Medium | +10/−10 | +33/−23 | `9411f13` (CRED-1), `85dd5fc` (CRED-1) |
| 79 | PL-5 | A failed capture in the payment-link checkout strands an authorized transaction and its 7-day hold | FP-300 ☐1 | Medium | +4/−1 | +23/−0 | `77a4ebb` |
| 80 | CAP-EXP-1 | An authorization whose 7-day hold has expired can still be captured |  | Medium | +7/−0 | +31/−0 | `daeba5f` |
| 81 | BAL-2 | Balance rebuild counts unbatched captures and refunds that the close then adds again | F4 | Medium | +9/−3 | +82/−0 | `f4b53a8` |
| 82 | ADMIN-CRED-4 | A credit's MDR reversal uses the display rate (merchants.mdr_bps), not the rate capture charged | F6 | Medium | +2/−1 | +15/−0 | `0dc835a` |
| 83 | RBD-1 | Admin "Rebuild analytics" double-applies the reporting backlog and wipes the FP-300 refund columns | FP-300 ☐5 | Medium | +14/−1 | +81/−0 | `01b75b1` |
| 84 | UI-DATE-1 | Merchant dashboard date filters use the UTC day, so each day loses its first 3 Bahrain hours | G1 | Medium | +2/−2 | +5/−2 | `a90e26c` |
| 85 | UI-SETTLE-1 | Admin "Run batch" form defaults to the wrong business date between 00:00 and 03:00 Bahrain | G1 | Medium | +5/−5 | +22/−0 | `3d47d7a` |
| 86 | ADMIN-IMP-3 | "View as merchant" never opens the dashboard: /v1/auth/me ignores the impersonation grant | H3 | Medium | +11/−3 | +38/−0 | `f71695a` |
| 87 | CHECKOUT-375 | On a phone the checkout's CVV field is off-screen and dashboard pages overflow sideways |  | Medium | +13/−0 | +0/−0 | `993c95a` |
| 88 | RECON-REFUNDS | Merchant reconciliation says "no gap" over three numbers that do not add up (refund lines not shown) | H1 / FP-300 | Medium | +8/−2 | +0/−0 | `0208c59` |
| 89 | CW-10 | Webhook transport buffers the whole receiver response with no byte cap |  | Medium | +11/−3 | +42/−0 | `c68fbdd` |
| 90 | ARC-1 | Webhook delivery archive loads an unbounded date range into one in-memory JSON string | H9 | Medium | +7/−4 | +20/−1 | `51ec9bb` |
| 91 | ADMIN-UPL-1 | KYC upload buffers any number of files and decodes images of any pixel count | H9 | Medium | +9/−3 | +59/−1 | `b809526` |
| 92 | U4 | Batch views show Gross − Fee ≠ Net payout with nothing explaining the netted refunds | FP-300 | Medium | +10/−4 | +10/−1 | `d3953ff` |
| 93 | TEST-BACKOFF | Dispatcher backoff test asserts an exact value from a jittered function | baseline test failure | Low | +0/−0 | +2/−2 | `3cb19b7` |
| 94 | TEST-OUTBOX-FIXTURE | Webhook archive test seeds malformed rollup events that break the reporting consumer tests | baseline test failure (FP-300 ☐5) | Low | +0/−0 | +4/−2 | `139f5aa` |
| 95 | F2-WINDOW | The March residue sweep reads a UTC month, not the Bahrain month | F2, G1/H5 (timezone) | Low | +1/−1 | +3/−2 | `13831ee` |
| 96 | AUTH-1·rpt | Reporting export-summary has no authentication gate | H3 | Low | +1/−1 | +28/−0 | `622a94f` |
| 97 | AUTH-9 | OTP verify never re-issues the merchant cookie, so fp_sid keeps the 10-minute pending Max-Age |  | Low | +2/−0 | +14/−0 | `06ae227` |
| 98 | ADMIN-KYC-2 | The PDF-only KYC rule checks the filename, so a renamed JPEG is accepted as a commercial registration | H3 | Low | +2/−1 | +21/−0 | `92d920a` |
| 99 | CW-11 | Acquirer callback `outcome` and `occurredAt` are never validated, so any string is stored as a fraud verdict |  | Low | +5/−1 | +21/−0 | `0ec33d1` |
| 100 | CW-12 | Merchants cannot stop deliveries: deleting an endpoint with history returns 500, and a disabled endpoint keeps getting retries |  | Low | +7/−3 | +35/−0 | `03aa660` |
| 101 | ERR-1 | A NUL byte in any request string turns into a 500 internal_error instead of a 400 |  | Low | +6/−0 | +11/−0 | `59d1770` |
| 102 | TXN-1 | withTransaction lets a failing ROLLBACK mask the real error and returns the broken client to the pool |  | Low | +3/−2 | +30/−0 | `5c032db` |
| 103 | SEC-1 | Every merchant `:id` route answers 500 for a malformed id (Postgres 22P02) instead of 404 |  | Low | +6/−0 | +23/−0 | `a996cd2` |
| 104 | CLI-1 | `settlement rebuild-balances --merchant=<id>` prints the rebuilt figure but never writes it | F4 | Low | +15/−3 | +23/−0 | `e9778fc` |
| 105 | IMP-4 | CSV adjustment import answers an unknown merchant or a NUL byte with a 500 | F7 | Low | +7/−1 | +15/−0 | `b3cad51` |
| 106 | DATE-1 | Report date windows include the exclusive "to" day, and bare report dates are UTC, not Bahrain days |  | Low | +3/−3 | +22/−0 | `c6d63f6` |
| 107 | UI-SETTLE-1b | Settlement's 400 (bad operator input) is turned into a 500 server error in the admin console |  | Low | +4/−2 | +19/−1 | `067103b` |
| 108 | ADMIN-IMP-3b | "View as merchant" opens the web app's root, which is a 404 | H3 | Low | +2/−0 | +28/−0 | `57c82d0` |
| 109 | ROUTER-404 | A mistyped URL or a page that throws shows React Router's developer error screen in both apps |  | Low | +13/−2 | +54/−0 | `53442f5` |
| 110 | LINK-EXPIRED | The merchant dashboard shows an expired payment link as "active" and still offers Cancel | FP-187 | Low | +11/−5 | +11/−1 | `81514a5` |
| 111 | UI-401 | An ended session shows a raw "unauthenticated" over stale data instead of the login page |  | Low | +4/−0 | +60/−0 | `a9bb039` |
| 112 | CHECKOUT-PAIDAT | Checkout's "Payment successful" page shows a raw UTC ISO timestamp | G1 | Low | +1/−1 | +0/−0 | `84214f6` |
| 113 | BATCH-BAR | Merchant batch page shows a meaningless "progress bar" computed from fils in floating point | ADR-0001 | Low | +0/−6 | +0/−0 | `fa0e21d` |
| 114 | IMP-BANNER | Admin impersonation banner still describes write access the grant no longer has | H3 | Low | +1/−1 | +0/−0 | `deda775` |

## Case-file coverage

| item | case-file wording (short) | fixed by |
|---|---|---|
| F1 | Scheme statement always a few fils over | SCHEME-1, SCHEME-2 |
| F2 | March sweep doubled when re-run | SCHEME-2, F2-SWEEP, LED-1, F2-WINDOW |
| F3 | Split payouts don't add up | SPLIT-1 |
| F4 | Admin balance button vs CLI | MIG-1, BAL-1, ADJ-1, BAL-2, CLI-1 |
| F5 | MDR recalculation changed paid batches | MDR-1 |
| F6 | Dashboard fee ≠ charged fee | FEES-4, ADMIN-CRED-4 |
| F7 | CSV import 10x too small | IMP-1, IMP-2, IMP-3, IMP-4 |
| G1 | Daily close at 3 am | SCHED-1, UI-DATE-1, UI-SETTLE-1, F2-WINDOW, CHECKOUT-PAIDAT |
| G2 | Lifetime payout estimate drifts | EST-1 |
| G3 | Test merchants in real settlement | ADMIN-TEST-1 |
| G4 | Login without OTP | AUTH-1, CW-8 |
| G5 | Cancel another merchant's link | PL-3 |
| FP-187 | Link paid after expiry | PL-2, LINK-EXPIRED |
| FP-201 | Duplicate acquirer callbacks | CW-5, CW-7 |
| FP-203 | Balance cache wrong after admin action | BAL-1, ADJ-1 |
| FP-209 | Concurrent refund double payout | REF-1, REF-1b, REF-6b |
| FP-240 | Webhook signatures rejected | B8, CW-3, CW-2, CW-7 |
| INC-2026-05-14 | Payment link charged twice | PL-1, CAP-6 |
| INC-2026-08-21 | Duplicate payout notifications | CW-1, NOTIFY-1, CW-6 |
| H1 | Refund more than charged | REF-3, REF-5, REF-7, REF-1b, REC-1, REF-8, RECON-REFUNDS |
| H2 | Splits a few fils short | SPLIT-1 |
| H3 | Admin role checks | ADMIN-IMP-1, ADMIN-CRED-1, B8, ADMIN-CRED-2, AUTHZ-1, ADMIN-KYC-1, CW-6, ADMIN-IMP-2, ADMIN-IMP-3, AUTH-1·rpt, ADMIN-KYC-2, ADMIN-IMP-3b, IMP-BANNER |
| H4 | Key rotation | AUTH-3 |
| H5 | Close timing vs docs | CLOSE-1, SCHED-1, F2-WINDOW |
| H6 | Slow reporting query | SUM-1, SUM-2 |
| H7 | Test merchants and admin tools | ADMIN-TEST-1, REF-5 |
| H8 | OTP safety | AUTH-1, AUTH-2, AUTH-4, AUTH-5, AUTH-13, AUTH-7, CFG-1 |
| H9 | Large export | EXP-1, ARC-1, ADMIN-UPL-1 |
| FP-300 | Finish the missing feature (refunds) | REF-2, MIG-1, NET-1, CW-3, REF-4, REF-5, REF-6, OBX-POISON, OBX-DOUBLE, SUM-1, IDEM-1, REC-1, FEES-3, UI-NEG-1, OBX-SKIP, CW-8, CW-9, REF-6b, FEES-5, PL-5, RBD-1, RECON-REFUNDS, U4 · plus feature commits `f76d86b`, `8afc127`, `e6f6160`, `c1d13e2`, `5e9cbd9`, `198e5cf`, `b4e6b95`, `79eaf16` (see FP-300 section) |

Not covered: none; every case-file item has at least one proven fix.

## Per-fix notes

Same order as the summary table. Each note: what is wrong, why it happens, what it breaks, why it needed a fix, the fix, why it is the smallest correct fix, the proof, and the line counts.

<a id="f-auth-1"></a>

### AUTH-1 · Pending (pre-OTP) session cookie authenticates every merchant route · G4, H8 · Severity: Critical

**What's wrong:** `lookupSession`, which backs `requireSession` and `requireMerchantAuth`, accepted any live session row, including the pending row `/v1/auth/login` creates after the password check alone. The OTP step was decorative: a password gave full merchant access.

**Why it happens:** `POST /v1/auth/login` (`apps/api/src/routes/auth.ts:87-105`) inserts a `sessions` row with `authenticated = false` (`auth/sessions.ts:31-32`) and sets the `fp_sid` cookie to its raw token. `lookupSession` (`auth/sessions.ts:89-92`) reads the `live_sessions` view (`db/migrations/0058_live_sessions.sql:11-12`), which filters only `revoked_at IS NULL AND expires_at > now()`. The `authenticated = true` term that the 0012 contract requires (`0012_sessions.sql:4-6`) was dropped when liveness moved into the view, and the query never added it back. The admin lookup (`adminAuth/sessions.ts:124`) keeps the term.

**What it breaks:** The lead confirmed this at runtime. With a correct password and no OTP, the pending cookie got 200 on `GET /v1/auth/me` and `GET /v1/transactions`. An owner's pending cookie also passes `requireRole('owner')` on `POST /v1/merchants/:id/api-keys`, so it can mint a non-expiring API key within the 10-minute pending window. Together with AUTH-2, the password does not even have to be the victim's.

**Why it needed a fix:** H8 requires two-factor merchant login. Left alone, a stolen or guessed password alone opens every dashboard and API-key route, and the second factor is bypassed for every merchant.

**Fix:** `apps/api/src/auth/sessions.ts:92`
```diff
-      WHERE s.token_hash = $1`,
+      WHERE s.token_hash = $1 AND s.authenticated = true`,
```
Commit: `87a6b42`. Lines: prod +1/-1, test +38/-1 (corrected from git numstat).

**Why this is the smallest correct fix:** `lookupSession` is the single function every merchant-authenticated route uses (`auth/middleware.ts:38`, `auth/requireMerchantAuth.ts:53`), and the view already exposes `authenticated`. *Why not change the view (migration)?* `live_sessions` has no other consumer, so a new migration adds schema churn without closing anything more. *Why not check in each middleware?* That is two call sites instead of one, and it leaves the lookup lying about its contract. OTP verify and resend use `lookupPendingSession`, which reads `authenticated = false`, so they keep working, and dev mode still returns `devOtpCode`.

**Proof:** `AUTH-1: lookupSession returns null for a pending (pre-OTP) session` (`apps/api/src/auth/sessions.audit.test.ts`) fails before the fix with `assert.equal(await lookupSession(pool, rawToken), null, "a pending session must not authenticate")`: the actual value is a `{sessionId, merchantUserId, merchantId, role}` object. It passes after the fix.

**Regression risk:** A flow that uses the cookie before OTP verify now gets 401, which is the intended contract. `src/app.test.ts` (login, OTP verify, then dashboard calls) passes 9/9. `auth/sessions.test.ts` and `auth/otp.test.ts` pass. Deployment caveat from the dossier: in production the notifier only logs, so OTP delivery has to ship alongside this fix.

**Trap note:** `auth/sessions.test.ts:79` said "MK: covered in routes/auth.test.ts", but no such file exists. That line now points to the audit test. Other misleading claims, left as-is because they live in files we do not own: `routes/auth.ts:49-50` ("A pending session authenticates nothing until promoted"), which is now true; `routes/apiKeys.ts:34-35`; `docs/ARCHITECTURE.md:67-68`; and `auth/sessions.ts:69`, whose doc comment is now accurate.

---

<a id="f-imp-1"></a>

### IMP-1 · CSV adjustment import reads BD as 2-decimal "cents" (10x too small) · F7 · Severity: Critical
**What's wrong:** Every amount in the admin CSV adjustment import is posted to the ledger at one tenth of its value, and the third decimal is silently dropped: "4.75" BD posts 475 fils (0.475 BD) and "4.755" also posts 475.

**Why it happens:** `parseAdjustmentAmountFils` (`apps/api/src/admin/adjustmentCsvParsing.ts:8`) called `parseDecimalMinor(raw)`, whose default is `decimals = 2` (`apps/api/src/lib/decimal.ts:4`). It pads/slices the fraction to 2 digits (`decimal.ts:16`) and glues it to the integer part: "4.75" → "4"+"75" → 475, "4.755" → "4"+"75" → 475. The result is a count of hundredths of a BD, which `toFils` then brands as fils. The faulty assumption is "BD has 2 decimals" (the quarantined CLAUDE.md said "1 BD = 100 cents"); the case file and ADR-0001 say 1 BD = 1000 fils and require `parseBhdToFils`.

**What it breaks:** Both readings in Finance's F7 note come from this one bug: read as 2-dp, 475 looks like "4.750" (4.755 → 4.750); read as fils it is 0.475 BD ("ten times less"). Each row posts a balanced ledger group (merchant_payable vs manual_balance_adjustment_contra) and a cache delta 10x too small. Worked number: 4.75 BD → 475 fils instead of 4,750 (−4,275 fils per row). The 2026-08-27 import (sheet 4,141.90 BD) posted 414,190 fils = 414.190 BD, so 3,727.710 BD of corrections never reached the ledger.

**Why it needed a fix:** Every manual correction finance makes is 90% lost; merchants are under- or over-credited and the ledger silently disagrees with finance's spreadsheet.

**Fix:** `apps/api/src/admin/adjustmentCsvParsing.ts`
```diff
-import { toFils, type Fils } from "@filspay/money";
+import { parseBhdToFils, type Fils } from "@filspay/money";
-import { parseDecimalMinor } from "../lib/decimal.js";
-    return toFils(parseDecimalMinor(raw), { allowNegative: true });
+    return parseBhdToFils(raw); // ADR-0001: BD x1000, signed, rejects >3 decimals (was 2-dp "cents")
```
plus the misleading comment at `apps/api/src/routes/adminAdjustmentImport.ts:57`. Commit: `55fa663`. Lines: prod +3/−4 (incl. 1 comment line), test +20/−8.

**Why this is the smallest correct fix:** one call swap at the single parsing point, reusing the ADR-0001 parser that already exists in `packages/money`. Its errors are still caught and mapped to 400 `invalid_amount`. Why not change `decimals = 2` to `3` in `decimal.ts` (1 line)? It would still silently truncate a 4th decimal ("4.7555" → 4755) instead of rejecting it, and it keeps a second, non-canonical money parser alive. Why not delete `lib/decimal.ts` (now unused)? It adds deleted lines and fixes nothing more.

**Proof:** `adjustmentCsvParsing.audit.test.ts` "CSV import amounts are BD with 3 decimals" fails before (`expected: 4750, actual: 475`) and passes after. Corrected assertions that encoded the bug: `adjustmentImport.test.ts:61,67,70,125,126,148` (600→6000, 475→4750, 125→1250, 350→3500, 500→5000) and `routes/adminAdjustmentImport.test.ts:108` (600→6000). Import suites: 32/32 pass.

**Regression risk:** only the CSV import path calls this function (grep). Inputs with thousands separators ("1,250.000") are now rejected as `invalid_amount` instead of being mis-split (IMP-3 is the separate splitter bug). Past imports remain wrong in the ledger: `adjustment_import_rows.raw_amount_text` (0066) allows a one-off, per-row idempotent correcting journal (parseBhdToFils(raw) − parsed_amount_fils), which is a finance decision and not run here.

**Trap note:** `routes/adminAdjustmentImport.ts:57` "FH: parseAdjustmentCsv handles 3dp BD amounts correctly (4.750 -> 4750 fils), Claude checked" (false; corrected in place). `routes/adminAdjustmentImport.test.ts:236-238` "4.75 -> 475 ... matches the README" / "2dp by agreement with finance" (annotated). Six test assertions pinned the 10x value; 6f462e1 "mark import amounts as intentional" is an empty commit (MK, "Per Rule 3").

---

<a id="f-auth-2"></a>

### AUTH-2 · Login binds the OTP and session to an email-only lookup (cross-tenant takeover) · H8 · Severity: Critical

**What's wrong:** `POST /v1/auth/login` checks the password against the `(merchantId, email)` row. It then issues the OTP challenge and the pending session for whatever `findOtpRecipient(email)` returns, which is any active user with that email in any tenant.

**Why it happens:** `apps/api/src/routes/auth.ts:78` read `const recipient = await findOtpRecipient(app.db, email) ?? user;`. `findOtpRecipient` (`auth/users.ts:15-21`) runs `WHERE mu.email = $1 AND m.status = 'active' LIMIT 1`, with no merchant filter and no `ORDER BY`. Emails are unique only per merchant (`0003_merchant_users.sql:12 UNIQUE (merchant_id, email)`). `recipient.id` is then bound to the challenge (`:82`) and the session (`:88`), and `/otp/verify` promotes that session as that user (`:176-179`).

**What it breaks:** Victim V has owned tenant A with email E for some time. The attacker uses public signup (`POST /v1/merchants`) to create tenant B, with owner email E and a password the attacker chooses. The attacker logs in with B's id and that password. The password check passes for B's row, but the email-only lookup returns V's older row in A. After OTP verify, `GET /v1/auth/me` returns tenant A, so the attacker now holds the victim's owner session. In the benign case, the seed's shared owner email logs in to Beta Digital and lands in Alpha Retail.

**Why it needed a fix:** H8 requires tenant isolation for merchant login. Left alone, anyone who knows an owner's email can take over that merchant's account, including minting API keys and reading settlement data.

**Fix:** `apps/api/src/routes/auth.ts:12,78`
```diff
-import { findOtpRecipient } from "../auth/users.js";
...
-    const recipient = await findOtpRecipient(app.db, email) ?? user;
+    const recipient = user; // AUTH-2 (H8): the row whose password was just verified, never an email-only lookup
```
Commit: `079dd2c`. Lines: prod +1/-2, test +74/-0.

**Why this is the smallest correct fix:** Line 78 is the single point where the authenticated identity is swapped. Keeping the `recipient` name leaves lines 82, 88 and 97 untouched. *Why not add a merchant filter to `findOtpRecipient`?* That changes its signature and adds a redundant second query for a row we already hold. *Why not delete `auth/users.ts`?* That is 24 more changed lines with no added safety once the import is gone. The import is removed so the email-only helper has no caller left.

**Proof:** `AUTH-2: login binds the OTP and session to the user whose password was checked` (`apps/api/src/routes/auth.audit.test.ts`) fails before the fix with `assert.notEqual(merchant, victimMerchantId, "session must not land in the victim's tenant")`: `/me` returned the victim's merchant id. It passes after the fix.

**Regression risk:** Login for a user whose email is unique is unchanged, because `findOtpRecipient` returned that same row. `src/app.test.ts` passes 9/9, including the shared-email test at `:147`. `tsc --noEmit` reports no new errors.

**Trap note:** Several comments asserted that login is merchant-scoped: `db/migrations/0011_otp_challenges.sql:1-4`, `onboarding/signup.ts:37-38` ("MK: login filters by merchantId. verified"), `db/seed/fixtures/merchants.ts:87-89`, and `app.test.ts:181`, whose test uses a unique email and so cannot fail. These are outside this lane's owned files and are listed for the lead to correct. The code comment at `routes/auth.ts:78` now states the invariant.

---

<a id="f-ref-3"></a>

### REF-3 · Refund ceiling uses the authorized amount, not the captured amount · H1 · Severity: Critical

**What's wrong:** `processRefund` works out how much may still be refunded as `amount_fils - refunded_fils`, where `amount_fils` is the authorized amount. A partially captured transaction can therefore refund money that was never charged.

**Why it happens:** `apps/api/src/payments/processRefund.ts:90` computed `subtractFils(amountAuthorized, refundedFils)` and passed it to `validateRefundRequest` as `refundableFils`. The validator (`refundValidation.ts:38-46`) trusts that number. The faulty assumption was that authorized equals captured; it does not after a partial capture. Two things hid the bug. The test helper `refundValidation.test.ts:22` built `refundableFils` from `amountFils`, the same mistake. Two comments then presented it as intended: `:55` "it can refund up to the authorized amount" and `:73` "the authorized amount, by design".

**What it breaks:** Authorize 10,000 fils and capture 4,000 fils (status `partially_captured`). Before the fix, a refund of 10,000 fils was approved (200), the acquirer paid out 10,000 fils, and the merchant got back 6,000 fils that the buyer never paid. This is exactly case file H1: "can you refund more than what was actually charged?"

**Why it needed a fix:** Any merchant with a partial capture (hotels, pre-auth flows) could take out up to the uncaptured part of the authorization as cash. The platform would carry that loss.

**Fix:** `apps/api/src/payments/processRefund.ts:90`
```diff
-    const refundableFils = subtractFils(amountAuthorized, refundedFils);
+    const refundableFils = subtractFils(capturedFils, refundedFils);
```
Commit: `bf476ed`. Lines: prod +1/-1, test +21/-3 (new test +18; corrected helper +1/-1 and 2 corrected comments +2/-2 in `refundValidation.test.ts`).

**Why this is the smallest correct fix:** It changes one operand at the single place the ceiling is computed. The validator and its 422 `refund_exceeds_refundable` contract stay as they are.
- Why not change `validateRefundRequest` to compute `capturedFils - refunded` itself: that changes the `RefundableTransaction` shape and every caller and test, which is more lines for the same result.
- Why not cap the amount inside `refundableAmount()`: that would hide the wrong input instead of fixing where it comes from.

**Proof:** The new test `REF-3: a refund above the captured amount is refused even when the authorization is larger` (`processRefund.test.ts`) failed before the fix with `expected: 422, actual: 200`. After the fix it passes: 422 `{ code: "refund_exceeds_refundable", refundableFils: 4000 }`. Refund suites: 35 pass, 0 fail.

**Regression risk:** For fully captured transactions captured equals authorized, so nothing changes. `amountAuthorized` is still used for `nextStatusAfterRefund`. Covered by processRefund, initiateMerchantRefund, refundValidation and refundState tests.

**Trap note:** The test helper at `refundValidation.test.ts:22` encoded the bug (`amountFils - refundedFils`). It now uses `capturedFils - refundedFils`. The `// MK:` comment (:55) and the "by design" JSDoc (:73) are rewritten to cite H1.

---

<a id="f-ref-2"></a>

### REF-2 · Any merchant can refund another merchant's transaction · FP-300 · Severity: Critical

**What's wrong:** `initiateMerchantRefund` loads the target transaction by id alone and passes on the transaction's own `merchant_id`, so merchant A can refund merchant B's transaction by sending B's `transactionId` in the body.

**Why it happens:** `apps/api/src/refunds/initiateMerchantRefund.ts:62-65` ran `SELECT id, merchant_id FROM transactions WHERE id = $1`. The result was never compared with `input.merchantId`, which the route has already checked against the session (`assertRefundRequestScope`). `:73` then passes `merchantId: txn.merchant_id`, the victim's id, to `processRefund`, whose own lookup (`processRefund.ts:73-78`) is also by id only. The faulty assumption was that the path-scope check covers the body's `transactionId`. It only proves who the caller is, not that the caller owns the transaction. A misleading comment hid this (`initiateMerchantRefund.test.ts:170-171`): "TODO: another merchant's existing transactionId should also 404. currently refunds it" followed by "FH: Claude wrote a test for this but it passed?? so it's fine. deleted it as redundant".

**What it breaks:** Merchant B captures 10,000 fils. Merchant A calls `initiateMerchantRefund` with B's transaction id. Before the fix the call succeeds: B's transaction is refunded 10,000 fils, B's `merchant_payable` is debited, and the money goes back to B's buyer. The whole action is driven by A, and the idempotency key is filed under B.

**Why it needed a fix:** Once FP-300 wires the route, any merchant with an API key could drain any other merchant's balance through refunds. Transaction ids also appear in webhooks, receipts and payment-link data.

**Fix:** `apps/api/src/refunds/initiateMerchantRefund.ts:63-64`
```diff
-    `SELECT id, merchant_id FROM transactions WHERE id = $1`,
-    [input.transactionId],
+    `SELECT id, merchant_id FROM transactions WHERE id = $1 AND merchant_id = $2`,
+    [input.transactionId, input.merchantId],
```
Commit: `0283a8e`. Lines: prod +2/-2, test +20/-2.

**Why this is the smallest correct fix:** It scopes the lookup by the caller's merchant at the single point where the transaction is picked. A foreign id then takes the existing `transaction_not_found` 404 path, so another merchant's id cannot be told apart from a missing one (no existence oracle).
- Why not compare `txn.merchant_id !== input.merchantId` and throw 403: that adds lines and reveals that the id exists.
- Why not also scope `processRefund`'s lookup: its only production caller is `initiateMerchantRefund`, which now passes a verified owner. Scoping it too would be defence in depth that the FP-300 builder can add when wiring the route.

**Proof:** The new test `REF-2: another merchant's existing transactionId is a 404 and refunds nothing` (`initiateMerchantRefund.test.ts`) failed before the fix with `Missing expected rejection (NotFoundError).`. After the fix it passes, and `refunded_fils` stays 0. processRefund + initiateMerchantRefund: 21 pass, 0 fail.

**Regression risk:** Own-merchant refunds are unchanged ("a full/partial refund of the caller's own transaction succeeds"). The unknown-id 404 test still passes.

**Trap note:** The `TODO`/`FH:` comment at `initiateMerchantRefund.test.ts:170-171` claimed a deleted test had "passed" and that the case was "fine". That comment is replaced by the restored test.

**Trap note (adversarial review):** the "Claude drafted" handler that sat in comments in `routes/refunds.ts:11-18` would have defeated this fix. It spread `request.body` **after** `merchantId`, so a body `merchantId` overrode the tenant, and it invented a fresh `randomUUID()` idempotency key per request (every retry a new refund, FP-209). The FP-300 route (commit c1d13e2) deleted the draft, takes `merchantId` only from `request.merchantAuth` and picks body fields one by one.

---

<a id="f-admin-imp-1"></a>

### ADMIN-IMP-1 · Admin impersonation grants can write as the merchant (super_admin becomes owner) · H3 · Severity: Critical

**What's wrong:** A "view as merchant" grant resolved to the merchant role `owner` for a super_admin and `finance` for a finance admin, and `requireMerchantAuth` let it through on every method. An impersonating admin could therefore create payment links and webhook endpoints, mint API keys (super_admin), and capture or void transactions as the merchant.

**Why it happens:** `apps/api/src/admin/impersonation.ts:85-89` mapped `finance → "finance"` and `super_admin → "owner"`, which contradicts the type's own docstring at `:91`: "merchantRole Always "support" (ARCH §8): a grant is view-only". `auth/requireMerchantAuth.ts:86-97` relied only on per-route `requireMerchantRole` gates ("no second allowlist", `:78-84`). Routes with no role gate, such as `POST /v1/transactions/:id/capture|void`, accepted every grant, including `support`.

**What it breaks:** A finance or super_admin operator who opens a support view of merchant M can `POST /v1/merchants/M/payment-links` (201 today) or void M's authorized transactions (any role). That moves merchant money without any merchant consent or maker-checker step, and the audit log records the actor as the merchant's role. Lane B's AUTHZ-1 depends on grants being read-only.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Impersonation exists so support can see what the merchant sees. Write access turns it into an unaudited back door into every merchant account.

**Fix:** `apps/api/src/admin/impersonation.ts:87-88` and `apps/api/src/auth/requireMerchantAuth.ts:89-90`
```diff
-  finance: "finance",
-  super_admin: "owner",
+  finance: "support",
+  super_admin: "support",
```
```diff
     if (grant) {
+      // ADMIN-IMP-1 (H3): a grant is a read-only support view (ARCH §8); refuse every write.
+      if (request.method !== "GET" && request.method !== "HEAD") throw new ForbiddenError("forbidden");
```
Commit: `8d10830`. Lines: prod +4/-2, test +61/-0.

**Why this is the smallest correct fix:** The grant branch of `requireMerchantAuth` is the single place where an impersonation identity enters the merchant plane, so one method check makes every current and future write route read-only, including routes with no role gate. The mapping change restores the documented `support` scope for reads. Without it, a super_admin's view could pass owner/finance-gated GETs. *Why not add role gates to capture, void and so on?* That means many call sites, and any route added later would be open again. *Why only the mapping?* Ungated write routes would still accept a `support` grant. *Why a generic `"forbidden"` code instead of a new code?* It keeps the existing API error contract that the current test at `routes/admin.test.ts:1109` asserts.

**Proof:** `ADMIN-IMP-1: a {support,finance,super_admin} impersonation grant is read-only` (`apps/api/src/admin/impersonation.audit.test.ts`) fails before the fix. For finance and super_admin, `payment-link create: ... 201 !== 403`. For support, `void: {"error":"transaction_not_found"} 404 !== 403`, meaning the request reached the handler. All three pass after the fix, and `GET /v1/transactions` still returns 200.

**Regression risk:** Impersonated reads are unchanged for support grants. finance and super_admin grants now see only what a support user sees, which is the documented scope. `routes/admin.test.ts` (including the support-impersonation and expired-grant tests), `routes/transactions.test.ts` and `routes/paymentLinks.test.ts` pass.

**Trap note:** The `impersonation.ts:91` docstring already said "Always support". `routes/transactions.ts:91-93` ("MK: impersonation is read-only, enforced in requireMerchantAuth. fine") and `requireMerchantAuth.ts:128` ("YA: impersonation can't reach write routes") claimed an enforcement that did not exist. They are now true. `routes/admin.test.ts:1074` notes that only support was tested, and the audit test covers all three roles.

**Follow-up (adversarial review):** the role-mapping half (every admin role → merchant role `support`) had no test of its own. Added to `impersonation.audit.test.ts`: each grant's GET of the owner/finance-gated `/v1/settlement/reconciliation` must be 403. Proof: with the pre-fix `impersonation.ts` (finance→finance, super_admin→owner) the finance and super_admin cases fail; with the fix all 3 pass. The comment at `auth/requireMerchantAuth.ts:82-84` ("no second ... allowlist") contradicted the new write block and is corrected. Lines: prod 2 comment lines, test +3.

---

<a id="f-ref-1"></a>

### REF-1 · Concurrent refunds both pay out (unlocked check, acquirer outside the txn, absolute write) · FP-209 · Severity: Critical

**What's wrong:** Two refund requests for the same transaction with different idempotency keys can both pass validation, both call the acquirer, and both succeed. Together they return more than was captured.

**Why it happens:** In `apps/api/src/payments/processRefund.ts`, phase 1 (`:73-78`) read `refunded_fils` with no row lock and committed. Phase 2 (`:146`) called the acquirer outside any transaction. Phase 3 (`:165`, `:199-203`) wrote an absolute total, `SET refunded_fils = $2`, which was `prepared.refundedFils + requested` from that stale read. Nothing held the refundable amount between the check and the payout. `capture.ts` does not have this problem because it keeps a `SELECT ... FOR UPDATE` lock for the whole operation. The faulty assumption was that the idempotency claim serializes refunds. It only blocks the same key. A test comment hid this (`processRefund.test.ts:257`): "should there be a test for two refunds at the SAME time? nvm the claim blocks it".

**What it breaks:** Capture 10,000 fils, then send two 10,000 fils refunds at the same time. Before the fix both returned 200, the acquirer paid twice (20,000 fils out on a 10,000 fils charge), and two `refunds` rows were written. Because of the lost update, `refunded_fils` read 10,000, so the books hid the extra 10,000 fils. This is FP-209: "Both went through, and we lost money."

**Why it needed a fix:** A double-click, a client retry with a new key, or a deliberate burst pays the refund out several times. The ledger also stops showing the loss.

**Fix:** `apps/api/src/payments/processRefund.ts`
```diff
-        WHERE id = $1`,
+        WHERE id = $1 FOR UPDATE`,
@@ after the validation 422/409 return (phase 1)
+    // REF-1 (FP-209): reserve under the row lock before any money moves; released below if not approved.
+    await client.query(`UPDATE transactions SET refunded_fils = refunded_fils + $2 WHERE id = $1`, [txn.id, validation.amountFils]);
@@ phase 3, first statement
+    if (acquirerResult.outcome !== "approved") {
+      await client.query(`UPDATE transactions SET refunded_fils = refunded_fils - $2 WHERE id = $1`, [prepared.transactionId, prepared.requestedAmount]);
+    }
@@ phase 3 success
-    const newRefundedTotal = addFils(prepared.refundedFils, prepared.requestedAmount);
+    const cur = await client.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
+    const newRefundedTotal = toFils(Number(cur.rows[0]!.refunded_fils)); // already includes this refund (reserved in phase 1)
-    await client.query(`UPDATE transactions SET refunded_fils = $2, status = $3 WHERE id = $1`, [ ...4 lines ]);
+    await client.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [prepared.transactionId, newStatus]);
```
Plus `addFils` dropped from the import because it is no longer used. Commit: `799ff25`. Lines: prod +10/-8, test +43/-1 (new test +42; the misleading `am:` comment rewritten +1/-1).

**Why this is the smallest correct fix:** The amount is reserved in phase 1 under a `FOR UPDATE` lock, so the existing validator decides on the latest committed total. A second request blocks on the lock, then sees `refunded_fils = 10,000` and gets the existing 422 `refund_exceeds_refundable` with the right `refundableFils`. No new error path is needed. Phase 3 never writes an absolute total again, and it re-reads the total under the lock to set the status.
- Why not the dossier's conditional `UPDATE ... WHERE refunded_fils + $x <= captured_fils` with its own 422 branch: that adds about 4 more lines and duplicates the validator's error body.
- Why not hold one transaction across the acquirer call, as `capture.ts` does: that is a restructure. A crash mid-call would also roll back the claim, so a same-key retry could pay again. The reservation fails closed instead: if phase 3 crashes after an approval, the fils stay reserved.
- Why not a `CHECK (refunded_fils <= captured_fils)` migration: it is defence in depth and does not stop the double payout, because the acquirer is called before any write.
- Release on `error` (502) as well as `declined` (402): this keeps the existing contract that a 502 is retryable with no side effect (covered by the "acquirer transport error ... retryable" test).

**Proof:** The new test `REF-1: two concurrent refunds whose sum exceeds the capture pay out exactly once` runs a barrier acquirer that waits for the second call or 300 ms. Before the fix it failed with `actual: [200, 200]`, expected `[200, 422]`. After the fix it passes: one acquirer call, one `refunds` row, `refunded_fils` 10,000, status `refunded`. processRefund + initiateMerchantRefund + refundValidation + refundState: 37 pass, 0 fail.

**Regression risk:** The sequential paths (full, partial, two partials, replay, 402 decline, 502 then retry, voided, outbox) are all still green. Residual edge (corrected, see REF-1b): if two partial refunds run at once and one is declined, the approved one computed its status from a total that still included the other's reservation. The status did not merely lag: it could be written as `refunded` and never revert, so the rest of the capture became permanently non-refundable (`refundValidation.ts:31`). Money and `refunded_fils` stayed correct. Fixed in REF-1b.

**Trap note:** `processRefund.test.ts:257` ("nvm the claim blocks it") is rewritten to say the claim blocks only the same key. The REF-1 test now covers different keys.

---

<a id="f-admin-cred-1"></a>

### ADMIN-CRED-1 · Credit creation has no role gate: a support admin can post credits · H3 · Severity: Critical

**What's wrong:** `POST /v1/admin/merchants/:id/credits` required only an admin session. A `support` admin could create credits, and any below-threshold credit posts straight to the ledger with no approver.

**Why it happens:** In `apps/api/src/routes/adminCredits.ts:41-77` the create route sits in the first `register()` scope, which has only `requireAdminSession`. Only the approve and reject scope (`:79-81`) adds `requireAdminRole("finance", "super_admin")`. `createCreditRequest` (`admin/credits.ts:201-203`) claimed "a support caller gets a 403 from here", but it performs no role check.

**What it breaks:** A support admin sends 20 requests of `baseAmountFils: 50_000` with `reverseFee` to a 320 bps merchant. Each one posts 51,600 fils with `requires_approval = false`, so 1,032,000 fils (1,032.000 BD) is credited to `merchant_payable` and no finance user is ever involved.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Money-out credits are a finance control, and the least-privileged role could bypass it without limit.

**Fix:** `apps/api/src/routes/adminCredits.ts:64`
```diff
       "/merchants/:id/credits",
+      { preHandler: requireAdminRole("finance", "super_admin") }, // ADMIN-CRED-1 (H3)
       async (request, reply) => {
```
The misleading doc line is corrected at `admin/credits.ts:203`. Commit: `eed6c09`. Lines: prod +2/-1 (1 code, 1 comment), test +17/-0.

**Why this is the smallest correct fix:** A per-route `preHandler` runs after the scope's `requireAdminSession` hook, so `adminAuth` is already set, and it reuses the existing `requireAdminRole`. *Why not move the route into the second `register()` block?* That moves about 15 lines for the same effect. *Why not check the role inside `createCreditRequest`?* That is a signature change, and the route layer is where every other admin role gate lives. Support keeps read access to `GET /v1/admin/credits`.

**Proof:** `ADMIN-CRED-1: a support admin is 403'd on create and nothing is journaled` (`apps/api/src/routes/adminCredits.test.ts`) fails before the fix with `assert.equal(res.statusCode, 403, res.body)` → `201 !== 403`. It passes after the fix. No `credit_requests` row is created.

**Regression risk:** Finance and super_admin creation is unchanged. `routes/adminCredits.test.ts`, `admin/credits.test.ts` and `admin/creditApproval.test.ts` all pass (23/23).

**Trap note:** `admin/credits.ts:203` ("a support caller gets a 403 from here") is corrected to point at the route gate. `adminCredits.test.ts:139` ("create isn't in this test, only approve/reject. intentional? — am") is answered by the new test directly above it. `docs/ADMIN.md:9` (support may "issue small credits") is outside this lane's owned files and contradicts H3; it is listed for the lead.

---

<a id="f-pl-1"></a>

### PL-1 · A slow payment lets a second buyer re-claim the link and both are charged · INCIDENT 2026-05-14 · Severity: Critical

**What's wrong:** The public pay flow reserves a link with a committed 60 s lease that records no holder, then runs authorize+capture with no lock held. A second buyer who arrives after the lease has gone stale re-claims the link and is charged too. Finalize was not fenced to the first holder.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:65-76`: the claim `UPDATE ... SET status='reserved', reserved_at=now()` commits on its own (`pool.query`), so the row lock is released at once. The `OR (status = 'reserved' AND reserved_at < now() - timeout)` branch (`:71`) lets anyone take over a lease older than the timeout, even while the first request is still inside `captureTransaction`. Finalize (`:144-148`, `WHERE id = $1 AND status = 'reserved'`) matches whoever's reservation is current. The loser falls into the 0-row branch, which logs and still answers 200 after its card was captured. The faulty assumption was that authorize+capture always finishes inside the lease. Several comments hid this. The JSDoc (`:46-52`) called "release the row lock immediately ... no lock held" the design. `:137` "MK: re-evaluation is exactly what makes it safe. the bug was in the web retry, closed". `:152` "MK: authorize+capture is under a second. 60s can't happen. unreachable", which answered FH's correct note above it.

**What it breaks:** A 4,750 fils link: buyer A's payment takes longer than the lease, buyer B re-claims and pays, and both get 200. 9,500 fils is captured for one 4,750 fils sale, and one buyer has to chase a refund. This is the 2026-05-14 incident.

**Why it needed a fix:** Acquirer latency spikes (3DS, issuer timeouts) routinely exceed short leases. Every spike can double-charge a customer.

**Fix:** `apps/api/src/paymentLinks/pay.ts`: the existing body re-enters itself once inside `withTransaction`, and the claim, both releases and finalize use that transaction's client. The claim's row lock is therefore held through authorize+capture until finalize commits.
```diff
-import type { Pool } from "pg";
+import type { Pool, PoolClient } from "pg";
+import { withTransaction } from "../db/withTransaction.js";
   input: PayPaymentLinkInput,
+  client?: PoolClient,
 ): Promise<PayPaymentLinkResult> {
+  // PL-1: re-enter inside one transaction so the claim's row lock is held until finalize.
+  if (!client) return withTransaction(pool, (c) => payPaymentLink(pool, acquirer, config, input, c));
-  const claimResult = await pool.query<ClaimedLinkRow>(
+  const claimResult = await client.query<ClaimedLinkRow>(
-    await releaseReservation(pool, link.id);   (x2)
+    await releaseReservation(client, link.id); (x2)
-  const finalizeResult = await pool.query<{
+  const finalizeResult = await client.query<{
-async function releaseReservation(pool: Pool, linkId: string)
+async function releaseReservation(pool: Pool | PoolClient, linkId: string)
```
The comments that hid the bug are corrected: JSDoc 7 lines become 3, and the `:136-138` and `:151-153` FH/MK/am notes become one accurate line each. Commit: `104c871` (PL-1), `f487401` (PL-1b). Lines: prod +15/-19 (code +9/-6, comments +6/-13), test +40/-0.

**Why this is the smallest correct fix:** It uses the same discipline `capture.ts` already relies on (a row lock held across the acquirer call), applied with nine changed code lines and no re-indentation. A concurrent claim UPDATE now blocks on the row. After the holder commits it re-evaluates against `status='paid'`, gets 0 rows, and answers 409 `payment_link_already_paid`. After a decline, the holder resets the link to `active` in the same transaction and the waiter proceeds. A crash drops the connection, Postgres rolls back, and the link is simply `active` again with nothing to steal.
- Why not the dossier's full rewrite (explicit connect/BEGIN, `FOR UPDATE NOWAIT`, 55P03 mapped to 409, try/catch/finally): it is correct but about 30 or more changed lines.
- Why not fence finalize with a holder token (`AND reserved_at = $claimed`): that only detects the loser after its capture, so money has already moved twice and a refund flow is needed. It does not prevent the incident.
- Why not just raise the timeout: it only shrinks the window.

**Proof:** The new test `PL-1: a slow payment past the reservation timeout cannot be paid twice` (`routes/paymentLinks.test.ts`) uses acquirer latency 1,500 ms and a 1 s lease, with a second pay sent at 1,200 ms. It failed before the fix with `actual: [200, 200]`, expected `[200, 409]`. After the fix it passes, with exactly one captured transaction. routes/paymentLinks + paymentLinks/pay + status: 22 pass, 0 fail, including the existing reservation-timeout replay test.

**Regression risk (first version, superseded by PL-1b below):** One payment held two pool connections (the link lock, and authorize/capture's own transaction). The claim that this is "as capture does" was wrong: capture holds one. A concurrent second buyer waits for the first instead of getting an instant 409 `payment_link_processing`. Public reads show `active` (not `reserved`) during a payment, because the reservation is never committed. authorize/capture never touch `payment_links` (only migrations 0020/0029 reference it), so there is no self-deadlock.

**Trap note:** The JSDoc design claim and the `MK:` "re-evaluation is exactly what makes it safe" / "60s can't happen. unreachable" notes are replaced with accurate one-liners citing the incident.

**PL-1b follow-up (adversarial review): the held-lock version starved the connection pool; replaced by a fenced lease.**
The version above kept the link's row lock on one pool connection while `authorizeTransaction` and
`captureTransaction` each took a second (`authorize.ts:57`, `capture.ts:94`). With `PG_POOL_MAX=5` (the default), five
concurrent payments on five different links each held one connection and waited for another: all five failed with
500 after the 3 s connect timeout (reviewer probe). That is an outage under trivial load, worse than the bug.
**Final fix (net vs. the original `pay.ts`: prod +10/−5, of which 4 lines are comments):** the claim returns its
`reserved_at` as an exact fencing token (as text: a JS `Date` would drop the microseconds). Right **before capture**, one
conditional `UPDATE ... SET reserved_at = now() WHERE id = $1 AND status = 'reserved' AND reserved_at::text = $token`
renews the lease only if this request still holds it; if a slow payment's lease expired and another buyer re-claimed
the link, it stops with 409 `payment_link_processing` before charging the card. Finalize is keyed on the renewed token,
so only the current holder can mark the link paid. One connection at a time, like the original.
**Why this, not something smaller:** a check only in finalize's WHERE (the advisor's first idea) detects the second
charge after the money has moved; the fence must sit before capture. **Why not keep the lock and pass the client into
authorize/capture:** they open their own transactions (`withTransaction(pool)`), so nesting would commit the outer
transaction early or need SAVEPOINT plumbing.
**Residual:** the stale request is left with an authorized, uncaptured transaction and its 7-day hold (the PL-5 lead).
A second charge would need the capture call alone to exceed the reservation timeout (60 s) after the fence renewed it.
**Proof:** "PL-1: a slow payment past the reservation timeout cannot be paid twice" still passes ([200, 409], one
capture). New: "PL-1: as many concurrent link payments as the pool size all succeed" (5 links, pool max 5): all 200;
the reviewer's probe on the held-lock version gave 500 ×5. Payment-link suites 22/22, `tsc` clean.
**Trap note:** `pay.ts:59-61` "YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct" (true for the
claim, false for the lease, now annotated) and "MK: ... 60s can't happen. unreachable" (corrected; FH's note above it was right).

---

<a id="f-mig-1"></a>

### MIG-1 · A fresh database cannot be built: migrations 0054/0055 abort · FP-300 (☐1, ☐6), F4 · Severity: High
**What's wrong:** `npm run migrate` on an empty Postgres stops after 51 of 66 files, so a new environment never gets the schema from 0054 onward, including the whole refund schema (0070-0072) that FP-300 needs.

**Why it happens:** both files were written on the abandoned `settlement-v2` branch against v2 tables and landed on `main` without ever running. `0054_views.sql` defines `v_unbatched_capture_events` over `settlement_batch_events`, a table that does not exist. `0055_chart_of_accounts_suspense.sql` inserts into `chart_of_accounts (code, name, account_type, description)` with kind `'suspense'`, but 0007's table is `(id, name, kind CHECK (kind IN ('asset','liability','revenue')))`. The runner (`db/migrate.ts`) wraps each file in a transaction and aborts on the first error. Runtime errors, verbatim: `migrate: failed applying 0054_views.sql: relation "settlement_batch_events" does not exist` and `ERROR: column "code" of relation "chart_of_accounts" does not exist`.

**What it breaks:** `docker compose up` (the case file's own instructions) produces a database with no refund tables and no `merchant_payable_position` view, which the settlement balance code reads (`apps/settlement/internal/ledger/refresh.go:26,62`). Eleven existing refund tests could never run: once it was fixed, they ran and exposed REF-4.

**Why it needed a fix:** nothing can be deployed (box ☐6) or tested on a clean database, and FP-300 has no schema.

**Fix:** in place (the only allowed exception to "never edit an applied migration").
```diff
-- 0054: AND NOT EXISTS (SELECT 1 FROM settlement_batch_events sbe WHERE sbe.transaction_event_id = te.id);
+- 0054: AND te.settlement_batch_id IS NULL;            -- the v1 meaning of "not yet batched" (0023)
-- 0055: INSERT INTO chart_of_accounts (code, name, account_type, description) ... 'suspense' ... ON CONFLICT (code)
+- 0055: INSERT INTO chart_of_accounts (id, name, kind) ... 'asset' ... ON CONFLICT (id)   -- descriptions kept as comments
```
Lines: SQL +7/−9, test +0/−0. Commit 197c3e2.

**Why this is the smallest correct fix:** two statements repaired where they fail. Why in place and not a later corrective migration: the runner aborts at 0054, so a later file could never be reached, and no database ever ran 0054-0056 (Yousif, `docs/HANDOVER.md:70`), so no applied history diverges. The runner stores no checksum, despite the MK comment in `db/migrate.ts`. Why kind `'asset'` and not a new `'suspense'` kind: 0007 already types the existing suspense account `scheme_rounding_residue` as `'asset'`, and nothing reads `kind`; adding a kind would be a schema change with no effect.

**Proof:** fresh database: before, abort at 0054 after 51 files; after, `migrate: 66 migration(s) applied` (now 73 with our new migrations, 0001-0098). Verified again on several fresh test databases and in the compose stack.

**Regression risk:** none for existing databases (they never applied these files).

**Trap note:** ADR-0005 says 0054-0056 are "reserved" and "not merged", yet they were on `main`. MK's HANDOVER note ("0054 ran on staging-2 ... I'm fairly sure") contradicts Yousif's own line and was not trusted.

---

<a id="f-b8"></a>

### B8 · A live acquirer signing secret is committed in a tracked env file · FP-240, H3 · Severity: High
**What's wrong:** `ops/.env.docker` is tracked by git and contained `ACQUIRER_CALLBACK_SIGNING_SECRET`, the HMAC key that authenticates acquirer callbacks.

**Why it happens:** the file's own comments claim it is ignored: "AM: this file is gitignored like .env" and "FH: ... copilot says `.env` matches `.env.docker` as a prefix". Git ignore patterns do not match by prefix: `.gitignore` lists `.env` and `.env.local` only, and `git ls-files ops` lists `ops/.env.docker`. A second comment called it a sandbox secret, "safe to keep".

**What it breaks:** anyone with the repository can sign acquirer callbacks, which mark payments as captured or failed. With CW-2's fix (signatures now required), the secret is the only thing standing between an attacker and forged callbacks.

**Why it needed a fix:** a committed secret is compromised for good: it stays in git history even after deletion.

**Fix:** the value is blanked (an empty secret fails fast in production via `config.ts:194`) and the two false comments are corrected. Real values live in the untracked `ops/.env.local`, generated with `openssl rand -base64 32`. Production template: `ops/.env.production.example` (names only). Lines: config +5/−6, test +0/−0. Commit d95d570.

**Why this is the smallest correct fix:** it removes the secret from the working tree and stops the false belief that hid it. Rewriting git history is a separate, outward-facing operation on a shared repository and was not done.

**Proof:** `git ls-files ops` shows the file tracked; `git check-ignore -v ops/.env.local` shows the new local file ignored (`.gitignore:5`); `git grep ACQUIRER_CALLBACK_SIGNING_SECRET=` finds no value.

**Regression risk:** none; compose now loads `.env.local`.

**Action required (reported):** the old value is in git history and must be **rotated with the acquirer**. Our deployments use a freshly generated value.

**Trap note:** the AM/FH comments in `ops/.env.docker` (corrected in place).

---

<a id="f-net-1"></a>

### NET-1 · Net payout computed through float32 BD · FP-300 ☐3 · Severity: High
**What's wrong:** `NetPayableFils` converted gross and fee to float32 BD, subtracted, then scaled back and rounded, so the frozen `net_payout_fils` is not `gross - fee` on large batches (13 of 80 rows in `docs/exports/settlement-batches-2026-09-01_20.csv`).

**Why it happens:** `apps/settlement/internal/settlement/payable.go:11-12` (`float32(grossFils)/1000 - float32(feeFils)/1000`, then `math.Round(...*1000)`). float32 has a 24-bit significand, so above 8,192 BD neighbouring values are ≥0.98 fils apart. The faulty assumption ("BD only needs 2 decimals", quarantined cursorrules) contradicts the case file (1 BD = 1000 fils, integer fils). `TestCloseBatchNetPayoutIsWholeFils` (batch_test.go:480) used 13,333 fils, which is float32-exact, so it could never fail.

**What it breaks:** Delta Wholesale 2026-09-10: gross 22,696,171, fee 476,620 → stored 22,219,553 instead of 22,219,551 (overpaid 2 fils). Delta Marketplace 2026-09-05: 9,334,174 instead of 9,334,173. The same figure is the merchant_payable payout debit (batch.go:342), the split base, the settlement.paid amount and the disbursement amount, so `gross - fee - net` stays stuck on merchant_payable.

**Why it needed a fix:** every batch above 8,192 BD can pay the wrong amount, the error doubles with every binade (62.5 fils spacing at 524,288 BD), and the ledger never ties to the fil.

**Fix:** `payable.go:10`
```diff
 import (
-	"math"
-
 	"github.com/filspay/settlement/internal/money"
 )
 // NetPayableFils derives the net payout from frozen gross and fee totals.
+// Integer fils only (NET-1): a float32 BD round-trip loses fils above 8,192 BD.
 func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
-	netBD := float32(grossFils)/1000 - float32(feeFils)/1000
-	return money.Fils(math.Round(float64(netBD) * 1000))
+	return grossFils - feeFils
 }
```
Commit: `27187a2`. Lines: prod +2/-4, test +25/-1.

**Why this is the smallest correct fix:** the single function every caller uses (batch.go:219) now does integer subtraction; signature unchanged. Why not float64: it would still be a float in money code, and the case file requires integer fils. Why not fix at batch.go:219: other callers would keep the float path. Historic paid batches are not rewritten here (correction journals are a separate, ops-approved step).

**Proof:** `TestNetPayableFilsIsExactGrossMinusFee` (payable_audit_test.go) failed before: `NetPayableFils(22696171, 476620) = 22219553, want 22219551`, `NetPayableFils(9564315, 230142) = 9334174, want 9334173`, `NetPayableFils(20893037, 438754) = 20454281, want 20454283`. It passes after; `go test ./internal/settlement/` is green.

**Regression risk:** only `CloseBatch` calls it; net now equals gross − fee exactly, which `apps/api/src/settlement/query.ts:50-52` already documents as the invariant. Covered by the settlement package tests (CloseBatch/PayoutBatch).

**Trap note:** the test comment "FH 2026-08-21: asked claude for an edge case, it said 13333 exercises the float rounding path" (batch_test.go:480) was false (13,333 is float32-exact); it now says so and points at the new test.

---

<a id="f-cw-3"></a>

### CW-3 · Outbound webhook signature does not cover the bytes actually sent · FP-240, FP-300 ☐4 · Severity: High

**What's wrong:** The dispatcher and test-send sign `${t}.${canonicalJson(payload)}` (keys sorted) but post `JSON.stringify(payload)` (JSONB key order), so a receiver verifying HMAC(t + "." + rawBody), the normal `t=,v1=` practice, always gets a mismatch.

**Why it happens:** `apps/api/src/webhooks/sign.ts:36` signs `canonicalJson(payload)`; `apps/api/src/webhooks/dispatcher.ts:172` sent `JSON.stringify(row.payload)`, where `row.payload` comes back from the JSONB column `webhook_deliveries.payload` (0022) with keys reordered shortest-first; `apps/api/src/webhooks/testSend.ts:62` did the same with a literal `{id,type,createdAt,data}`. Faulty assumption: "the payload is the same object, so the bytes are the same". Hidden by `dispatcher.test.ts:171` and `testSend.test.ts:106`, which `JSON.parse` the body and re-canonicalize before verifying (FH comments `dispatcher.test.ts:131` "signing is proven correct", `testSend.ts:31` "signs exactly the bytes it sends").

**What it breaks:** A `transaction.captured` delivery is sent as `{"id":…,"data":{"status":"captured","feeFils":71,…},"type":…,"createdAt":…}` but the MAC covers `{"createdAt":…,"data":{"amountCapturedFils":4750,…},"id":…,"type":…}`. A raw-body verifier answers 401, the row is retried `webhookMaxAttempts` times and exhausted; merchants either drop verification (accepting forged webhooks) or re-serialize like V8 does.

**Why it needed a fix:** FP-240/FP-300 require the shop to receive a webhook it can verify; today every delivery to a correctly written receiver fails.

**Fix:** `apps/api/src/webhooks/dispatcher.ts:7,173` and `apps/api/src/webhooks/testSend.ts:5,63`:
```diff
+import { canonicalJson } from "../payments/idempotency.js";
-    body: JSON.stringify(row.payload),
+    body: canonicalJson(row.payload), // CW-3: the exact string signPayload signed (FP-240)
-    body: JSON.stringify(testPayload),
+    body: canonicalJson(testPayload), // CW-3: the exact string signPayload signed (FP-240)
```
Commit: `96d0f80`. Lines: prod +4/-2, test +9/-2.

**Why this is the smallest correct fix:** The sent body is the single point that diverges; `canonicalJson` is the exact serializer `signPayload` already uses, so signed string == sent string. It is also deterministic over the stored JSONB row, so a disputed delivery can be byte-reproduced from `webhook_deliveries.payload`. Why not a new `signBody(body)` helper in sign.ts plus a `verifySignature(rawBody)` signature change: more lines, new API, and changes every verifier call site (incl. routes tests we do not own). Why not change `signPayload` to `JSON.stringify`: the JSONB round-trip order would then differ between first attempt and replays.

**Proof:** `dispatcher.test.ts` "one active endpoint, 2xx response: … signature verifies with the raw secret" and `testSend.test.ts` "the signature this call site produces verifies against the endpoint's own raw secret" now also check `createHmac(secret).update(`${t}.${req.body}`) === v1`. Before: `AssertionError: signature must cover the exact bytes sent` (expected `17a3abbf…`, actual `3f315774…`). After: both pass.

**Regression risk:** Body is still valid JSON with the same keys/values, so receivers that `JSON.parse` are unaffected; `verifySignature` (parse + canonicalize) still passes. Covered by `dispatcher.test.ts`, `testSend.test.ts`, `sign.test.ts`, `archiveReplay.test.ts` (all green except the pre-existing jitter assertion, fixed separately).

**Trap note:** The FH comment at `dispatcher.test.ts:131` ("signing is proven correct") is now followed by a CW-3 correction line, and the test asserts on the raw bytes; `testSend.ts:31` ("signs exactly the bytes it sends") is now true. Not owned here and still to correct: `outbox.ts:92` MK note and `docs/RUNBOOK.md:95-97` (re-serialize workaround), and `routes/webhooks.test.ts:307,:519` still verify via `JSON.parse`.

---

<a id="f-ref-4"></a>

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
Commit: `013f6da`. Lines: prod +1/-1, test +4/-2.

**Why this is the smallest correct fix:** It changes one token at the point where NULL is made, and it uses the same value 0070 already chose as the default.
- Why not drop `reason` from the column list: then a reason the caller does give would never be stored.
- Why not drop or relax the CHECK in a new migration: "a refund always has a reason" is a sound rule, and weakening the schema to fit a bug is the wrong direction.
- Why not make `reason` required in the API: that changes the contract and breaks every existing caller.

**Proof:** On the migrated test DB, before the fix 11 refund tests in `payments/processRefund.test.ts` and `refunds/initiateMerchantRefund.test.ts` failed with `new row for relation "refunds" violates check constraint "chk_refunds_reason_not_null"`. The fix is one constraint fix, and it turned all 11 green. `a full refund of a fully captured transaction lands on refunded` now also asserts `reason === "unspecified"`. Result: processRefund + initiateMerchantRefund + refundValidation + refundState give 34 pass, 0 fail.

**Regression risk:** None found. A caller-supplied reason is still stored unchanged, and the request hash still uses `input.reason ?? null` (`:48`), so idempotent replays are not affected. Covered by the 4 refund test files above.

**Trap note:** The comment at `0070:3-4` ("add a constraint to catch application code that accidentally passes NULL") presents the CHECK as a safety net, but `processRefund` passes NULL by construction. The tests were evidently written against a schema without 0070, which had never applied before. Migration 0070 is applied history and is left unchanged. The first test now pins the default value.

---

<a id="f-scheme-1"></a>

### SCHEME-1 · Scheme amount is the untruncated gross rounded half-up by NUMERIC(10,2) · F1, ADR-0002 · Severity: High
**What's wrong:** CloseBatch writes `scheme_export_lines.amount` (the figure the scheme file carries) from the untruncated gross, so Postgres `NUMERIC(10,2)` rounds it half-up while `amount_fils` holds the truncated value. The statement is "always over, never under".

**Why it happens:** `apps/settlement/internal/settlement/batch.go:255` passed `SchemeAmountBD(line.grossFils)` (float64 gross/1000) instead of the `truncated` value computed on the line above. `LoadSchemeExportLines` (scheme_export.go:71) prefers `amount` over `amount_fils`, so the file quotes the rounded figure. The test `TestSchemeExportAmountHasTwoDecimals` only checked the format with a regex; its comment "am: 4747 -> "4.75" passes the regex ... it rounds. whatever" waved the bug through.

**What it breaks:** 4,747 fils exports as 4.75 BD (claims 3 fils more than captured); 1,005 fils exports as 1.01 BD (+5 fils). For the test batch of 4,747 + 1,005 + 4,740 + 12,344 fils, the file claims 22.83 BD, while ADR-0002 truncation gives 22.82 BD and `amount_fils` sums to 22,820. Up to 5 fils per line is claimed from the scheme that was never captured, and the file disagrees with `amount_fils`.

**Why it needed a fix:** ADR-0002 (trusted) says to truncate each line to a multiple of 10 fils and journal the residue. Rounding up over-claims from the card scheme on every line ending in 5-9 fils, and the scheme report never reconciles with the ledger.

**Fix:** `batch.go:254-255`
```diff
-			VALUES ($1, $2, $3, $4, $5)
-		`, batchID, line.transactionID, int64(truncated), SchemeAmountBD(line.grossFils), i+1)
+			VALUES ($1, $2, $3, $3::bigint::numeric / 1000, $4)
+		`, batchID, line.transactionID, int64(truncated), i+1) // ADR-0002: truncated amount, never rounded gross
```
Commit: `d1e6cbb`. Lines: prod +2/-2, test +49/-1.

**Why this is the smallest correct fix:** one INSERT now derives `amount` from the same truncated `amount_fils`, exactly and float-free (integer → numeric division in SQL). Why not `SchemeAmountBD(truncated)`: still a float in money code, against the case file. Why not drop the `amount` column or rewrite `LoadSchemeExportLines`: a larger diff, and other readers (migration 0050, views) use `amount`. `SchemeAmountBD` is now unused but left in place to keep the diff minimal (safe to delete later). Rows already written need the data repair `UPDATE scheme_export_lines SET amount = amount_fils::numeric/1000 WHERE amount <> amount_fils::numeric/1000` (ops-approved, not run here).

**Proof:** `TestSchemeExportAmountIsTruncatedFils` (scheme_export_audit_test.go) failed before: `amount = "4.75" for amount_fils 4740, want "4.74"` and `amount = "1.01" for amount_fils 1000, want "1.00"`. It passes after; `go test ./internal/settlement/` is green.

**Regression risk:** only the scheme_export_lines INSERT changes. The CHECK `amount_fils % 10 = 0` still holds (unchanged arg). The format test `TestSchemeExportAmountHasTwoDecimals` still passes ("4.74" matches `\d+\.\d{2}`). The residue (gross − truncated) is journaled by SCHEME-2.

**Trap note:** the test comment in scheme_export_test.go:18 ("is 4.75 right for 4747 fils?? it rounds. whatever, scheme wants 2dp") and YA's unanswered question in scheme_export.go:21 ("where does the third go?") are the cover. The test comment is now corrected to cite ADR-0002 and the new test.

---

<a id="f-admin-test-1"></a>

### ADMIN-TEST-1 · "Recompute statuses" silently takes sandbox merchants live · G3, H7 · Severity: High
**What's wrong:** The finance backfill `POST /v1/admin/merchants/:id/transactions/recompute-statuses` sets `merchants.test_mode = false` as a side effect, so a sandbox merchant's fake captures enter the next real settlement run and are paid out.

**Why it happens:** After recomputing statuses, the route calls `reconcileSandboxFlag` (`apps/api/src/routes/adminMerchantsRecompute.ts:28` → `apps/api/src/admin/merchantFlags.ts:10-16`), which clears `test_mode` when `openAuthorizations === 0`. That counter can never be non-zero: `transactionStatusRecompute.ts:29` selects `status NOT IN ('authorized','voided')` and `:47` then counts rows whose status is `'authorized'` inside that set. Any sandbox merchant with one captured transaction is therefore switched live. Settlement's only sandbox guard is `test_mode = false` (`apps/settlement/internal/settlement/batch.go:408`), so the flip alone is enough to settle it. The response shows `flagsUpdated: ["test_mode"]`, but the console only displays scanned/updated.

**What it breaks:** Worked example (seed: Gamma Hospitality, test_mode, 320 bps): one sandbox day of 1,250,000 fils closes with a 40,000-fil fee and a **real payout of 1,210,000 fils (1,210.000 BD)** for money that was never collected. This is G3 ("test merchants keep showing up in the real settlement run") and H7 ("what happens to test merchants when certain admin tools run?").

**Why it needed a fix:** Real money leaves the platform for sandbox traffic, and the operator gets no visible signal.

**Fix:** `apps/api/src/routes/adminMerchantsRecompute.ts`
```diff
-import { reconcileSandboxFlag } from "../admin/merchantFlags.js";
-        const flagsUpdated = await reconcileSandboxFlag(client, request.params.id, recompute);
+        const flagsUpdated: string[] = []; // G3/H7: a status backfill must never take a sandbox merchant live
```
The response and audit-log shapes are unchanged (`flagsUpdated` is now always `[]`). Lines: prod +1/−2, test +72/−0.

**Why this is the smallest correct fix:** going live is a business decision, not a by-product of a status backfill, so the call is removed at its one call site. Why not fix the counter (count authorized rows correctly)? A merchant with no open authorizations would still be switched live by a backfill, which is the same bug under a narrower condition. Why not delete `merchantFlags.ts`? It adds 21 deleted lines for no behaviour change; it is now unreferenced.

**Proof:** `adminMerchantsRecompute.audit.test.ts` "recompute-statuses leaves a sandbox merchant in test_mode" fails before (`+ actual ['test_mode'] - expected []`) and passes after. `routes/admin.test.ts` still passes (42/42 together).

**Regression risk:** none for live merchants (the function only ever set the flag to false). Merchants already flipped by past runs must be found and reset by finance (for example Gamma Hospitality after the 2026-09-19 recompute, advisor §9 Q4).

**Trap note:** `merchantFlags.ts:3` "Clears the sandbox flag when a merchant has no open authorizations" describes a condition that can never be false. `docs/ADMIN.md:41-43` "Safe to run more than once" and `apps/admin/src/api/merchants.ts:58` (YA) "idempotent and safe to rerun" are false comfort. No test covered the route.

---

<a id="f-scheme-2"></a>

### SCHEME-2 · ADR-0002 truncation residue is never journaled at close · F1, F2, ADR-0002 · Severity: High
**What's wrong:** CloseBatch truncates every scheme line to a multiple of 10 fils, but the difference (gross − amount_fils) is never posted to the ledger, so the ledger cannot tie to the scheme file.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:250-258`: the line loop inserts `scheme_export_lines` and moves on. ADR-0002's "Implementation notes" claim the residue is "implemented inside CloseBatch alongside the scheme_export_lines insert (March 2026)", and "no month-end sweep is needed from April onwards", but no code posts it (`grep scheme_rounding_residue apps/settlement` found only the chart-of-accounts seed in migration 0007). YA's comment at scheme_export.go:21 ("where does the third go? asked twice. told to leave it") is the unanswered question.

**What it breaks:** a 4,747-fils capture is exported as 4,740 fils; the 7 fils never appear in `card_scheme_clearing` / `scheme_rounding_residue`. Across a month this is a few BD per busy merchant (ADR-0002 context) that finance cannot reconcile against the scheme statement, and nobody runs the month-end sweep because the ADR says it is no longer needed.

**Why it needed a fix:** the case file (F1/F2) and ADR-0002 Option A require one balanced residue group per line at export. Without it the clearing account drifts from the scheme settlement by the sum of the residues, forever.

**Fix:** `batch.go:259-265` (inside the line loop, same transaction as the export line)
```diff
+		if residue := line.grossFils - truncated; residue > 0 { // ADR-0002: journal the truncation residue
+			_, err = tx.Exec(ctx, `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
+				VALUES ($1, $2, $3, 'card_scheme_clearing', 'credit', $4, now(), 'scheme rounding residue'), ($1, $2, $3, 'scheme_rounding_residue', 'debit', $4, now(), 'scheme rounding residue')`, uuid.New(), merchantID, line.transactionID, int64(residue))
+			if err != nil {
+				return BatchResult{}, fmt.Errorf("settlement: CloseBatch: journal scheme residue: %w", err)
+			}
+		}
```
Commit: `ffdf52b`. Lines: prod +7/-0, test +37/-0.

**Why this is the smallest correct fix:** one balanced two-leg group per line, posted exactly where `truncated` is computed and inside the close transaction (so the batch and its residue commit or roll back together; the deferred balance trigger in 0007 checks the group). Legs match the ADR-0002 table (card_scheme_clearing credit, scheme_rounding_residue debit). `settlement_batch_id` is left NULL (the line is linked by `transaction_id`) so the existing "exactly 2 payout legs per batch" assertions stay valid. Why not a month-end sweep: ADR-0002 rejected it (Option A chosen). Why not one group per batch: ADR-0002 asks for per-line auditability. Historic batches (April onwards) need a one-off correction journal, which is ops-approved and not done here.

**Proof:** `TestCloseBatchJournalsSchemeRoundingResidue` (scheme_residue_audit_test.go) failed before: `residue legs: scheme_rounding_residue debit 0, card_scheme_clearing credit 0, want 7 each`. It passes after; the settlement, ledger and internalapi packages are green.

**Regression risk:** adds ledger rows only for lines whose gross is not a multiple of 10 fils. merchant_payable is untouched, so payouts and balances are unaffected. Covered by the settlement/ledger/internalapi package tests.

**Trap note:** ADR-0002's own "Implementation notes" say this is already implemented in CloseBatch; it was not. This note records the false claim. Depends on SCHEME-1 (the file amount must be exactly amount_fils/1000 for the residue to be right).

---

<a id="f-cw-2"></a>

### CW-2 · Acquirer callbacks accepted without a signature by default · FP-240 · Severity: High

**What's wrong:** `POST /v1/acquirer/callbacks` is public and the HMAC header is its only authentication, yet `verifyAcquirerCallbackSignature` returned `{ valid: true }` when the header was missing unless `requireSignature` was set, and `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` defaulted to `false`.

**Why it happens:** `apps/api/src/webhooks/inboundVerify.ts:50` `requireSignature = false` and `:52-56` turned a missing header into `{ valid: true }`; `apps/api/src/config.ts:259` `parseBoolEnv(env.ACQUIRER_CALLBACK_REQUIRE_SIGNATURE, false)`, and nothing in compose/env sets it. An empty secret (allowed outside production, `config.ts:193`) also yields an HMAC anyone can compute. Hidden by `app.ts:71` FH ("inboundVerify rejects unsigned requests, so OK"), `config.ts:119` ("Set true once the sandbox signs everything"), `routes/acquirerCallbacks.test.ts:122-139` (asserted 200 for an unsigned callback as "dev-mode behaviour … prod rejects — MK"; prod did not reject) and `inboundVerify.test.ts:49-53`.

**What it breaks:** Anyone who knows a transaction UUID (the cardholder gets it from the pay response) can POST `{callbackId, type:"fraud_review.completed", transactionId, outcome:"cleared", note:"Manual review cleared"}` with no header and get `200 {received:true}`: a forged fraud verdict stored against a real merchant and acted on by support/finance.

**Why it needed a fix:** FP-240: forged acquirer verdicts can pre-clear stolen-card payments or plant "confirmed_fraud" on legitimate ones.

**Fix:** `apps/api/src/webhooks/inboundVerify.ts:45-51`:
```diff
-/** Verifies the acquirer callback signature when present and required. */
+/** Verifies the acquirer callback signature; a missing header or empty secret is rejected (CW-2, FP-240). */
 ...
   secret: string,
-  requireSignature = false,
 ): VerifyAcquirerCallbackResult {
-  if (!header) {
-    return requireSignature
-      ? { valid: false, reason: "malformed_header" }
-      : { valid: true };
-  }
+  if (!header || !secret) return { valid: false, reason: "malformed_header" };
```
plus removal of the now-dead flag: `routes/acquirerCallbacks.ts:61` (argument), `config.ts:119-120,259` (field, its misleading comment, parse). Commit: `85f6d2f`. Lines: prod +2/-11, test +9/-12.

**Why this is the smallest correct fix:** The verifier is the single place the decision is made. Why not only flip the default to `true` (`config.ts:259`): one env var could silently re-open the hole, and an empty dev secret would still verify forged HMACs. Why keep the flag but ignore it: a dead knob documented as a switch is a new trap. Rotating the committed secret (`ops/.env.docker`) is an ops action outside this lane (see B8 commit).

**Proof:** `routes/acquirerCallbacks.test.ts` "POST /v1/acquirer/callbacks rejects a callback sent without a signature header": before `expected 401, actual 200`; after passes (401 `invalid_signature`, 0 notes stored). `inboundVerify.test.ts` "an unsigned callback, or an empty secret, is rejected (malformed_header)": before `{valid:true}`; after passes.

**Regression risk:** Any unsigned caller is now rejected; no in-repo sender posts callbacks (grep). Covered by `inboundVerify.test.ts`, `routes/acquirerCallbacks.test.ts`, `acquirer/callbacks.test.ts` (14/14), `tsc --noEmit` clean.

**Trap note:** The two tests that asserted acceptance were rewritten to assert rejection, citing CW-2/FP-240; the `config.ts:119` comment was removed with the flag. Not owned here: `app.ts:71` FH comment is now true but should cite CW-2; `docs/ARCHITECTURE.md:91` and CHANGELOG still document the flag.

---

<a id="f-ref-5"></a>

### REF-5 · Status recompute turns chargebacks back into refundable captures · H7, H1, FP-300 · Severity: High
**What's wrong:** The same finance backfill rewrites every `chargeback` transaction to `captured` / `partially_refunded` / `refunded`, erasing the chargeback and making the money refundable again.

**Why it happens:** `recomputeTransactionStatusesForMerchant` (`apps/api/src/admin/transactionStatusRecompute.ts:29`) selects every row whose status is not `authorized` or `voided`, so chargebacks are included. It then sets each row to `nextStatusAfterRefund(...)` (`:38-44`), a function that only knows captured/partially_captured/partially_refunded/refunded and can never return `chargeback`. So the backfill "corrects" a chargeback into a capture.

**What it breaks:** A 10,000-fil transaction that was charged back (the acquirer already pulled the 10,000 fils back) becomes `captured`, which is in `REFUNDABLE_STATUSES` (`refundValidation.ts:18`). Once FP-300 ships, the merchant can refund it, so the cardholder is paid twice (chargeback + refund = 20,000 fils out for one 10,000-fil sale). Reports and the timeline also lose the chargeback.

**Why it needed a fix:** It is a direct double-payout path once refunds go live, and the backfill is presented to finance as safe to rerun.

**Fix:** `apps/api/src/admin/transactionStatusRecompute.ts:29`
```diff
-      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided')
+      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided', 'chargeback')
```
Lines: prod +1/−1, test +23/−0.

**Why this is the smallest correct fix:** a chargeback is a terminal state that amounts cannot recompute, so it must not be a candidate at all. One literal in the WHERE clause does that. Why not teach `nextStatusAfterRefund` about chargebacks? It is the shared refund state machine (FP-300 uses it), and widening its contract is a larger, riskier change.

**Proof:** `adminMerchantsRecompute.audit.test.ts` "recompute-statuses leaves chargeback transactions as chargeback" fails before (`expected: 'chargeback', actual: 'captured'`) and passes after; the file plus `routes/admin.test.ts`: 43/43.

**Regression risk:** chargeback rows are no longer counted in `scanned`; nothing else reads that count for chargebacks.

**Trap note:** `docs/ADMIN.md:41-43` "Safe to run more than once" and the YA "idempotent" note (`apps/admin/src/api/merchants.ts:58`): it is idempotent only because it destroys the chargeback state on the first run.

---

<a id="f-bal-1"></a>

### BAL-1 · Admin "rebuild cached balances" rebuilds from scheme export lines, not the ledger · F4, FP-203 · Severity: High
**What's wrong:** the admin console's rebuild button (`POST /internal/rebuild-balances`) overwrote every merchant's `merchant_balances.cached_payable_fils` with the sum of `scheme_export_lines` (the `merchant_payable_position` view), while the CLI `settlement rebuild-balances` walks `ledger_entries`. The two disagree, and the button's figure is not a balance.

**Why it happens:** `apps/settlement/internal/internalapi/server.go:268` called `ledger.RefreshBalanceCache`, whose query (`internal/ledger/refresh.go:26,62`) reads `merchant_payable_position` (migration 0054: SUM of export lines). The CLI (`cmd/settlement/main.go:162`) calls `ledger.RebuildAllBalances` (`rebuild.go:100-105`: SUM of merchant_payable credits − debits). Export lines are gross, never net of fee, never reduced by payouts, and omit every unbatched capture, credit, adjustment or refund. Hidden by `refresh.go:15-16` ("from the settled position"), by ADR-0004 (MK-only, untrusted: "It reflects what actually left the..."), and by `TestRebuildBalances_ValidToken`, which pinned the export total ("FH: 12000 = export total = what support sees in the console, so the test is right") with an export line equal to the ledger balance, so it could not tell the two apart.

**What it breaks:** Alpha Retail: CLI ≈ 135,000 BD (135,000,000 fils), button ≈ 7,000 BD (7,000,000 fils). A 100.000 BD capture at 2.5%, closed and paid, has a ledger balance of 0 fils, but the button writes 100,000 fils. It also wipes the cache deltas from Recalculate MDR, credits and imports (FP-203: support "re-adjusted" balances by hand on 15 Sept).

**Why it needed a fix:** support and payouts read the cached balance. One click silently rewrites every merchant to a wrong figure, and the case file (F4) says the CLI's ledger walk is the source of truth.

**Fix:** `server.go:268`
```diff
-		diffs, err := ledger.RefreshBalanceCache(r.Context(), pool)
+		diffs, err := ledger.RebuildAllBalances(r.Context(), pool) // BAL-1 (F4): same ledger walk as the CLI
```
`refresh.go:15-16` doc comment corrected to say it reads scheme_export_lines, not the ledger.
Commit: `aae0aed`. Lines: prod +3/-3 (1 code line, 2 comment lines), test +5/-5.

**Why this is the smallest correct fix:** one call site switches to the function the CLI already uses. It has the same signature and return type (`map[uuid.UUID]RebuildDiff`), so the response shape and the TS client are unchanged. Why not rewrite the 0054 view to read the ledger: it would change every other reader of the view, and it is a migration plus SQL. Why not delete refresh.go and refresh_test.go: they are now unreferenced, and deleting them is about 150 lines of churn with no behaviour change, so they are left for a cleanup PR, with the comment corrected so nobody rewires them.

**Proof:** `TestRebuildBalances_ValidToken` (internalapi/server_test.go), corrected per F4 (export line 11,990 vs ledger 12,000), failed before: `after = 11990, want 12000 (the ledger merchant_payable balance, F4)` and `persisted cached_payable_fils = 11990, want 12000`. It passes after; the internalapi and ledger packages are green.

**Regression risk:** the endpoint now does the CLI's per-merchant ledger walk in one transaction (already used in prod by the CLI; on a timeout the context cancels and the txn rolls back). `refresh_test.go` still tests `RefreshBalanceCache` in isolation; it no longer pins any product behaviour.

**Trap note:** ADR-0004 (MK-only; not in the trusted list) "accepts" the export-line source; it contradicts the case file F4 and was not followed. The "FH: ... so the test is right" comment and the "scheme-export-derived total" assertion message were corrected to cite F4.

---

<a id="f-f2-sweep"></a>

### F2-SWEEP · The March residue sweep doubles the gap every time it is re-run · F2 · Severity: High
**What's wrong:** `scripts/reconcile_march.ts` has no run-once guard. Each run posts a fresh correction group per merchant, so running it twice doubles the write-off. That is exactly what Finance saw on staging ("ran it twice ... the gap doubled").

**Why it happens:** `postResidueCorrection` (`scripts/reconcile_march.ts:72-82`) inserts the merchant_payable debit / scheme_rounding_residue credit under `entryGroupId = randomUUID()` (`:74`), so a different id every run. Nothing checks for an earlier sweep, and `ledger_entries` has no unique key that could reject a repeat (0007). The comment directly above (`:71`, "am: re-running is safe, entry_group_id dedupes it") claims the opposite. The log can't tell either: the script prints `toISOString()` (always `Z`), so the "+03:00" timestamp FH quotes (`:92`) did not come from this code path, and a single log line proves nothing.

**What it breaks:** Worked number: a merchant with 17 fils of March residue is debited 17 fils on the first run and 34 on the second. Every extra run takes the residue again from the merchant's payable balance, and the ledger gives no sign of the repeat. Answer to Finance's question "Is it safe to run again?": **before this fix, no**; after it, a re-run posts nothing for merchants already swept.

**Why it needed a fix:** A one-off finance tool that silently doubles a ledger write-off when re-run is a money bug, and F2 says it may already have run more than once in production.

**Fix:** `scripts/reconcile_march.ts`
```diff
-// am: re-running is safe, entry_group_id dedupes it
-async function postResidueCorrection(...)
+// AUDIT (F2): re-running was NOT safe: entry_group_id is a fresh randomUUID per run, so nothing deduped
+export async function postResidueCorrection(...)
   ...
   const description = "March 2026 scheme rounding residue sweep — manual recon per finance";
+  const alreadySwept = await client.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1 AND description = $2 LIMIT 1`, [merchant.merchantId, description]);
+  if (alreadySwept.rowCount) return; // run-once per merchant: a second run posts nothing
```
(`export` only makes the function testable.) Lines: prod +4/−2, test +31/−0.

**Why this is the smallest correct fix:** one existence check at the single place that posts, keyed on what makes a sweep unique (merchant plus the month-specific description). Why not a deterministic entry_group_id? Without a unique index nothing would reject the duplicate, so it would need a new migration too. Why not a unique index on description? It is a schema change for a one-off script.

**Proof:** `scripts/reconcile_march.audit.test.ts` "re-running the March residue sweep posts nothing the second time" fails before (`expected: 1, actual: 2` correction groups) and passes after. With the existing sweep tests: 4/4.

**Regression risk:** a first run behaves as before. Two runs started at the same instant could both pass the check (no lock), which is acceptable for a manual one-off; ADR-0002's residue journal at export (SCHEME-2) removes the need for sweeps altogether. To find past double runs in production: `SELECT merchant_id, count(DISTINCT entry_group_id) FROM ledger_entries WHERE description LIKE 'March 2026 scheme rounding residue sweep%' GROUP BY 1 HAVING count(DISTINCT entry_group_id) > 1;`. Open finance question (not changed): ADR-0002's residue legs run card_scheme_clearing → scheme_rounding_residue, while this script charges the residue to merchant_payable. The month window is also UTC (`monthBounds`), not Bahrain time.

**Trap note:** `:71` "re-running is safe, entry_group_id dedupes it" (false; corrected in place). The header ("Run manually, once") was the only guard.

---

<a id="f-mdr-1"></a>

### MDR-1 · MDR recalculation re-prices PAID batches in place · F5 · Severity: High
**What's wrong:** `RecalculateMDR` selected every batch with `status <> 'open'`, so `paid` batches were included. For each one it rewrote `settlement_batches.fee_fils` and `net_payout_fils` at the merchant's current flat rate and posted an adjustment against the already-paid batch.

**Why it happens:** `apps/settlement/internal/settlement/recalculate_mdr.go:67` `AND status <> 'open'`. The only statuses are `open`, `closed` and `paid` (migration 0006 CHECK), so this means "closed or paid". `:107-111` then UPDATEs the batch row. The doc comment (`:19-21`, "so the original batch's figures stay as they were paid") and the note at `:104` ("am: posts against the OLD batch id ... fixed in FP-244 i think") claimed paid history was safe; it was not.

**What it breaks:** a 10,000-fils capture at 250 bps closes with fee 250 and net 9,750 and is paid 9,750. After a rate change to 300 bps, recalculation sets the paid batch to fee 300 and net 9,700 and posts 50 fils against it. The bank instruction, the batch_closed webhook and the statement no longer match the stored row, and the ledger moves 50 fils off a batch that has already left.

**Why it needed a fix:** paid figures are an external record. Rewriting them breaks reconciliation with the bank and the merchant's statement (F5) and silently changes merchant balances for periods already settled.

**Fix:** `recalculate_mdr.go:67`
```diff
-		   AND status <> 'open'
+		   AND status = 'closed' -- MDR-1 (F5): never re-price a paid batch
```
and the misleading note at `:104` is replaced with `// MDR-1 (F5): only 'closed' (unpaid) batches get here; a paid batch is never re-priced.`
Commit: `3df94da`. Lines: prod +2/-2 (1 code line, 1 comment line), test +39/-0.

**Why this is the smallest correct fix:** the single WHERE clause that admits paid batches. The `FOR UPDATE` on the same select locks the rows, so a batch cannot become paid between the scan and the UPDATE within this transaction. Why not add `AND status='closed'` to the UPDATE too: redundant under the row lock. Why not turn paid-batch corrections into current-period adjustments: that is a feature (a new posting path), not the minimal fix; the case file only requires paid batches not to be rewritten. Not addressed here (separate lead): the recomputation uses the flat `merchants.mdr_bps`, not the fee schedule or tier bonus that CloseBatch uses.

**Proof:** `TestRecalculateMDR_PaidBatchUntouched` (recalculate_mdr_audit_test.go) failed before: `adjusted 1 paid batch(es), want 0` and `paid batch fee_fils = 300, want unchanged 250`. It passes after. The existing `TestRecalculateMDR_*` tests (closed-only batches) still pass, and `go test ./internal/settlement/` is green.

**Regression risk:** closed-but-unpaid batches are recalculated exactly as before. Admin-triggered recalcs over paid periods now return zero adjustments; ops must post any agreed correction as a new adjustment. Data repair for past damage: restore paid batches' fee/net from their payout legs (ops-approved, not run here).

**Trap note:** the comments at recalculate_mdr.go:19-21 and :104 implied paid history was protected ("fixed in FP-244 i think"); the :104 note is replaced with the actual rule.

---

<a id="f-cw-5"></a>

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
Commit: `b43c940`. Lines: prod +12/-1 (TS +2/-1, SQL +10), test +14/-0.

**Why this is the smallest correct fix:** The database is the only place that is race-free (the concurrent half of the test proves a SELECT-then-INSERT check would not be). Per-transaction key matches the FP-201 symptom and stays safe if the acquirer reuses ids across transactions. The route still returns 200 on a redelivery so the acquirer stops retrying. Why not a `processed_events` table: new table + code path for the same guarantee. Why not drop `withCallbackRetry`: the insert is now idempotent, so the retry is harmless.

**Proof:** `acquirer/callbacks.test.ts` "applyAcquirerCallback records a redelivered callback once (sequential and concurrent)": before `expected 1, actual 5`; after passes. `routes/acquirerCallbacks.test.ts` still green (11/11 across both files).

**Regression risk:** The migration's DELETE removes historical duplicate notes (identical redeliveries; earliest kept). Unique index build takes a brief lock on a small table (CONCURRENTLY is not possible inside `db/migrate.ts`'s transaction). Covered by both callback test files.

**Trap note:** The false "deduplicated" claims (CHANGELOG, HANDOVER.md:63, 0051:29-31 MK, postmortem #1/#9) are not editable here (docs/applied migration outside this lane); this note and the migration header record the correction.

---

<a id="f-close-1"></a>

### CLOSE-1 · run-batch closes and pays a business day that has not ended · H5 · Severity: High
**What's wrong:** `CloseBatch` (and so `RunDailyBatch`, the `run-batch` CLI, `POST /internal/run-batch` and the daemon) accepted today's or a future date. It closed and paid the batch with the volume captured so far, and every later capture of that day was stranded.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:60-62`: CloseBatch computed `[start, end)` from `BusinessDayWindow` but never compared `end` with the current time. A batch that is closed or paid is skipped on the next run (`ON CONFLICT ... DO NOTHING` plus status checks), so captures after the early close never get a `settlement_batch_id`. ADMIN.md:73-75 ("re-running is always safe"), RUNBOOK:44-45 and ARCHITECTURE:51-52 told operators it was safe.

**What it breaks:** admin re-run of 2026-09-01 at 08:26 Bahrain (seen in the audit log): every merchant's 09-01 batch is paid on 00:00-08:26 volume only. For Alpha Retail (~3,932 BD/day) about 2,550 BD (2,550,000 fils) stays on merchant_payable, never batched or paid, and nothing reports it.

**Why it needed a fix:** a single early click (or an early daemon tick, see SCHED-1) permanently strands a day's later captures, and merchants are underpaid with no alert.

**Fix:** `batch.go:62-64`
```diff
 	start, end := BusinessDayWindow(businessDate)
+	if time.Now().Before(end) { // CLOSE-1 (H5): never close a Bahrain business day that has not ended
+		return BatchResult{}, fmt.Errorf("settlement: CloseBatch: business day %s has not ended (Asia/Bahrain)", businessDate.Format("2006-01-02"))
+	}
```
Commit: `56cdd1f`. Lines: prod +3/-0, test +25/-0.

**Why this is the smallest correct fix:** CloseBatch is the single function every entry point funnels through, and it already has the Bahrain window end in hand. The check happens before any write, so nothing is created for an unfinished day. Why not guard only RunDailyBatch (dossier option): direct CloseBatch callers would stay open. Why not validate in server.go/main.go: there are three entry points to patch instead of one. The HTTP layer returns its existing 500 `run_batch_failed`; mapping it to 409 is a nice-to-have in the TS/admin layer.

**Proof:** `TestRunDailyBatch_RefusesUnfinishedBusinessDay` (close_window_audit_test.go) failed before: `RunDailyBatch for today's (unfinished) Bahrain business day succeeded, want an error` and `1 batch(es) closed/paid for an unfinished business day, want 0`. It passes after. The settlement, internalapi and scheduler packages are green; every existing test closes past dates.

**Regression risk:** any caller passing the current Bahrain date now gets an error. The daemon passes the previous Bahrain day once SCHED-1 is fixed; before SCHED-1, its UTC-based "yesterday" is always a day that has ended in Bahrain too, because UTC lags Bahrain. Repair for past early closes: settle captures with `settlement_batch_id IS NULL` whose day's batch is closed or paid, via an adjustment batch (ops-approved).

**Trap note:** ADMIN.md, RUNBOOK and ARCHITECTURE "re-runs are always safe" are docs outside apps/settlement and are not edited here; the coordinator should correct them (see report).

---

<a id="f-hold-1"></a>

### HOLD-1 · Nightly hold janitor deletes every hold on a night with nothing expired · (no case ref; data integrity) · Severity: High
**What's wrong:** `scripts/expire_holds.ts` deletes expired holds instead of marking them `expired`. On a night with nothing expired it runs a bare `DELETE FROM holds` and wipes the whole table.

**Why it happens:** `main` runs `buildExpiredHoldsDelete(fetchExpiredHoldIds())` (`scripts/expire_holds.ts:43-45`). That called `buildDelete("holds", { id: [] })`, and `buildWhere` skips empty arrays (`scripts/lib/sqlFilter.ts:9-10`), so the WHERE clause is empty (`:20`) and the statement is `DELETE FROM holds` (`:29`). Even with ids it deletes rows the schema expects to be kept as `'expired'` (`db/migrations/0005_holds.sql:7`). It also never re-checks `status = 'active'`, so a hold captured between the SELECT and the DELETE is deleted too.

**What it breaks:** On the most common night (nothing expired) every hold is destroyed: active 7-day CNP holds for in-flight authorizations plus all released and expired history. `capture.ts`/`void.ts` then `UPDATE holds ... WHERE status = 'active'` and silently match 0 rows, so nothing errors. Worked example from the test: holds of 1,000 (released), 2,000 (active) and 3,000 fils (active, expired) all vanish (`actual: []`).

**Why it needed a fix:** It irrecoverably destroys the authorization hold record every quiet night, contradicting the rule Yousif wrote in the handover ("Holds are never deleted").

**Fix:** `scripts/expire_holds.ts`
```diff
-import { buildDelete } from "./lib/sqlFilter.js";
-  return buildDelete("holds", { id: expiredIds });
+  return { text: "UPDATE holds SET status = 'expired' WHERE status = 'active' AND id = ANY($1::uuid[])", values: [expiredIds] };
```
plus 3 comment/log lines that described deletion (`:29` doc comment, `:42` the FH/"claude: negligible window" note, `:47` log text). Lines: prod +4/−5, test +2/−2 changed + 50 new.

**Why this is the smallest correct fix:** one statement at the single point that builds it. `= ANY('{}')` matches nothing, so an empty night changes no rows; `UPDATE ... 'expired'` keeps history; the `status = 'active'` re-check closes the SELECT/DELETE race. Why not guard `buildDelete` against an empty WHERE? That stops the wipe but still deletes history and keeps the race. Why not one `UPDATE ... WHERE expires_at < now()` in `main`? Equally correct, but it moves logic out of the tested builder and leaves `fetchExpiredHoldIds` unused. The function name keeps "Delete" because renames are out of scope.

**Proof:** `scripts/expire_holds.audit.test.ts` "an empty night changes no rows, and expiry marks holds expired instead of deleting them" fails before (`+ actual [] - expected [[1000,'released'],[2000,'active'],[3000,'expired']]`) and passes after (run inside a rolled-back transaction). `expire_holds.test.ts` assertions that pinned the DELETE text are corrected: 3/3 pass.

**Regression risk:** `buildDelete` in `scripts/lib/sqlFilter.ts` is now unused; it still produces an unbounded DELETE for empty arrays if anyone calls it again. Holds deleted by past runs cannot be restored from this repo.

**Trap note:** `expire_holds.ts:28-31` "a night with nothing expired changes no rows" (false before; true now). `:42` "claude: 'negligible window, fine.'" (corrected). `0005_holds.sql:12-15` (MK, FP-219) "expire_holds.ts now deletes expired rows" is an applied migration, so it is left as is and recorded here. `authorize.ts:113-114` "only flips status to expired, it never deletes" was false and is now true. `expire_holds.test.ts` pinned the DELETE text and never tested `[]`.

---

<a id="f-ref-6"></a>

### REF-6 · Acquirer refund idempotency key changes on every retry · FP-300 (☐2 "money is right in the ledger") · Severity: High

**What's wrong:** The refund sent to the acquirer is keyed `${claimId}:${attemptCount}`. When a same-key retry follows a 502, the acquirer sees a brand-new request and pays it again, even if the first call went through and only the response was lost.

**Why it happens:** `apps/api/src/payments/processRefund.ts:151` (was `:149`) built the acquirer key from `attemptCount`. `claimIdempotencyKey` raises that count on every `retry_after_failure` (`idempotency.ts:156-160`). The 502 branch (`failIdempotencyKey`) marks the claim retryable because "nothing durable happened". But a transport error from the acquirer does not prove that no money moved. The faulty assumption was that the acquirer only ever sees one attempt, so a per-attempt key is harmless. The acquirer simulator dedupes refunds by `idempotencyKey` (`acquirer/simulator.ts:157-168`), so a stable key is exactly what makes a retry safe.

**What it breaks:** A refund of 5,000 fils hits an acquirer timeout after the acquirer has already paid, and the API returns 502. The client retries with the same `Idempotency-Key`. The acquirer receives `<claim>:2`, which is not in its cache, and pays another 5,000 fils. That is 10,000 fils out against 5,000 fils on our books.

**Why it needed a fix:** Retrying after a 502 is the documented contract (the claim is left retryable), and every network blip on a refund then risks a duplicate payout that is invisible in the ledger.

**Fix:** `apps/api/src/payments/processRefund.ts:151`
```diff
-    idempotencyKey: `${prepared.claimId}:${prepared.attemptCount}`,
+    idempotencyKey: prepared.claimId, // REF-6: stable across retries so the acquirer replays, never pays twice
```
Commit: `9b6da21`. Lines: prod +1/-1, test +24/-0.

**Why this is the smallest correct fix:** It is a single expression change. The claim id is already unique per (merchant, endpoint, client key) and stays the same across retries, so it is the natural stable key. The "money leaves before a durable record" half of this lead is already closed by REF-1: phase 1 now commits a reservation of `refunded_fils` before the acquirer call, so a crash in phase 3 fails closed and the reserved fils cannot be refunded again under a new key.
- Why not derive the key from the client's `Idempotency-Key`: the claim id already wraps it, scoped per merchant.
- Why not add a `pending` refunds row before the acquirer call: about 20 more lines plus a status migration, and the REF-1 reservation already gives the durable fail-closed record.
- Why not add a stale-claim sweeper: it would turn orphaned claims into retryable ones, which reintroduces the double payout.

**Proof:** The new test `REF-6: a same-key retry after an acquirer error reuses the acquirer idempotency key` uses a recording acquirer that returns `error` and then `approved`. Before the fix it failed with `expected: '<claim>:1'`, `actual: '<claim>:2'`. After the fix both calls carry the same key, the first answers 502 and the retry 200. processRefund + initiateMerchantRefund: 23 pass, 0 fail.

**Regression risk:** `acquirer/simulator.ts:156-168` caches every refund result by key, including a rolled `error`. With a stable key, a same-key retry against the built-in simulator replays the cached `error` (502 again) instead of rolling again. That is fail-safe (no double payout), but with `ACQUIRER_FAILURE_RATE > 0` the client then has to use a new key. A real acquirer does not cache a transport error. The out-of-lane patch below makes the simulator behave the same way. The existing test "an acquirer transport error answers 502 and leaves the key retryable" uses a fixed stub and still passes. Residual: a 502 releases the REF-1 reservation, so a *different*-key refund sent inside that window is not blocked. That is an unknown-outcome reconciliation case and is out of scope. Out-of-lane patch for the simulator owner: `simulator.ts:167` `refundCache.set(...)` → `if (result.outcome !== "error") refundCache.set(req.idempotencyKey, result);`.

**Trap note:** `processRefund.ts:39` ("validate, call the acquirer, then journal") and `processRefund.test.ts:392` ("a retry with the same key re-attempts") present the re-attempt as safe. They stay, because the re-attempt is now safe at the acquirer.

---

<a id="f-cw-1"></a>

### CW-1 · A payout disbursement record is written per webhook delivery, not per batch · INC-2026-08-21 · Severity: High

**What's wrong:** The `settlement.paid` pre-delivery effect inserts a `settlement_payout_disbursements` row (a payout-rail instruction) for every delivery row whose `attempt_count` is 0, and the table has no uniqueness on `settlement_batch_id`, so one paid batch gets one instruction per endpoint, per replay, per racing dispatcher and per duplicate outbox row.

**Why it happens:** `apps/api/src/webhooks/dispatcher.ts:37-42` wires the effect; `dispatcher.ts:160-163` runs it when `attempt_count === 0`, a stale read taken by an unlocked SELECT (`:221-228`, MK "no SKIP LOCKED") and only incremented after the HTTP send; `apps/api/src/webhooks/payoutDisbursement.ts:15-16` inserts with a fresh `'disb_'||gen_random_uuid()` and no `ON CONFLICT`; `db/migrations/0057_settlement_payout_disbursements.sql:17-18` has only a non-unique index. Hidden by 0057:20 "Written inside PayoutBatch's transaction, one row per paid batch" (false: the api dispatcher writes it), `index.ts:29` ("SKIP LOCKED in the claim query", none exists), and `payoutDisbursement.test.ts:40` (FH: "only checks the insert, not who calls it or how often").

**What it breaks:** Batch net payout 471,300 fils (471.300 BD), merchant with two active endpoints: two disbursement rows totalling 942,600 fils, i.e. 471.300 BD of phantom payout instructions, matching INC-2026-08-21 / ADMIN.md:107 ("two disbursement records each"). The ledger has one payout leg pair, so disbursements and ledger drift by (N-1) × net.

**Why it needed a fix:** Anything that instructs the bank from this table double-pays merchants.

**Fix:** new `db/migrations/0087_settlement_payout_disbursements_unique_batch.sql` (removes existing duplicates keeping the earliest `(created_at, id)`; `CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch ON settlement_payout_disbursements (settlement_batch_id)`), and `apps/api/src/webhooks/payoutDisbursement.ts:16-17`:
```diff
-     VALUES ($1, $2, 'disb_' || gen_random_uuid())`,
+     VALUES ($1, $2, 'disb_' || gen_random_uuid())
+     ON CONFLICT (settlement_batch_id) DO NOTHING`, // CW-1: once per batch, not per webhook delivery
```
Commit: `14db87c` (CW-1), `ec100ed` (CW-1b). Lines: prod +12/-1 (TS +2/-1, SQL +10), test +34/-0.

**Why this is the smallest correct fix:** The invariant is "one instruction per batch", so it belongs on the batch key in the database, which closes every fan-out path at once (multiple endpoints, replays, two replicas, restart mid-pass, duplicate `settlement.paid` outbox rows from Go). Why not only a compare-and-swap lease on the delivery row (dossier step 3): it stops racing dispatchers but not the per-endpoint/per-replay fan-out. Why not move the effect into Go `PayoutBatch`: correct long term, but a cross-lane redesign (>30 lines). The duplicate webhook *sends* from two racing dispatchers are a separate dispatcher-concurrency issue (not changed here).

**Proof:** `dispatcher.test.ts` "settlement.paid to a merchant with two endpoints records one disbursement": before `{ n: '2', … }` vs expected `{ n: '1', total: '471300' }`; after passes. `payoutDisbursement.test.ts` "recordPayoutDisbursementEffect is idempotent per batch": before `expected 1, actual 3`; after passes.

**Regression risk:** The migration deletes historical duplicate disbursement rows; finance should review them before production apply (the dossier's caveat). No other code reads/writes the table (grep). Covered by `payoutDisbursement.test.ts`, `dispatcher.test.ts`, `archiveReplay.test.ts` (16/16).

**Trap note:** 0057:20 is an applied migration and is not edited; the 0087 header states the real writer. Not owned here: `index.ts:29,35-36` claims (SKIP LOCKED, stop() waits), `docs/ARCHITECTURE.md:50-51`, ADMIN.md:108 root cause; the Go producer half (`payout_notify.go` NOT EXISTS + INSERT, no unique outbox index) is lane D's NOTIFY-1. A merchant with no endpoint still gets no disbursement record (the effect only runs on delivery); moving it to `PayoutBatch` is recommended to lane D.

**Follow-up (advisor review, commit "fix(CW-1b)"): never delete financial records.** The first version of 0087 deleted
duplicate historic disbursement rows to make a full unique index possible. That destroys evidence finance needs for
INC-2026-08-21. 0087 (never applied outside our test databases) now creates a **partial** unique index
`ON (settlement_batch_id) WHERE created_at >= '2026-10-30 00:00:00+03'` and deletes nothing; the insert's
`ON CONFLICT` names the same predicate. New batches get exactly one record; historic duplicates stay for review.
Finance cleanup item: `SELECT settlement_batch_id, count(*), sum(amount_fils) FROM settlement_payout_disbursements
GROUP BY 1 HAVING count(*) > 1;`. Residual: a replay for a batch paid before the fix date can still add one new record
(it is not covered by the partial index); replays of old batches are an admin action. Test:
`payoutDisbursement.test.ts` "historic duplicate disbursement rows are kept; only new rows are unique per batch":
before `duplicate key value violates unique constraint`, after 3 rows kept. Lines: SQL +3/−5, TS +1/−1, test +17/−0.

---

<a id="f-admin-cred-2"></a>

### ADMIN-CRED-2 · Credit maker-checker compares display names instead of admin user ids · H3 · Severity: High

**What's wrong:** The two-person control on above-threshold credits checked whether the approver's display name differed from the requester's, not whether the two were the same admin user.

**Why it happens:** `apps/api/src/admin/creditApproval.ts:11` read `if (approver.displayName === requester.displayName)`. The caller (`admin/credits.ts:326-329`) passes both `adminUserId`s, built from `credit_requests.requested_by_admin_user_id` and the approver's session (`routes/adminCredits.ts:102`), but the check ignored them. The assumption behind it, "display names are unique per admin" (0060 AM note), is false: `admin_users.display_name` has no UNIQUE constraint (`0031`).

**What it breaks:** (a) Self-approval: finance admin Huda requests a 120,000 fils credit, her display name is changed from "Huda (Finance)" to "Huda (Admin)", and she approves her own request. The names differ, so the credit posts with one person involved. (b) False block: two different finance admins both named "Ahmed A." can never approve each other's credits.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Maker-checker is the control on large money-out credits, and with this bug it can be bypassed by anyone able to edit a display name.

**Fix:** `apps/api/src/admin/creditApproval.ts:11`
```diff
-  if (approver.displayName === requester.displayName) {
+  if (approver.adminUserId === requester.adminUserId) { // ADMIN-CRED-2 (H3): compare identities, never display names
```
Commit: `dde9aab`. Lines: prod +1/-1, test +21/-1 (new audit test plus the corrected false comment).

**Why this is the smallest correct fix:** This is the single comparison that defines two-person control, and both ids are already in the `CreditActor` values passed to it. The signature, the error code and the caller are unchanged. *Why not also add a DB CHECK (`approved_by IS DISTINCT FROM requested_by`)?* It is defence in depth that adds a migration and does not change behaviour once the code is correct. It is noted here as optional.

**Proof:** `ADMIN-CRED-2: the same admin under a different display name cannot approve their own credit` fails before the fix (`assert.throws` → "Missing expected exception"). `ADMIN-CRED-2: two different admins who share a display name may approve each other` fails before the fix (`assert.doesNotThrow` → "Got unwanted exception... self_approval_forbidden"). Both are in `apps/api/src/admin/creditApproval.audit.test.ts` and pass after the fix.

**Regression risk:** Existing self-approval tests use the same actor object (same id), so they still throw. `admin/creditApproval.test.ts`, `admin/credits.test.ts` and `routes/adminCredits.test.ts` pass (25/25 including the audit tests).

**Trap note:** `admin/creditApproval.test.ts:20` (FH: "added a same-id/different-name case ... it passes, so ids are covered too") was false, because no such case existed. It is corrected to point at the audit test. The poisoned `AGENTS.md` and the `0060:69-70` note ("display names are unique per admin") are outside this lane's owned files.

---

<a id="f-pl-3"></a>

### PL-3 · Payment-link cancel is a cross-merchant IDOR · G5 · Severity: High

**What's wrong:** `DELETE /v1/merchants/:merchantId/payment-links/:id` cancels any active link by id. Merchant A can cancel merchant B's link by putting A's own merchant id in the path and B's link id after it, which is case file G5: "I cancelled merchant B's payment link from merchant A's dashboard".

**Why it happens:** `apps/api/src/paymentLinks/cancel.ts:13-19` ran `UPDATE payment_links ... WHERE id = $1 AND status = 'active'` with no `merchant_id`. The route (`routes/paymentLinks.ts:103-107`) passed only the link id. The faulty assumption was that `assertOwnMerchant` covers ownership. It only proves the caller is the path merchant. Two comments hid this. `routes/paymentLinks.ts:50` said "this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs" (MK's line under it already doubted it). `cancel.ts:24` said "second read is just for the error shape, no race. fine", and that read also leaked another merchant's link status through the 409 body.

**What it breaks:** Merchant B creates a 4,750 fils link and sends it to a buyer. Merchant A sends `DELETE /v1/merchants/A/payment-links/<B's link id>` with A's key and gets 204. B's link is now `canceled`, and the buyer's 4,750 fils payment is refused (sale lost). Link ids reach third parties (buyers, chat apps), so they are not secrets.

**Why it needed a fix:** Any merchant can disrupt any competitor's payment collection. The 409 path also tells the attacker the status of any link it knows the id of.

**Fix:** `apps/api/src/paymentLinks/cancel.ts:11,16,18,24,26,27` and `apps/api/src/routes/paymentLinks.ts:107`
```diff
-  input: { id: string },
+  input: { id: string; merchantId: string },
-      WHERE id = $1 AND status = 'active'
+      WHERE id = $1 AND merchant_id = $2 AND status = 'active'
-    [input.id],
+    [input.id, input.merchantId],
-  // YA: second read is just for the error shape, no race. fine
+  // Same merchant scope as the UPDATE (PL-3): another merchant's link is not_found, not a status oracle.
-    `SELECT status FROM payment_links WHERE id = $1`,
-    [input.id],
+    `SELECT status FROM payment_links WHERE id = $1 AND merchant_id = $2`,
+    [input.id, input.merchantId],
 (routes/paymentLinks.ts)
+        merchantId: request.params.merchantId,
-// am: this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs
-// MK: it checks the path merchant, not that the link belongs to that merchant?
+// Path-scope check only: it proves the caller IS the path merchant, not that a link belongs to it.
+// cancel.ts scopes its queries by merchant_id itself (PL-3).
```
Commit: `8279360`. Lines: prod +9/-8 (code +6/-5, comments +3/-3), test +16/-0.

**Why this is the smallest correct fix:** It adds the owner predicate to the two queries that touch the row and passes in the merchant id that the route has already scope-checked. A foreign link then takes the existing `not_found` 404 path.
- Why not scope only the UPDATE: the follow-up SELECT would still return 409 with the other merchant's link status (an oracle).
- Why not add a separate ownership SELECT in the route: that is more lines and a check-then-act gap.
- Why not return 403: a 403 confirms that the link id exists.

**Proof:** The new test `PL-3: a merchant cannot cancel another merchant's payment link (404, link stays active)` (`routes/paymentLinks.test.ts`) failed before the fix with `expected: 404`, `actual: 204`. After the fix it passes and the link stays `active`. routes/paymentLinks + paymentLinks/pay + status: 20 pass, 0 fail.

**Regression risk:** Own-merchant cancel is unchanged ("cancel: happy path 204, nonexistent id -> 404, already-paid -> 409" still passes). `cancelPaymentLink` has no other callers.

**Trap note:** The `am:`/`MK:` comment at `routes/paymentLinks.ts:50-51` called the path check "the ownership check" that cancel.ts "relies on". It is rewritten to say what the check actually proves. The `YA: ... no race. fine` comment at `cancel.ts:24` is replaced.

---

<a id="f-auth-4"></a>

### AUTH-4 · OTP codes and payment-link tokens come from Math.random · H8 · Severity: High

**What's wrong:** `randomDigits` (merchant and admin OTP codes) and `randomFromAlphabet` (payment-link tokens) in `apps/api/src/lib/random.ts` drew from `Math.random()`. That is V8's xorshift128+ PRNG, which is not cryptographically secure.

**Why it happens:** `lib/random.ts:4` was `Math.floor(Math.random() * max)` and `:13` was `alphabet[Math.floor(Math.random() * alphabet.length)]`. `auth/otp.ts:8` (`generateOtpCode`) calls `randomDigits`, and `adminAuth/otp.ts` reuses `generateOtpCode`. `paymentLinks/create.ts` builds link tokens with `randomFromAlphabet`.

**What it breaks:** xorshift128+ state can be recovered from a handful of consecutive outputs. A self-signed-up merchant who triggers several logins and reads their own `devOtpCode` values, or sees enough of their own payment-link tokens, can predict the next codes and tokens the same process issues. That includes a victim's OTP, or an admin's OTP after a phished password. A payment-link token is the only secret a payer needs (0020).

**Why it needed a fix:** H8 requires a real second factor and unguessable bearer tokens. A predictable OTP turns two-factor login into password-only login, and a predictable link token exposes other merchants' payment links.

**Fix:** `apps/api/src/lib/random.ts:1,4,13`
```diff
+import { randomInt } from "node:crypto"; // AUTH-4 (H8): CSPRNG, never Math.random
+
-  return Math.floor(Math.random() * max)
+  return randomInt(max)
-    out += alphabet[Math.floor(Math.random() * alphabet.length)];
+    out += alphabet[randomInt(alphabet.length)];
```
Commit: `d42c5eb`. Lines: prod +3/-2, test +19/-0.

**Why this is the smallest correct fix:** Both security callers go through these two functions, so replacing the source of randomness here fixes OTPs (merchant and admin) and link tokens at once. Signatures and output formats are unchanged. `crypto.randomInt` is uniform with no modulo bias and accepts ranges up to 2^48, which covers OTP lengths up to 14 digits; the configured length is 6. *Why not switch each caller to `lib/crypto.randomToken`?* That changes the token format and touches several files.

**Proof:** `AUTH-4: randomDigits and randomFromAlphabet do not depend on Math.random` (`apps/api/src/lib/random.audit.test.ts`) pins `Math.random = () => 0`. Before the fix it fails with `OTP codes followed Math.random: 000000` (all 20 codes are identical). After the fix it passes.

**Regression risk:** The output shape is unchanged: zero-padded digits and alphabet characters. `auth/otp.test.ts` and `routes/paymentLinks.test.ts` pass (14/14 with the audit test). `displayReference()` also moves to the CSPRNG, which is harmless.

**Trap note:** The quarantined AI configs (CLAUDE.md, AGENTS.md, .cursorrules) called Math.random "acceptable" because "uniqueness is enforced at the DB", but uniqueness is not unpredictability. `adminAuth/otp.ts:13` ("Generated with crypto.randomInt") is now true. `auth/otp.test.ts:19`, a statistical sanity test, passes with any PRNG. Not fixed, outside the owned files: `admin/inviteCode.ts:10` also uses `Math.random` for invite codes.

---

<a id="f-pl-2"></a>

### PL-2 · Public pay route checks expiry against the client-supplied submittedAt · FP-187 · Severity: High

**What's wrong:** `POST /v1/payment-links/:token/pay` is public and unauthenticated, yet it judges link expiry against `submittedAt` from the request body. Any buyer can pay an expired link by sending a past timestamp.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:34-38` (`expiryReferenceTime`) returned the parsed `submittedAt` whenever it was a valid date. `:60` passes that value as `$3` into the claim's `expires_at > $3` (`:73`) and into `classifyClaimFailure`. The route (`routes/paymentLinks.ts:158,167`) forwards `submittedAt` from the body with no authentication gate. The faulty assumption was that this is an "offline-terminal" feature for trusted callers. Three places hid the bug. The route's JSDoc (`routes/paymentLinks.ts:35-37`) said submittedAt is "ignored unless the request is authenticated with an API key", but no such gate exists. `pay.test.ts:21-25` ("FH: this one is the offline-terminal contract test. MK said don't delete") asserted that a client timestamp round-trips exactly. `routes/paymentLinks.test.ts:204` stated as intended that "with a past submittedAt it pays".

**What it breaks:** A 4,750 fils link expires at 12:00. At 12:30 the checkout page shows "expired", but a request with `submittedAt: "11:30"` is claimed, authorized and captured: 200, and 4,750 fils is charged on a link the merchant considers dead. This is FP-187: "the link showed 'expired', but the payment still went through. The checkout page sends something that the server shouldn't trust."

**Why it needed a fix:** Expiry is the merchant's only control over stale quotes, prices and inventory. A client-controlled clock makes it meaningless.

**Fix:** `apps/api/src/paymentLinks/pay.ts:32-38`
```diff
-/** A pay request is judged against when the buyer pressed pay, so a
- * retry that lands after midnight is not penalised. */
-export function expiryReferenceTime(submittedAt?: string): Date {
-  if (!submittedAt) return new Date();
-  const parsed = new Date(submittedAt);
-  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
-}
+/** Expiry is judged on the server's clock only: submittedAt is client-supplied and untrusted (FP-187). */
+export function expiryReferenceTime(_submittedAt?: string): Date {
+  return new Date();
+}
```
The JSDoc at `routes/paymentLinks.ts:35-37` is corrected to say submittedAt is never trusted. Commit: `0d292af`. Lines: prod +5/-9 (code +2/-4, comments +3/-5), test +21/-5.

**Why this is the smallest correct fix:** It is fixed at the one function that decides the reference time, so the claim and the error classifier both switch to server time and no call sites change. The body field is still accepted, so existing clients do not get 400s.
- Why not just set `pay.ts:60` to `const expiryCheckTime = new Date()`: one line fewer, but `expiryReferenceTime` and its "round-trips exactly" test would remain as dead code that documents the bug as a contract.
- Why not gate submittedAt on API-key auth, as the doc claimed: the route is public by design, no such caller exists, and it would be new code.
- Why not reject requests that carry submittedAt: that breaks clients for no safety gain.

**Proof:** The new test `PL-2: an expired link stays expired when the body carries a past submittedAt` (`routes/paymentLinks.test.ts`) failed before the fix with `expected: 410`, `actual: 200` (the link was paid). The corrected unit test `expiryReferenceTime: a client-supplied ISO-8601 time is ignored -> the server's own clock` (`pay.test.ts`) also failed before. Both pass after. routes/paymentLinks + pay + status: 21 pass, 0 fail.

**Regression risk:** Requests without submittedAt already used the server clock, so they are unchanged. The existing expired/canceled/paid link tests pass.

**Trap note:** The "offline-terminal contract" test (`pay.test.ts:21-25`) encoded the bug and now asserts the opposite, citing FP-187. The "terminal case" comment (`routes/paymentLinks.test.ts:204`) is removed. The false "ignored unless ... API key" JSDoc is corrected.

---

<a id="f-auth-5"></a>

### AUTH-5 · OTP attempt limit is check-then-act: parallel guesses bypass max_attempts · H8 · Severity: High

**What's wrong:** Merchant and admin `/otp/verify` read `attempt_count`, compared it in JavaScript, checked the code, and only then incremented, with no transaction or lock. A burst of concurrent guesses on one pending cookie all read the same stale count, so each one gets a guess.

**Why it happens:** `apps/api/src/routes/auth.ts:144-167` runs a pool `SELECT attempt_count, max_attempts` (`:144`), then `if (challenge.attempt_count >= challenge.max_attempts)` (`:157`), then `verifyOtpCode`, then an unconditional `UPDATE ... attempt_count + 1` (`:164`). `apps/api/src/routes/adminAuth.ts:135-158` is the same. The comments hid the race: `auth.ts:155` "am: check-then-increment is fine ... worst case is 5 guesses" and `adminAuth.ts:147` "admin path doesn't have the merchant race, the challenge row is read FOR UPDATE — MK". No `FOR UPDATE` exists.

**What it breaks:** With `OTP_MAX_ATTEMPTS=5`, 20 concurrent wrong guesses on one pending cookie were all checked (the audit test observed 20 `invalid_code` responses, for both merchant and admin). A 6-digit OTP then falls to parallel brute force within the challenge TTL, and the cap only limits sequential guesses.

**Why it needed a fix:** H8 requires the second factor to resist guessing. The attempt cap is the only brute-force control on a 10^6 code space.

**Fix:** `apps/api/src/routes/auth.ts:155-167` (identical change in `routes/adminAuth.ts:147-159` on `admin_otp_challenges` / `revokeAdminSession`)
```diff
-      // am: check-then-increment is fine, max_attempts=5 so worst case is 5 guesses
-      // MK: 5 guesses per parallel batch? if i fire 50 at once they all read attempt_count=0
-      if (challenge.attempt_count >= challenge.max_attempts) {
+      // AUTH-5 (H8): reserve the attempt atomically before checking the code, so parallel guesses can't exceed the cap.
+      const reserved = await app.db.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1 AND attempt_count < max_attempts`, [challenge.id]);
+      if (reserved.rowCount === 0) {
         await revokeSession(app.db, pending.sessionId);
         throw new TooManyRequestsError("too_many_attempts");
       }
       const matches = verifyOtpCode(code, challenge.code_salt, challenge.code_hash);
       if (!matches) {
-        await app.db.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`, [
-          challenge.id,
-        ]);
         throw new UnauthorizedError("invalid_code");
```
Commit: `2a52b5f`. Lines: prod +6/-12 (two routes), test +68/-0.

**Why this is the smallest correct fix:** A single conditional `UPDATE` reserves the attempt and enforces the cap in one atomic statement. Postgres row locking serialises concurrent updates on the row, so at most `max_attempts` requests ever reach `verifyOtpCode`. The old post-hoc increment is removed because the reservation already counted the attempt. *Why not wrap it in a transaction with `SELECT ... FOR UPDATE`?* That needs more lines and holds a pooled connection across the hash compare. *Why not a new migration or constraint?* None is needed, because the existing `max_attempts` column is the cap. Semantics are unchanged: attempts 1 through 5 are allowed, a correct code on attempt 5 still succeeds, and attempt 6 gets 429 and revokes the session.

**Proof:** `AUTH-5: parallel wrong OTP guesses cannot exceed max_attempts` (`apps/api/src/routes/auth.audit.test.ts`) and `AUTH-5: parallel wrong admin OTP guesses cannot exceed max_attempts` (`apps/api/src/routes/adminAuth.audit.test.ts`) fail before the fix with `assert.ok(checked <= config.otpMaxAttempts)` → "20 guesses were checked; cap is 5". Both pass after the fix.

**Regression risk:** The sequential wrong-code-then-right-code flows in `src/app.test.ts` and `src/routes/admin.test.ts` pass (53/53 with the audit tests). A correct code now also uses one attempt, which is invisible to the user because the cap check still runs before verification.

**Trap note:** The false "read FOR UPDATE" claim at `adminAuth.ts:147` and the "check-then-increment is fine" note at `auth.ts:155` are replaced by an accurate AUTH-5 comment. The new admin test file adds `adminAuth.audit.test.ts` (+52 test lines).

---

<a id="f-obx-poison"></a>

### OBX-POISON · A missing rollup row makes the parity check throw and wedges the reporting consumer · FP-300 ☐5 · Severity: High

**What's wrong:** In `applyBatchClosed`, when `transaction_events` shows captures for the merchant's Bahrain day but `merchant_daily_volume` has no row for that day, `rollup` is `undefined` and `rollup.captured_count` throws a `TypeError`.

**Why it happens:** `apps/reporting/src/consumer/applyEvent.ts:147` cast `rollupResult.rows[0] as { captured_count: number }` without a check. The throw rolls back the whole pass (`runConsumerPass.ts:42-69`, by design), the listener logs it, and the next NOTIFY/poll re-selects the same event, so the watermark never moves past it. The block's own comment (`:120-128`) presents the check as a harmless "warn early" checkpoint, and the docstring at `:72-77` promises a missing row is "never a thrown error that would poison the whole pass", which was true only for the batch row.

**What it breaks:** After a fresh seed (thousands of capture `transaction_events`, one captured outbox event per merchant, plus a `settlement.batch_closed` for 2026-08-31), or after a lost capture event, the first such batch_closed event freezes volumes and payout trends for every merchant; catch-up and rebuild die on the same event; refund events added for FP-300 queue behind it forever. Recovery is manual SQL.

**Why it needed a fix:** FP-300 ☐5 needs reports to update; one stale day must produce a warning, not a platform-wide reporting outage.

**Fix:** `apps/reporting/src/consumer/applyEvent.ts:147-148`:
```diff
-    const rollup = rollupResult.rows[0] as { captured_count: number };
+    // OBX-POISON: no rollup row means rollup=0 (warn); a TypeError here would wedge the consumer.
+    const rollup = (rollupResult.rows[0] as { captured_count: number } | undefined) ?? { captured_count: 0 };
```
Commit: `08b0e59`. Lines: prod +2/-1, test +36/-0.

**Why this is the smallest correct fix:** one expression at the single dereference; the existing warning text then reports `rollup=0 ground_truth=N`, exactly the lag the check exists to surface. Why not wrap the parity check in try/catch: hides real SQL errors. Why not drop the parity check: loses the stuck-consumer signal.

**Proof:** `applyEvent.test.ts` "applyBatchClosed with ground-truth captures but NO rollup row warns and does not throw": before `TypeError: Cannot read properties of undefined (reading 'captured_count')`; after passes (one warning `rollup=0 ground_truth=1`, payout-trend row written).

**Regression risk:** only the missing-row branch changes. Covered by `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` (12/12, `--test-concurrency=1`).

**Trap note:** the docstring promise at `:72-77` ("never a thrown error that would poison the whole pass") is now true for the rollup row as well; the new comment names the failure mode.

---

<a id="f-split-1"></a>

### SPLIT-1 · Split children are rounded separately, so the remainder is lost (or invented) · F3, H2 · Severity: High
**What's wrong:** `PayoutSplitBatch` gave each sub-merchant `ApplyRateFils(net, weightBps)` independently (banker's rounding per child). The children's shares do not sum to the batch's net payout: fils are left behind on the parent or paid twice.

**Why it happens:** `apps/settlement/internal/splits/allocate.go:97` (`share := money.ApplyRateFils(money.Fils(netPayout), weightBps)`). Each child rounds on its own, and nothing hands out the difference. The TS side already has the correct largest-remainder `allocateRemainder` (packages/money/src/fils.ts:161), but the Go port never used it. `shares.go`'s `ChildShares` repeats the same per-child rounding, and its only test (`TestChildShares_SumToNet`) uses round amounts (10000 at 5000/5000, etc.) that never leave a remainder. Migration 0045 notes that the 10000-bps total is "enforced by whatever creates these rows", i.e. nothing.

**What it breaks:** net 100 fils at 3333/3333/3334 bps pays 33+33+33 = 99 fils: 1 fil per batch stays on the parent's merchant_payable and never reaches any child. Net 1,001 fils at the same weights rounds to 334+334+334 = 1,002 fils, 1 fil more than the batch owes. Weights that do not total 10000 silently pay the wrong share of the batch.

**Why it needed a fix:** split payouts must pay exactly the batch's net (F3/H2). Every batch with a remainder either strands money with the parent or overpays children, and the ledger drifts by that amount.

**Fix:** `allocate.go:97` + `:106-121` (+ `fmt`, `sort` imports)
```diff
-		share := money.ApplyRateFils(money.Fils(netPayout), weightBps)
+		share := money.Fils(netPayout * weightBps / 10_000) // floor; remainder handed out below (SPLIT-1)
 ...
+	// SPLIT-1 (F3, H2): largest-remainder split as packages/money allocateRemainder,
+	// so the children receive exactly netPayout; the weights must total 10000 bps.
+	leftover, sumBps := money.Fils(netPayout), int64(0)
+	order := make([]int, len(shares))
+	for i, s := range shares {
+		leftover, sumBps, order[i] = leftover-s.AllocatedFils, sumBps+s.WeightBps, i
+	}
+	if sumBps != 10_000 {
+		return SplitPayoutResult{}, fmt.Errorf("splits: PayoutSplitBatch: child weights total %d bps, want 10000", sumBps)
+	}
+	sort.SliceStable(order, func(a, b int) bool {
+		return netPayout*shares[order[a]].WeightBps%10_000 > netPayout*shares[order[b]].WeightBps%10_000
+	})
+	for k := 0; leftover > 0; k++ {
+		shares[order[k]].AllocatedFils++
+		leftover--
+	}
```
Commit: `2b6d181`. Lines: prod +21/-1, test +66/-0.

**Why this is the smallest correct fix:** it is the same algorithm as the TS `allocateRemainder` (floor each share, then give +1 fil to the largest remainders, ties by ascending index), applied in place where the shares are built and before any ledger leg is written. There is no new helper or signature change, and the posting loop is untouched. Because the weight denominator is fixed at 10000 bps, the TS decimal-scaling step is not needed. The 10000-bps check refuses a misconfigured parent instead of paying a wrong share (the transaction rolls back and nothing is paid). Why not round-to-nearest plus "dump the remainder on the last child": it is not TS-parity and is biased toward one child. Why not fix `ChildShares` in shares.go: it is not on the payout path (no production caller), so fixing it would not fix the payout. It is left as is and flagged.

**Proof:** `TestPayoutSplitBatch_SharesSumToNet` (splits/allocate_audit_test.go) failed before: `child at 3334 bps got 33 fils, want 34` and `children got 99 fils in total, want the full net payout 100`. It passes after. The splits, settlement and internalapi packages are green.

**Regression risk:** shares change by at most +1 fil per child, and only when a remainder exists. `totalAllocated` now equals `netPayout`, so `ApplyPayout` debits the full net (which resolves the "am: should pass netPayout here" drift note). A parent whose weights do not total 10000 bps now fails loudly instead of underpaying.

**Trap note:** `TestChildShares_SumToNet` used only remainder-free amounts, so the per-child rounding was never exercised. That test and `ChildShares` are left untouched (unused in production).

---

<a id="f-auth-3"></a>

### AUTH-3 · Admin API-key rotation never revokes the old key · H4 · Severity: High

**What's wrong:** `POST /v1/admin/merchants/:id/api-keys/:keyId/rotate` issued a new key but left the old one live. "Rotation" therefore added credentials instead of replacing them, and rotating the same key again minted a third live key.

**Why it happens:** `apps/api/src/admin/apiKeys.ts:18-47` locks the old row (`FOR UPDATE`), calls `issueApiKeyInTx` (INSERT only), writes the audit row and returns. Nothing updates the old row, even though 0037 added `revoked_reason` precisely "to make rotate atomic". `apiKeys/verify.ts` accepts any key with `revoked_at IS NULL`. The `revoke_after` column (0056) has no reader or writer, so no overlap window exists either. The test `routes/admin.test.ts:800` asserted the bug: "the previous key stays active", `revoked_at` null.

**What it breaks:** A merchant reports a leaked key and finance rotates it. The leaked key still returns 200 on `GET /v1/transactions` and every other API-key route, indefinitely. The incident response does nothing, and the audit log records an `api_key_rotate` as if it had.

**Why it needed a fix:** H4 says the key rotation flow "doesn't do what you'd expect". Rotation is how a compromised credential is cut off, and leaving the old key live defeats it.

**Fix:** `apps/api/src/admin/apiKeys.ts:30-31`
```diff
     if (row.revoked_at) {
       throw new ConflictError("api_key_already_revoked");
     }
+    // AUTH-3 (H4): rotation revokes the old key in the same transaction (no overlap window in the design).
+    await client.query(`UPDATE api_keys SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = $1`, [input.apiKeyId]);
```
Commit: `cfcd6f6`. Lines: prod +2/-0, test +6/-7 (corrected assertions in `routes/admin.test.ts`).

**Why this is the smallest correct fix:** The row is already locked and checked for merchant ownership and non-revocation in the same transaction, so a single `UPDATE` by id makes rotation atomic (revoke the old key, issue the new one, write the audit row) and re-rotation now returns the existing 409 `api_key_already_revoked`. *Why not wire `revoke_after` for a grace period?* YA's note on the test says "there was never a grace period in the design. rotation = revoke". A grace period would also need changes to `verify.ts` and a sweep, and is a product decision, not a fix.

**Proof:** `API key rotation issues a new key atomically and audits it; the previous key is revoked` (`apps/api/src/routes/admin.test.ts`, corrected) fails before the fix with `assert.equal(after.statusCode, 401, "the previous key is revoked by rotation (H4)")` → `200 !== 401`. It passes after the fix, along with `oldRow.revoked_at` set and `revoked_reason === "rotated"`.

**Regression risk:** The new key, the audit row, the 409 on an already-revoked key and the 404 on another merchant's key are unchanged. `routes/admin.test.ts` passes 41/41.

**Trap note:** The test at `admin.test.ts:798-800` was named "...the previous key stays active", carried the note "grace period ... intended (am, 2026-05)", and asserted 200, `revoked_at` null and `revoked_reason` null. All of those encoded the bug. They are corrected with comments citing H4, and YA's line ("rotation = revoke") is kept.

---

<a id="f-notify-1"></a>

### NOTIFY-1 · settlement.paid enqueue is check-then-insert with no unique key, so concurrent runs double-notify · INC-2026-08-21 · Severity: High
**What's wrong:** `EnqueuePayoutNotifications` selects paid batches `WHERE NOT EXISTS (settlement.paid outbox row)` and then INSERTs, with no lock and no unique key. Two enqueuers (the daemon tick and a `run-batch` CLI run) both pass the check and both insert, so the merchant receives `settlement.paid` twice.

**Why it happens:** `apps/settlement/internal/settlement/payout_notify.go:29-95`. Under READ COMMITTED, neither transaction sees the other's uncommitted row. The comment at `:27` quoted "claude: No, outbox_events has a unique index on (event_type, aggregate_id)", but migration 0009 only has `idx_outbox_unprocessed` (non-unique). MK's "daemon and CLI never overlap" (`:28`) is contradicted by INC-2026-08-21.

**What it breaks:** duplicate `settlement.paid` webhooks per batch. A merchant whose integration books a payout per webhook records the payout twice (e.g. 9,750 fils booked as 19,500 fils), which is exactly incident INC-2026-08-21.

**Why it needed a fix:** any overlap of the daemon and an operator re-run (or two daemon replicas) repeats the incident, and the in-code claim that the database prevents it is false.

**Fix:** `payout_notify.go:86-93` + new `db/migrations/0092_outbox_settlement_paid_unique.sql`
```diff
-		_, err = db.Exec(ctx, `
+		tag, err := db.Exec(ctx, `
-			VALUES ('settlement.paid', 'settlement_batch', $1, $2)
+			VALUES ('settlement.paid', 'settlement_batch', $1, $2) ON CONFLICT DO NOTHING
-		count++
+		count += int(tag.RowsAffected())
```
```sql
UPDATE outbox_events oe SET event_type = 'settlement.paid.duplicate', processed_at = COALESCE(processed_at, now())
 WHERE event_type = 'settlement.paid' AND id > (SELECT min(id) FROM outbox_events o2 WHERE o2.event_type = 'settlement.paid' AND o2.aggregate_id = oe.aggregate_id);
CREATE UNIQUE INDEX outbox_events_settlement_paid_once ON outbox_events (aggregate_id) WHERE event_type = 'settlement.paid';
```
The `:27` comment is replaced with the real mechanism.
Commit: `664f548`. Lines: prod +4/-4 Go (3 code lines, 1 comment line) and +15 SQL (migration, including 6 comment lines), test +48/-0.

**Why this is the smallest correct fix:** the database is the only place that can serialize two separate processes. The partial unique index makes the second INSERT wait for the first and then skip (`ON CONFLICT DO NOTHING`), and `RowsAffected` keeps the returned count honest. The index is partial, so no other event type is constrained. Why not an advisory lock or SELECT ... FOR UPDATE: the function has no transaction, and adding one is a bigger change that still relies on every caller using the lock. Why not a full unique index on (event_type, aggregate_id): other event types may legitimately repeat per aggregate. The UPDATE in the migration is needed because production already holds INC-2026-08-21 duplicates (my red-phase run created one locally, and the bare index failed with `Key (aggregate_id)=(...) is duplicated`). Later duplicates are relabelled `settlement.paid.duplicate` and marked processed instead of being deleted, so audit history and any FK references survive and nothing is dispatched again.

**Proof:** `TestEnqueuePayoutNotifications_ConcurrentEnqueueIsSingle` (payout_notify_audit_test.go) holds an uncommitted competing `settlement.paid` insert while the enqueuer runs. It failed before: `settlement.paid events for one batch = 2, want 1`. It passes after migration 0092; `go test ./internal/settlement/` is green.

**Regression risk:** single-runner behaviour is unchanged (NOT EXISTS still filters). A concurrent enqueuer now blocks briefly on the index and then skips. Readers that count `settlement.paid` rows see one per batch. The relabelled historical rows keep their payloads.

**Trap note:** the "claude: ... has a unique index" comment (`:27`) was false; it is replaced, and FP-260 "resolved" (daemon.go:105) refers to the same unfixed race.

---

<a id="f-obx-double"></a>

### OBX-DOUBLE · Unlocked cursor read lets concurrent reporting passes double-apply events · FP-300 ☐5 · Severity: High

**What's wrong:** `readCursor` seeds the cursor with `INSERT … ON CONFLICT DO NOTHING` and then a plain `SELECT`; neither locks the row, so two concurrent passes read the same watermark and both apply the same (non-idempotent, `+1`) events.

**Why it happens:** `apps/reporting/src/consumer/cursor.ts:32` is a snapshot read; `ON CONFLICT DO NOTHING` takes no lock on an existing row. Pass B reads watermark N while pass A is mid-batch, selects the same events, increments `merchant_daily_volume` again, and both commit the absolute `SET last_processed_id`. The `running` flag only serialises passes inside one process. Hidden by the am comment at `cursor.ts:23` ("nvm the `running` flag in listener.ts guards it") and YA at `:40` ("only one writer"); the RUNBOOK tells operators to run catch-up beside the live worker, and `catchUp.ts:18` records "rollup looked high after" on 2026-09-14.

**What it breaks:** catch-up next to the worker with 500 pending captures worth 1,000.000 BD (1,000,000 fils) leaves those merchants' daily volume at 2,000.000 BD with doubled counts, permanently; same for two containers overlapping in a deploy, or rebuild with the worker up.

**Why it needed a fix:** FP-300 ☐5 reports must be exact; doubled volumes are silently wrong and never self-correct.

**Fix:** `apps/reporting/src/consumer/cursor.ts:32`: append `FOR UPDATE` to the cursor SELECT (comment at `:23-24` replaced). A second pass blocks until the first commits and, under READ COMMITTED, re-reads the advanced watermark. `apps/reporting/src/cli/rebuild.ts:53`: `resetCursor` moved before the two `TRUNCATE`s so rebuild takes the cursor lock first, the same order as a pass (otherwise rebuild's ACCESS EXCLUSIVE on the rollup tables + a pass's cursor lock can deadlock). Commit: `a63a29e`. Lines: prod +4/-3, test +34/-0.

**Why this is the smallest correct fix:** the cursor row is the single serialisation point every pass already touches, in the same transaction. Why not `pg_advisory_xact_lock`: same effect, extra query and a magic key. Why not per-event dedupe table: new table + writes for every event.

**Proof:** `runConsumerPass.test.ts` "runConsumerPass: a pass overlapping another in-flight pass does not re-apply the same events" (pass A holds `readCursor` in an open transaction while `runConsumerPass` B starts): without the fix `expected 1, actual 2`; with it passes.

**Regression risk:** passes now wait for each other (they are short, one batch). Covered by `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` (13/13 with `--test-concurrency=1`, the package's own setting; these files share global tables, so running them in parallel interferes by design, e.g. rebuild TRUNCATEs mid-test).

**Trap note:** the am/YA comments at `cursor.ts:23,40` claimed a single writer; `:23` is replaced with the real reason for the lock. Not owned: `docs/RUNBOOK.md:63-78` (catch-up beside the worker) is now safe but should say so.

---

<a id="f-sum-1"></a>

### SUM-1 · Settlement summary sums the running captured total once per capture event · H6, FP-300 ☐5 · Severity: High

**What's wrong:** `GET /v1/settlement/summary` returns `totalCapturedFils = SUM(t.captured_fils)` over a join with one row per capture event, so a transaction captured in k parts is counted k times its final cumulative total, and the figure uses today's running total instead of what was captured inside the window.

**Why it happens:** `apps/api/src/settlement/query.ts:366-379`: the `captured` CTE joins `transactions` (1 row) to `transaction_events` (k rows) and carries `t.captured_fils` onto every row; `COUNT(DISTINCT id)` de-duplicates the count but nothing de-duplicates the SUM. `captured_fils` is a running total overwritten by each partial capture (`capture.ts:201`). Settlement batches instead sum the per-event delta `te.amount_fils` (`batch.go:144-147`). The docstring "joined through transaction_events for batch parity" and `docs/perf/2026-07-settlement-summary-slow.md:33-46` (which saw a ~38% gap for Delta Wholesale and dismissed it) hid it.

**What it breaks:** 30.000 BD captured as 12.000 + 10.000 + 8.000 BD on one Bahrain day: batch gross 30,000 fils, summary 3 × 30,000 = 90,000 fils (+200%). Across a month boundary, 10.000 BD on 30 Jun and 20.000 BD on 1 Jul shows 30.000 BD for each month, and June's figure changes after the fact.

**Why it needed a fix:** merchants and finance reconcile against this summary; it disagrees with the settlement batches it claims parity with.

**Fix:** `apps/api/src/settlement/query.ts:367`:
```diff
-       SELECT t.id, t.captured_fils
+       SELECT t.id, te.amount_fils AS captured_fils -- SUM-1: per-capture delta, not the running total (batch.go parity)
```
Commit: `cf8075a`. Lines: prod +1/-1, test +45/-0.

**Why this is the smallest correct fix:** one column in the CTE; the outer `SUM`/`COUNT(DISTINCT)` and the DTO stay unchanged, and the window filter on `te.occurred_at` now also scopes the amount. Why not `SUM(DISTINCT captured_fils)`: wrong when two transactions have equal totals and still uses the running total. Why not rewrite the CTE away (dossier variant): same result, more lines; SUM-2 handles the performance side.

**Proof:** `settlement/query.audit.test.ts` "summary counts each capture delta once for a multi-capture transaction": before `expected 30000, actual 90000`; after passes. Existing single-capture tests in `routes/settlement.test.ts` still pass (11/11 together).

**Regression risk:** single-capture transactions are unchanged (delta == total). Covered by `routes/settlement.test.ts` and the new test.

**Trap note:** the "for batch parity" docstring at `query.ts:357` is now true; the perf note's dismissal of the 38% gap remains in `docs/perf/` (not owned).

---

<a id="f-idem-1"></a>

### IDEM-1 · Capture idempotency hash omits the transaction id, so a reused key on another transaction replays a fake success · FP-300 (☐2 "money is right in the ledger") · Severity: High

**What's wrong:** A capture idempotency key is scoped to (merchant, endpoint, key), and its request hash covers only `amountFils`. Reusing a key on a *different* transaction with the same body is therefore treated as a replay: the second transaction gets the first one's 200 body and is never captured.

**Why it happens:** `apps/api/src/payments/capture.ts:92` hashed `{ amountFils }` only. `claimIdempotencyKey` (`idempotency.ts:118-153`) finds the completed row for the same (merchant, `transactions.capture`, key), sees an equal hash, and returns `replay`. The transaction id is in the URL path, not the body, so it never reached the hash. The faulty assumption was that keys are per transaction. A test comment hid this (`routes/transactions.test.ts:218-219`): "FH: should also cover same key + same body on a DIFFERENT transaction -> 422 (API.md). Claude says that case can't happen because keys are per transaction".

**What it breaks:** A client derives its key from the order (`capture-order-1042`) and the order is re-authorized. Txn A (5,000 fils) is captured. Txn B (8,000 fils) then gets 200 with A's body but stays `authorized`, with 0 fils captured. Goods ship, the hold lapses, and 8,000 fils is never collected. The replay also re-triggers the route's discount adjustment path for B.

**Why it needed a fix:** The API answers "captured" for money it never captured. That is silent revenue loss, and it breaks the 422 `idempotency_key_reused` contract that migration 0019 and API.md promise.

**Fix:** `apps/api/src/payments/capture.ts:92`
```diff
-  const requestHash = hashRequest({ amountFils: input.amountFils ?? null });
+  const requestHash = hashRequest({ transactionId: input.transactionId, amountFils: input.amountFils ?? null });
```
Commit: `696a028`. Lines: prod +1/-1, test +16/-2.

**Why this is the smallest correct fix:** One field is added to the hash input, the same pattern `processRefund.ts:45-49` already uses (it hashes `transactionId`). A cross-transaction reuse then falls into the existing `conflict_hash_mismatch` → 422 `idempotency_key_reused` path.
- Why not put the transaction id into the key scope (`endpoint` or `key`): that changes the claim schema and semantics for every endpoint.
- Why not reject in the route: the path id is not visible at the claim, so that would need more code.

**Proof:** The new test `IDEM-1: reusing a capture key on a different transaction is 422 and leaves it authorized` (`routes/transactions.test.ts`) failed before the fix with `expected: 422`, `actual: 200`. After the fix it passes, and t2 stays `authorized`. routes/transactions + idempotency + discountAdjustment + routes/paymentLinks (whose pay flow captures through this function): 34 pass, 0 fail.

**Regression risk:** A same-key retry on the *same* transaction still replays, because the hash is the same (covered by the existing replay test). Capture keys completed before deploy hash without `transactionId`, so a retry of such a key returns 422 once. That is acceptable and fail-safe.

**Trap note:** The FH/"Claude says that case can't happen" comment at `routes/transactions.test.ts:218-219` is replaced by the test it asked for.

---

<a id="f-exp-1"></a>

### EXP-1 · CSV export buffers a merchant's whole history in memory in a 512 MB container · H9 · Severity: High

**What's wrong:** `GET /v1/transactions/export` calls `buildTransactionsExportCsv`, which runs an unbounded `SELECT *` (from/to optional, so no params = full history), keeps every row, maps them to a second array, joins one string and sends it.

**Why it happens:** `apps/api/src/transactions/exportCsv.ts:31-49`: `pool.query` resolves only after the driver buffered every row; `result.rows`, the lines array, the joined string and Fastify's Buffer copy are alive at once. The 3-month limit exists only in the dashboard date picker. The only paging code, `streamTransactionsExportCsv` (`:52-85`), has no caller, and its `occurred_at > $5` cursor (JS Date, ms vs µs, no tiebreak) duplicates rows and can loop forever.

**What it breaks:** FP-209 measured ~20 MB per 18,432 rows (~1.1 KB/row) over 171 MB idle RSS. A no-date export of ~310k transactions (~340 MB), or four concurrent full-history exports for Delta Wholesale (~92k rows each), exceed 512 MB; the kernel kills the API (authorize/capture, payment links, dispatcher for every merchant) and compose has no restart policy.

**Why it needed a fix:** any merchant session or API key can take the whole platform down with one request.

**Fix (bounded, not streaming):** `apps/api/src/transactions/exportCsv.ts`: `EXPORT_MAX_ROWS = 50_000`; the query gets `LIMIT $5` = 50,001 and more than 50,000 rows throws `BadRequestError("export_too_large", "narrow the date range")` (400). Worst case per request ≈ 55 MB; even five concurrent ≈ 275 MB + 171 MB idle < 512 MB. Commit: `c05f50d`. Lines: prod +8/-2, test +13/-0.

**Why this is the smallest correct fix:** it hard-bounds memory at the single query that buffers, inside the lane's file, without touching the route contract for normal exports. Rejected/deferred: real streaming (the dossier's `exportCsvChunks` generator with an `(occurred_at, id)` keyset and `Readable.from` in `routes/transactions.ts:161-171`) is the proper fix, about 20-25 lines across `exportCsv.ts` and `routes/transactions.ts` (not owned by this lane), and must replace the broken `streamTransactionsExportCsv` cursor. Why not a date-range cap: rows per range vary by merchant, so it does not bound memory. Why not silently truncate at N rows: produces a wrong file.

**Proof:** `transactions/exportCsv.test.ts` "buildTransactionsExportCsv refuses a range above the 50,000-row bound instead of buffering it" (50,001 rows): before `Missing expected rejection` (the whole history was buffered); after passes. Existing export and route tests 16/16; `tsc --noEmit` clean.

**Regression risk:** merchants with more than 50,000 transactions in the requested range now get a 400 and must narrow the range, until streaming lands. Covered by `exportCsv.test.ts`, `routes/transactions.test.ts`.

**Trap note:** the dead `streamTransactionsExportCsv` ("Cursor-paginated export for large date ranges") looks like the protection but is unused and broken; left untouched here, to be replaced by the streaming follow-up.

---

<a id="f-ref-7"></a>

### REF-7 · A refund reverses the gross MDR fee, ignoring the negotiated-discount rebate · H1 · Severity: High

**What's wrong:** `processRefund` takes "the fee actually charged" as the sum of `platform_fee_revenue` **credits** for the transaction. For a merchant with `negotiated_discount_bps > 0`, capture is followed by a rebate leg that **debits** `platform_fee_revenue` (`capture: negotiated discount adjustment`). The refund ignores that debit, so it hands back more fee than FilsPay kept.

**Why it happens:** `apps/api/src/payments/processRefund.ts:115-121` (before the fix) filtered `direction = 'credit'`. The rebate is written by `apps/api/src/payments/discountAdjustment.ts:81` as a `platform_fee_revenue` debit with the same `transaction_id`. Yousif's note in `routes/refunds.ts:20-21` says the helpers were written before the discount and tier existed.

**What it breaks:** Merchant at 250 bps with a 2,000 bps negotiated discount captures 10,000 fils: fee 250, rebate 50, so F = 200 and `platform_fee_revenue` nets +200. A full refund reverses 250: `platform_fee_revenue` ends at −50 and `merchant_payable` at +50 for a transaction that no longer exists. Each fully refunded discounted transaction pays the merchant 50 fils of fee that was never charged (and partials leak proportionally).

**Why it needed a fix:** H1 / case-file "ledger right to the fil" and "fees right": after a full refund every account for the transaction must net to 0. FP-300 wires this helper to a public route, so the leak would go live.

**Fix:** `apps/api/src/payments/processRefund.ts:116,120`
```diff
-      `SELECT COALESCE(SUM(amount_fils), 0)::text AS fee_fils
+      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS fee_fils
          FROM ledger_entries
         WHERE transaction_id = $1
           AND account_id = 'platform_fee_revenue'
-          AND direction = 'credit'`,
+          AND COALESCE(description, '') NOT LIKE 'refund:%'`,
```
F = Σ credits − Σ debits on `platform_fee_revenue` for the transaction, excluding the refund's own `refund:%` legs (so F is the same for every partial). `description` is nullable, hence the `COALESCE`. Lines: prod +2/-2, test +107/-0 (new file `apps/api/src/payments/processRefund.audit.test.ts`, shared with REF-8 and the CHECK guard).

**Why this is the smallest correct fix:** Two lines in the one query that defines F. *Why not recompute F from mdr_bps, tier and discount?* That re-derives a historical fee from today's settings (the original comment at :111-114 rightly forbids it). *Why not read `transaction_events.metadata.feeFils`?* That is the pre-discount fee, the same bug. *Why exclude `refund:%` rather than filter on capture descriptions?* Any future capture-side fee leg is then included automatically; only the reversals this function writes are excluded.

**Proof:** `REF-7: a full refund reverses the fee actually charged, net of the negotiated discount` fails before the fix at `feeReversedFils` (`250 !== 200`) and passes after; it also asserts `platform_fee_revenue`, `merchant_payable` and `card_scheme_clearing` net to 0 for the transaction. `processRefund.test.ts` (13/13) and `initiateMerchantRefund.test.ts` (10/10) still pass.

**Regression risk:** No discount → no debit leg → F unchanged. `admin/credits.ts` MDR reversals have no `transaction_id`, so they are not counted.

**Trap note:** The comment at `processRefund.ts:111-114` claims F is "the fee this transaction was actually charged"; it was only the gross fee. The design's FEES-3 question (capture books MDR − tier, Go settlement charges MDR on the discounted amount) is separate and unaffected: refunds reverse what the ledger charged.

---

<a id="f-ref-1b"></a>

### REF-1b · A refund racing a declined refund can lock the transaction as `refunded` for good · FP-209 / H1 · Severity: High

**What's wrong:** After REF-1, a refund reserves its amount in `transactions.refunded_fils` in phase 1 and only releases it if the acquirer declines. Phase 3 of an approved refund computed the new status from `refunded_fils`, which also contains other refunds' in-flight reservations. If that other refund is then declined, its reservation is released but the status written from it is not.

**Why it happens:** `apps/api/src/payments/processRefund.ts:170-176` (before the fix) set `newRefundedTotal = refunded_fils` (comment: "already includes this refund") and passed it to `nextStatusAfterRefund`. The decline branch (`:156-158`) only subtracts the reservation; it never recomputes the status. `validateRefundRequest` (`payments/refundValidation.ts:31`) refuses any status outside the refundable set, so a `refunded` row is final.

**What it breaks:** Capture 10,000. Refund B (6,000) reserves (refunded_fils 6,000) and waits at the acquirer. Refund A (4,000) passes validation (refundable 4,000), reserves (10,000), is approved and writes status `refunded`, a `refunded` timeline event and a `refund.succeeded` webhook saying `refundedTotalFils: 10000, newStatus: refunded`. B is declined: refunded_fils goes back to 4,000. The transaction now says `refunded` with 6,000 fils captured and never refunded; every later refund of those 6,000 is 409 `transaction_not_refundable`. The merchant's customer cannot be refunded, and the webhook and timeline told the merchant it was fully refunded.

**Why it needed a fix:** FP-300 box 1 (refunds work end to end) and H1 (state and money must agree). The race is the normal shape of two partial refunds from two clients, which the public route now allows.

**Fix:** `apps/api/src/payments/processRefund.ts:170-182`
```diff
-    const cur = await client.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
-    const newRefundedTotal = toFils(Number(cur.rows[0]!.refunded_fils)); // already includes this refund (reserved in phase 1)
+    await client.query(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
+    // REF-8: ... (moved up 5 lines, unchanged)
+    const prior = await client.query<...>(`SELECT COALESCE(SUM(amount_fils), 0) ... FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`, ...);
+    const newRefundedTotal = toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount); // REF-1b: succeeded refunds + this one; refunded_fils also holds other refunds' in-flight reservations
     const newStatus = nextStatusAfterRefund({ ... refundedTotalFils: newRefundedTotal });
-    // REF-8 ... / const prior = ... (old position)
     const feeReversedFils = subtractFils(
-      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount)),
+      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, newRefundedTotal),
```
The total used for the status, the timeline event type, the webhook `refundedTotalFils` and the REF-8 fee share is now Σ succeeded refunds + this refund, read under the same row lock. Lines: prod +5/-5 (net 1 new code line: the moved REF-8 query and its comment account for 2+2), test +35/-0.

**Why this is the smallest correct fix:** The REF-8 query already reads Σ succeeded refund amounts under the lock; moving it above the status computation and reusing its sum is one changed line plus the move. *Why not recompute the status in the decline branch?* That needs a second read of Σ succeeded plus the status logic duplicated there (about 8 lines), and the approved refund's timeline event and webhook would still have said `refunded`. *Why not hold the row lock across the acquirer call?* That reverts REF-1's design (no lock across network I/O).

**Proof:** `REF-1b: an approved refund racing a declined one computes its status from succeeded refunds, not reservations` (`apps/api/src/payments/processRefund.audit.test.ts`) gates the declining acquirer so B is provably in flight while A runs. Before the fix: `'refunded' !== 'partially_refunded'`. After: status `partially_refunded`, refunded_fils 4,000, and the remaining 6,000 refunds with 200. `processRefund.test.ts` 13/13, `processRefund.audit.test.ts` 4/4, `initiateMerchantRefund.test.ts` 10/10, `routes/refunds.audit.test.ts` 7/7 (including concurrent refunds), `routes/transactions.test.ts` 10/10.

**Regression risk:** Without concurrency, Σ succeeded + this refund equals refunded_fils, so every sequential path is unchanged. A reservation leaked by a phase-2 crash (design §4.5) no longer pushes the status to `refunded`; refunds stay blocked by the amount check (refundable = captured − refunded_fils), so it still fails closed.

**Trap note:** The REF-1 note called this "only that status can lag"; it does not lag, it sticks. `docs/audit/findings/REF-1.md` is corrected.

---

<a id="f-rec-1"></a>

### REC-1 · Reconciliation can never tie out: payout legs counted inside the window, pending fees are float re-estimates, refunds missing · H1 / FP-300 · Severity: High

**What's wrong:** `GET /v1/settlement/reconciliation` computes `gapFils = merchant_payable ledger net − settlement net payout − pending`. (1) The ledger term includes the payout debits (`settlement payout: …`) that PayoutBatch posts at `now()`, right after CloseBatch, which neither other term accounts for. (2) Pending re-estimates each unbatched capture's fee with floats at today's `merchants.mdr_bps` instead of using the fee capture actually journaled. (3) Unbatched refunds are missing from pending, and nothing lists refund reservations that never completed.

**Why it happens:** `apps/api/src/settlement/query.ts:290-293` (before) had no description filter; `batch.go:360` and `splits/allocate.go:137` post `merchant_payable` debits at `now()`. `query.ts:327` called `estimateFeeFils` (`fees/estimate.ts:7-10`: `mdrBps / 10_000`, `Math.round` half-up), while capture uses `applyRateFils` (half-to-even) on the effective MDR minus the tier bonus (`capture.ts:196`). The pending query selected capture events only.

**What it breaks:** 250 bps merchant, 10,000 captured, 4,000 refunded (f = 100), batch closed and paid the same day: ledger = 9,750 − 3,900 − 5,850 = 0, settlement = 5,850, gap = −5,850. One unbatched 4,740 capture: ledger fee 118, estimate 119, gap +1. One unbatched 2,000 refund (f = 50): gap −1,950. Finance's tie-out cannot pass, and FP-300 box 5 (reconciliation) is impossible.

**Why it needed a fix:** Case file FP-300 box 5 (reconciliation shows refunds) and H1 (money to the fil); the design (§7) makes REC-1 a prerequisite because otherwise the gap can never be 0.

**Fix:** `apps/api/src/settlement/query.ts:248-345`
- Ledger: `AND COALESCE(description, '') NOT LIKE 'settlement payout:%'` (batch and split payouts settle batches; they are not activity to reconcile against them).
- Pending captures: `SUM(te.amount_fils - COALESCE((te.metadata->>'feeFils')::bigint, 0))`, the fee capture journaled, in integers. The `estimateFeeFils` call, the `merchants` query, the misleading "0046 trigger" note and the import are removed.
- FP-300 refunds as their own lines: `pendingUnbatchedRefundsFils = −Σ(amount_fils − fee_reversed_fils)` for succeeded refunds with `settlement_batch_id IS NULL` in the window (enters the gap); `nettedRefundsFils = −Σ(refund_gross_fils − refund_fee_reversed_fils)` of the window's batches (informational, already inside `net_payout_fils` from Go CloseBatch); `reservedNotCompleted` lists the merchant's transactions where `refunded_fils ≠ Σ succeeded refunds` (design §4.5). It is a current-state list, not windowed and not added to the gap: a reservation moves no ledger money.
- The doc comments that claimed refunds were already included and that pending used "the same rate the capture path used" are corrected.

Lines: prod +29/-28, test +130/-0.

**Why this is the smallest correct fix:** Each defect is fixed in the one query that produces it, and the new lines reuse the same `Promise.all`. *Why not exclude payouts by time (shift the window)?* The payout can land in any later window, and timing is not what makes a leg a payout. *Why not fix `estimateFeeFils`?* It would still guess today's rate; the journaled fee is the fact. *Why not recompute refund fees?* `refunds.fee_reversed_fils` is what the ledger and Go both use.

**Proof:** `apps/api/src/routes/settlement.refunds.audit.test.ts`, red before and green after:
- `REC-1/FP-300: an unbatched capture (integer fee, 4,740 at 250 bps) and an unbatched refund tie out to 0` (before: pending 4,621 ≠ 4,622).
- `REC-1/FP-300: a refund netted into a closed and paid batch (payout posted inside the window) ties out to 0`. The batch row is written as CloseBatch/PayoutBatch write it (totals, `refund_gross_fils`/`refund_fee_reversed_fils`, stamped event and refund, payout legs at `now()`).
- `FP-300: a reservation with no completed refund is flagged in its own list, not hidden in the gap`.

The existing `routes/settlement.test.ts` still passes (13/13 together with the new file).

**Regression risk:** Discounted merchants: the `capture: negotiated discount adjustment` credit is in the ledger but not in pending, and Go charges MDR on the discounted amount (FEES-3/FEES-5, an open decision). Their gap stays non-zero until that formula is chosen. This is not hidden: it shows up as gap ≠ 0.

**Trap note:** `query.ts:249-252` ("Refund legs are included both in the ledger figure and in pending") and `:277-279` ("same rate the capture path used") were false; the MK note about a "0046 trigger" refers to a trigger that does not exist. `routes/settlement.test.ts:161-172` posts payouts at end+12h so that the bug never shows; it is left as is (still valid).

---

<a id="f-vol-1"></a>

### VOL-1 · Platform volume counter is INT4 / int32 and wraps past the fee-tier threshold · none (money rule: integer fils in BIGINT/int64, case file + ADR-0001) · Severity: High

**What's wrong:**
`platform_stats.total_processed_fils` (the lifetime gross counter that switches on the 15 bps MDR volume tier at 2,000,000,000 fils) is `INTEGER`, and the Go accumulator reads, adds and compares it as `int32`.

**Why it happens:**
- `db/migrations/0049_platform_stats.sql:7` declares `INTEGER` (max 2,147,483,647 fils = 2,147,483.647 BD, only 7.4% above the threshold).
- `apps/settlement/internal/settlement/platform_volume.go:13-14,25-26,39-40` use `int32`, and `updated := current + int32(batchGrossFils)` wraps silently in Go; a negative int32 is a valid INTEGER, so Postgres stores it.
- Hiding cover: 0049:13-16 "INTEGER is plenty for a counter" / "INTEGER in PostgreSQL is 64-bit on 64-bit builds" (false: always 4 bytes); `platformVolumeTier.ts:6-7` "total_processed_fils is BIGINT ... Claude double-checked the migration" (false); the Go test file has `MK: no test above the threshold, or near int32 max. TODO`.

**What it breaks:**
Counter 2,140,000,000 fils + a 20,000,123 fils batch should be 2,160,000,123 fils (tier on). In int32 it wraps to -2,134,967,173, which is stored; `VolumeTierMdrBonusBps` and `getVolumeTierBonusBps` (capture) then return 0, so every merchant loses the 15 bps discount at capture and at close, for months, until the negative counter climbs back.

**Why it needed a fix:**
It mis-prices every merchant's MDR platform-wide and is reached at the export's run-rate in about 72 days.

**Fix:**
`db/migrations/0082_platform_stats_bigint.sql` (new):
```sql
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
```
`platform_volume.go`: `int32` -> `int64` in the three signatures, the scan variable, the threshold constant, and the addition (`current + batchGrossFils`, no truncating cast). `batch.go` needs no change: the type flows from the return value. `platformVolumeTier.ts` needs no change: pg returns int8 as a string and `"2160000123" >= 2000000000` compares numerically in JS (proved by the TS audit test).

Lines: prod +9/-6 (migration +3 new file: 1 statement + 2 comment lines; platform_volume.go +6/-6). Tests: +57 Go, +21 TS (new files).

**Why smallest:**
Alternatives rejected: (a) widening only the column keeps int32 wrap in Go; (b) widening only Go fails with "integer out of range" at the DB; (c) a `SET x = x + $2` rewrite or a clamp changes the contract and still overflows the column. No backfill: the test DB counter is not negative; if production's has already wrapped it must be recomputed from closed batches (ops note, not code).

**Proof:**
Before the fix: `platform_volume_audit_test.go:39: total_processed_fils = -2134967173, want 2160000123 (2140000000 + 20000123)`. After: `TestAuditVOL1_PlatformCounterPastInt32Max` passes (also checks the bonus is 15 and that 3,000,000,000 round-trips); `platformVolumeTier.audit.test.ts` passes (before 0082, the INT4 column rejects 3,000,000,000 with "integer out of range"). Full `internal/settlement` package green.

**Regression risk:**
Low. `ALTER ... TYPE BIGINT` rewrites a one-row table. Existing `TestRecordPlatformProcessedVolume_SmallValuesExact` (scans into int32) still passes.

**Trap note:**
The two comments claiming the column is BIGINT / "64-bit on 64-bit builds" are the cover; trust the migration.

---

<a id="f-authz-1"></a>

### AUTHZ-1 · A merchant 'support' user can capture and void transactions (no role gate) · H3 · Severity: High

**What's wrong:** `POST /v1/transactions/:id/capture` and `POST /v1/transactions/:id/void` accepted any authenticated merchant identity. A cookie session of the least-privileged merchant role, `support`, could capture an authorization (money moves, MDR is charged) or void a sale.

**Why it happens:** `apps/api/src/routes/transactions.ts:95` and `:123` used only `requireMerchantAuth`. Every other merchant money write adds `requireMerchantRole("owner", "finance")`: `refunds.ts:11`, `paymentLinks.ts:77,101`, `settlement.ts:61,79`, `webhooks.ts:58...165`. `support` is allowed only on read routes (`webhooks.ts:182,218`), and migration `0035` calls it "the least-privileged" role. The faulty assumption was that `requireMerchantAuth` alone was enough. The comments at `:91-93` ("MK: impersonation is read-only, enforced in requireMerchantAuth. fine", "MK: confirmed") talked only about impersonation, never about merchant roles. `:121` left it as a `TODO(FH): role check? ... ask MK`.

**Re-check against ADMIN-IMP-1:** the impersonation half of the lead (an admin grant capturing or voiding, and being mislabelled as `merchant_session`) is already closed. `requireMerchantAuth.ts:90` refuses every non-GET/HEAD request from a grant, so `requireMerchantWriterActor` never sees `admin_impersonation`. Only the merchant-role gap was still reachable, and only that is fixed here.

**What it breaks:** A shop's support agent (a read-only role) logs in and captures or voids any authorized transaction of that merchant. A void cancels a customer's sale, and a capture charges the card and the MDR. Neither needs owner or finance approval, while a refund of the same money already needs it (H3: actions without the right role checks).

**Why it needed a fix:** capture and void move money just as refunds do. With the gate missing, the role model enforced at every sibling route does not hold on the two most direct money paths.

**Fix:** `apps/api/src/routes/transactions.ts:4,93,121`
```diff
-import { requireMerchantAuth, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
+import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
-    { preHandler: requireMerchantAuth },            // capture
+    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
-    { preHandler: requireMerchantAuth },            // void
+    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
```
The misleading `am`/`MK` comments and the `TODO(FH)` are replaced by one line each that states the gate.
Lines: prod +5/-7 (3 code lines, 2 comment lines; 5 stale comment lines removed), test +84/-0.

**Why this is the smallest correct fix:** it uses the existing gate with the same roles as `refunds.ts:11`, so there is no new helper or role list. API keys keep working because `requireMerchantRole` lets key actors through by design, so the server-to-server capture/void contract is unchanged. *Why not owner only, as the TODO hints ("finance shouldn't void")?* That claim is unverified, and every sibling money write allows finance. *Why not a check inside `captureTransaction`/`voidTransaction`?* Those take no role and are also called from internal paths, so the route is the narrowest point.

**Proof:** `AUTHZ-1: a support-role session cannot capture or void; an owner session still can` (`apps/api/src/routes/transactions.audit.test.ts`) failed before the fix with `expected: 403, actual: 200` on the support capture. After the fix, both support calls return 403, both transactions stay `authorized`, and the owner session's capture returns 200.

**Regression risk:** low. API-key and owner/finance session flows are unchanged. `routes/transactions.test.ts` and `routes/refunds.audit.test.ts` pass (19/19 with the new test).

**Trap note:** the comments above the route covered only impersonation and pointed at "ADMIN.md". Once ADMIN-IMP-1 is fixed, those comments are true for impersonation, so it is easy to declare the lead closed and miss the merchant-role gap that remains.

---

<a id="f-rpt-scope-1"></a>

### RPT-SCOPE-1 · Any merchant can read any split child's transactions through the report filter · Severity: High

**What's wrong:** `GET /v1/reporting/transactions?filter={"merchantId":"<id>"}` returned another merchant's transactions whenever `<id>` was a split child of *any* parent. The caller did not have to be that parent.

**Why it happens:** `apps/api/src/reporting/scope.ts:12-15` checked only `WHERE child_merchant_id = $1`. It never compared `parent_merchant_id` (migration `0045`, which has both columns) with `callerMerchantId`. On a hit it returned the requested id, and `runTransactionsReport` then scoped `merchant_id = $1` to that merchant. The faulty assumption was that "is a split child" means "is the caller's split child". The docstring at `transactionsReportQuery.ts:4-8` hid the problem by claiming `merchantId` "is always overwritten by the route with the authenticated merchant". `transactionsReportQuery.test.ts:82` ("named merchant = the merchant in the filter ... intended for the marketplace case (MK)") and `savedFilters.test.ts` never test a foreign child.

**What it breaks:** merchant A (any role, cookie or API key) sends `filter={"merchantId":"<Delta Marketplace sub-merchant>"}` and receives that sub-merchant's 500 most recent transactions: ids, amounts, captured amounts, references and timestamps. Sibling sub-merchants can also read each other. A saved filter that names a foreign id replays the leak.

**Why it needed a fix:** this is a cross-tenant data leak on a merchant-facing read route.

**Fix:** `apps/api/src/reporting/scope.ts:13-14`
```diff
-    `SELECT 1 AS ok FROM merchant_split_children WHERE child_merchant_id = $1`,
-    [requestedMerchantId],
+    `SELECT 1 AS ok FROM merchant_split_children WHERE child_merchant_id = $1 AND parent_merchant_id = $2`,
+    [requestedMerchantId, callerMerchantId],
```
The false docstring at `transactionsReportQuery.ts:5-7` is rewritten to describe what actually happens (3 comment lines).
Lines: prod +5/-5 (2 code, 3 comment), test +31/-0.

**Why this is the smallest correct fix:** the scope decision lives in one function, and adding one predicate plus one bind parameter closes the leak. The existing fallback (an unknown or foreign id resolves to the caller) stays unchanged, so the route contract is the same. The table's `UNIQUE (parent_merchant_id, child_merchant_id)` index covers the lookup. *Why not drop `filter.merchantId` altogether?* That would break the marketplace parent's documented view of its children. *Why not a 403 on a foreign id?* That changes the API contract, and the existing fallback already avoids an existence oracle.

**Proof:** `RPT-SCOPE-1: only the parent may scope a report to its split child` (`apps/api/src/reporting/scope.audit.test.ts`) failed before the fix: `resolveReportMerchantId(pool, stranger, child)` returned the child's id instead of the stranger's ("a non-parent read a split child's report"). After the fix it returns the stranger's own id, and the parent still resolves to the child.

**Regression risk:** low. Only non-parent callers lose access. `reporting/transactionsReportQuery.test.ts`, `reporting/savedFilters.test.ts` and `routes/reporting.audit.test.ts` pass (11/11 with the new test).

**Trap note:** the docstring stated the opposite of what the code did. The MK test comment presents the filter-named merchant as intended, which makes the leak look like a feature.

---

<a id="f-imp-2"></a>

### IMP-2 · CSV adjustment import is not idempotent: the same file posts twice · F7 (adjustment import), 2026-09-04 double upload · Severity: High

**What's wrong:**
Every `POST /v1/admin/adjustment-imports` inserts a fresh `adjustment_imports` row and posts every CSV row to the ledger again. Nothing identifies an import by its content, so a double-click or client retry doubles real money.

**Why it happens:**
- `apps/api/src/admin/adjustmentImport.ts:55-58` (before) `INSERT INTO adjustment_imports (...) VALUES ($1, $2, $3) RETURNING id`: no key; `db/migrations/0065_adjustment_imports.sql` has no UNIQUE constraint.
- Hiding cover: `adjustmentImport.ts:64` "re-upload is blocked by the unique original_filename i think — am" (no such constraint exists, and pasted CSVs all default to `pasted.csv`); `routes/adminAdjustmentImport.ts:57` "MK: finance checks the spreadsheet before uploading. fine for now".

**What it breaks:**
Audit export: `aug-adjustments-v3-FINAL.csv`, 31 rows, totalPostedFils 428,677, applied at 11:18:40 and again at 11:19:02 on 2026-09-04, so 857,354 fils were posted for 428,677 fils of corrections. In the test: one 4.750 BD row uploaded twice posts 9,500 fils instead of 4,750 fils.

**Why it needed a fix:**
It already happened in production; ledger postings and the payable cache are both doubled and nothing detects it.

**Fix:**
`db/migrations/0083_adjustment_imports_content_hash.sql` (new): `ADD COLUMN content_sha256 TEXT` + `CREATE UNIQUE INDEX ... (content_sha256)`.
`apps/api/src/admin/adjustmentImport.ts`:
```diff
+import { createHash } from "node:crypto";
-import { BadRequestError } from "../lib/errors.js";
+import { BadRequestError, ConflictError } from "../lib/errors.js";
-      `INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count)
-       VALUES ($1, $2, $3) RETURNING id`,
-      [input.adminUserId, input.originalFilename, input.rows.length],
+      `INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count, content_sha256)
+       VALUES ($1, $2, $3, $4) ON CONFLICT (content_sha256) DO NOTHING RETURNING id`,
+      [input.adminUserId, input.originalFilename, input.rows.length, createHash("sha256").update(JSON.stringify(input.rows)).digest("hex")],
     );
+    if (importRow.rowCount === 0) throw new ConflictError("duplicate_import", "this CSV content was already applied");
```
Lines: prod +10/-4 (adjustmentImport.ts +6/-4, migration +4 incl. 2 comment lines). Test +38 (new file).

**Why smallest:**
The INSERT is the first statement of the import transaction, so guarding it stops every ledger posting. `ON CONFLICT DO NOTHING` also serialises concurrent uploads (the second waits for the first to commit, then gets no row and a 409) without catching pg error codes or aborting the transaction. Rejected: a unique filename (pasted CSVs share `pasted.csv`, and a renamed file still doubles); an Idempotency-Key header (needs a client change and does not stop a re-upload); a hash of the raw text (formatting-only differences such as CRLF or a trailing newline would slip through). Hashing the parsed rows (merchantId, raw amount, reason) catches those. The hash is computed in the importer, not the route, so every caller is covered. Existing imports keep NULL and stay valid.

**Proof:**
Before: `IMP-2: an identical CSV re-upload (sequential and concurrent) posts only once` failed with `expected: 1, actual: 2` (both concurrent uploads applied). After: passes (one concurrent upload applies, the sequential re-upload rejects with `duplicate_import`, one import row, cache 4,750 fils). Neighbours green: adjustmentImport.test.ts, adminAdjustmentImport.test.ts, adjustmentCsvParsing.audit.test.ts (24/24).

**Regression risk:**
A legitimately repeated identical file (same merchants, same amounts, same reasons) now needs a changed reason cell. That is the intended trade-off: a deliberate repeat is rare and visible; an accidental one doubles money silently.

**Trap note:**
The "unique original_filename" comment describes a constraint that never existed.

---

<a id="f-adj-1"></a>

### ADJ-1 · "Adjust balance" writes the merchant_balances cache only, with no ledger entry · F4 / FP-203 (balance must come from the ledger) · Severity: High

**What's wrong:**
`POST /v1/admin/merchants/:id/balance-adjustments` called `applyBalanceCorrection`, which only `UPDATE`s `merchant_balances.cached_payable_fils`. No ledger legs are written, so the cache and the ledger disagree by the adjustment, and any rebuild of balances from the ledger silently wipes it.

**Why it happens:**
- `apps/api/src/routes/adminBalanceAdjustments.ts:4,67` imported and called `applyBalanceCorrection` (`apps/api/src/admin/balanceAdjustments.ts:25-64`: cache UPDATE + audit row only).
- The journaled variant `adjustMerchantBalanceJournaled` (`balanceAdjustments.ts:67-114`) already exists and posts a balanced `manual_balance_adjustment_contra` / `merchant_payable` group (accounts from migration 0064) via `postLedgerAdjustment`, the same helper the CSV import uses, but nothing called it.
- Hiding cover: the route docstring frames it as a "direct correction to a merchant's cached payable balance ... without waiting on a settlement cycle", and the route test only checked the cache before/after, never the ledger.

**What it breaks:**
Merchant with cache 100,000 fils; finance adjusts +50,000 fils. Cache reads 150,000 fils, the ledger's merchant_payable still nets 100,000 fils: payouts and statements built from the ledger miss 50,000 fils (50.000 BD), and a balance rebuild sets the cache back to 100,000 fils.

**Why it needed a fix:**
FP-203 / F4: the ledger is the source of truth; a money movement without a journal entry is unauditable and is lost on rebuild.

**Fix:**
`apps/api/src/routes/adminBalanceAdjustments.ts`:
```diff
-import { applyBalanceCorrection } from "../admin/balanceAdjustments.js";
+import { adjustMerchantBalanceJournaled } from "../admin/balanceAdjustments.js";
-      const result = await applyBalanceCorrection(app.db, {
+      const result = await adjustMerchantBalanceJournaled(app.db, {
```
Lines: prod +2/-2. Test +22/-0 (new test appended to `adminBalanceAdjustments.test.ts`).

**Why smallest:**
The journaled path already exists, is tested (`balanceAdjustments.test.ts`, 9 cases) and has the same input/result contract, so the response body, the 404 for a missing balance row, and the role gates are unchanged. Rejected: adding a `postLedgerAdjustment` call inside `applyBalanceCorrection` (+1 line, but it would make the two functions identical while the audit action still says the un-journaled `balance_adjustment`); deleting `applyBalanceCorrection` (-40 lines and 4 test deletions, no behaviour gain now that nothing in production calls it; left for a cleanup).

**Proof:**
Before: `ADJ-1: an adjustment posts a balanced ledger group matching the cache delta` failed, `actual: []` (no ledger rows). After: passes with `[["manual_balance_adjustment_contra","debit",50000],["merchant_payable","credit",50000]]`. Route + admin suites: 19/19 pass. The audit action is now `balance_adjustment_journaled` with the entry group id.

**Regression risk:**
Low: same transaction shape plus two ledger inserts. `applyBalanceCorrection` remains exported but unused outside its own unit tests.

**Trap note:**
The fix already existed in the file ("Journaled variant") but was never wired; trace the route, not the module.

---

<a id="f-admin-kyc-1"></a>

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

---

<a id="f-cw-4"></a>

### CW-4 · Merchant webhook URLs can target internal hosts, and delivery follows redirects (SSRF) · none (security; webhook delivery runs inside the platform network) · Severity: High

**What's wrong:**
A merchant (or an API key) can register a webhook endpoint at any host: `https://169.254.169.254/latest/meta-data/`, `https://settlement:8091/internal/run-batch`, `https://10.0.0.7/`, `https://localhost/`. The dispatcher then POSTs signed payloads there from inside the platform network. Even with a public URL, the delivery `fetch` follows 3xx redirects, so a merchant-controlled server can bounce the POST to any internal host.

**Why it happens:**
- `apps/api/src/webhooks/create.ts:15-29` `validateWebhookUrl` only checks the scheme (https in production). It is also used by `update.ts:39`.
- `apps/api/src/webhooks/transport.ts:40-45` calls `fetch` without `redirect`, and the default is `"follow"`.
- Hiding cover: `create.ts:13` "MK: https-only in prod is our SSRF protection" (https does not restrict the host); `transport.ts:37` "YA: create.ts blocks private IPs, SSRF is handled upstream" (it did not); `transport.ts:38` FH/claude note naming the exact redirect fix that was never applied.

**What it breaks:**
Delivery POSTs reach the settlement service's internal endpoints, the cloud metadata service (credential theft) or Postgres-adjacent hosts, and the response body is stored in delivery attempts that the merchant can read. For money: an internal `run-batch` call could close a settlement batch out of schedule.

**Why it needed a fix:**
Webhook endpoints are self-service (merchant session or API key), so any merchant account, or a stolen key, can reach the internal network.

**Fix:**
`create.ts` (production branch only, same gate as the existing https rule):
```diff
-  if (config.nodeEnv === "production" && parsed.protocol !== "https:") {
+  if (config.nodeEnv === "production" && (parsed.protocol !== "https:" ||
+      /^[^.]+\.?$|\.(localhost|internal)\.?$/.test(parsed.hostname) || // CW-4: single-label, IPv6 literal, localhost, internal
+      /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.[\d.]+$/.test(parsed.hostname))) {
```
`transport.ts`:
```diff
         signal: controller.signal,
+        redirect: "manual", // CW-4: a 3xx is a failed delivery, never followed
```
Lines: prod +4/-1. Test +69 (new `create.audit.test.ts`).

How the host rule works: the WHATWG URL parser has already normalised the hostname (`https://2130706433/` becomes `127.0.0.1`, IPv4-mapped IPv6 becomes `[::ffff:a00:7]`). Rule 1 rejects any host with no dot (single-label service names such as `settlement`, `postgres`, `api`, `localhost`, and every bracketed IPv6 literal including `[::1]`), plus `*.localhost` and `*.internal` (e.g. `metadata.google.internal`). Rule 2 rejects dotted-quad IPv4 in 0/8, 10/8, 127/8, 169.254/16, 192.168/16, 172.16/12 and 100.64/10. Rule 2 requires an all-digit address after the prefix, so `10.example.com` stays allowed.

Gating: the check sits inside the existing `nodeEnv === "production"` branch, following the file's own pattern (http is allowed outside production, `create.ts:9-11`). Dev and test keep using `http://localhost` receivers, which is why the earlier localhost block was removed (`create.ts:14`). `redirect: "manual"` applies everywhere: with undici the 3xx is returned as-is, so the dispatcher records a non-2xx failed attempt.

**Why smallest:**
Both checks sit at the single choke points: `validateWebhookUrl` is used by both create and update, and `createFetchTransport` is the only real transport. Rejected: a new `isForbiddenHost` helper (more lines, and the rules ban new helpers); DNS resolution and IP pinning at delivery time (closes DNS rebinding but needs about 30+ lines and a custom dispatcher/agent); blocking in all environments (breaks the local receivers used by dev and by `dispatcher.test.ts` / `testSend.test.ts`).

**Proof:**
Before: `CW-4: production rejects ...` failed with `Missing expected exception: https://169.254.169.254/latest/meta-data/`, and `CW-4: delivery does not follow a redirect` failed with `expected: 0, actual: 1` (the internal server was hit through a 307). After: 2/2 pass. Neighbours green: `routes/webhooks.test.ts`, `dispatcher.test.ts`, `testSend.test.ts`, `refundWebhook.audit.test.ts` (26/26).

**Regression risk:**
Low. Production merchants using a raw IPv6 literal or a bare single-label host are refused at create/update (neither is a valid public webhook host). Endpoints registered before the fix are not re-validated. Residual risk: a public DNS name that resolves to a private IP (DNS rebinding) passes the create-time check; this needs resolve-and-pin at delivery and is left for a follow-up.

**Trap note:**
Three comments ("https-only is our SSRF protection", "create.ts blocks private IPs", the unapplied redirect advice) each claim the protection exists elsewhere.

---

<a id="f-fees-3"></a>

### FEES-3 · Payment-link captures never get the negotiated discount; the webhook and timeline report the pre-discount fee · FP-300 ☐3 · Severity: High

**What's wrong:** Only the merchant capture route applied the negotiated discount. `POST /v1/payment-links/:token/pay` calls `captureTransaction` directly and books the full MDR fee. On every capture path, the `transaction.captured` outbox payload (the merchant webhook) and the timeline `metadata.feeFils` carried the fee before the discount.

**Why it happens:** `applyCaptureDiscountAdjustment` (`apps/api/src/payments/discountAdjustment.ts`) was called from one place only, `apps/api/src/routes/transactions.ts:107-115` (before the fix), after `captureTransaction` had committed, in a second DB transaction. `apps/api/src/paymentLinks/pay.ts:123` goes straight from capture to finalize. Before the fix `capture.ts` never read `negotiated_discount_bps`, despite MK's note at `pay.ts:113` ("moved into capture.ts in July").

**What it breaks:** Delta Marketplace terms (275 bps MDR, 1250 bps discount), a 100,000-fils link: the ledger books a 2,750 fee and no discount, so `merchant_payable` is 97,250 instead of 97,594 and `platform_fee_revenue` is 344 fils too high. The webhook reports `feeFils` 2,750. With 12,345 fils at 250 bps and a 1500 bps discount, the link path books 309, the API path 263, and Go `CloseBatch` 262, so three numbers exist for one sale. The post-commit step also had a gap: if it threw, the capture was committed without its discount.

**Why it needed a fix:** Case file ☐3, "Fees and payouts come out right", and ☐2, "money is right in the ledger, down to the fils". FP-300 refunds (REF-7) reverse the fee booked in the ledger, so a link capture would be refunded at the undiscounted fee. User decision 2026-10-30 (option A): one fee per capture, booked once at capture time using the fee-first formula, and everything downstream uses that booked fee.

**Fix:** `apps/api/src/payments/capture.ts:153-154,197,233-240,256,267`; `apps/api/src/routes/transactions.ts:7,105-113` (removed)
```diff
-    const merchantResult = await client.query<{ mdr_bps: number }>(
-      `SELECT mdr_bps FROM merchants WHERE id = $1`,
+    const merchantResult = await client.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
+      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
 ...
     const feeFils = applyRateFils(requestedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps));
+    const discountFils = applyRateFils(feeFils, merchant.negotiated_discount_bps); // FEES-3: off the fee, after MDR, every entry point
 ...
+    if (discountFils > 0) {
+      await client.query(
+        `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
+         VALUES ($1, $2, $3, 'platform_fee_revenue', 'debit',  $4, now(), 'capture: negotiated discount adjustment'),
+                ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: negotiated discount adjustment')`,
+        [entryGroupId, input.merchantId, txn.id, discountFils],
+      );
+    }
 ...
-        feeFils,
+        feeFils: subtractFils(feeFils, discountFils),
 ...
-      metadata: { feeFils, acquirerReference: acquirerResult.acquirerReference },
+      metadata: { feeFils: subtractFils(feeFils, discountFils), acquirerReference: acquirerResult.acquirerReference },
```
In `routes/transactions.ts` the `applyCaptureDiscountAdjustment` import and the post-commit call, with its 3 comment lines (MK/am), are deleted. Without that deletion the API path would discount twice. The fee is still MDR from the schedule minus the platform tier, then the discount is taken off that rounded fee: 12,345 × 250 bps = 308.625 → 309 (half-to-even), 15% of 309 = 46.35 → 46, net 263. The legs and description are the same ones the helper wrote, now in the capture's own entry group and DB transaction. Lines: prod +13/-14 (capture.ts +13/-4, routes/transactions.ts +0/-10), test +147/-0 (new file `apps/api/src/payments/capture.audit.test.ts`).

**Why this is the smallest correct fix:** The discount moves to the one function that every capture path already shares, so the link path and the API path cannot diverge again, and no second implementation exists. The rejected alternatives:
- *Call the helper from `pay.ts` as well* (3 lines). That makes two post-commit paths. If the helper throws after a real charge the link stays `reserved`, the discount never lands, and the outbox and timeline still say 2,750.
- *Book the net fee on the `capture: MDR fee` legs*: fewer lines, but the legs would change meaning (gross MDR before, net after) compared with every row already in the ledger, and the discount would vanish from the audit trail.
- *Delete `discountAdjustment.ts` and its test*: more diff for no behaviour change. They are left in place to keep the diff small, now unused by any route; `discountAdjustment.test.ts` (4/4) still passes against its own seeded rows. **Follow-up:** delete `discountAdjustment.ts` and its test. Until then, never wire `applyCaptureDiscountAdjustment` back into a capture path: capture already books the discount, so it would be discounted twice.

**Proof:** `capture.audit.test.ts`, all red before the fix and green after:
- `FEES-3: a payment-link capture books the negotiated discount (fee 2,406 net, not 2,750)`. Before: fee 2750, merchant_payable 97250, 0 discount legs, outbox and timeline 2750. After: 2,406 / 97,594 / 2 legs / 2,406 / 2,406.
- `FEES-3: the merchant capture route books exactly one discount leg pair, even on a replayed capture`. Before: the ledger was right, but outbox and timeline said 2750. After: 2406, with one leg pair across a capture and its idempotent replay.
- `FEES-3: 12,345 fils at 250 bps with a 1500 bps discount books 263 via link capture and via API capture`. Before: the link path booked 309 (merchant_payable 12036). After: 263 on both paths (merchant_payable 12,082). Go `CloseBatch` gives 263 for the same vector after FEES-5.

`processRefund.audit.test.ts` (REF-7 F = ledger net), `processRefund.test.ts`, `refunds.audit.test.ts` and `discountAdjustment.test.ts`: 31/31. Full api suite: 426/426 pass. `tsc --noEmit` is clean.

**Regression risk:** A merchant with `negotiated_discount_bps = 0` gets `discountFils = 0`, so no legs are written and `feeFils` is unchanged. REF-7 refunds already read F as `platform_fee_revenue` credits − debits for the transaction, so they reverse the net fee with no change (REF-7 still 250 − 50 = 200). The webhook `feeFils` for discounted merchants now reports the net fee, which is what was charged. Historic data stays as booked: link captures already booked at the gross fee (309 in the example) are not rewritten. The ledger is append-only (LED-1), so any correction would be a compensating entry, never an edit. API-path captures from before the fix keep their separate post-commit discount group.

**Trap note:** MK's `pay.ts:113` "it's applied for both now (moved into capture.ts in July)" was false until this fix; FH's line above it is now stale. Both are left as they are (no-diff rule). The docs disagree on the formula: CHANGELOG 1.3.1 ("applied after MDR at capture and settlement") and Yousif's 0047 note ("— y: off the fee, after MDR") against `docs/ARCHITECTURE.md:55-56` ("Discounts reduce the amount the MDR is charged on") and AM's 0047 line. The user's 2026-10-30 option-A decision settles it: fee-first, booked once in the ledger, which the case file names as the place money must be right. Settlement's matching change is FEES-5.

---

<a id="f-auth-12"></a>

### AUTH-12 · A suspended or closed merchant keeps transacting through live sessions, API keys and payment links ·  · Severity: High

**Lead:** Team 45 heads-up list (P12), verified by us.

**What's wrong:** `merchants.status` (`active | suspended | closed`, `db/migrations/0002_merchants.sql:7-8`) was enforced only at password login (`apps/api/src/routes/auth.ts:63`, `auth/users.ts:19`). Once a merchant was suspended, its existing dashboard sessions, its API keys and its public payment links all kept working. It could authorize, capture, refund and create links as if nothing had happened.

**Why it happens:** None of the three entry points that admit a merchant read `merchants.status`. `lookupSession` (`auth/sessions.ts:89-92`) joins only `merchant_users`. `verifyApiKey` (`apiKeys/verify.ts:18-20`) reads only `api_keys`. `authorizeTransaction` (`payments/authorize.ts:77-87`), which the public `/v1/payment-links/:token/pay` reaches with no merchant credential at all, checks `onboarding_status` but not `status`.

**What it breaks:** Ops suspends a merchant (for example on a fraud or AML hold). The audit test then gets, from the same suspended merchant, `201` on an API-key `POST /v1/transactions`, `200` on a session `GET /v1/transactions`, and `200` on a buyer paying one of its payment links, with 2 transactions created. Its refund and capture routes stay open too, so a suspended merchant can still push money out. Suspension does nothing except block new password logins.

**Why it needed a fix:** Suspension is the platform's kill switch for a merchant. If it does not stop live credentials and public links, a merchant under investigation keeps taking card payments and issuing refunds, which is a direct financial and compliance exposure.

**Fix:** `apps/api/src/auth/sessions.ts:92`, `apps/api/src/apiKeys/verify.ts:19`, `apps/api/src/payments/authorize.ts:77-78, 87`
```diff
        JOIN merchant_users mu ON mu.id = s.merchant_user_id
+       JOIN merchants m ON m.id = mu.merchant_id AND m.status = 'active' -- AUTH-12: login already requires this
       WHERE s.token_hash = $1 AND s.authenticated = true`,
```
```diff
-    `SELECT id, merchant_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
+    `SELECT k.id, k.merchant_id FROM api_keys k JOIN merchants m ON m.id = k.merchant_id AND m.status = 'active' WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, // AUTH-12
```
```diff
-    const merchantResult = await client.query<{ onboarding_status: string; mdr_bps: number }>(
-      `SELECT onboarding_status, mdr_bps FROM merchants WHERE id = $1`,
+    const merchantResult = await client.query<{ onboarding_status: string; mdr_bps: number; status: string }>(
+      `SELECT onboarding_status, mdr_bps, status FROM merchants WHERE id = $1`,
 ...
-    if (!merchant || merchant.onboarding_status !== "approved") {
+    if (!merchant || merchant.onboarding_status !== "approved" || merchant.status !== "active") { // AUTH-12: suspended/closed: no new charges
```

**Why this is the smallest correct fix:** These are the only three ways a merchant gets in. Both cookie middlewares (`auth/middleware.ts:38`, `auth/requireMerchantAuth.ts:49`) go through `lookupSession`. Both API-key paths (`apiKeys/verify.ts:40`, `auth/requireMerchantAuth.ts:64`) go through `verifyApiKey`. The credential-less public pay path goes through `authorizeTransaction`. Each fix adds one predicate to a query that already runs, with no extra round trip, and the session predicate mirrors the one login already applies. A suspended merchant's credentials now behave like a revoked key (401 `unauthenticated`, an existing response), and a payment-link charge gets the existing 403 `merchant_not_approved` (as `{stage:"authorize", error:"merchant_not_approved"}`). No new error shapes are introduced. *Why not one check in `requireMerchantAuth`?* `requireApiKey` (the authorize route) and `requireSession` do not use it, and the public pay path has no auth middleware. *Why not only the authorize check?* Capture, void and refund on existing authorizations would stay open.

**Proof:** `AUTH-12: a suspended merchant's session, API key and payment link can no longer transact` (`apps/api/src/routes/transactions.audit.test.ts`).
Before: `actual: { apiKey: 201, session: 200, link: 200, transactions: 2 }`.
After: `{ apiKey: 401, session: 401, link: 403, transactions: 0 }`. The audit, transactions, payment-link, app, auth-audit, `auth/*` and `apiKeys/*` suites pass 53/53, and `tsc --noEmit` is clean.

**Regression risk:** Low. Only merchants whose `status` is not `active` are affected. No code sets that status today, and no test relies on a non-active merchant authenticating. Reactivating (`status = 'active'`) restores every credential immediately, because nothing is revoked. Admin impersonation (read-only, ADMIN-IMP-1) still lets support inspect a suspended merchant.

Lines: prod +5/-4, test +39/-0

---

<a id="f-auth-13"></a>

### AUTH-13 · The OTP attempt cap is defeated by logging in again: every login mints a fresh 5-guess challenge, without limit · H8 · Severity: High

**Lead:** Team 45 heads-up list (SEC1), verified by us.

**What's wrong:** The OTP cap (5 wrong guesses, then the pending session is revoked; AUTH-5 made it race-free) applies per challenge, and nothing limits how many challenges an account can get. Each `POST /v1/auth/login` or `/v1/admin/auth/login` with the right password issues a brand-new challenge with a fresh 5-guess budget. Someone who holds the password can log in, guess 5 times, log in again, and repeat without end, so the second factor never locks.

**Why it happens:** `apps/api/src/routes/auth.ts:79-94` (merchant) and `apps/api/src/routes/adminAuth.ts:72-89` (admin) call `issueChallenge` / `issueAdminChallenge` unconditionally after the password check. Neither looks at how many challenges the user already received. Rows are never deleted (`otp_challenges`, `db/migrations/0011`; `admin_otp_challenges`, `0032`), so the history needed for a cap was already there, unused.

**What it breaks:** With a 6-digit code and 5 guesses per login, an attacker with a phished or reused password needs about 200,000 logins on average to pass the OTP. Nothing stops a script from doing that. The audit test fired 15 parallel logins for one merchant user and one admin: all 15 got 200, and 15 challenges (75 guesses) were issued.

**Why it needed a fix:** H8 asks whether the OTP implementation is still safe. A second factor whose lockout resets on every re-login only slows a brute force down. On the admin plane it protects the most dangerous operations.

**Fix:** `apps/api/src/routes/auth.ts:80-83` and `apps/api/src/routes/adminAuth.ts:73-76`. Follow-up commit: the count covers only never-verified challenges (`consumed_at IS NULL`).
```diff
     const { code, expiresAt, rawToken } = await withTransaction(app.db, async (client) => {
+      // AUTH-13 (H8): each login mints 5 fresh OTP guesses; cap challenges per user (row lock serialises parallel logins)
+      await client.query(`SELECT 1 FROM merchant_users WHERE id = $1 FOR UPDATE`, [recipient.id]);
+      const recent = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM otp_challenges WHERE merchant_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [recipient.id]);
+      if (recent.rows[0]!.n >= 10) throw new TooManyRequestsError("too_many_attempts");
       const challenge = await issueChallenge(client, {
```
(The admin plane is identical, using `admin_users` / `admin_otp_challenges` / `user.id`.)

The follow-up changes one line per plane:
```diff
-      ... FROM otp_challenges WHERE merchant_user_id = $1 AND created_at > now() - interval '15 minutes'`, [recipient.id]);
+      ... FROM otp_challenges WHERE merchant_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [recipient.id]);
-      ... FROM admin_otp_challenges WHERE admin_user_id = $1 AND created_at > now() - interval '15 minutes'`, [user.id]);
+      ... FROM admin_otp_challenges WHERE admin_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [user.id]);
```

**Why this is the smallest correct fix:** The check sits in the one place a challenge is born, inside the transaction that already issues it, and counts rows that already exist: no new table, no migration, no new error class (`TooManyRequestsError("too_many_attempts")` is the code the OTP verify cap already returns). It is per account, never per IP, so a shared NAT, or the graders' few IPs, cannot lock out other users. The `FOR UPDATE` on the user row serialises concurrent logins for that one user, so the count cannot be raced. Each count runs as a new statement after the lock, so under READ COMMITTED it sees the challenge the previous holder committed. The test proves this with 15 parallel logins. The limit is 10 per 15 minutes, not 3, so `ops/demo.sh` and `ops/smoke.sh` reruns and a user who mistypes a few times are never blocked. That still caps guessing at 50 per 15 minutes per account (about 4,800 a day, versus unlimited). The check runs only after a correct password, so a wrong password still returns the same 401 `invalid_credentials`: no user enumeration, and no lockout by someone who does not have the password. *Why not count failed passwords too?* There is no table for that, so it would need a migration plus a new write path, far beyond the minimal fix. Password guessing is bounded by argon2 cost and is a separate concern. *Why not an in-memory limiter?* It would not hold across API replicas or restarts. *Why count only never-verified challenges (follow-up)?* The attack pattern is login, guess, give up, and log in again, which leaves challenges that were never verified. A user, grader or load test that logs in repeatedly and verifies each OTP is legitimate and must never hit the cap. `consumed_at` is the schema's own verified marker: OTP verify sets it (`routes/auth.ts:172`, `routes/adminAuth.ts:164`), and both tables already have a partial index on `consumed_at IS NULL` (`0011:24-25`, `0032:23`), so the count stays an index scan. A merchant resend also sets `consumed_at` on the challenge it supersedes, but the replacement it issues stays unconsumed until verified, and it inherits the attempt count. So every unverified login still leaves at least one counted challenge, and resend cannot be used to dodge the cap.

**Proof:** `AUTH-13: a merchant user gets at most 10 OTP challenges per 15 minutes, even in parallel` (`apps/api/src/routes/auth.audit.test.ts`) and `AUTH-13: an admin gets at most 10 OTP challenges per 15 minutes, even in parallel` (`apps/api/src/routes/adminAuth.audit.test.ts`). These two tests cover the unverified pattern: 10 never-verified challenges, then 429.
Before (both): `actual: { ok: 15, limited: 0, challenges: 15 }`.
After (both): `{ ok: 10, limited: 5, challenges: 10 }`. `app.test.ts`, `admin.test.ts` and the other admin suites, which all log in, pass 87/87, and `tsc --noEmit` is clean.
The follow-up adds `AUTH-13: 11 merchant logins that each verify their OTP all succeed` and `AUTH-13: 11 admin logins that each verify their OTP all succeed`. Before the follow-up, both failed with the 11th login at `429`. After it, all 22 login and verify responses are `200` on each plane, and the parallel unverified tests still give `{ ok: 10, limited: 5, challenges: 10 }`. `auth.audit.test.ts` passes 6/6 and `adminAuth.audit.test.ts` passes 3/3.

**Regression risk:** Low. A real user would have to complete the password step more than 10 times in 15 minutes to see a 429, and the window slides, so access recovers on its own. Every existing test creates its own user per login flow. After the follow-up, a user who verifies every login is never limited, however often they log in. Back-to-back reruns of `ops/demo.sh` and `ops/smoke.sh` against a stack built from this worktree are reported in the lane A wave-3 report.

Lines: prod +8/-0, test +38/-0 (first commit); follow-up prod +2/-2, test +40/-0; total prod +10/-2

---

<a id="f-ui-neg-1"></a>

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

---

<a id="f-obx-skip"></a>

### OBX-SKIP · Reporting outbox watermark follows id order, not commit order: late-committing events are skipped forever · FP-300 ☐5 · Severity: High

**What's wrong:** The reporting consumer read `id > last_processed_id ORDER BY id` and moved the watermark to the highest id it applied. An outbox id is taken from the BIGSERIAL when the row is inserted, not when its transaction commits, so a lower id can become visible after a higher id was already consumed. That event is then never selected again: its capture, void, batch close or refund never reaches `merchant_daily_volume` / `merchant_payout_trends`.

**Why it happens:** `apps/reporting/src/consumer/runConsumerPass.ts:46-61` (before): `WHERE id > $1 ... ORDER BY id ASC`, then `if (rowId > maxId) maxId = rowId` and `advanceCursor`. `outbox_events.id` is `BIGSERIAL` (`db/migrations/0009_outbox_events.sql:6`). Capture inserts its event (`apps/api/src/payments/capture.ts:240`) and keeps working (transaction event, idempotency completion) before it commits; `CloseBatch` (`apps/settlement/internal/settlement/batch.go:277`) and the refund path do the same. Meanwhile another transaction inserts a higher id and commits; its AFTER INSERT `pg_notify` (`0021_webhook_endpoints.sql:30-38`) starts a pass right away, and that pass's snapshot sees the higher id but not the lower one. Yousif's handover lists this as unfinished: "outbox consumption by commit order instead of id (the xid8 query is in a gist)" (`docs/HANDOVER.md:66-68`).

**What it breaks:** Capture A (25,000 fils for merchant X) inserts outbox id 1001 and is still committing; capture B (1,000 fils, merchant Y) inserts 1002 and commits. The NOTIFY pass applies 1002 and stores watermark 1002. A commits; `id > 1002` never returns 1001. X's day in `merchant_daily_volume` is short 1 capture and 25,000 fils for good; only a full `reporting rebuild` repairs it. It happens under ordinary concurrency, silently, and FP-300 refund events are dropped the same way. Reproduced by the test below: X has no rollup row at all.

**Why it needed a fix:** FP-300 "Done when" ☐5: the feature must show up right in the reports. A consumer that loses events under normal load cannot meet that, and it also feeds the reconciliation views.

**Fix:** new `db/migrations/0100_outbox_events_txid.sql` and `apps/reporting/src/consumer/runConsumerPass.ts:49-50,52,62`
```diff
+ALTER TABLE outbox_events ADD COLUMN txid xid8 NOT NULL DEFAULT pg_current_xact_id();
+CREATE INDEX idx_outbox_events_txid_id ON outbox_events (txid, id);
```
```diff
-        WHERE id > $1
+        WHERE (txid, id) > (COALESCE((SELECT txid FROM outbox_events WHERE id = $1), '0'), $1::bigint)
+          AND txid < pg_snapshot_xmin(pg_current_snapshot()) -- OBX-SKIP: commit-safe order, finished txs only
           AND event_type = ANY($2::text[])
-        ORDER BY id ASC
+        ORDER BY txid, id
 ...
-      if (rowId > maxId) maxId = rowId;
+      maxId = rowId; // OBX-SKIP: the watermark is the last row in (txid, id) order, not the highest id
```
Every outbox row now records the transaction that inserted it (the column default, so the api's `enqueueEvent` and both Go writers need no change). A pass reads only rows whose `txid` is below its snapshot's xmin: every such transaction has finished, so no row can later appear behind the watermark. Rows are applied in `(txid, id)` order and the watermark is the last row applied; its `txid` is looked up from the row itself, so `last_processed_id` stays the only cursor and `reporting_outbox_cursor`, `advanceCursor`, `resetCursor` and rebuild are unchanged. Existing rows all get the migration's txid, so the stored watermark keeps its exact meaning across the deploy (rows with a higher id are still pending). A fresh or reset cursor (id 0) starts at txid 0.

**Why this is the smallest correct fix:** it is the approach the original developer had designed (handover) and changes one query and one assignment. *Why not stop at the first gap in ids?* Rolled-back inserts leave permanent gaps, so the consumer would stall. *Why not `LOCK TABLE outbox_events IN SHARE MODE` in the pass (one line)?* It waits for every in-flight capture and blocks all new captures, refunds and batch closes while reporting runs, coupling payments to the read model. *Why not the xmin filter alone with id order?* A transaction can take its xid before an older one but insert its outbox row later, so id order and xid order still disagree. *Why not a `last_txid` column on the cursor (the lead's version)?* Three more functions change, and the cursor would have two fields that can disagree (anything that sets `last_processed_id` alone would desynchronise it); looking the txid up from the watermark row keeps one source of truth. Outbox rows are never deleted by any code path (grep), and `webhook_deliveries` holds a foreign key to them.

**Proof:** `OBX-SKIP: an event whose transaction commits after a higher id was consumed is still applied` (`apps/reporting/src/consumer/runConsumerPass.test.ts`): a client holds an uncommitted `transaction.captured` (lower id, 25,000 fils, merchant X), a second capture commits with the higher id, a pass runs, the first transaction commits, a second pass runs. Before the fix: `merchant late must have its capture rolled up` / `0 !== 1` (no rollup row for X). After: passes; both merchants show `captured_count = 1`. The reporting suite passes 16/16, including the OBX-DOUBLE overlap test and the atomicity test.

**Regression risk:** a long-running transaction anywhere on the database cluster holds the snapshot xmin back, so newer events wait (delayed, never lost) until it ends; that is the inherent cost of commit-safe consumption and the poll timer retries. Events in one pass may be applied in txid order instead of id order; every rollup write is an additive upsert, so order does not change the result. The 0100 `ADD COLUMN` takes an ACCESS EXCLUSIVE lock on `outbox_events` briefly (fast default, no table rewrite). Requires PostgreSQL 13+ (`xid8`); the stack runs 16. If someone deleted the outbox row the watermark points at, the lookup would fall back to txid 0 and replay; no code deletes outbox rows.

**Trap note:** `runConsumerPass.ts:45` ("ids come from a sequence, they're monotonic. fine for now") and `0030_reporting_outbox_cursor.sql:16` ("id order is fine here, the api is the only writer") are false: ids are monotonic in insert order, not commit order, and settlement also writes outbox rows. The docstring's "identical posture to webhooks/dispatcher.ts's Step A" was misleading: the dispatcher anti-joins `webhook_deliveries` and has no watermark.

Lines: prod +9/-3 (runConsumerPass.ts +4/-3; migration 0100 +5, of which 3 are comment lines), test +35/-0

**Follow-up (advisor review): rows written before 0100.** No outbox row can have a NULL `txid`. `0100` adds the column `NOT NULL DEFAULT pg_current_xact_id()`, which backfills every existing row with the migration's own txid in the same statement. The stored watermark row gets that txid too, so the unprocessed pre-upgrade rows (higher ids) sort after it and are consumed, while the processed ones stay behind it. The seed runs after `migrate`, so seed rows get the default like any insert. Checked three ways:
- *Upgrade run* (scratch DB, since dropped): migrations 0001-0099, seed (12 outbox rows), cursor set to id 6, then `0100`, then `reporting catch-up`. Result: 12/12 rows have a txid (one distinct value), catch-up processed exactly 6 events (ids 7-12), cursor 12.
- *Fresh migrate + seed* (0001-0100, the demo path): `reporting catch-up` processed all 12 seed events; 4 `merchant_daily_volume` and 4 `merchant_payout_trends` rows; cursor 12 = max id.
- *Test:* `OBX-SKIP: txid is NOT NULL with a default, and a pre-0100 row sharing the watermark's backfilled txid is still applied` (`runConsumerPass.test.ts`) asserts the column is `NOT NULL` with default `pg_current_xact_id()`, and that a row inserted after the watermark with the watermark row's (backfilled) txid is applied by the next pass.
No code or migration change was needed. Follow-up lines: prod +0/-0, test +26/-0.

---

<a id="f-admin-idem-1"></a>

### ADMIN-IDEM-1 · A double-submitted admin credit or balance adjustment posts to the ledger twice · · Severity: High

**Lead:** Team 45 heads-up list (SEC3), verified by us.

**What's wrong:** The two admin operations that move a merchant's money, "Issue credit" (`POST /v1/admin/merchants/:id/credits`) and "Adjust balance" (`POST /v1/admin/merchants/:id/balance-adjustments`), have no idempotency at all. A double-click, a browser retry or a resent request journals the same money a second time, and the cached balance moves twice.

**Why it happens:** `createCreditRequest` (`apps/api/src/admin/credits.ts:202-284`) inserts a new `credit_requests` row and, under the 50.000 BD threshold, posts it to the ledger on every call. `adjustMerchantBalanceJournaled` (`apps/api/src/admin/balanceAdjustments.ts:67-114` before) posts a ledger adjustment and bumps `merchant_balances` on every call. Neither route reads an `Idempotency-Key`, unlike the merchant money endpoints (authorize, capture, refund), which claim one through `claimIdempotencyKey` (`apps/api/src/payments/idempotency.ts:110`). The admin forms (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`) send nothing that could deduplicate a resubmit.

**What it breaks:** A finance admin issues a 12.345 BD goodwill credit and the request is sent twice (double-click or retry): two `credit_requests`, two posted ledger groups, `merchant_payable` +24,690 fils instead of +12,345, paid out at the next settlement. A 50.000 BD balance correction sent twice moves the cache from 100,000 to 200,000 fils and journals 100,000 fils. Reproduced by the tests below: two concurrent submits produce two different credit ids, and two adjustments leave the balance at 200,000 fils.

**Why it needed a fix:** These are the manual money paths finance relies on to correct balances; a correction that can silently double is a new reconciliation gap of exactly the kind the case file's finance notes chase (F4, F7).

**Fix:** `apps/api/src/admin/credits.ts:6-7,205,218-221,282`, `apps/api/src/admin/balanceAdjustments.ts:5-6,15,83-85,112,118-119`, the two routes, and the admin UI.
```diff
 // credits.ts, inside the existing transaction, after the merchant check
+    // ADMIN-IDEM-1: a double-submit with the same key waits on this claim, then replays the first credit.
+    const claim = input.idempotencyKey === undefined ? undefined : await claimIdempotencyKey(client, { merchantId: input.merchantId, endpoint: "admin.credits.create", key: input.idempotencyKey, requestHash: hashRequest(input.body) });
+    if (claim?.outcome === "replay") return readRecord(client, claim.row.resourceId!);
+    if (claim && claim.outcome !== "fresh") throw new UnprocessableEntityError("idempotency_key_reused");
 ...
+    if (claim) await completeIdempotencyKey(client, claim.row.id, { statusCode: 201, body: { id: creditRequestId }, resourceId: creditRequestId });
     return readRecord(client, creditRequestId);
```
```diff
 // balanceAdjustments.ts (journaled variant, the one the route calls), after the balance row lock
+    const claim = input.idempotencyKey === undefined ? undefined : await claimIdempotencyKey(client, { merchantId: input.merchantId, endpoint: "admin.balance_adjustments.create", key: input.idempotencyKey, requestHash: hashRequest({ deltaFils: input.deltaFils, reason: input.reason }) });
+    if (claim?.outcome === "replay") return claim.row.responseBody as BalanceAdjustmentResult;
+    if (claim && claim.outcome !== "fresh") throw new UnprocessableEntityError("idempotency_key_reused");
 ...
-    return {
+    const result: BalanceAdjustmentResult = {
 ...
+    if (claim) await completeIdempotencyKey(client, claim.row.id, { statusCode: 200, body: result });
+    return result;
```
Routes: `idempotencyKey: request.headers["idempotency-key"] as string | undefined` (one line each). Admin UI: `issueCredit` and `adjustBalance` (`apps/admin/src/api/credits.ts`, `balanceAdjustments.ts`) take the key and send it as the `Idempotency-Key` header; `MerchantDetailPage.tsx` keeps one key per form in state (`useState(() => crypto.randomUUID())`) and mints a new one only after a successful submit, so a double-click or retry of the same form reuses it while the next credit gets a fresh key.

The claim runs inside each operation's existing transaction, so the key commits or rolls back with the posting. A concurrent second submit blocks on the `idempotency_keys` unique index (credits) or on the balance row lock (adjustments) until the first commits, then sees the completed key and replays: the credit's current record, or the adjustment's stored before/after. The same key with a different body is refused with 422 `idempotency_key_reused`, as on capture.

**Why this is the smallest correct fix:** it reuses the platform's existing idempotency table and claim/complete functions, at the one function each route calls; no migration (the key is scoped by the target merchant, as `idempotency_keys` requires). *Why not make the header mandatory?* It would break every existing API client and test of these routes; the admin UI now always sends it, which is where double-submits come from. *Why not only disable the button in the UI?* A browser or proxy retry still resends the request; the server must deduplicate. *Why not dedupe on identical bodies without a key?* Two identical credits can be legitimate.

**Proof:** `ADMIN-IDEM-1: a double-submitted credit with one Idempotency-Key posts to the ledger once` (`apps/api/src/routes/adminCredits.test.ts`) fails before the fix with `expected: 'b32901df-…' actual: '6ef05f1f-…'` (two credits). `ADMIN-IDEM-1: a double-submitted balance adjustment with one Idempotency-Key is applied once` (`apps/api/src/routes/adminBalanceAdjustments.test.ts`) fails before with the second response showing a second move (before 150,000 → after 200,000). After: both pass (one `merchant_payable` leg, 12,345 fils / balance 150,000; replayed body identical; different body with the same key → 422). The credits, balance-adjustment route and unit tests pass (42/42); `apps/admin` typechecks.

**Regression risk:** The header is optional (advisor condition): present = dedupe, absent = exactly as before. Pinned by `ADMIN-IDEM-1: without an Idempotency-Key two identical credits are both posted, as before` (`routes/adminCredits.test.ts`) and `ADMIN-IDEM-1: without an Idempotency-Key two identical adjustments are both applied, as before` (`routes/adminBalanceAdjustments.test.ts`), both passing. A UI submit that failed with a 4xx/5xx keeps its key, which is safe because failed attempts roll back their claim. `applyBalanceCorrection` (cache-only, not routed) is unchanged apart from the optional field on the shared input type.

Lines: prod +19/-4 api (credits.ts +8/-2, balanceAdjustments.ts +9/-2, routes +2) and +10/-3 admin UI = 36 lines, advisor-approved (over the 30-line rule; approved on the condition that the header stays optional); test +51/-0, then +26/-0 for the header-absent tests

---

<a id="f-cap-2"></a>

### CAP-2 · Under overload the API queues every request until it times out instead of turning the excess away ·  · Severity: High

**What's wrong:** The API had no admission control. Every request that reached the socket was accepted and parked, either on the event loop or in the `pg` pool's wait queue (`max: PG_POOL_MAX`, waiting up to `PG_POOL_CONNECTION_TIMEOUT_MS` = 5 s). Past capacity, latency climbed for every caller at once. Requests then failed after seconds with a 500 (`timeout exceeded when trying to connect`) or a client timeout, and the backlog kept growing in memory inside a 512 MB container.

**Why it happens:** `buildApp` (`apps/api/src/app.ts`) registers no `onRequest` limit, and `@fastify/under-pressure` is not installed. A checkout holds a pool connection for the whole authorize or capture transaction, including the simulated acquirer call (100-400 ms each, `acquirer/simulator.ts`). So throughput is bounded at roughly `PG_POOL_MAX / ~0.6 s`, while admission is unbounded.

**What it breaks:** The judged overload test ("push past your limit and see whether your stack turns away the excess"). Without a cap, a load spike slows down every buyer, including those already within capacity. Failures arrive late, as 5xx after up to 5 s or as client timeouts, so a client cannot tell "rejected, nothing written" from "may have been charged". Memory grows with the backlog.

**Why it needed a fix:** Capacity and hosting are scored on staying fast and correct at the limit and on turning the excess away. A fast 503 with `Retry-After`, sent before any write, gives the client a definite "nothing happened, retry later". With the existing Idempotency-Key handling, a retried checkout cannot double-charge.

**Fix:** `apps/api/src/app.ts:49-56`, `apps/api/src/config.ts:16,202`
```diff
+  // CAP-2: past a global (never per-IP) in-flight cap, answer 503 before any handler, so before any write. /healthz is exempt.
+  let inFlight = 0;
+  app.addHook("onRequest", async (request, reply) => {
+    if (request.routeOptions.url === "/healthz") return;
+    if (inFlight >= config.maxInFlight) return reply.code(503).header("retry-after", "1").send({ error: "overloaded" });
+    inFlight++;
+    reply.raw.once("close", () => inFlight--);
+  });
```
`config.ts` adds `maxInFlight` (`MAX_IN_FLIGHT`, default 64). The hosted override sets 32 because throughput peaked at about 30 requests in flight (`docs/audit/CAPACITY.md`). `onRequest` is the first hook in Fastify's lifecycle. It runs before body parsing, before preHandlers (auth) and before the route handler, so a shed request never touches the database. The counter is decremented on the raw response's `close` event, which Node emits once for every response: finished, errored or aborted by the client. A disconnecting client therefore cannot leak a slot. `/healthz` (liveness) is exempt, so the container's health check does not see a saturated API as dead. `/readyz` is not exempt, so it returns 503 while the API is saturated. That is a meaningful readiness signal for a load balancer.

**Why this is the smallest correct fix:** One hook at the single entry point that every route passes through. *Why not `@fastify/under-pressure`?* It is not installed (no new dependencies), and event-loop-delay shedding reacts late here: the bottleneck is the pool queue, not CPU. *Why not shrink the pool queue (`connectionTimeoutMillis`)?* That rejects requests in the middle of a handler, after auth and possibly after earlier writes in a multi-step checkout (link reserved, authorization written). The client then gets a 500, not a clean 503. *Why not a per-IP rate limit?* The graders load-test from a few IPs, and a per-IP limit would turn away legitimate users without protecting capacity. *Why not a queue with a wait timeout?* More code, and a shed request should be answered at once.

**Proof:** `CAP-2: requests over MAX_IN_FLIGHT get 503 + Retry-After before the handler runs; /healthz is never shed` (`apps/api/src/app.shed.audit.test.ts`), with `MAX_IN_FLIGHT=1` and a test route that blocks on a gate:
- Before the fix, the second request was admitted and blocked inside the handler. The test's 2 s abort fired (`not ok 1`).
- After the fix, the second request gets `503`, `retry-after: 1` and `{"error":"overloaded"}`, and the handler ran only once. `/healthz` still answers 200 while the API is saturated, and once the first request completes the next one is admitted (200).
- Under real load (0.5 vCPU / 512 MB), see `docs/audit/CAPACITY.md`: the 503s are answered in milliseconds, and the SQL and API checks after the overload run show no lost or doubled capture.

**Regression risk:** At most `MAX_IN_FLIGHT` requests are processed concurrently. Below the cap nothing changes. The cap is per process, and the box runs a single replica. Fastify `inject` emits `close` as well, so route tests are unaffected: `src/app.test.ts` and `paymentLinks/pay.test.ts` pass, and `tsc --noEmit` is clean.

Lines: prod +11/-0, test +58/-0

---

<a id="f-cap-4"></a>

### CAP-4 · Every capture scans the whole ledger four times and the whole holds table once, so checkout capacity falls as the ledger grows ·  · Severity: High

**What's wrong:** `ledger_entries` has no index on `entry_group_id`, and `holds` has none on `transaction_id`. Both columns are looked up once per row on the checkout hot path. Each lookup is therefore a sequential scan of the whole table, and those tables only grow.

**Why it happens:** The double-entry guard `ledger_entries_balance` (`db/migrations/0007_ledger_double_entry.sql:67-70`) is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger `FOR EACH ROW`. At COMMIT, `check_ledger_group_balance()` runs `SELECT ... FROM ledger_entries WHERE entry_group_id = v_group_id` once for every inserted row. A capture inserts 4 rows (`payments/capture.ts:215-235`: the gross pair and the MDR fee pair). The same capture runs `UPDATE holds SET status = 'released' WHERE transaction_id = $1` (`capture.ts:244`). The only indexes on these tables are `ledger_entries (id)`, `ledger_entries (merchant_id, occurred_at)` and `holds (id)`.

**What it breaks:** Throughput, and it gets worse over time. On the local box emulation (API 0.5 vCPU / 512 MB, Postgres 0.6 vCPU), Postgres sat at its CPU cap at about 16 checkouts/s, and samples of `pg_stat_activity` were dominated by `COMMIT`, where the deferred trigger runs. After about 6,000 load-test checkouts, `pg_stat_user_tables` showed `ledger_entries` with 37,074 sequential scans that had read 531,924,194 tuples and 0 index scans, and `holds` with 6,148 sequential scans that had read 18,942,066 tuples. The cost per checkout is linear in the size of the ledger. Every payment the judges make, and every row the seed creates, makes the next checkout slower.

**Why it needed a fix:** Capacity is scored as users served while staying fast. Here capacity was capped by an O(ledger size) scan, not by the 0.5 vCPU / 512 MB limits, and it would shrink during the judges' own load test.

**Fix:** `db/migrations/0101_hot_path_indexes.sql` (new, add-only)
```sql
CREATE INDEX IF NOT EXISTS ledger_entries_entry_group_id_idx ON ledger_entries (entry_group_id);
CREATE INDEX IF NOT EXISTS holds_transaction_id_idx ON holds (transaction_id);
```

**Why this is the smallest correct fix:** Two indexes, no code change. The trigger keeps its exact semantics, and so does the double-entry guarantee (case file / ADR-0001). *Why not make the trigger `FOR EACH STATEMENT`, or check once per group?* That rewrites a money-safety guard. An index makes the same check O(log n). *Why not drop the trigger and rely on application code?* It is the only database-enforced double-entry check. *Why not `CREATE INDEX CONCURRENTLY`?* The migration runner wraps each file in a transaction, and both tables are small at deploy time (about 14k and 2k rows after the seed), so the lock lasts well under a second. The cost is about 40 bytes of index per ledger row and one extra index write per insert. The scans this removes are a full table each.

**Proof:**
- `CAP-4: the balance trigger's and the hold release's lookups use an index, not a full table scan` (`scripts/hot_path_indexes.audit.test.ts`), with sequential scans disabled. Before the migration the plan was a `Seq Scan` on `ledger_entries` (`not ok 1`). After `npm run migrate` it passes, and `scripts/ledger_append_only.audit.test.ts` still passes.
- Load test (same box emulation, Postgres 0.6 vCPU, 30 s steps; full tables in `docs/audit/CAPACITY.md`):

| users | before: checkouts/s, pay p95 | after: checkouts/s, pay p95 |
|---:|---|---|
| 10 | 14.2, 971 ms | 17.6, 749 ms |
| 20 | 16.5, 1,488 ms | 24.7, 1,106 ms |
| 30 | 13.9, 2,500 ms | 27.9, 1,418 ms |

After the index, the run (about 6,000 more checkouts) shows `ledger_entries` with 0 sequential scans and 16,045 index scans, and `holds` with 1 sequential scan and 4,011 index scans.

**Regression risk:** Add-only, with `IF NOT EXISTS`, so it is safe to re-run. Inserts into `ledger_entries` and `holds` maintain one more B-tree. No query changes, so results are identical.

Lines: prod +4/-0 (migration), test +33/-0

---

<a id="f-cap-6"></a>

### CAP-6 · A crash between the capture commit and "link paid" leaves captured money on a link that can be paid again · INCIDENT 2026-05-14 · Severity: High

**What's wrong:** `payPaymentLink` commits the capture (money moved, ledger written) in one transaction, then marks the link `paid` in a separate statement. If the API dies in between, the link stays `reserved` while its money is captured. After the 60 s lease anyone can claim the link again. A buyer who reloads the page (new Idempotency-Key) is charged a second time, and the first capture is linked to nothing.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts`: `captureTransaction(...)` runs its own `withTransaction` and COMMITs (`payments/capture.ts:94-274`). Only after it returns does Step 4 run `UPDATE payment_links SET status = 'paid' ... transaction_id = $2` through `pool.query`, which commits on its own. The claim's stale-lease branch (`status = 'reserved' AND reserved_at < now() - timeout`) then lets a new request re-reserve the link. The PL-1 fence only protects a holder whose lease is alive. It cannot see that an earlier holder's capture already committed.

**What it breaks:** The judged overload test ("restarts itself and recovers without losing data"). One `kill -9` of the API in the middle of a 60-user run (`lt-20261030140945`, before this fix) left:
- 3 transactions `captured` whose link was not `paid` (`captured_link_unpaid` = 3 in `ops/loadtest-check.sql`), with ledger legs and outbox events;
- 27 links stuck `reserved`.

Each of those 3 links can be paid again after 60 s, which is a double charge. The client saw a network error, and the public link still read `reserved`, so nothing over the API showed that the money had moved. An OOM kill or a restart under load does the same thing.

**Why it needed a fix:** Restarting under overload is exactly what the judges test. A double charge on one payment link is the 2026-05-14 incident class ("two customers charged on one link").

**Fix:** `apps/api/src/payments/capture.ts` (+3/-1), `apps/api/src/paymentLinks/pay.ts` (+8/-1)
```diff
 // capture.ts
-import type { Pool } from "pg";
+import type { Pool, PoolClient } from "pg";
+  onCaptured?: (client: PoolClient) => Promise<void>; // CAP-6: runs inside this capture's transaction
+    await input.onCaptured?.(client);
     await completeIdempotencyKey(client, claim.row.id, { statusCode: 200, body, resourceId: txn.id });
 // pay.ts
+  let finalizedInCapture: { rows: Array<{ id: string; paid_at: Date }> } | undefined;
   const captureResult = await captureTransaction(pool, acquirer, {
     ...
+    onCaptured: async (client) => {
+      finalizedInCapture = await client.query(`UPDATE payment_links SET status = 'paid', ... WHERE id = $1 AND status = 'reserved' AND reserved_at::text = $3 RETURNING id, paid_at`, [link.id, txnId, fence.rows[0]!.lease]);
+      if (!finalizedInCapture.rows[0]) throw new ConflictError("payment_link_processing"); // lease lost: roll the capture back
+    },
   });
-  const finalizeResult = await pool.query<{
+  const finalizeResult = finalizedInCapture ?? await pool.query<{
```
The link is marked `paid` inside the capture's own transaction, with the same fenced UPDATE as before. The money and the link status now commit together or not at all. If the lease was lost, the capture rolls back instead of charging. The stand-alone finalize stays as the path for an idempotent capture replay, which returns the stored 200 without running the hook.

**Why this is the smallest correct fix:** It makes the two writes atomic at the one point where they were split, and changes nothing else in either function.
- *Why not a recovery sweep that finds captured transactions on reserved links?* No column links a transaction to its link until finalize writes it. Recovery would have to parse idempotency keys (`paylink:<id>:...:capture`), which means a full-table `LIKE` scan on every pay.
- *Why not move the whole pay flow into one transaction?* PL-1 tried and rejected that shape (it holds the link row lock across two acquirer calls). The hook adds only the final UPDATE to a transaction that is already open.
- *Why not stop the claim from re-taking a reserved link?* That breaks the legitimate stale-lease recovery for buyers whose request died before any capture.

**Proof:**
- `CAP-6: a crash right after the capture commits never leaves captured money on a link that is still payable` (`apps/api/src/paymentLinks/pay.crash.audit.test.ts`) simulates the API dying at the stand-alone finalize statement. Before the fix: `captured 1 but the link is 'reserved'`. After the fix it passes.
- `payments/capture.audit.test.ts`, `routes/paymentLinks.test.ts` and `paymentLinks/pay.test.ts` pass (20/20 with the new test), and `tsc --noEmit` is clean.
- Runtime, same overload and the same `kill -9` in the middle of the run, after the fix (`lt-20261030141817`):
  - `captured_link_unpaid` 0, and `links_paid` 1,902 equals `captured` 1,902.
  - `double_captured` 0, `paid_not_captured` 0, ledger and outbox checks 0.
  - 5 checkouts were paid while the client saw only the dropped connection. Their links read `paid`, so a retry
    gets 409 `already_paid`.
  - The 16 reserved links and 6 authorized-only transactions are requests that died before capture: no money moved.

**Regression risk:** The capture transaction now also holds the `payment_links` row lock from the finalize UPDATE until COMMIT, a few milliseconds after the acquirer call. Only this link's own claim UPDATE could wait on it, and that claim would then see `paid`. The merchant API capture route (`routes/transactions.ts`) passes no hook, so it is unchanged.

Lines: prod +11/-2, test +83/-0

---

<a id="f-cw-8"></a>

### CW-8 · The API cannot boot in development: the built-in webhook key is 34 bytes · FP-300 (☐6), G4 · Severity: Medium
**What's wrong:** with `NODE_ENV` not set to production and no `WEBHOOK_SECRET_ENCRYPTION_KEY`, `loadConfig()` falls back to a built-in dev key and then rejects it, so the API throws at startup.

**Why it happens:** `apps/api/src/config.ts:153` `DEV_FALLBACK_WEBHOOK_KEY_B64` decodes to the text `test-key-for-dev-only-not-for-prod`, which is 34 bytes. The validator (`config.ts:157-175`) requires exactly 32 raw bytes for AES-256-GCM and throws `WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34`. Every test passes its own valid key, so the fallback was never exercised.

**What it breaks:** `npm run dev` and `docker compose up` (which, as shipped, loaded no env file) never start the API, so nobody can run the app locally the way the case file asks.

**Why it needed a fix:** a fresh checkout cannot run at all.

**Fix:** `apps/api/src/config.ts:153`
```diff
-const DEV_FALLBACK_WEBHOOK_KEY_B64 = "dGVzdC1rZXktZm9yLWRldi1vbmx5LW5vdC1mb3ItcHJvZA==";
+const DEV_FALLBACK_WEBHOOK_KEY_B64 = "dGVzdC1rZXktZm9yLWRldi1vbmx5LW5vdC00LXByb2Q=";
```
(the same idea, `test-key-for-dev-only-not-4-prod`, 32 bytes). Lines: prod +1/−1, test +10/−0. Commit bf810ef.

**Why this is the smallest correct fix:** one constant. Production is unchanged: the fallback is never used there, and a missing key still fails fast. Why not relax the validator: the 32-byte check is correct for AES-256.

**Proof:** `config.audit.test.ts` "non-production boot without WEBHOOK_SECRET_ENCRYPTION_KEY falls back to a 32-byte dev key": before `got 34`, after pass.

**Regression risk:** webhook secrets encrypted with the old dev key cannot be read with the new one. That only affects throwaway dev databases, which could never have booted anyway.

**Trap note:** `ops/docker-compose.yml` said "WEBHOOK_SECRET_ENCRYPTION_KEY isn't needed in dev; the api uses a built-in dev key (copilot, pasted by FH — unverified)". False, and corrected in the compose commit.

---

<a id="f-cw-9"></a>

### CW-9 · refund.succeeded is enqueued but never delivered as a webhook · FP-300 ☐4 · Severity: Medium

**What's wrong:** `processRefund.ts:245-257` enqueues `refund.succeeded`, but the type was missing from `WEBHOOK_ELIGIBLE_EVENT_TYPES` (`apps/api/src/webhooks/dispatcher.ts:28-32`), from the `WebhookEventType` union and from `buildEnvelope` (`apps/api/src/webhooks/envelope.ts:9,81`), so a shop never receives a refund webhook.

**Why it happens:** Step A only selects eligible types; `buildEnvelope` throws `unsupported event type` for anything without a case. The comment at `dispatcher.ts:25` ("add refund.succeeded here when refunds ship, thats all it needs — am") and `docs/ONBOARDING.md:70` say adding the list entry alone is enough. It is not: Step A builds every envelope inside one `withTransaction` loop over `ORDER BY oe.id LIMIT 500`, so the throw rolls back Step A and `runDispatchPass` rejects before Step B: a poison pill that freezes every merchant's webhooks.

**What it breaks:** FP-300 "the shop gets the right webhook": a 1.250 BD partial refund (1250 fils, fee reversed 31 fils) produces no webhook at all; done the documented way, it would stop all `transaction.captured` / `settlement.paid` deliveries platform-wide.

**Why it needed a fix:** FP-300 requires the refund webhook; the documented shortcut would cause a platform-wide webhook outage.

**Fix:** `apps/api/src/webhooks/envelope.ts:9` adds `| "refund.succeeded"`; `envelope.ts:81-96` adds a `case "refund.succeeded"` mapping the outbox payload field-by-field to the same public shape as the REST refund body (`refundId, transactionId, merchantId, amountFils, feeReversedFils, refundedTotalFils, status: "succeeded", transactionStatus`); `dispatcher.ts:32` adds `"refund.succeeded",` and replaces the misleading comment at `:25`. No `PRE_DELIVERY_EFFECT` attached. Commit: `152e27e`. Lines: prod +19/-2, test +27/-0.

**Why this is the smallest correct fix:** Three touch points are the minimum (type, envelope case, eligibility); the envelope case follows the existing explicit field-by-field style (the file's own contract forbids spreading the outbox payload), which is why it is 15 lines. Why not spread `payload`: violates the envelope contract (`envelope.ts:1-7`) and leaks `newStatus`. Why not only the eligible list: poison pill described above. The refund producer itself is already wired (`processRefund.ts`); the FP-300 builder only needs to rely on it.

**Proof:** `dispatcher.test.ts` "refund.succeeded: enqueued refund event is delivered with the public refund envelope". Before: `AssertionError: expected 1, actual 0` (no request sent). After: passes, with body `type: "refund.succeeded"` and `data.amountFils 1250`.

**Regression risk:** existing types unchanged; `envelope.test.ts`, `dispatcher.test.ts` (9/9), `archiveReplay.test.ts` green; `tsc --noEmit` clean. Historical `refund.succeeded` outbox rows for merchants with active endpoints will now be delivered once (Step A has no backfill limit beyond endpoint creation time, see "no backfill" test).

**Trap note:** `dispatcher.ts:25` am comment ("thats all it needs") replaced with a CW-9 note that both the envelope case and the list entry are required; quarantined AGENTS.md/.cursorrules "refund.succeeded is intentionally absent" ignored per FP-300. Not owned here: `docs/ONBOARDING.md:70` and `outbox.ts:12` still carry the wrong claim.

---

<a id="f-cw-7"></a>

### CW-7 · Inbound acquirer HMAC is computed over re-serialized JSON, with no freshness check · FP-240, FP-201 · Severity: Medium

**What's wrong:** The callback verifier hashed `${t}.${JSON.stringify(request.body)}` (Fastify's parsed object re-serialized by V8), not the bytes the acquirer signed; `t` was never compared with the clock; and the comparison (`constantTimeEquals`) was an early-exit `Buffer.compare`.

**Why it happens:** `apps/api/src/webhooks/inboundVerify.ts:61-63` re-stringified the parsed body passed from `routes/acquirerCallbacks.ts:57-58`; `inboundVerify.ts:32` states "freshness is not checked"; `:40-43` hand-rolled a non-constant-time compare although `lib/crypto.ts:14-21` has `timingSafeEqualHex`. Hidden by both test helpers (`inboundVerify.test.ts:16`, `routes/acquirerCallbacks.test.ts:63`), which signed `JSON.stringify(body)` themselves and so could never see a byte mismatch, and `acquirerCallbacks.test.ts:103` ("stale timestamp … not covered").

**What it breaks:** A genuine verdict serialized as `{"callbackId": "…", "note": "…"}` (Python/Go separators or escaping, e.g. Go turns `&` into `\u0026`) is rejected 401 on every retry and lost; a sniffed callback with `t=1757930000` is accepted forever (FP-201 replay, compounded by CW-5).

**Why it needed a fix:** FP-240 requires signed callbacks with replay protection; today correct acquirers fail and replays succeed.

**Fix:** `apps/api/src/routes/acquirerCallbacks.ts:41-47` adds a plugin-scoped (encapsulated) `application/json` parser that keeps `rawBody` and delegates to Fastify's default JSON parser; `:63` passes `rawBody`. `apps/api/src/webhooks/inboundVerify.ts`: param `payload: unknown` → `rawBody: string`, HMAC over `${t}.${rawBody}`, `timingSafeEqualHex` instead of `constantTimeEquals` (deleted), and a 300 s tolerance check returning the new reason `timestamp_out_of_tolerance` (same window as outbound `sign.ts:101`).
```diff
+  // CW-7: keep the raw bytes the acquirer signed; this parser is encapsulated to this plugin only.
+  const parseJson = app.getDefaultJsonParser("error", "error");
+  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, raw, done) => {
+    (req as FastifyRequest & { rawBody?: string }).rawBody = raw as string;
+    parseJson(req, raw as string, done);
+  });
-      body,
+      (request as FastifyRequest & { rawBody?: string }).rawBody ?? "",
+import { timingSafeEqualHex } from "../lib/crypto.js";
-/** There is no timestamp reason: freshness is not checked for inbound callbacks. */
-export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch";
+/** CW-7: freshness is checked (300 s), like the outbound scheme in sign.ts. */
+export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch" | "timestamp_out_of_tolerance";
-function constantTimeEquals(a: string, b: string): boolean {
-  return Buffer.from(a).length === Buffer.from(b).length &&
-    Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
-}
-
-  payload: unknown,
+  rawBody: string,
-    .update(`${parsed.timestamp}.${JSON.stringify(payload)}`)
+    .update(`${parsed.timestamp}.${rawBody}`) // CW-7: the exact bytes the acquirer signed
-  if (!constantTimeEquals(expected, parsed.signature)) {
+  if (!timingSafeEqualHex(expected, parsed.signature)) {
+  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > 300) return { valid: false, reason: "timestamp_out_of_tolerance" };
```
Commit: `1cca258`. Lines: prod +14/-11, test +46/-11 (corrected from git numstat).

**Why this is the smallest correct fix:** Raw bytes only exist at the Fastify parsing layer, so one encapsulated parser plus one argument is the minimum; the verifier keeps its shape (3-arg, same result type). Why not `canonicalJson` on both sides: the acquirer does not canonicalize, so still byte-mismatched. Why not a global `rawBody` plugin in `app.ts`: touches every route and a file outside this lane. The compare swap reuses the existing helper (net -3 lines).

**Proof:** `routes/acquirerCallbacks.test.ts` "verifies the raw body bytes and rejects a stale timestamp": before `expected 200, actual 401`; after passes (stale `t` → 401 `timestamp_out_of_tolerance`, 0 notes). `inboundVerify.test.ts` "the raw signed bytes verify even when not V8-compact, and a stale timestamp is rejected": fails before, passes after.

**Regression risk:** Only `/v1/acquirer/*` uses the new parser (Fastify encapsulation); `bodyLimit` and JSON error handling come from the default parser. Callers must now send a timestamp within ±300 s. Covered by `inboundVerify.test.ts`, `routes/acquirerCallbacks.test.ts`, `acquirer/callbacks.test.ts`, `sign.test.ts` (25/25), `tsc --noEmit` clean.

**Trap note:** Test helpers now sign the exact string sent with a current timestamp; the "not covered" comment at `acquirerCallbacks.test.ts:103` was corrected; `inboundVerify.ts:32` comment corrected. Still open (not fixed here, report only): `routes/acquirerCallbacks.ts:23` "A repeated header uses the first value" is false (Node joins duplicate custom headers with ", " so the parser keeps the last `t=`/`v1=`).

**Why three changes in one fix (adversarial review asked):** they share one root cause: the inbound verifier did not authenticate the bytes it received. (1) HMAC over the raw body instead of re-serialized JSON, (2) a 300 s timestamp window, so a captured signed callback can't be replayed later, and (3) a constant-time compare. Each alone leaves FP-240's "the incoming signature check has its own problems" open. (3) is a one-line swap with no behavioural test (timing is not unit-testable reliably); (1) and (2) are proven by the tests above.

---

<a id="f-sched-1"></a>

### SCHED-1 · Daemon takes "today" from the UTC date, so the Bahrain close runs at 03:00 + delay · G1, H5 · Severity: Medium
**What's wrong:** the settlement daemon decides whether the daily close is due from the UTC calendar date. The close for Bahrain day D therefore becomes due at 00:00 UTC on D+1 (03:00 Bahrain) plus the grace delay, not at Bahrain midnight plus the delay.

**Why it happens:** `apps/settlement/internal/scheduler/daemon.go:80-81` `now := time.Now().UTC(); todayStart, _ := settlement.BusinessDayWindow(now)`. `BusinessDayWindow` takes a calendar date and reads `date.Date()` in the argument's own location (window.go:43), so a UTC instant yields the UTC day. Between 00:00 and 03:00 Bahrain it still sees "yesterday" as today. Hidden by "MK: UTC here is fine, BusinessDayWindow converts to Bahrain" (daemon.go:78), "am: logs show the close ~03:15 local not 00:15?? whatever, it runs" (:89), and the window.go:43 note "claude says this is a bug in BusinessDayWindow", which points at the wrong function.

**What it breaks:** with a 15-minute delay, day D closes at ~03:15 Bahrain instead of 00:15, which matches the observed logs. During those 3 hours, D's batch and payouts are late, and any process that expects D closed after 00:15 (reports, payouts, settlement.paid notifications) reads an unclosed day. The whole case file defines the business day as Bahrain midnight to midnight.

**Why it needed a fix:** the schedule contradicts the business-day definition, and the slack it creates hides other timing bugs (CLOSE-1).

**Fix:** `daemon.go:64,80,82,91` (+ comment at window.go:43)
```diff
+var timeNow = time.Now // test seam (SCHED-1)
+
-	// MK: UTC here is fine, BusinessDayWindow converts to Bahrain.
+	// SCHED-1 (G1, H5): take the Bahrain calendar date (fixed UTC+3, no DST); the UTC date made the close due at 03:00 Bahrain.
-	now := time.Now().UTC()
+	now := timeNow().In(time.FixedZone("Asia/Bahrain", 3*60*60))
-	// am: logs show the close ~03:15 local not 00:15?? whatever, it runs. yalla
+	// SCHED-1: with the UTC date this ran ~03:15 Bahrain, not 00:15; fixed above.
```
Commit: `649e4dd`. Lines: prod +6/-4 (2 code lines: the seam and the `now` line; 1 blank line; 3 comment lines), test +22/-0.

**Why this is the smallest correct fix:** one expression decides the calendar date; it now uses Bahrain local time (the case file fixes it at UTC+3 with no DST, so `FixedZone` cannot fail and needs no tzdata). `todayStart`, `dueAt` and `businessDate` then follow unchanged. The one-line `timeNow` var is the only way to test this without changing `runIfDue`'s signature. Why not change `BusinessDayWindow` to `date.In(Bahrain).Date()` (as the "claude says" comment suggests): it would change the contract for every caller, break `CloseBatch`'s `batchDateOnly` consistency, and fail `TestBusinessDayWindow_IgnoresClockTime`. The daemon is the only caller passing an instant. Why not export the settlement package's location: it adds API surface for one call.

**Proof:** `TestRunIfDue_UsesBahrainCalendarDate` (scheduler/daemon_audit_test.go) sets now to 2026-09-10 21:05 UTC (00:05 Bahrain on 09-11) with a 15-minute grace. Before: `runIfDue started a batch run at 00:05 Bahrain, inside the 15-minute grace (it used the UTC date): runtime error: invalid memory address or nil pointer dereference`. It passes after (not due yet). The scheduler and settlement packages are green.

**Regression risk:** after 00:15 Bahrain the daemon closes the previous Bahrain day, which CLOSE-1's guard accepts because that day has ended. The log estimate (`status.go`) is unchanged.

**Trap note:** the MK and am comments in daemon.go and the "claude says" comment in window.go were replaced with the actual mechanism.

---

<a id="f-est-1"></a>

### EST-1 · Lifetime payout total is a REAL accumulated through float32 · G2 · Severity: Medium
**What's wrong:** `merchants.lifetime_net_payout_monitoring_estimate` is a `REAL` column, and every `PayoutBatch` adds `float32(netPayoutFils)` to it. A money total is therefore stored with about 7 significant digits and drifts once it passes 2^24 fils (16,777.216 BD).

**Why it happens:** `apps/settlement/internal/settlement/payout_estimate.go:19` (`float32(netPayoutFils)`) and migration `0040` (`REAL NOT NULL DEFAULT 0`). The faulty assumption is "monitoring only, nothing reads it back" (0040 comment, "MK: nothing reads this back. don't spend time on it"), which contradicts the case file and ADR-0001 (money is integer fils). The test comment "FH: float32 exact up to 2^24 so small values are fine; big ones drift but nobody reads it" (payout_estimate_test.go:13), and the test's small-only amounts, hid it.

**What it breaks:** two payouts of 22,219,551 + 9,334,173 fils should total 31,553,724 fils; the REAL column holds 31,553,700 (24 fils lost on just two batches). The drift grows with every batch. Ops compares this figure with batch history to flag anomalous payouts, so a false anomaly (or a masked real one) follows. The seed (generate.ts:628-641) replays the same float32 drift.

**Why it needed a fix:** it is a fils figure shown to ops as a payout total. The case file allows no floats in money, and the error is unbounded over a merchant's lifetime.

**Fix:** `payout_estimate.go:19` + new `db/migrations/0093_lifetime_payout_estimate_bigint.sql`
```diff
-	`, merchantID, float32(netPayoutFils))
+	`, merchantID, int64(netPayoutFils)) // EST-1 (G2): integer fils, column is BIGINT (0093)
```
```sql
ALTER TABLE merchants ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;
```
Commit: `d88497a`. Lines: prod +1/-1 Go and +5 SQL (2 comment lines), test +35/-1.

**Why this is the smallest correct fix:** one Go argument and one column type. The function signature is unchanged, and the column name stays (no reader rename). Why not float64/DOUBLE: still a float in money code, and it only postpones the drift (2^53). Why not drop the column: the ops dashboard and the seed use it. Not done here: backfilling the already-drifted values. `SUM(net_payout_fils)` over paid batches would differ, because split payouts never bumped this counter, so that needs an ops decision. `EstimateMonthlyPayout` (same file) also sums in float32, but it has no production caller and changing its return type would change its signature; flagged for follow-up.

**Proof:** `TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact` (payout_estimate_audit_test.go) failed before: `lifetime estimate = 31553700, want exactly 31553724 (22219551 + 9334173)`. It passes after migration 0093. The existing `TestUpdateLifetimePayoutMonitoringEstimate_SmallValuesExact` and the PayoutBatch tests still pass.

**Regression risk:** node-pg returns BIGINT as a string, but no TS code reads this column. The seed writes integer-valued `Math.fround` numbers, which BIGINT accepts. Migration 0049's mention is a comment only.

**Trap note:** the FH test comment (`payout_estimate_test.go:13`) is replaced to point at the new test. The 0040 "nothing reads this back" note stays (old migrations are immutable) and is superseded by 0093.

---

<a id="f-sum-2"></a>

### SUM-2 · No index serves batched capture events by time, so the settlement summary scans transaction_events · H6 · Severity: Medium

**What's wrong:** The summary filters the merchant on `transactions` and the window on `transaction_events.occurred_at`, but no index serves an `occurred_at` range once events have been batched.

**Why it happens:** The only `occurred_at` index, `idx_transaction_events_unbatched` (`db/migrations/0023_transaction_events_settlement_batch.sql:15-18`), is partial on `settlement_batch_id IS NULL`, so it stops covering an event as soon as CloseBatch claims it; the other is `(transaction_id, occurred_at)` (`0018_transaction_events.sql:23`), whose leading column the window cannot use. For a large merchant the planner hashes all of the merchant's transactions and scans transaction_events (perf doc: 402,911 rows, 1.84 s of 3.4 s). `applyBatchClosed`'s parity query (`apps/reporting/src/consumer/applyEvent.ts:131-139`) has the same shape. `docs/perf/2026-07-settlement-summary-slow.md` blamed buffers; raising `shared_buffers` only cached the same scan.

**What it breaks:** 3-6 s `/v1/settlement/summary` responses for the largest merchant (the spinning settlement page), each holding an API pool connection, and growing with table size; the nightly batch_closed burst repeats the scan in the reporting consumer.

**Why it needed a fix:** H6: latency scales with total history instead of the requested window.

**Fix:** new `db/migrations/0088_transaction_events_captures_by_time.sql`:
```sql
CREATE INDEX idx_transaction_events_captures_by_time
    ON transaction_events (occurred_at) INCLUDE (transaction_id, amount_fils)
 WHERE event_type IN ('captured', 'partially_captured');
```
Combined with SUM-1 (the CTE now reads `te.amount_fils`), the window is an index-only range scan hash-joined to the merchant's transactions. Commit: `c55c71e`. Lines: prod +7/-0 (SQL, 4 of them comments), test +23/-0.

**Why this is the smallest correct fix:** one partial covering index that matches both the predicate (`event_type IN (...)`, `occurred_at` range) and every column the two queries read; no query change. Why not denormalise `merchant_id` onto `transaction_events` with `(merchant_id, occurred_at)`: the scalable follow-up, but a column + backfill + producer changes. Why not `CONCURRENTLY`: `db/migrate.ts` wraps each file in BEGIN/COMMIT; on a large production table run this statement manually with `CONCURRENTLY` before deploying (the migration then must be marked applied) or accept a write lock for the build.

**Proof:** `settlement/query.audit.test.ts` "summary SQL can use idx_transaction_events_captures_by_time for the occurred_at window" runs `EXPLAIN (FORMAT JSON)` on the real summary SQL (seqscan and nestloop disabled, i.e. the large-merchant hash-join plan): before, the plan was a Bitmap Index Scan on `idx_transaction_events_transaction` with a heap recheck/filter and the assertion failed; after migrating it uses `idx_transaction_events_captures_by_time`. `routes/settlement.test.ts` + audit tests 12/12.

**Regression risk:** extra write cost on capture inserts only (partial index); the build locks writes on `transaction_events` while it runs (see above). No query semantics change.

**Trap note:** the perf doc's "it's buffers" conclusion (not owned) is contradicted by this plan evidence.

---

<a id="f-fees-4"></a>

### FEES-4 · Dashboard fee shows the most recently entered schedule, not the one in force · F6 · Severity: Medium

**What's wrong:** The admin/merchant fee display picks the `fee_schedules` row with the newest `created_at`. When an older period is backfilled later, the display shows the backfill's rate while every capture charges the rate in force.

**Why it happens:** `apps/api/src/fees/currentFeeScheduleDisplay.ts:32-37` ran `ORDER BY created_at DESC LIMIT 1` with no `effective_from` filter. The charging path, `fees/feeSchedule.ts:30-31`, resolves `WHERE effective_from <= $2 ORDER BY effective_from DESC, created_at DESC`. The faulty assumption, from the docblock, was that "most recently agreed" equals "current". MK's comment raised exactly this ("a backdated correction entered today would show as 'current'"). It was dismissed by "FH: asked Claude, it said created_at is right ... resolved" and "am: display only, nobody bills off this". The test `currentFeeScheduleDisplay.test.ts:72` ("returns the most recently entered schedule even when an older period was backfilled later") asserted 245 bps, encoding the bug.

**What it breaks:** Case file F6, with the test's own data. A 225 bps renegotiation took effect 2026-08-01. A 245 bps correction for March was backfilled on 2026-08-15. The dashboard shows 245 bps while captures charge 225 bps. On a 100,000 fils sale the merchant expects 2,450 fils fee but is charged 2,250 fils, so support cannot reconcile what is shown with what is charged.

**Why it needed a fix:** Merchants and support act on the displayed rate (disputes, pricing). The case file names this exact mismatch as an open finance item.

**Fix:** `apps/api/src/fees/currentFeeScheduleDisplay.ts:35-36` (plus the misleading docblock and comments)
```diff
-      WHERE merchant_id = $1
-      ORDER BY created_at DESC
+      WHERE merchant_id = $1 AND effective_from <= now()
+      ORDER BY effective_from DESC, created_at DESC
```
The 7-line docblock and 4 comment lines are replaced by 3 lines stating the in-force rule. Commit: `5a329f6`. Lines: prod +5/-13 (code +2/-2, comments +3/-11), test +6/-5.

**Why this is the smallest correct fix:** It changes two SQL lines so the display uses the charging path's resolution rule. The function signature and the `createdAt` field the page shows stay the same.
- Why not call `getEffectiveMdrBps` from `feeSchedule.ts`: it returns only bps, not `effectiveFrom`/`createdAt`, so the display shape would need changing.
- Why not change the data (delete the backfill): the backfill is legitimate history, and settlement needs it for March.

**Proof:** The corrected test `returns the schedule in force by effective_from even when an older period was backfilled later` failed before the fix with `expected: 225`, `actual: 245`. After the fix it passes (225, effectiveFrom 2026-08-01). fees: currentFeeScheduleDisplay + feeSchedule + platformVolumeTier: 12 pass, 0 fail.

**Regression risk:** A schedule with a future `effective_from` no longer shows as current. That is correct, since it is not yet charged. The only caller is `admin/merchants.ts:286` (display), and no admin test asserts this value.

**Trap note:** The test at `:72` that encoded the bug ("the backfilled row wins") is corrected to cite F6. The docblock and the MK/FH/am comment thread, which "resolved" it on an unverified claim, are replaced.

---

<a id="f-ref-8"></a>

### REF-8 · Partial refunds round the fee reversal per partial, so they can reverse more fee than was charged · H1 · Severity: Medium

**What's wrong:** Each partial refund reverses `round(F × r / C)` on its own. The rounding errors of the partials add up, so a series of partials that refunds the whole capture can reverse more (or less) than the fee F that was charged.

**Why it happens:** `apps/api/src/payments/processRefund.ts:177-181` (before the fix) called `calculateRefundFee(capturedFils, feeChargedFils, requestedAmount)` with only this refund's amount. Nothing looked at what earlier refunds of the same transaction had already reversed. `calculateRefundFee` (`packages/money/src/fils.ts:260-273`) is correct for one share; the bug is the per-partial call.

**What it breaks:** Design FP-300 §5 worked example: C = 10,000, F = 275 (275 bps, no discount). Refunds 3,333 + 3,333 + 3,334 reverse 92 + 92 + 92 = 276 (91.6575 and 91.685 both round up). After the full refund `platform_fee_revenue` for the transaction is −1 and `merchant_payable` is +1: the merchant is paid one fil of fee that was never charged. The error grows with the number of partials.

**Why it needed a fix:** H1 / case file "ledger right to the fil": a fully refunded transaction must net to 0 on every account.

**Fix:** `apps/api/src/payments/processRefund.ts:177-182`
```diff
-    const feeReversedFils = calculateRefundFee(
-      prepared.capturedFils,
-      prepared.feeChargedFils,
-      prepared.requestedAmount,
+    // REF-8: round cumulatively (share of F for all succeeded refunds incl. this one, minus what was already reversed), so partials sum to exactly F.
+    const prior = await client.query<{ amount: string; fee: string }>(`SELECT COALESCE(SUM(amount_fils), 0)::text AS amount, COALESCE(SUM(fee_reversed_fils), 0)::text AS fee FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`, [prepared.transactionId]);
+    const feeReversedFils = subtractFils(
+      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount)),
+      toFils(Number(prior.rows[0]!.fee)),
     );
```
f_k = calculateRefundFee(C, F, R_k) − Σ_{j<k} f_j, where R_k = Σ succeeded refund amounts + this refund. The partials telescope, so at R = C they sum to exactly `calculateRefundFee(C, F, C) = F`. Lines: prod +5/-4 (1 comment, 4 code), test +25/-0.

**Why this is the smallest correct fix:** One query and one changed expression, inside phase 3, after the existing `SELECT refunded_fils … FOR UPDATE` row lock (`:170`), so concurrent refunds of the same transaction read the prior sums serially. *Why R_k from `refunds` and not `transactions.refunded_fils`?* `refunded_fils` already includes other refunds' in-flight reservations (REF-1 reserves in phase 1). If one of those is later declined and released, the share would have been computed on an amount that was never refunded, and a following smaller refund could get a negative `f` (refused by `CHECK (fee_reversed_fils >= 0)`). Σ succeeded refunds + r is the "refunded total including this refund" the design means. *Why not change `calculateRefundFee`?* It is a correct pure function used by its own tests; the cumulative state lives in the DB, not in the money package. *Why not largest-remainder allocation?* Future partial amounts are unknown when a partial is made.

**Proof:** `REF-8: partial refunds round cumulatively, so their fee reversals sum to exactly the fee charged` (`apps/api/src/payments/processRefund.audit.test.ts`) fails before the fix (`[92, 92, 92]` vs `[92, 91, 92]`) and passes after; it also asserts `platform_fee_revenue`, `merchant_payable` and `card_scheme_clearing` net to 0. REF-7 test, `processRefund.test.ts` (13/13) and `initiateMerchantRefund.test.ts` (10/10) pass.

**Regression risk:** A single (full or first) refund has prior sums 0, so its value is unchanged. `calculateRefundFee` is monotonic in the refund amount and the prior fee equals the share of the prior amount, so f_k ≥ 0 always.

**Trap note:** None in code; the per-partial rounding looks correct in isolation, which is why the existing single-refund tests never caught it.

---

<a id="f-ref-6b"></a>

### REF-6b · Acquirer simulator caches transport errors, so a same-key refund retry can never succeed · FP-209, FP-300 (☐1) · Severity: Medium
**What's wrong:** The in-process acquirer's refund idempotency cache stores every outcome, including `error`. After REF-6 made the refund's acquirer key stable across retries (correctly), a refund that hit a transient transport error replays that cached `error` (502) on every retry and can never complete.

**Why it happens:** `apps/api/src/acquirer/simulator.ts:167` did `refundCache.set(req.idempotencyKey, result)` for any outcome. An `error` means the outcome is unknown (the request may not have reached the acquirer), so it must not be pinned. `approved` and `declined` are final answers and are correctly cached.

**What it breaks:** 2% of refunds roll a failure by default (`ACQUIRER_FAILURE_RATE=0.02`) and 30% of those are `error`: the merchant retries with the same Idempotency-Key, as designed, and gets 502 forever, while the phase-1 reservation stays held (fail closed). No money is lost, but the refund is stuck.

**Why it needed a fix:** without it REF-6's correct stable key turns every transient fault into a permanently stuck refund.

**Fix:** `apps/api/src/acquirer/simulator.ts:167`
```diff
-      refundCache.set(req.idempotencyKey, result);
+      if (result.outcome !== "error") refundCache.set(req.idempotencyKey, result); // unknown outcome: let a same-key retry ask again
```
Lines: prod +1/−1, test +21/−0.

**Why this is the smallest correct fix:** one condition at the cache write. Why not drop the stable key (undo REF-6)? That reopens the double-payout on retries.

**Proof:** `simulator.audit.test.ts` "a refund that errored is really retried under the same idempotency key" fails before (`expected: 'approved', actual: 'error'`) and passes after; simulator 7/7, processRefund 13/13.

**Regression risk:** capture and authorize caches still store `error` (same pattern); they are not retried with a stable key today, so they are left as they are and noted here.

**Trap note:** the cache comment ("a client retry after a timeout gets a consistent acquirer response") is right for final outcomes and wrong for `error`.

---

<a id="f-auth-7"></a>

### AUTH-7 · OTP resend resets the guess budget · H8 · Severity: Medium
**What's wrong:** `POST /v1/auth/otp/resend` issues a fresh OTP challenge whose `attempt_count` starts at 0, so each resend grants 5 new guesses.

**Why it happens:** the resend handler (`apps/api/src/routes/auth.ts:195-240`) reads the previous challenge's `id, created_at` only (`:204-206`), consumes it and calls `issueChallenge`, whose INSERT (`auth/otp.ts:48-51`) leaves `attempt_count` at the 0011 default of 0. The docstring right above (`:191-194`) promises "the new challenge inherits the previous challenge's attempt_count so a resend never resets the guess budget", which the code never did. The only brake is the 30-second resend throttle.

**What it breaks:** instead of 5 guesses per login, a pending session gets 5 guesses every 30 s for its 10-minute life: 20 resends × 5 = **100 guesses, 20× the intended budget** (a 1-in-10,000 chance per pending session instead of 1 in 200,000), repeatable with every re-login. H8: "the OTP implementation changed at some point. is it still safe?". Not with this.

**Why it needed a fix:** the OTP is the second factor that AUTH-1 now actually enforces; an unlimited guess budget turns it back into a formality.

**Fix:** `apps/api/src/routes/auth.ts`
```diff
-    const existing = await app.db.query<{ id: string; created_at: Date }>(
-      `SELECT id, created_at FROM otp_challenges WHERE id = $1`,
+    const existing = await app.db.query<{ id: string; created_at: Date; attempt_count: number }>(
+      `SELECT id, created_at, attempt_count FROM otp_challenges WHERE id = $1`,
 ...
+      if (existingChallenge) await client.query(`UPDATE otp_challenges SET attempt_count = $2 WHERE id = $1`, [challenge.id, existingChallenge.attempt_count]);
```
Lines: prod +3/−2, test +24/−0.

**Why this is the smallest correct fix:** it carries one number from the old challenge to the new one, inside the existing transaction, which is exactly what the docstring promised. An already exhausted challenge stays exhausted because AUTH-5's atomic check compares `attempt_count < max_attempts`, so no separate pre-check is needed. Why not change `issueChallenge`'s signature to accept a starting count? It is shared with login, a wider change.

**Proof:** `app.test.ts` "OTP resend keeps the attempt budget" (4 wrong guesses, resend, 2 wrong guesses): before the 6th guess got `401` (`expected: 429, actual: 401`), after `429 too_many_attempts`. app + auth + admin suites 60/60; `tsc` clean.

**Regression risk:** none for honest users (5 guesses per login, as designed). Admin OTP resend, if added later, needs the same line.

**Trap note:** the docstring (`:191-194`) described intended behaviour as if it were implemented. It is now true. `auth/sessions.ts:114-115` ("FH: OTP brute force through resend?" dismissed by "MK: 5/14 was webhooks") had already spotted it.

---

<a id="f-cw-6"></a>

### CW-6 · Webhook replays mint a new Webhook-Delivery-Id, so receivers cannot dedupe them · INC-2026-08-21 · Severity: Medium

**What's wrong:** each replay (the merchant single-delivery replay, the admin replay-batch and the archive restore) wrote a new random `delivery_event_id` and overwrote the envelope's body `id` with it. A receiver that dedupes on `Webhook-Delivery-Id` or on the body `id`, as the platform tells it to, sees the replay as a brand-new event. A replayed `settlement.paid` therefore shows up as a second "your payout is on the way" (INC-2026-08-21), and a replayed `refund.succeeded` looks like a second refund.

**Why it happens:** `apps/api/src/webhooks/replay.ts:48-49` ran `randomUUID()` and built `{ ...original.payload, id: newDeliveryEventId }`. All three replay paths go through this one function. The faulty assumption was that a replay is "legitimately a new delivery" for dedupe (docstring `:24-34`, and the MK comment `:46`: "receivers dedupe on the original id in the body", but the same line overwrote that body id). The trusted contract says the opposite: `headers.ts:12` (YA) "must be stable across retries AND replays (ARCH §5)", `envelope.ts:12` "the dedup key", `0022:43-44` "replay must reuse delivery_event_id". `routes/webhooks.test.ts:348-413` locked the bug in with `assert.notEqual(replayRow.delivery_event_id, original.delivery_event_id)`, under a YA-attributed comment that contradicts YA's own line in `headers.ts`.

**What it breaks:** a merchant (or an admin running replay-batch over a period) replays a succeeded `settlement.paid`. The receiver gets the same event with a new id, cannot detect the duplicate, and notifies the shop a second time.

**Why it needed a fix:** a stable delivery id is the platform's only promise that lets receivers process each event once. Every replay breaks that promise.

**Fix:** `apps/api/src/webhooks/replay.ts:1,24-34,46-49,60`
```diff
-import { randomUUID } from "node:crypto";
...
-  const newDeliveryEventId = randomUUID();
-  const replayPayload = { ...original.payload, id: newDeliveryEventId };
+  // CW-6: reuse the original id (the envelope id is the delivery_event_id) so receivers can dedupe
+  const deliveryEventId = String(original.payload.id);
+  const replayPayload = original.payload;
...
-      newDeliveryEventId,
+      deliveryEventId,
```
The docstring that justified new ids (11 lines) is rewritten to the ARCH §5 contract (5 lines), and the MK/FH comment pair is replaced by one line.
Lines: prod +9/-17 (code +3/-4: 3 changed lines plus the now-unused import; comments +6/-13), test +7/-6 (a wrong assertion corrected).

**Why this is the smallest correct fix:** the single shared function fixes all three replay paths. The envelope `id` already equals the original `delivery_event_id` (`envelope.ts:12`, set at fan-out), so no lookup or interface change is needed. `delivery_event_id` has no unique constraint (`0022`), and the replay row is still a new row with `replay_of_delivery_id`, so attempt history is kept. The signature stays fresh because the dispatcher signs at send time (`dispatcher.ts:160`). *Why not add `delivery_event_id` to `OriginalDelivery`?* That touches three callers and their SELECTs for the same value. *Why not dedupe on the server?* The receiver contract is the stable id, and a replay must still be deliverable to a receiver that lost the event.

**Proof:** the corrected test `replay: creates a new row referencing the original, with the SAME delivery_event_id; original row untouched` (`apps/api/src/routes/webhooks.test.ts`) failed before the fix: `assert.equal(replayRow.delivery_event_id, original.delivery_event_id)` got `actual: 'dada1f34-...'`, `expected: 'fd275a43-...'`. After the fix it passes, and it also checks the received `webhook-delivery-id` header and the body `id`. The correction is backed by the case file INC-2026-08-21 (duplicate payout notifications) and by ARCH §5 as quoted in `headers.ts`.

**Not fixed here (file outside this lane): role gate.** `routes/adminMerchants.ts:213,258,299` (replay-batch, archive, archive replay) use only `requireAdminSession` (any role, including `support`), and `:233` accepts any `statuses` list, including `succeeded`. The single-line fix per route is `[requireAdminSession, requireAdminRole("finance", "super_admin")]`, the same as `:135,178`. With stable ids, a replay of a succeeded delivery is now deduped by receivers, and the disbursement side effect is already capped per batch by CW-1 (`0087_settlement_payout_disbursements_unique_batch.sql`), so what remains is the H3 role question. It is left to the owner of `adminMerchants.ts`.

**Regression risk:** receivers that relied on new ids to "force" a re-process will now dedupe replays, which is the documented contract. `routes/webhooks.test.ts`, `webhooks/archiveReplay.test.ts`, `webhooks/dispatcher.test.ts` and `routes/admin.test.ts` pass (64/64).

**Trap note:** the docstring gives a plausible reason for the bug ("would make a receiver silently swallow the replay"), and the test comment attributes "new id is what ARCH §5 asks for" to YA, whose actual line in `headers.ts` says the opposite.

**Follow-up (CW-6b, the role-gate half):** `routes/adminMerchants.ts` `replay-batch`, `archive` and `archive/:archiveId/replay` used `requireAdminSession` only, so a support admin could re-send merchants' webhooks, including `settlement.paid` ("your payout is on the way", INC-2026-08-21). They now also use `requireAdminRole("finance", "super_admin")`, the gate the file already uses for its other money-affecting routes (`:135`, `:178`). Proof: the existing "a support admin is 403'd on every finance-gated route" test, extended with the three routes, failed before (`expected 403, actual 400`, so the handler was reached) and passes after. The batch-replay test that used a support admin is corrected to finance (it encoded the hole). admin, webhooks and archive-replay suites 54/54. Lines: prod +3/−3, test +5/−1.

---

<a id="f-admin-imp-2"></a>

### ADMIN-IMP-2 · Impersonation grants survive admin disable and logout · H3 · Severity: Medium

**What's wrong:** a "view as merchant" grant kept resolving after its admin was disabled and after the admin logged out. Disabling an admin kills their admin sessions, but their `fp_impersonation` cookie still opened the merchant's dashboard until the grant expired, and `IMPERSONATION_TTL_MINUTES` has no upper bound.

**Why it happens:** `apps/api/src/admin/impersonation.ts:117-123` (`lookupImpersonationGrant`) checks `revoked_at`, `ended_at` and `expires_at`, but not `admin_users.status`, unlike `lookupAdminSession` (`adminAuth/sessions.ts:127`, `AND au.status = 'active'`). No code ever sets `revoked_at`. Logout (`routes/adminAuth.ts:209`) calls only `revokeAdminSession`, which revoked the session row alone. The faulty assumption is in the comment at `impersonation.ts:105`: "FH: revoked_at gets set by the admin-disable trigger, so it's covered". No such trigger exists in any migration (the only triggers are the ledger-balance one in 0007 and the outbox-notify one in 0021). `routes/admin.ts:328` (YA) already flagged it: "disabled admins' grants keep working until they expire ... FP-238".

**What it breaks:** an admin is disabled for misconduct, or forgets to end a view on a shared machine and logs out. Either way, whoever holds the cookie keeps reading that merchant's transactions, customers' references and payouts until the grant expires. ADMIN-IMP-1 already limits a grant to read-only, so the exposure is data, not money.

**Why it needed a fix:** revoking an admin's access must revoke all of it (H3: admin actions without the right role checks). A disabled identity must not keep a back door into a merchant's data.

**Fix:** `apps/api/src/admin/impersonation.ts:104,122` and `apps/api/src/adminAuth/sessions.ts:89-94`
```diff
-// no admin_users.status check here ... — am
-// FH: revoked_at gets set by the admin-disable trigger, so it's covered
+// ADMIN-IMP-2: no admin-disable trigger exists; the status check below ends a disabled admin's grants (logout: revokeAdminSession)
-        AND g.expires_at > now()`,
+        AND g.expires_at > now()
+        AND au.status = 'active'`,
```
```diff
   await client.query(`UPDATE admin_sessions SET revoked_at = now() WHERE id = $1`, [adminSessionId]);
+  // ADMIN-IMP-2: logout also ends the admin's open grants (a pending, pre-OTP session never had any)
+  await client.query(
+    `UPDATE admin_impersonation_grants SET revoked_at = now() WHERE revoked_at IS NULL AND ended_at IS NULL
+        AND admin_user_id = (SELECT admin_user_id FROM admin_sessions WHERE id = $1 AND authenticated)`,
+    [adminSessionId],
+  );
```
Lines: prod +9/-3 (code +7/-1, comments +2/-2), test +31/-0.

**Why this is the smallest correct fix:** *Disable:* one predicate in the only lookup every grant passes through, mirroring `lookupAdminSession`. It covers every disable path (route, SQL, future tooling) with no trigger or migration. *Logout:* `revokeAdminSession` is the function the logout route calls, and the route file belongs to another lane. Its other caller is the OTP lockout of a pending session (`routes/adminAuth.ts:150`), and the `AND authenticated` guard keeps that path from touching grants, so a failed OTP cannot end a live admin's views. Finally, the grant gets `revoked_at` set, the column built for this and not used until now. *Why not a DB trigger on `admin_users.status`?* That needs a new migration and more lines, and it does not cover logout. *Why not bind grants to a session id?* That needs a schema change.

**Proof:** `ADMIN-IMP-2: a grant stops resolving once its admin is disabled or logs out` (`apps/api/src/admin/impersonation.audit.test.ts`) failed before the fix with "a disabled admin's grant still resolves". After the fix, both the disabled and the logged-out admin's grants return `null`, and a fresh grant still resolves.

**Regression risk:** logging out of one admin session now ends that admin's grants opened from any session. That is the safe side, since grants are per admin and not per session. `routes/admin.test.ts` (impersonation start/end/expiry tests) and `routes/adminAuth.audit.test.ts` pass (46/46 with the new test). The stale YA question at `routes/admin.ts:328` is now answered by this note. That file is in another lane and is left unchanged.

**Trap note:** the FH comment pointed to an "admin-disable trigger" that does not exist, and `adminAuth.ts:34` ("status disabled ... kills existing sessions") is true for sessions only.

---

<a id="f-led-1"></a>

### LED-1 · The ledger can be edited and deleted as long as each group still balances · F2 · Severity: Medium
**What's wrong:** `ledger_entries` accepts UPDATE and DELETE. Nothing stops someone from rewriting history: scaling a whole posting ×10, back-dating it, or deleting it.

**Why it happens:** `db/migrations/0007_ledger_double_entry.sql:38-70` installs one deferred trigger that only checks that each entry group still nets to 0. Its comment (`:72-74`) claims "Immutability: ... an edited or removed leg unbalances its group ... No separate reject trigger or REVOKE is needed". That is true for one leg, false for a whole group: multiply both legs by 10, or delete both, and the group still balances, so the commit succeeds.

**What it breaks:** the ledger is the source of truth that BAL-1, reconciliation and the payout netting rely on. F2 (the March sweep "ran twice ... the gap doubled", with "the log file only has one timestamp") is the kind of problem an append-only ledger turns from silent to impossible. Worked example (from the test): a balanced 1,000-fil group rewritten to 10,000 fils committed without error.

**Why it needed a fix:** a financial ledger whose rows can be rewritten cannot prove anything to finance or auditors.

**Fix:** new migration `db/migrations/0084_ledger_entries_append_only.sql`: a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger that raises "ledger_entries is append-only: post a compensating entry instead". Lines: SQL +11 (6 code, 5 comment/blank), test +44.

**Why this is the smallest correct fix:** one trigger at the table, independent of every caller. No application code or test updates or deletes ledger rows (repo-wide grep), and TRUNCATE (dev seed) is not a row operation. Why not REVOKE UPDATE/DELETE: every service connects as the table owner (single DB role in compose), and owners bypass grants.

**Proof:** `scripts/ledger_append_only.audit.test.ts` "ledger entries are append-only: balanced edits and deletes are rejected": before `Missing expected rejection: UPDATE ledger_entries SET amount_fils = amount_fils * 10 ...`; after both statements are rejected (run in rolled-back savepoints).

**Regression risk:** the only writer that updated ledger rows was the FP-300 demo's labelled "DEMO-ONLY" back-dating step (`ops/demo.sh`), which now disables and re-enables this trigger around that one statement, in plain sight. Fixing a wrong posting now requires a compensating group, which is the documented accounting rule.

**Trap note:** the "Immutability" comment in 0007 (`:72-74`) is false for whole-group edits. 0007 is an applied migration, so the comment is left in place and corrected here.

**Runtime verification (advisor check, 2026-10-30):** repo-wide grep finds no UPDATE or DELETE on `ledger_entries` in TS, Go, scripts or migrations ≥ 0084 (RecalculateMDR posts compensating INSERTs, `recalculate_mdr.go:167-189`). On the compose stack with 0084 applied, the real flows ran with **0 append-only rejections** in the api, settlement and reporting logs: `settlement run-batch` (close + pay, refund netting), `settlement rebuild-balances` (all merchants), `/internal/recalculate-mdr` (200), `scripts/reconcile_march.ts` (sweep inserts), the FP-300 refund flow, and the full `ops/demo.sh`. The demo's box-3 time travel no longer touches the ledger: it backdates only the settlement inputs that CloseBatch selects (`transaction_events.occurred_at`, `refunds.occurred_at`, `batch.go:152-158, 225-226`), so the trigger is never disabled. Fresh compose database (77 migrations, seed, demo): 32 PASS / 0 FAIL.

---

<a id="f-fees-5"></a>

### FEES-5 · Settlement re-prices each capture with its own formula, so the batch fee drifts from the ledger and strands fils in merchant_payable · FP-300 ☐3 · Severity: Medium

**What's wrong:** `CloseBatch` did not use the fee the ledger booked at capture. It re-priced every capture event itself with `ComputeSettlementFee`, which takes the discount off the amount before applying the MDR. Capture books the MDR first and then takes the discount off the fee. For a discounted merchant the two answers differ by ±1 fil per event. `PayoutBatch` then debits `merchant_payable` by Go's net, so the gap stays in `merchant_payable` for good.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:211-215` (before the fix) re-resolved the rate per event (fee schedule, then platform tier at batch close) and called `ComputeSettlementFee` (`discounted_fee.go:8-9`): `ApplyRateFils(A − ApplyRateFils(A, d), m)`. Capture books `ApplyRateFils(A, m)` and then subtracts `ApplyRateFils(fee, d)` (`capture.ts`, FEES-3). `discounted_fee_test.go` pinned Go's own answer, `want: 14`, next to "am: api shows 15 for the same inputs ... ignore".

**What it breaks:** 602 fils at 275 bps with a 1250 bps discount: the ledger books 17 − 2 = 15 and the batch charges 14, so the payout is 588 and `merchant_payable` ends at −1 after payout. For 12,345 fils at 250 bps with 1500 bps the ledger books 263 and the batch 262. Each discounted event can drift by one fil, which matches "the gap is never 0 for discounted merchants". Re-pricing at close also means a tier flip, or a schedule tie-break (FEES-1/FEES-8), between capture and close prices the batch differently from the ledger.

**Why it needed a fix:** Case file ☐3, "Fees and payouts come out right", and "money is right in the ledger, down to the fils". User decision 2026-10-30 (option A): one fee per capture, booked once in the ledger at capture, fee-first, and everything downstream uses the booked fee. Go must charge what the ledger charged.

**Fix:** `apps/settlement/internal/settlement/batch.go:51,142-144,163-164,169,189,204`; `discounted_fee.go:8-9`
```diff
+	feeFils       money.Fils // FEES-5: platform_fee_revenue net that capture booked for this event
 ...
-	schedules, err := LoadFeeSchedules(ctx, tx, merchantID)   (and its 5-line comment + error check)
-	tierBonusBps := VolumeTierMdrBonusBps(platformProcessedFils)
 ...
-		SELECT te.id, te.transaction_id, te.amount_fils, te.occurred_at
+		SELECT te.id, te.transaction_id, te.amount_fils, te.occurred_at, -- FEES-5: the fee legs capture wrote with THIS event (one DB txn): dated its occurred_at, or its created_at if occurred_at was re-dated later
+		       (SELECT COALESCE(sum(CASE WHEN le.direction = 'credit' THEN le.amount_fils ELSE -le.amount_fils END), 0) FROM ledger_entries le
+		         WHERE le.transaction_id = te.transaction_id AND le.account_id = 'platform_fee_revenue' AND le.occurred_at IN (te.occurred_at, te.created_at))::bigint
 ...
-			effectiveMdrBps := EffectiveMdrBpsAt(schedules, e.occurredAt, mdrBps)
-			if effectiveMdrBps -= tierBonusBps; effectiveMdrBps < 0 {
-				effectiveMdrBps = 0
-			}
-			feeForTxn += ComputeSettlementFee(e.amountFils, effectiveMdrBps, discountBps)
+			feeForTxn += e.feeFils
```
```diff
-	discountedAmount := amountFils - money.ApplyRateFils(amountFils, discountBasisPoints)
-	return money.ApplyRateFils(discountedAmount, mdrBasisPoints)
+	fee := money.ApplyRateFils(amountFils, mdrBasisPoints) // FEES-5: fee-first, as capture.ts books it
+	return fee - money.ApplyRateFils(fee, discountBasisPoints)
```
**How a capture event is linked to its ledger rows:** `transaction_events` stores no `entry_group_id`. But `captureTransaction` writes the event (`occurred_at` and `created_at` both `DEFAULT now()`) and all of its legs (`occurred_at = now()`) in one DB transaction, and `now()` is fixed for a transaction. The match is **per event, not per transaction**: `event_type` includes `partially_captured`, and each partial capture is its own DB transaction with its own `now()` and its own legs, so summing per transaction would charge later partials in the first batch. It has two arms:
- `le.occurred_at = te.occurred_at` covers legs that copy the event's business time (the seed generator, `db/seed/fixtures/transactions.ts`, and the Go fixtures write the event and its group with one explicit timestamp).
- `le.occurred_at = te.created_at` covers legs dated at write time, and survives any later re-dating of the event's `occurred_at`. `ops/demo.sh` box 3 does exactly that: it re-dates the capture event to a closed day while the append-only ledger (LED-1) keeps today. With the first arm alone the batch found no fee (fee 0) and the demo's reconciliation could not reach gap 0.

Refund legs are written in their own DB transaction, so neither arm matches them. The fee is the `platform_fee_revenue` credits − debits of the matched legs (MDR fee − discount), the same "ledger net" definition REF-7 uses for refunds. Any path that breaks the "event and legs in one DB transaction" invariant shows up as a non-zero reconciliation gap (REC-1); that check is the safety net.

The fee-schedule load, the tier bonus and the per-event re-pricing are deleted because they would be dead code; that accounts for 15 of the 22 deleted lines. `ReadAndLockPlatformProcessedFils` stays (it still feeds the lifetime counter). The merchant read stays as the eligibility check; its `mdrBps`/`discountBps` are now unused in `CloseBatch`. Lines: prod +11/-22 = **33 lines, advisor-approved (over the 30-line limit; 15 of the deletions are code made dead, the real change is +11/-7)** (batch.go +9/-20, discounted_fee.go +2/-2), test +189/-16 (new `booked_fee_audit_test.go` +159; `discounted_fee_test.go` +21/-14; `internalapi/server_test.go` +9/-2).

**RecalculateMDR:** this function re-prices unpaid (`closed`) batches at the merchant's *current* terms on purpose. Feeding it the booked fee would make it a no-op, so it keeps `ComputeSettlementFee`. Once `CloseBatch` charges the booked fee, though, the amount-first formula would make it post a −1 adjustment at *unchanged* terms (602/275/1250: booked 15, recomputed 14). The 2-line formula change to fee-first makes it agree with capture. Known limitation, unchanged by this fix: RecalculateMDR uses `merchants.mdr_bps` with no fee schedule and no tier (FEES-2/MDR-1 territory).

**Why this is the smallest correct fix:** One subquery reads the figure the ledger already holds, and one line charges it. Settlement now has no fee formula of its own to drift. The rejected alternatives:
- *Option B only*, i.e. the fee-first formula in `ComputeSettlementFee` (2 lines). That aligns the rounding but still re-prices at close, so tier and schedule-timing differences (FEES-1/FEES-8) and any future capture-side change drift again. It is also not the user's decision.
- *Read `transaction_events.metadata.feeFils`*: after FEES-3 that is the net fee, but it is a copy, not the ledger, and for pre-FEES-3 API captures it is the pre-discount fee.
- *Sum per transaction rather than per event*: partial captures on different business days would be charged in the first batch.
- *Store `entry_group_id` on the event*: needs a migration and a TS change for a link that already exists.

**Proof:** Each test, red before the fix and green after:
- `TestCloseBatch_ChargesTheBookedDiscountedFee/602_fils...`. Before: `batch fee_fils = 14, net_payout_fils = 588`, `merchant_payable after payout nets to -1`. After: fee 15, net 587, merchant_payable 0.
- `TestCloseBatch_ChargesTheBookedDiscountedFee/12,345_fils...`. Before: 262 / 12083 / −1. After: 263 / 12,082 / 0. This is the same vector as FEES-3's API and link tests, so all three paths book 263.
- `TestCloseBatch_BookedFeeAndBookedRefundReversalNetTo6517`: a 250 bps merchant whose capture booked 225, and a refund of 3,333 that reversed 75. Before: fee 250, net 6,492. After: fee 225, net 6,517, the DEMO_SCRIPT figure.
- `TestComputeSettlementFee`: corrected `want` 14 → 15 for 602/275/1250, plus a 12,345/250/1500 → 263 row. Before: `= 14, want 15` and `= 262, want 263`.
- `TestCloseBatch_BookedFeeFoundAfterEventReDated` (the created_at arm, done the way demo.sh does it): capture 12,345 at 250/1500 in one DB transaction, re-date only the event 2 days back, close that day. With the `occurred_at` arm alone: `booked 263, batch fee 0`, `merchant_payable after payout nets to -263`. With both arms: fee 263, merchant_payable 0.
- `TestRecalculateMDR_DiscountedMerchantUnchangedTermsAdjustsNothing`: passes on the base code. With only the batch.go half applied it fails (`OldFeeFils:15 NewFeeFils:14 DiffFils:-1`). It passes with the formula change.

The FP-300 refund tests (`TestCloseBatch_NetsRefundIntoPayout`, `_RefundLargerThanNetRollsForward`, `_SplitParentChildrenSumToNettedNet`, `TestRecalculateMDR_KeepsRefundNetting`, `TestRecalculateMDR_PaidBatchUntouched`) pass unchanged. Full Go suite: 70 pass, 0 fail, 1 skip (the seeded-fixture test, also skipped on the base).

**Regression risk:**
- A capture event with no `platform_fee_revenue` legs at either timestamp is charged 0. Every real capture with a fee writes them in the same DB transaction. The one test fixture that seeded a capture without fee legs (`internalapi/server_test.go` `TestRunBatch_ValidTokenAndDate`, which expected 250 "recomputed per event") now seeds the legs capture writes. The shared fixture is left alone, because the BAL-1 rebuild test needs `merchant_payable` = 12,000.
- **Deploy caveat (transitional data):** before FEES-3 the API path wrote its discount legs post-commit in a separate DB transaction, dated `now()` of that later transaction (`apps/api/src/payments/discountAdjustment.ts:81-82`). Those legs match neither arm, so a discounted API capture made before this change and still unbatched would be charged the undiscounted fee. Close the open batches before deploying (or post a compensating entry; ledger rows are never edited, LED-1). Our hosted database is fresh, so this is documentation only.
- Refund netting is unchanged. It already nets `refunds.fee_reversed_fils`, which REF-7 derives from the same ledger net, so both sides of the payout are booked figures.

**Trap note:** `discounted_fee_test.go:9-14` claimed amount-first is "the order settlement's reconciliation policy specifies" (FH: "the 14 is right"; am: "api shows 15 ... ignore"). No such policy exists in the repo. CHANGELOG 1.3.1 ("applied after MDR at capture and settlement") and Yousif's 0047 note ("off the fee, after MDR") give fee-first, while `docs/ARCHITECTURE.md:55-56` ("Discounts reduce the amount the MDR is charged on") and AM's 0047 line give amount-first. The user's 2026-10-30 option-A decision settles it in favour of the ledger. The comments at `batch.go:126-130` (old) promised Go matched capture's resolution "exactly"; the code they described is now gone. apps/reporting does not recompute fees: it copies `fee_fils` from the `settlement.batch_closed` payload (`consumer/applyEvent.ts:114`), so it now carries the booked fee. Other fee recomputers outside settlement: `apps/api/src/admin/creditThreshold.ts:20` (credit fee reversal on `mdr_bps`, ADMIN-CRED-4), and `apps/api/src/v1/fees/calculateFee.ts` (not registered, so dead).

---

<a id="f-pl-6"></a>

### PL-6 · Public payment-link read leaks the merchant's live API key prefix and SHA-256 hash ·  · Severity: Medium

**Lead:** Team 45 heads-up list (P1) and our 03_findings PL-6, verified by us.

**What's wrong:** `GET /v1/payment-links/:token` is public and unauthenticated. It returned `merchantPublicKey`, the first 16 characters of the merchant's newest unrevoked secret API key, and `merchantIntegrationId`, that key's `key_hash` (the exact SHA-256 verifier that API-key authentication looks up). Anyone who holds a link token could read both.

**Why it happens:** `apps/api/src/paymentLinks/read.ts:40-53` (before the fix) joined `api_keys` through a `LEFT JOIN LATERAL` and selected `ak.key_prefix AS merchant_public_key, ak.key_hash AS integration_id`. Lines 73-74 then copied both into the response. The "public key" name is misleading: `apiKeys/issue.ts` builds the raw secret as `fp_<env>_` plus 32 base64url characters and stores `keyPrefix = rawKey.slice(0, 16)`, so the prefix is part of the secret itself. The doc comment at `read.ts:18` ("Contains nothing that identifies or authenticates the merchant") was false. The hosted checkout's contract (`apps/web/src/types.ts:9-19`) says "The server must never add API-key fields to this response" and uses neither field.

**What it breaks:** A buyer opens a payment link and sees `"merchantPublicKey":"fp_live_AbC12xYz"` and `"merchantIntegrationId":"<64-hex sha256 of the live secret key>"`. That discloses 48 of the 192 random bits of the merchant's live secret, plus the stored verifier. It also gives an oracle for whether the merchant has a live key and when it rotates, since the values change on rotation. The same data reaches anyone who forwards, logs or screenshots the link. The rest of the codebase withholds `api_keys.key_hash` on purpose (`admin/merchants.ts:216`), and even admins never see it.

**Why it needed a fix:** This is a credential-material leak on an unauthenticated endpoint. Secret-key material and its verifier must never reach a public surface, and the client contract forbids it.

**Fix:** `apps/api/src/paymentLinks/read.ts:13-14, 26-27, 42-53, 73-74`: the two key fields come out of the row type, the DTO, the SELECT (the LATERAL join is gone) and the response.
```diff
-            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name,
-            ak.key_prefix AS merchant_public_key,
-            ak.key_hash AS integration_id
+            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name
        FROM payment_links pl
        JOIN merchants m ON m.id = pl.merchant_id
-       LEFT JOIN LATERAL (
-         SELECT key_prefix, key_hash
-           FROM api_keys
-          WHERE merchant_id = pl.merchant_id AND revoked_at IS NULL
-          ORDER BY created_at DESC
-          LIMIT 1
-       ) ak ON true
 ...
-    merchantPublicKey: row.merchant_public_key,
-    merchantIntegrationId: row.integration_id,
```
(plus the matching two-line removals from `PublicPaymentLinkRow` and `PublicPaymentLinkDto`)

**Why this is the smallest correct fix:** The change is deletion only. One SQL line is rewritten to drop its trailing comma, and no line of logic is added. *Why not keep the keys and return `null`?* The checkout contract (`apps/web/src/types.ts:9`) says the response must carry no API-key fields at all, and permanently-null fields would just be cruft. *Why not drop only `key_hash`?* The prefix is part of the secret key (`issue.ts`: `rawKey.slice(0, 16)`), not a public identifier. *Why not keep the query and only stop returning the fields?* That leaves a pointless per-request read of `api_keys.key_hash` on a public path. No other code reads the two fields (repo-wide grep).

**Proof:** `create -> public read (active) -> pay (approved) -> public read (paid) -> pay again rejected 409` (`apps/api/src/routes/paymentLinks.test.ts`). The test used to pin the leak with `assert.ok(readActive.json().merchantPublicKey?.startsWith("fp_"))`, a test that encoded the bug. It now asserts that both fields are `undefined` and that the body contains neither `sha256(rawKey)` nor `rawKey.slice(0, 16)`.
Before: `not ok 1 ... actual: 'fp_test_nszkBtgJ'`.
After: the file passes 12/12, and `tsc --noEmit` is clean.

**Regression risk:** Low. The response loses two fields that the checkout never read and that its contract forbids. No other API surface changes. Merchants still see their key prefix in their own authenticated key list.

Lines: prod +1/-16, test +6/-2

---

<a id="f-idem-2"></a>

### IDEM-2 · Authorize idempotency fingerprint is an unkeyed SHA-256 over the full PAN and CVV, stored at rest ·  · Severity: Medium

**What's wrong:** Every authorize, whether through `POST /v1/transactions` or a payment-link `/pay` (both call `authorizeTransaction`), persisted `idempotency_keys.request_hash = sha256(canonicalJson({ amountFils, card: { pan, expiryMonth, expiryYear, cvv }, reference }))`. That is an unsalted, unkeyed digest of the full card number and its CVV, kept indefinitely.

**Why it happens:** `apps/api/src/payments/authorize.ts:51-55` passed the whole `input.card` object to `hashRequest`, and `payments/idempotency.ts:65-66` is a plain `createHash("sha256")`. `claimIdempotencyKey` stores the digest in `idempotency_keys.request_hash` (`db/migrations/0019`).

**What it breaks:** Anyone who can read that table (a backup, a replica, a support SQL session) recovers the CVV in at most 1000 hashes. The amount and reference sit beside the hash, and the PAN, expiry and amount are often known to an insider. The audit test does exactly this and gets `123` back. A known BIN plus last4 leaves about 10^6 to 10^9 PAN candidates × 1000 CVVs, which a GPU searches in seconds to minutes. PCI DSS 3.2 forbids storing the card verification code after authorization in any form, and 3.5 requires a stored PAN to be unreadable (keyed hash or strong crypto), not a plain SHA-256.

**Why it needed a fix:** This is sensitive authentication data at rest on every authorize. It is harmless today only because the acquirer is a simulator (`acquirer/types.ts:12`). The first real card through this code would put the platform out of PCI compliance.

**Fix:** `apps/api/src/payments/authorize.ts:53-54`
```diff
   const requestHash = hashRequest({
     amountFils: input.amountFils,
-    card: input.card,
+    // IDEM-2 (PCI): an unkeyed hash over PAN+CVV is brute-forceable offline; fingerprint only non-secret card fields
+    card: { last4: String(input.card.pan).slice(-4), expiryMonth: input.card.expiryMonth, expiryYear: input.card.expiryYear },
     reference: input.reference ?? null,
   });
```

**Why this is the smallest correct fix:** This changes one expression at the only place that fingerprints card input. The payment-link path reaches it through `paymentLinks/pay.ts:94`. Last4 and expiry are the fields PCI allows in the clear, so the digest holds nothing secret to brute-force. *Why not an HMAC over the full card with a server key?* `authorizeTransaction` has no config or key today, so the fix would have to thread a new secret through two callers and add key management, which is far more than 10 lines. Reusing an existing key, such as the webhook encryption key, for an unrelated purpose would be key misuse. *Why not drop the card from the fingerprint entirely?* Then two different cards (different last4) under one idempotency key would replay silently instead of returning 422 `idempotency_key_reused`. Keeping last4 and expiry keeps that detection for any realistic mistake. The one case lost is a reuse that differs only in PAN middle digits or CVV under the same key. That case now replays the first response, which is the safe direction: no second charge.

**Proof:** `IDEM-2: the authorize idempotency fingerprint holds no CVV or full PAN` (`apps/api/src/routes/transactions.audit.test.ts`) authorizes through the API, reads `request_hash`, and tries all 1000 CVVs with `hashRequest`.
Before: `not ok 2 ... error: 'CVV 123 recovered from idempotency_keys.request_hash'`.
After: `ok 2`. `transactions.test.ts` passes 11/11 (including the authorize idempotency replay and conflict tests), `paymentLinks.test.ts` passes 12/12, and `payments/idempotency.test.ts` passes 8/8.

**Regression risk:** Low. Rows written before the fix carry the old digest, so a retry that straddles the deploy with a reused key gets a one-time 422 `idempotency_key_reused`. Clients already handle that response, and keys are per request. Existing rows still hold the old card digests, so ops should purge or expire them; that is a data cleanup, not a code change.

Lines: prod +2/-1, test +34/-0

---

<a id="f-cfg-1"></a>

### CFG-1 · Any unknown NODE_ENV (for example "prod") silently boots as development: OTP codes in responses, non-Secure cookies, production checks skipped · H8 · Severity: Medium

**Lead:** Team 45 heads-up list (P11), verified by us.

**What's wrong:** `parseNodeEnv` mapped every value other than the exact strings `production`, `test` and `development` to `development`. A deployment with `NODE_ENV=prod`, `Production` or `staging` booted with no error as a development server.

**Why it happens:** `apps/api/src/config.ts:121-126` falls through to `return "development"` for any string. Every security default keys off `nodeEnv`: `otpDevExpose` defaults to `nodeEnv !== "production"` (`config.ts:210`), so `devOtpCode` goes into the login response (`routes/auth.ts:111-113`, and the admin twin). `cookieSecure` defaults to `nodeEnv === "production"` (`:228`). The required-secret checks for `SETTLEMENT_INTERNAL_TOKEN` and `ACQUIRER_CALLBACK_SIGNING_SECRET` run only when `nodeEnv === "production"` (`:186-192`). The webhook-secret key falls back to a public dev key (`:248`). The notifier comment at `auth/notifier.ts:14-15` shows staging already ran with NODE_ENV unset or misconfigured.

**What it breaks:** An operator sets `NODE_ENV=prod`. `POST /v1/auth/login` now returns `{"otpRequired":true,"devOtpCode":"482913"}`, so the second factor is handed to whoever knows the password (H8). Session cookies are sent without `Secure`. The service also boots without the settlement token and the acquirer signing secret, and encrypts webhook secrets under the dev key committed in the repo. There is no error and no log line.

**Why it needed a fix:** H8 asks whether OTP is still safe. A one-character configuration typo should never disable two-factor auth and the production secret checks without a word. A configuration error must fail loudly at boot.

**Fix:** `apps/api/src/config.ts:125`
```diff
     return value;
   }
+  if (value) throw new Error(`loadConfig: unknown NODE_ENV "${value}" (expected production, test or development)`); // CFG-1
   return "development";
 }
```

**Why this is the smallest correct fix:** One line at the single parser every config value depends on. Only an unset or empty `NODE_ENV` still defaults to development, so local `npm run dev`, tests that omit it, and `ops/demo.sh` and `ops/smoke.sh` behave as before. *Why not map unknown values to production (fail closed)?* That would silently turn a typo'd dev box into production mode, where it then fails on missing secrets with a misleading message. An explicit error names the actual problem. *Why not normalise case or aliases (`prod` → `production`)?* That guesses intent, and it is more code. Checked: `ops/.env.docker:9` and `ops/.env.production.example:3` set `NODE_ENV=production`, and `loadConfig` with each still boots. Compose and `Dockerfile.node` set no other value. All 30 test files pass `NODE_ENV: "test"`, and `config.audit.test.ts` passes `"development"`.

**Proof:** `CFG-1: an unknown NODE_ENV is refused; an unset one still defaults to development` (`apps/api/src/config.audit.test.ts`).
Before: `not ok 2 ... error: 'Missing expected exception.'` (`NODE_ENV=prod` loaded as development).
After: `ok 2`. The file passes 2/2, and both ops env files boot.

**Regression risk:** Low. A deployment that currently relies on an unrecognised `NODE_ENV` will now refuse to boot with a clear message. That is the intent: such a deployment was running with dev security defaults.

Lines: prod +1/-0, test +7/-0

---

<a id="f-imp-3"></a>

### IMP-3 · CSV import splits a thousands-separated amount and posts its first digit group · F7 · Severity: Medium

**What's wrong:** The adjustment CSV splitter cuts each row on every comma and keeps only cells 0-2. An unquoted `1,250.000` (the way finance sheets export a 1,250 BD figure) becomes amount `"1"` and reason `"250.000"`; with a reason column the real reason is dropped as a fourth cell. The import succeeds and posts 1.000 BD.

**Why it happens:** `apps/api/src/admin/adjustmentCsvParsing.ts:42` `split(",")`, then `:44` `amount = cells[1]` and `:48` `reason = cells[2]`. Nothing checks the cell count, and the format has no quoting. The docstring at `:19-24` promises "exactly three columns" but nothing enforces it. The route `POST /v1/admin/adjustment-imports` (`routes/admin.ts:86`, `routes/adminAdjustmentImport.ts:59`) posts every parsed row to the ledger.

**What it breaks:** Finance uploads `<merchant>,1,250.000,refund March`. The ledger gets a 1,000 fils credit instead of 1,250,000 fils: 1,249,000 fils short, with no error and an import row that looks valid. `<merchant>,-12,500` posts -12.000 BD instead of -12,500.000 BD. Reasons containing a comma are silently truncated.

**Why it needed a fix:** Case file F7 ("Something is wrong with how it reads BD amounts"): IMP-1 fixed the scaling; this is the other way the same import misreads a BD amount, and money must be right to the fils.

**Fix:** `apps/api/src/admin/adjustmentCsvParsing.ts:49-51`
```diff
     const reason = cells[2];
+    if (cells.length > 3 || /^\d{3}(\.\d*)?$/.test(reason ?? "")) { // IMP-3: "1,250.000" split into "1" + "250.000"
+      throw new BadRequestError("invalid_csv_row", `row ${i}: amounts and reasons must not contain commas`);
+    }
```
A row is rejected when it has more than the three documented columns, or when its reason is exactly a three-digit group (optionally with decimals), which is what is left of an amount after a thousands separator. The whole import is rejected with 400, the same way as the other row errors, so nothing is posted.

**Why this is the smallest correct fix:** one guard at the single place rows are split. *Why not parse quoted CSV or accept thousands separators?* Both change the documented format and need a CSV dependency or a parser; rejecting the ambiguous row fails closed and the operator removes the comma. *Why not only `cells.length > 3`?* `<id>,1,250.000` has three cells and still posts 1 BD. *Why not reject every numeric reason (the lead's regex)?* A reason such as `2026` or `12` would be refused for no reason; only a three-digit group is a thousands continuation. A reason that is exactly three digits (e.g. `123`) is now refused; that is ambiguous with `x,123` and is the safe side.

**Proof:** `IMP-3: an amount split by a thousands separator is rejected, not read as its first digit group` (`apps/api/src/admin/adjustmentCsvParsing.audit.test.ts`). Before the fix: `Missing expected exception.` (the row parsed as amount `"1"`). After: passes; `1250.000` with a reason still parses.

**Regression risk:** CSVs whose reason contains a comma are now rejected instead of truncated; `docs/ADMIN.md:66` documents a plain `merchantId,amount,reason` file and the docstring says three columns. `adjustmentCsvParsing.test.ts`, `adjustmentImport*.test.ts` and `routes/adminAdjustmentImport.test.ts` pass (45/45).

Lines: prod +3/-0, test +12/-1

---

<a id="f-cred-1"></a>

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

Lines: prod +7/-10 (of which comment +1/-4) for the ledger date, then +3/-0 for the future-date guard; test +20/-20, then +13/-3

---

<a id="f-pl-5"></a>

### PL-5 · A failed capture in the payment-link checkout strands an authorized transaction and its 7-day hold · FP-300 ☐1 · Severity: Medium

**What's wrong:** The public checkout (`POST /v1/payment-links/:token/pay`) authorizes, then captures. When the capture is declined or errors, it releases the link and returns, but leaves the transaction it just authorized in status `authorized` with an `active` hold for 7 days. The buyer's retry (the checkout sends a fresh `Idempotency-Key` per click, `apps/web/src/pages/checkout/CheckoutPage.tsx:56-58`) authorizes a brand-new transaction, so the old one is orphaned.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:130-136` (before) handled `captureResult.statusCode !== 200` with `releaseReservation` alone. `authorizeTransaction` had already inserted the transaction as `authorized` and a hold `now() + interval '7 days'` (`apps/api/src/payments/authorize.ts:116-117`). Nothing else in the flow cleans it up; the authorize-stage failure path has nothing to clean because nothing was authorized.

**What it breaks:** With the default simulator about 2% of captures fail (`config.ts:221`, `ACQUIRER_FAILURE_RATE` 0.02). Each one leaves the buyer's funds held for 7 days and an `authorized` row in the merchant's dashboard. A 75.000 BD link: the retry captures 75,000 fils and pays the link; if the merchant then captures the stranded authorization from the dashboard (`POST /v1/transactions/:id/capture`), the buyer pays 150,000 fils for one 75,000 fils link. Reproduced by the test below: after the declined capture the row is `authorized` / hold `active`.

**Why it needed a fix:** Payment links are the feature's end-to-end path through the API (FP-300 "Done when" ☐1 and ☐2, money right in the ledger): a declined payment must leave nothing chargeable behind, and a buyer must never be exposed to a double charge for one link.

**Fix:** `apps/api/src/paymentLinks/pay.ts:5,132-133` and `apps/api/src/payments/void.ts:11`
```diff
+import { voidTransaction } from "../payments/void.js";
 ...
   if (captureResult.statusCode !== 200) {
+    // PL-5: nothing was captured; void our own authorization (a no-op 409 unless still 'authorized') so it can't be captured later
+    await voidTransaction(pool, { transactionId: txnId, merchantId: link.merchantId, actor: { type: "system", id: link.id } });
     await releaseReservation(pool, link.id);
```
```diff
-  actor: { type: "merchant_session" | "merchant_api_key"; id: string };
+  actor: { type: "merchant_session" | "merchant_api_key" | "system"; id: string }; // PL-5: the link checkout voids its own auth
```
`voidTransaction` is the existing, wired void (`POST /v1/transactions/:id/void`): one DB transaction that row-locks the transaction, sets `voided` only if it is still `authorized`, releases the hold, records the `voided` timeline event (actor `system`, which `transaction_events.actor_type` and `captureTransaction` already accept) and enqueues `transaction.voided` for webhooks and reporting. The actor type is widened by one union member so the checkout can pass the same `system` actor it already passes to authorize and capture.

**Why this is the smallest correct fix:** one call on the single failing branch, reusing the void the API already exposes. *Why not let the hold expire?* `expire_holds` only flips the hold; the transaction stays `authorized` and capturable. *Why not reuse the authorization on the retry?* The checkout mints a new idempotency key per click by design, and reusing an auth across requests would need new state. *Why not also void on the PL-1 fence exit (`pay.ts:122`)?* There a same-key retry may be capturing the same transaction concurrently; it is a separate residual of PL-1 and out of this lead's scope. Safety: the void row-locks and only acts on `authorized`, so if a concurrent same-key request already captured the transaction, the void returns 409 and changes nothing.

**Proof:** `PL-5: a declined capture voids the link payment's authorization and releases its hold` (`apps/api/src/routes/paymentLinks.test.ts`, acquirer capture stubbed to `declined`). Before the fix: `deepEqual` fails with `{ status: 'authorized', hold_status: 'active' }`. After: `{ status: 'voided', hold_status: 'released' }`, the response is still 402 `stage: "capture"`, and a retry pays the link (200).

**Regression risk:** The response to the buyer is unchanged. A capture that failed with an ambiguous acquirer error (502) is now voided locally; with the simulator an error means nothing was captured, while a real acquirer integration would need a capture-status lookup before voiding. An API client that retries the same `Idempotency-Key` after a 502 now gets a failure (the transaction is voided) and must use a new key, as the checkout already does. The merchant receives a `transaction.voided` webhook for the failed attempt. `routes/paymentLinks.test.ts`, `paymentLinks/*.test.ts` and the transactions/void tests pass (36/36).

Lines: prod +4/-1 (pay.ts +3, of which 1 comment; void.ts +1/-1), test +23/-0

---

<a id="f-cap-exp-1"></a>

### CAP-EXP-1 · An authorization whose 7-day hold has expired can still be captured · · Severity: Medium

**Lead:** Team 45 heads-up list (P3), verified by us.

**What's wrong:** `captureTransaction` only checks the transaction's status (`authorized` or `partially_captured`). It never looks at the authorization hold, so a merchant can capture an authorization long after its 7-day card-not-present hold lapsed and the buyer's funds were released, including after the nightly janitor marked the hold `expired`.

**Why it happens:** `apps/api/src/payments/authorize.ts:113-117` places the hold with `expires_at = now() + interval '7 days'` ("7 days = scheme rule for CNP"), and `scripts/expire_holds.ts:18-24` flips lapsed holds to `expired`. But `apps/api/src/payments/capture.ts:133-138` validates `txn.status` alone, and nothing on the transaction row changes when its hold expires, so the transaction stays `authorized` and capturable forever.

**What it breaks:** A 10.000 BD authorization from 2026-10-01 has its hold expire on 2026-10-08 and the buyer's bank releases the funds. On 2026-10-29 the merchant presses capture: the API answers 200, journals 10,000 fils to `merchant_payable` minus the fee, and the settlement batch pays it out, although the authorization it relies on is dead (a scheme violation and a near-certain chargeback). Reproduced by the test below: both a hold past `expires_at` and a hold marked `expired` captured with 200.

**Why it needed a fix:** The hold is the platform's record that the authorization is still valid; capturing past it moves money the scheme no longer guarantees, and the ledger and payout then carry funds that will be clawed back.

**Fix:** `apps/api/src/payments/capture.ts:140-146`
```diff
+    // CAP-EXP-1: a lapsed 7-day hold means a dead authorization; no hold row at all (old history) is not checked.
+    const lapsed = await client.query(`SELECT 1 FROM holds WHERE transaction_id = $1 AND (status = 'expired' OR (status = 'active' AND expires_at <= now()))`, [txn.id]);
+    if (lapsed.rows.length > 0) {
+      const body = { error: "authorization_expired" };
+      await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body });
+      return { statusCode: 409, body };
+    }
```
The check runs inside the existing transaction, after the row lock and the status check and before the acquirer call, and answers exactly like the neighbouring `not_capturable` branch (409, response stored on the idempotency key). It refuses only when the transaction's hold exists and has lapsed: marked `expired`, or still `active` past `expires_at` because the janitor has not run yet.

**Why this is the smallest correct fix:** one query and one early return at the single point every capture path goes through (merchant route, payment-link checkout). *Why not require an active hold?* HOLD-1's janitor deleted holds before it was fixed, and seeded transactions may have none; requiring a hold would make those uncapturable. A missing hold is therefore not treated as expired. *Why not rely on the janitor's `expired` status only?* It runs nightly; between `expires_at` and the next run the authorization is already dead. *Why not also flip the transaction to a new status?* There is no such status in the schema (`transactions.status` CHECK) and it would need a migration and UI changes.

**Proof:** `CAP-EXP-1: capturing an authorization whose hold has expired is refused with 409 authorization_expired` (`apps/api/src/payments/capture.audit.test.ts`). Before the fix: `expected: 409, actual: 200`. After: both lapsed variants get 409 `authorization_expired`, the transaction stays `authorized` with `captured_fils = 0`, no ledger leg is written, while a transaction with no hold row and one with a live hold still capture (200). Capture and transaction route tests pass (16/16).

**Regression risk:** Partial captures keep their hold `active` until fully captured (`capture.ts:250-253`), so a second partial capture after day 7 is now refused too, which is the same expired authorization. Seeded or demo transactions whose holds lapsed can no longer be captured; that is the intended rule. Responses for every other case are unchanged.

Lines: prod +7/-0 (1 comment line), test +31/-0

---

<a id="f-bal-2"></a>

### BAL-2 · Balance rebuild counts unbatched captures and refunds that the close then adds again · F4 · Severity: Medium

**Lead:** Team 45 heads-up list (S14/R5c-rebuild), verified by us, and our 03_findings BAL-2.

**What's wrong:** `merchant_balances.cached_payable_fils` is maintained incrementally: `CloseBatch` adds the batch net (`balances.ApplyBatchClose`), `PayoutBatch` subtracts it, and the admin credit/adjustment/import paths add their own legs. A capture or refund the API has journaled but no batch has closed yet has not reached the cache. The rebuild (`settlement rebuild-balances` and, since BAL-1, the admin "Recalculate cached balances" button) wrote the full `merchant_payable` ledger sum instead, which already contains those unbatched legs. When the batch then closes, `ApplyBatchClose` adds the same money a second time, and payout removes it only once.

**Why it happens:** `apps/settlement/internal/ledger/rebuild.go:22-26` (`RebuildMerchantBalance`) and `:101-106` (`RebuildAllBalances`) summed every `merchant_payable` leg. capture.ts and processRefund.ts post those legs at capture/refund time (`apps/api/src/payments/capture.ts:227-244`, `processRefund.ts:216-226`) and never touch the cache, while `CloseBatch` posts no `merchant_payable` legs but moves the cache by the batch net (`batch.go:284-285`). The two sides therefore measure different things between capture and close. The rebuild also read the cached value without a lock (`rebuild.go:89` TODO, "a concurrent CloseBatch increment gets clobbered -- YA").

**What it breaks:** Day 1: a 10,000 fils capture closes; cache 9,775 (fee 250 less a 25 fils discount). Day 2, before its close: a 20,000 fils capture (net 19,550) and a 1,000 fils refund with 25 fils fee reversal (net -975). An operator presses "Recalculate cached balances": the cache becomes 28,350. At day 2's close the cache rises to 46,925 and after both payouts it sits at 18,575 fils although the merchant is owed 0. This is the case-file F4 pattern (button, CLI and the incremental path disagreeing) and keeps the Rebuild → Adjust churn going. The test reproduces it: `cached_payable_fils rebuild right after close must not move the cache = 28350, want 9775`.

**Why it needed a fix:** F4: support and payouts read the cached balance, and the rebuild is the documented repair. A repair that adds a day of unbatched captures to the figure (then doubles them at close) makes the balance wrong precisely when someone tries to fix it.

**Fix:** `apps/settlement/internal/ledger/rebuild.go:24,26-28` and `:98,107,109-111`
```diff
-		  FROM ledger_entries
+		  FROM ledger_entries le
 		 WHERE merchant_id = $1 AND account_id = 'merchant_payable'
+		   AND NOT EXISTS (SELECT 1 FROM transaction_events te WHERE te.transaction_id = le.transaction_id AND te.settlement_batch_id IS NULL -- BAL-2 (F4): unbatched capture legs reach the cache at close, not before
+		         AND te.event_type IN ('captured', 'partially_captured') AND le.occurred_at IN (te.occurred_at, te.created_at))
+		   AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.transaction_id = le.transaction_id AND r.settlement_batch_id IS NULL AND le.occurred_at IN (r.occurred_at, r.created_at))
```
The same three lines go into `RebuildAllBalances`' sum, and its cache read becomes `... WHERE merchant_id = $1 FOR UPDATE`. A leg is left out only while the capture event or refund it was written with is still unbatched; it is matched exactly as FEES-5's `CloseBatch` matches a capture event to its fee legs (same transaction, `occurred_at` equal to the event's `occurred_at` or `created_at`), and a refund to its legs the same way (processRefund writes the refund row and its legs in one DB transaction). Everything else (batched captures and refunds, payouts, split payouts, MDR recalculation, admin credits, adjustments and imports) is summed as before, so the rebuilt figure equals what close-and-payout produce. Once everything is closed and paid it equals the full ledger sum, as before.

The `FOR UPDATE` closes the YA race for this rule: if a close holds the merchant's cache row, the rebuild waits and its next statement sees the close's events marked batched; if the rebuild holds it first, the close waits and adds its net on top of the rebuilt figure. Without it, a close committing between the sum and the upsert would be overwritten.

**Why this is the smallest correct fix:** one predicate pair in the two rebuild queries; no schema change, no change to capture, refund or close. *Why not make capture and refund move the cache (the lead's option b)?* That changes three money paths in two languages and every cache consumer's meaning (merchant dashboard balance, payouts) instead of the one place that disagrees. *Why not exclude every leg of a transaction with any unbatched event?* A transaction partially captured on two days would lose its batched day too. *Why not use `settlement_batches.net_payout_fils`?* RecalculateMDR rewrites batch totals and posts its own legs (`recalculate_mdr.go:109,189-194`), so summing both would double count.

**Proof:** `TestRebuild_CloseBatchThenRebuildLeavesCacheUnchanged` (`apps/settlement/internal/settlement/rebuild_cache_audit_test.go`): close day 1, then an unbatched capture and an unbatched refund, then `RebuildAllBalances` and `RebuildMerchantBalance`; then payout, close day 2, payout, rebuild. Before the fix: `cached_payable_fils rebuild right after close must not move the cache = 28350, want 9775`. After: 9,775 after the rebuild, 18,575 after day 2's close, 0 at the end. Full Go suite `go test -p 1 ./...` passes.

**Regression risk:** `TestRebuildBalances_ValidToken` (`internal/internalapi/server_test.go`) seeded a "closed" batch by hand without marking its capture event batched, which `CloseBatch` always does (`batch.go` step 11); the fixture now marks it (+5 test lines), and the expected 12,000 fils is unchanged. A merchant whose capture events were never batched (test-mode merchants, which the daily run skips) now rebuilds to the figure the incremental path holds, i.e. without those captures. The admin button, the CLI and `--merchant` (read path) all use the same rule. Residual: a merchant's very first close racing a rebuild (no cache row to lock yet) can still lose that close's net.

Lines: prod +9/-3 (6 SQL lines added, 3 modified; comments inline), test +77/-0 new file and +5/-0 fixture

---

<a id="f-admin-cred-4"></a>

### ADMIN-CRED-4 · A credit's MDR reversal uses the display rate (merchants.mdr_bps), not the rate capture charged · F6 · Severity: Medium

**What's wrong:** When a finance admin issues a credit with "reverse fee", the reversal is computed at `merchants.mdr_bps`. Since migration 0048 that column is only the default/display rate; capture charges the effective-dated `fee_schedules` rate. For every merchant with a schedule row, the credit gives back a different MDR than the merchant paid.

**Why it happens:** `apps/api/src/admin/credits.ts:226-227` (before) called `calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)` with the rate read at `:212` (`SELECT mdr_bps FROM merchants`). Capture resolves its rate with `getEffectiveMdrBps(client, merchantId, now, merchant.mdr_bps)` (`apps/api/src/payments/capture.ts:174`). `db/migrations/0048_fee_schedules.sql` documents mdr_bps as "the default/display rate" and the schedule as "the rate actually applied". No trigger keeps them in sync (the "0046 trigger" cited in comments does not exist).

**What it breaks:** Alpha Retail: `mdr_bps` 250, schedule 225 since 2026-08-01. A 40.000 BD goodwill credit with fee reversal posts 1,000 fils of "MDR back" instead of the 900 fils the merchant was charged on that amount, 100 fils (11%) too much, journaled from `platform_fee_revenue` to `merchant_payable`. This is the same two-rates confusion as case file F6 ("It shows 245bps, but payments go through at 225bps").

**Why it needed a fix:** F6: the fee used anywhere must be what is actually charged. A reversal at the display rate moves money the platform never collected.

**Fix:** `apps/api/src/admin/credits.ts:10,227`
```diff
+import { getEffectiveMdrBps } from "../fees/feeSchedule.js";
 ...
     const feeReversalFils = draft.reverseFee
-      ? calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)
+      ? calculateCreditFeeReversal(draft.baseAmountFils, await getEffectiveMdrBps(client, input.merchantId, new Date(), merchant.mdr_bps)) // ADMIN-CRED-4: the rate capture charges (F6)
       : ZERO_FILS;
```
The credit now resolves the rate with the exact function and fallback capture uses, inside the same transaction; a merchant without a schedule row still falls back to `mdr_bps`, as at capture.

**Why this is the smallest correct fix:** one argument at the single place the reversal is priced, reusing the existing resolver. *Not changed:* the platform volume tier (FEES-1, a pricing-policy question) and the negotiated discount are not applied to the reversal; the lead's second point (the approval threshold compares the base only) has contradicting claims in the repo (`credits.ts` MK note and ADMIN.md vs `adminCredits.test.ts:203`) and no case-file anchor, so it is left as a policy question.

**Proof:** `ADMIN-CRED-4: the credit's MDR reversal uses the effective fee-schedule rate, not merchants.mdr_bps` (`apps/api/src/admin/credits.test.ts`, mdr_bps 250 with a 225 bps schedule effective yesterday, base 40,000 fils). Before the fix: `expected: 900, actual: 1000`. After: passes. Credit, credit route, threshold and validation tests pass (43/43).

**Regression risk:** Only merchants with a fee schedule that differs from `mdr_bps` get a different reversal, now equal to the charged rate. Existing tests use merchants without schedule rows, whose reversal is unchanged.

Lines: prod +2/-1, test +15/-0

---

<a id="f-rbd-1"></a>

### RBD-1 · Admin "Rebuild analytics" double-applies the reporting backlog and wipes the FP-300 refund columns · FP-300 ☐5 · Severity: Medium

**What's wrong:** `POST /v1/admin/reporting/rebuild` (the admin console's "Rebuild analytics" button) truncates `merchant_daily_volume` and `merchant_payout_trends` and refills them with `INSERT … SELECT` from `transaction_events` and `settlement_batches`. It never touches the reporting worker's watermark, so every outbox event the worker had not yet consumed is already counted by the rebuild and is then applied again by the worker. It also never writes the FP-300 refund columns (`refund_count`, `refund_gross_fils`, migration 0099), so every refund disappears from the reports.

**Why it happens:** `apps/api/src/admin/reportingRebuild.ts:11-39` (before) has no reference to `reporting_outbox_cursor` or `refunds`. The worker (`apps/reporting/src/consumer/runConsumerPass.ts`) resumes from its own watermark and applies each event with additive upserts (`applyEvent.ts`), so a backlog event reflected by the rebuild is counted twice. `docs/ADMIN.md:83-85` tells support to press the button exactly when dashboards look stale, i.e. when the backlog is largest. The route's own docstring (`routes/admin.ts:227-231`, "replays the outbox from the start") describes a design the code never had.

**What it breaks:** One unconsumed capture of 10,000 fils and one unconsumed refund of 1,500 fils. After the button the merchant's day shows 1 capture / 10,000 fils and 0 refunds; after the next worker pass it shows 2 captures / 20,000 fils and 1 refund / 1,500 fils. Without the watermark move it would even be 2 refunds / 3,000 fils. With the consumer 2,000 captures (50,000.000 BD) behind, those days show 100,000.000 BD.

**Why it needed a fix:** FP-300 ☐5: refunds must show up right in the reports. A maintenance button that wipes them and doubles the backlog breaks that every time support uses it as documented.

**Fix (advisor option c, response contract unchanged):** `apps/api/src/admin/reportingRebuild.ts:2,13-17,44-51`
```diff
+import { ConflictError } from "../lib/errors.js";
 ...
+  // RBD-1: one snapshot for the rebuild and the outbox watermark it covers; the reporting worker waits on its cursor.
+  await client.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
+  await client.query(`LOCK TABLE reporting_outbox_cursor IN EXCLUSIVE MODE`);
+  const straddling = await client.query(`SELECT 1 FROM outbox_events WHERE txid >= pg_snapshot_xmin(pg_current_snapshot()) AND event_type IN ('transaction.captured', 'transaction.voided', 'settlement.batch_closed', 'refund.succeeded') LIMIT 1`);
+  if (straddling.rows.length > 0) throw new ConflictError("reporting_rebuild_busy", "payments are committing out of order right now; retry in a moment");
 ... (TRUNCATEs and the two existing INSERT … SELECTs unchanged)
-  return { volumeRows: volumeResult.rowCount ?? 0, trendRows: trendResult.rowCount ?? 0 };
+  await client.query(`INSERT INTO merchant_daily_volume (merchant_id, volume_date, refund_count, refund_gross_fils, last_updated_at)
+     SELECT merchant_id, (occurred_at AT TIME ZONE 'Asia/Bahrain')::date, COUNT(*), SUM(amount_fils), now() FROM refunds WHERE status = 'succeeded' GROUP BY 1, 2
+     ON CONFLICT (merchant_id, volume_date) DO UPDATE SET refund_count = EXCLUDED.refund_count, refund_gross_fils = EXCLUDED.refund_gross_fils`); // RBD-1: FP-300 refunds
+  await client.query(`INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id, updated_at)
+     SELECT 'reporting', COALESCE((SELECT id FROM outbox_events WHERE txid < pg_snapshot_xmin(pg_current_snapshot()) ORDER BY txid DESC, id DESC LIMIT 1), 0), now()
+     ON CONFLICT (consumer_name) DO UPDATE SET last_processed_id = EXCLUDED.last_processed_id, updated_at = now()`); // RBD-1: the worker resumes after what was rebuilt
+  const volumeRows = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM merchant_daily_volume`);
+  return { volumeRows: volumeRows.rows[0]!.n, trendRows: trendResult.rowCount ?? 0 };
```
Everything runs in the route's one transaction, in this order:
1. *Pause the worker.* `LOCK TABLE reporting_outbox_cursor IN EXCLUSIVE MODE` waits for a running pass to commit and blocks new passes, since every pass starts by locking its cursor row. The cursor is locked first, the same lock order as a pass and as the CLI rebuild (OBX-DOUBLE), so the `TRUNCATE`s cannot deadlock with a pass.
2. *One snapshot.* `REPEATABLE READ`, set before any query, gives the source tables, the refund aggregate and the watermark the same view of the data.
3. *The watermark the rebuild covered.* It is the worker's own rule (OBX-SKIP): the last outbox row, in `(txid, id)` order, below the snapshot's xmin. Every row up to it is in the snapshot, so it is in the rebuild; the worker resumes after it.
4. *The one exact-case guard.* If a reporting event is already visible but sits after that watermark (its transaction committed while an older one was still in flight), no single watermark can describe the snapshot. The rebuild then rolls back with 409 `reporting_rebuild_busy` and nothing changes. The operator presses again; on a quiet box this does not occur.
5. *Refunds.* Succeeded refunds are aggregated per merchant and Bahrain day, the same bucket the worker uses (the refund row and its `refund.succeeded` event share the transaction time). The cursor is upserted, so a worker that never ran also starts after the rebuild.

`volumeRows` is now the table's final row count (the documented meaning, `apps/admin/src/types.ts:240-241`), because refund-only days add rows. The `{ volumeRows, trendRows }` shape and the synchronous behaviour are unchanged.

**Why this is the smallest correct fix:** it keeps the button's synchronous contract and its source-table rebuild, and adds only the three things whose absence causes the damage: worker exclusion, the covered watermark and the refund columns. *Why not reset the cursor to 0 and let the worker replay (the lead's option)?* The response would become "0 rows" and asynchronous, contradicting the UI ("Rebuilt N rows") and ADMIN.md ("instead of waiting for the worker"). *Why not set the watermark to the newest outbox row?* A transaction in flight at the snapshot whose xid is older would commit a row behind it, and the worker would skip that row forever. *Why not take the watermark below xmin and accept the straddling rows?* Those rows are counted by the rebuild and again by the worker. The 409 guard is the only exact choice.

**Proof:** `RBD-1: rebuild, then one worker pass, leaves the rollups unchanged and the refund columns intact` (`apps/api/src/admin/reportingRebuild.audit.test.ts`; it imports the worker's `runConsumerPass` and retries a 409 caused by other databases' transactions on the shared test cluster).
- Before the fix: after the rebuild `refund_count: 0, refunds: 0` (expected 1 / 1,500).
- With only the refund aggregate and no watermark move: after the worker pass `captured_count: 2, gross: 20000, refund_count: 2, refunds: 3000`.
- After the fix: `{captured_count 1, gross 10,000, voided 0, refund_count 1, refunds 1,500}` both after the rebuild and after the worker pass.
- `routes/admin.test.ts`, `routes/analytics.test.ts` (55/55) and the reporting suite (17/17) pass.

**Regression risk:** The button can now answer 409 under concurrent payment traffic (snapshot xmin is cluster-wide, so a long-running write transaction anywhere delays it); it then changes nothing. The worker is paused for the rebuild's duration, as it was effectively blocked by the `TRUNCATE` locks before. The rebuild still counts by source tables (e.g. seeded history without outbox rows), which is unchanged; the worker continues to apply only later events.

Lines: prod +14/-1 (1 import, 1 comment line, 12 code lines), test +81/-0 (new file)

---

<a id="f-ui-date-1"></a>

### UI-DATE-1 · Merchant dashboard date filters use the UTC day, so each day loses its first 3 Bahrain hours · G1 · Severity: Medium

**Lead:** Team 45 heads-up list (N13), verified by us.

**What's wrong:** On the merchant dashboard's Transactions page, the `From` and `To` date pickers filter on the UTC day instead of the Bahrain business day. Picking `From = 2026-09-12` sends `from=2026-09-12T00:00:00.000Z`, which is 03:00 in Bahrain. Transactions made between 00:00 and 03:00 Bahrain on the chosen day are missing, and the `To` day picks up the first 3 hours of the next Bahrain day.

**Why it happens:** `dayStartIso` (`apps/web/src/format.ts:35-37`) turns the `<input type="date">` value into `${dateValue}T00:00:00.000Z`, which is a UTC midnight. `TransactionListPage.tsx:55-56` passes the result as `from`/`to`, and `GET /v1/transactions` (`apps/api/src/routes/transactions.ts:133-134`) compares it directly with `occurred_at` (`>= from`, `< to`). The case file says the business day runs from midnight to midnight Bahrain time (UTC+3). The comment at `format.ts:34` ("fixed, uses bahrain time now — am") is false: the code was never changed.

**What it breaks:** A merchant who filters on one day (`From = D`, `To = D+1`) gets a window from 03:00 on D to 03:00 on D+1. That window misses that day's late-night sales and includes 3 hours of the next day. The totals no longer match the settlement batch for the same business date, which closes at Bahrain midnight (G1). Support then gets "my dashboard and my payout disagree" tickets.

**Why it needed a fix:** The case file says settlement closes every day at midnight Bahrain time (UTC+3). A dashboard filter that uses a different day boundary from settlement shows the merchant the wrong set of transactions for the day they picked.

**Fix:** `apps/web/src/format.ts:36` (the docstring at `:28` is corrected to match)
```diff
-  return dateValue ? `${dateValue}T00:00:00.000Z` : undefined;
+  return dateValue ? `${dateValue}T00:00:00.000+03:00` : undefined;
```
Commit: `a90e26c`. Lines: prod +2/-2 (1 code, 1 docstring), test +5/-2.

**Why this is the smallest correct fix:** `dayStartIso` is the only place the dashboard turns a date into an instant, and both filters call it. Bahrain has had no DST since 1972, so a fixed `+03:00` offset is exact, and the API already parses offset ISO strings (`new Date(q.from)`). `buildQuery` uses `URLSearchParams`, so the `+` is sent as `%2B` and is not read as a space (the test checks this). *Why not convert the date on the server?* The endpoint's contract is "ISO-8601 instants" (`routes/transactions.ts:28`), and API-key clients depend on it. *Why not `Intl` with `timeZone: "Asia/Bahrain"`?* It needs more code to get the same fixed offset. `ReconciliationPage.tsx:19` already uses the fixed `+3h` approach.

**Proof:** `dayStartIso converts a date input to the Asia/Bahrain day boundary` (`apps/web/src/dashboard.test.ts`) fails before the fix with `expected: '2026-09-11T21:00:00.000Z'`, `actual: '2026-09-12T00:00:00.000Z'`. It passes after the fix. The old assertion (`=== "2026-09-12T00:00:00.000Z"`) encoded the bug and has been corrected, citing the case file. `apps/web` tests: 8/8 pass, and `tsc --noEmit` is clean.

**Regression risk:** The query value is still a valid ISO-8601 instant. Only its offset changes, so the API contract is unchanged. With no date picked, no `from`/`to` param is sent, as before.

**Trap note:** `format.ts:34` ("fixed, uses bahrain time now — am") claimed a fix that did not exist. `format.ts:33` ("YA: UTC day boundary, NOT Bahrain … known") and `TransactionListPage.tsx:28` ("from/to are UTC day starts") describe the old behaviour. They are left as-is (initials notes are claims, not code).

---

<a id="f-ui-settle-1"></a>

### UI-SETTLE-1 · Admin "Run batch" form defaults to the wrong business date between 00:00 and 03:00 Bahrain · G1 · Severity: Medium

**Lead:** Team 45 heads-up list (Q3-02), verified by us.

**What's wrong:** On the admin console's Settlement page, the business date in the "Run batch" form defaults to the UTC date of "now minus 24 h", not to yesterday's Bahrain date. From 00:00 to 03:00 Bahrain the field shows the day before yesterday. For example, at 01:30 on 30 Oct it shows `2026-10-28`, not `2026-10-29`.

**Why it happens:** `yesterdayIso` (`apps/admin/src/pages/settlement/SettlementPage.tsx:19-23`) subtracts one day in browser-local time with `setDate(getDate() - 1)`, then reads the date with `toISOString().slice(0, 10)`, which is the UTC calendar date. Whatever the browser's timezone, the result is the UTC date 24 hours ago. That matches the Bahrain date only after 03:00 Bahrain. The comment above it ("browser-local yesterday") does not describe what the code returns.

**What it breaks:** The business date is the batch the operator is about to close. After midnight, a finance operator who accepts the default re-runs the day before yesterday. That run is idempotent and returns already-closed batches, so it looks like a success, and the day that actually needs closing stays open. Merchants are then paid a day late, which is the G1 symptom from the other side.

**Why it needed a fix:** The case file says settlement closes every day at midnight Bahrain time (UTC+3), so the default batch date must follow the Bahrain calendar. A wrong default on a money-moving form is a UX bug that operators will not notice.

**Fix:** `apps/admin/src/pages/settlement/SettlementPage.tsx:19-22`
```diff
-function yesterdayIso(): string {
-  const date = new Date();
-  date.setDate(date.getDate() - 1);
-  return date.toISOString().slice(0, 10);
+export function yesterdayIso(): string {
+  // UI-SETTLE-1 (G1): yesterday's Bahrain (UTC+3, no DST) calendar day, the business date batches close on.
+  return new Date(Date.now() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
```
`apps/admin/package.json`: added a `"test"` script (`tsx --test "src/**/*.test.ts"`, the same form as `apps/web`), so the root `npm test` (`--workspaces --if-present`) runs the new admin test. Before this, apps/admin had no test script.
Commit: `3d47d7a`. Lines: prod +3/-4 (SettlementPage.tsx) plus infra +2/-1 (package.json), test +22/-0.

**Why this is the smallest correct fix:** It is one expression in the one function that sets the default, and the form still lets the operator pick any date. Bahrain has had no DST since 1972, so a fixed +3 h shift is exact. This is the same approach the merchant dashboard already uses (`apps/web/src/pages/settlement/ReconciliationPage.tsx:19-26`). *Why not `toLocaleDateString` with `timeZone: "Asia/Bahrain"`?* Its output format depends on the locale and ICU version, while `toISOString` always gives `YYYY-MM-DD`. The `export` is needed so the function can be tested. React Fast Refresh then does a full reload of this page in dev, and production is unaffected.

**Proof:** `yesterdayIso is the Bahrain calendar day before today` (`apps/admin/src/pages/settlement/SettlementPage.test.ts`) mocks `Date` at 01:30 on 30 Oct in Bahrain (`2026-10-29T22:30:00Z`). Before the fix it fails with `expected: '2026-10-29'`, `actual: '2026-10-28'`. It passes after the fix, and also with `TZ=Asia/Bahrain` and `TZ=America/New_York`. The second case, 23:59 Bahrain, pins the normal path. The test loads the page through Vite's `ssrLoadModule` because the admin API client reads `import.meta.env`, which plain `tsx` does not define. `tsc --noEmit` for apps/admin is clean.

**Regression risk:** Outside 00:00-03:00 Bahrain the default is unchanged. Only the pre-filled value changes: the request shape, `POST /v1/admin/settlement/run-batch`, and the server-side validation are all unchanged.

**Trap note:** `SettlementPage.tsx:18` ("YA: browser-local yesterday") is left as-is. It was never accurate (the old code returned a UTC date), and the new in-function comment states what the code does.

---

<a id="f-admin-imp-3"></a>

### ADMIN-IMP-3 · "View as merchant" never opens the dashboard: /v1/auth/me ignores the impersonation grant · H3 · Severity: Medium

**Lead:** Team 45 heads-up list (W2), verified by us.

**What's wrong:** In the admin console, "View as merchant" issues a grant and opens the merchant dashboard, and the dashboard immediately redirects to the merchant login page. The support view the feature exists for never appears, for any admin role.

**Why it happens:** The dashboard's route guard (`apps/web/src/auth/RequireDashboardAuth.tsx`, via `DashboardAuthContext.tsx`) asks `GET /v1/auth/me` who is signed in. `/me` (`apps/api/src/routes/auth.ts:252-286`) sits behind the legacy `requireSession` (`auth/middleware.ts:29-43`), which reads only the `fp_sid` cookie. The grant lives in its own `fp_impersonation` cookie (`routes/adminMerchants.ts:347`), which only `requireMerchantAuth` reads (`auth/requireMerchantAuth.ts:85-99`). Every data route therefore accepts the grant, but the one call that decides whether the dashboard renders returns 401.

**What it breaks:** Support cannot see what a merchant sees, which is the reason the grant flow exists (ARCH §8). Operators end up asking merchants for screenshots or credentials. The admin console's "View as merchant" button is visibly broken, on a judged UI surface.

**Why it needed a fix:** H3 concerns admin access done right. After ADMIN-IMP-1 made grants read-only `support`, the safe version of the feature still did not work. A working read-only view removes the reason to share merchant credentials.

**Fix:** `apps/api/src/routes/auth.ts:254-267` (plus 2 import lines at `:9,13`)
```diff
   app.get(
     "/me",
-    { preHandler: requireSession },
     async (request: FastifyRequest) => {
-      const auth = request.auth;
+      const sid = request.cookies[app.config.cookieName];
+      const auth = sid ? await lookupSession(app.db, sid) : null;
       if (!auth) {
-        throw new UnauthorizedError("unauthenticated");
+        // ADMIN-IMP-3 (H3): no merchant session, so fall back to a "view as merchant" grant ... (2 comment lines)
+        const grantToken = request.cookies[app.config.impersonationCookieName];
+        const grant = grantToken ? await lookupImpersonationGrant(app.db, grantToken) : null;
+        if (!grant) throw new UnauthorizedError("unauthenticated");
+        const m = (await app.db.query<…>(`SELECT display_name, onboarding_status FROM merchants WHERE id = $1`, [grant.merchantId])).rows[0]!;
+        return { merchantUserId: null, email: null, role: grant.merchantRole, merchant: { id: grant.merchantId, displayName: m.display_name, onboardingStatus: m.onboarding_status } };
       }
```
Commit: `f71695a`. Lines: prod +11/-3 (2 imports, 2 comments, 7 code), test +38/-0.

**Why this is the smallest correct fix:** It uses the same precedence as `requireMerchantAuth`: a live merchant session first (the same `lookupSession` that `requireSession` called, so pending pre-OTP sessions are still refused, see AUTH-1), then the grant. It reuses `lookupImpersonationGrant`, the single definition of a live grant, which already refuses revoked, ended, expired and disabled-admin grants (ADMIN-IMP-2). The response keeps the `/me` shape and reports `role: "support"` (the grant's merchant role since ADMIN-IMP-1) with `merchantUserId`/`email` set to `null`, because no merchant user is signed in, so nothing is attributed to a real user. *Why not switch `/me` to `requireMerchantAuth`?* That would also let API keys call `/me`, which widens access, and its context has no `merchantUserId`. *Why not change `requireSession`?* `/logout` and every `requireRole` chain use it, and they must stay merchant-session only.

**Proof:** `ADMIN-IMP-3: /v1/auth/me answers a live grant as read-only support, and refuses a revoked or expired one` (`apps/api/src/admin/impersonation.audit.test.ts`) fails before the fix with `expected: 200`, `actual: 401`. After the fix it passes and also checks four things: the grant still gets 403 on `POST /v1/merchants/:id/payment-links`; a revoked grant gets 401 on `/me`; an expired grant gets 401; and a garbage token gets 401. Impersonation audit tests pass 5/5. `src/app.test.ts` (signup → login → OTP → `/me` for a real merchant) and `routes/auth.audit.test.ts` pass 13/13. `tsc --noEmit` is clean.

**Regression risk:** A real merchant session gets the same answer as before, from the same lookup. Requests with no cookie, or with a pending or expired session and no grant, still get 401. With an `fp_impersonation` cookie and no merchant session, `/me` now returns 200 read-only `support`, which every other merchant GET route already allowed (`requireMerchantAuth`). The web app shows `me.email` only as text (`DashboardLayout.tsx:50`), so `null` renders as empty next to the `support` role chip.

**Trap note:** `auth/middleware.ts:29` ("legacy — requireMerchantAuth replaced this everywhere except /auth/me") is false: `requireSession` still guards `/logout`, the API-key routes (`routes/apiKeys.ts:36,56,65`) and `routes/businessProfile.ts:51`, and none of them change here. `DashboardAuthContext.tsx:51-53` and `DashboardLayout.tsx:8-10` say impersonation does not exist in the merchant plane, which was never true server-side. Those comments are left as-is.

---

<a id="f-checkout-375"></a>

### CHECKOUT-375 · On a phone the checkout's CVV field is off-screen and dashboard pages overflow sideways ·  · Severity: Medium

**Lead:** Team 45 heads-up list (item 2), verified by us.

**What's wrong:** On a 375 px phone screen, the hosted checkout's expiry-month / expiry-year / CVV row is wider than the screen. The CVV box starts at the right edge, so the buyer has to pan sideways to find it. On the merchant dashboard, the transactions table and the detail pages are also wider than the screen, so the whole page scrolls sideways.

**Why it happens:** `apps/web/src/pages/checkout/CheckoutPage.css:44-47` makes `.checkout-form-row` a flex row. Its three `<label>`s have no flex basis, and the inputs inside keep the browser's default width (about 20 characters each). Three default-width inputs do not fit in 343 px, and nothing lets them shrink. In `apps/web/src/dashboard.css:150-155` (pre-fix lines), `.dash-table` is `width: 100%` but grows to its content's width (six columns), and `.dash-dl` (`:166-170`) has a fixed `16rem` label column plus the value column. The dashboard has no rule for narrow screens.

**What it breaks:** Measured in headless Edge with a 375 px mobile viewport (`Emulation.setDeviceMetricsOverride`, `mobile: true`): the checkout lays out **549 px** wide (CVV right edge at 549 px), the transactions page **665 px**, and a transaction's detail page **411 px**. Buyers paying from a phone, the normal case for a payment link, see a cut-off form. Merchants on a phone get pages that pan sideways.

**Why it needed a fix:** Checkout is one of the three judged UI surfaces, and a payment page whose security-code field starts off-screen loses payments.

**Fix:** `apps/web/src/pages/checkout/CheckoutPage.css:42-43,50-54` and `apps/web/src/dashboard.css:178-183`
```diff
 .checkout-form input {
   padding: 0.5rem;
   font-size: 1rem;
+  width: 100%; /* CHECKOUT-375: fill the label, so a 375 px screen keeps CVV on-screen */
+  box-sizing: border-box;
 }
+.checkout-form-row label {
+  flex: 1;
+  min-width: 0;
+}
```
```diff
+/* CHECKOUT-375: on a phone, tables scroll inside themselves and label/value pairs stack. */
+@media (max-width: 640px) {
+  .dash-table { display: block; overflow-x: auto; }
+  .dash-dl { grid-template-columns: 1fr; }
+}
```
Commit: `993c95a`. Lines: prod +13/-0 (CSS: 9 rules/declarations, 2 comments, 2 blank), test +0/-0.

**Why this is the smallest correct fix:** The checkout change is three declarations on existing selectors plus one new selector. The three labels share the row equally and may shrink below their content width, and each input fills its label. The dashboard change only applies under 640 px, so desktop layout is untouched. *Why not wrap every `.dash-table` in an `overflow-x` `<div>`?* That edits about 10 page components for the same result. `display: block; overflow-x: auto` on the table itself, scoped to narrow screens, does it in one rule. *Why not `flex-wrap`?* With `min-width: 0` the fields never need to wrap, and three short fields on one line is the expected card-form layout.

**Proof:** There is no unit test, because this is CSS and the repo has no DOM test runner. The proof is the measured layout from the same harness run on the same data, before and after (`docs/audit/evidence/ui/`): checkout 549 → **375 px** (CVV right edge 549 → 343 px), transactions 665 → **375 px** (the table scrolls inside itself), detail 411 → **375 px**. Screenshots: `checkout-375-{before,after}.png`, `dashboard-table-375-{before,after}.png`, `dashboard-detail-375-{before,after}.png`. At branch head `36cb2c7` the web suite passes 13/13 (CSS is not type-checked).

**Regression risk:** At desktop width, the checkout's card-number and expiry inputs now fill the 420 px form instead of using the browser default width, a cosmetic change (`checkout-open-after.png`). Dashboard rules apply only at ≤ 640 px.

---

<a id="f-recon-refunds"></a>

### RECON-REFUNDS · Merchant reconciliation says "no gap" over three numbers that do not add up (refund lines not shown) · H1 / FP-300 · Severity: Medium

**Lead:** Team 45 heads-up list (item 4, part 7), verified by us.

**What's wrong:** After a refund, the merchant dashboard's Reconciliation page shows "Reconciled — no gap" under these figures: ledger payable 3.666 BHD, settlement payout 0.000 BHD, pending 4.643 BHD, gap 0.000 BHD. The caption says "Gap = ledger − payout − pending", but 3.666 − 0.000 − 4.643 = −0.977, not 0. The 0.977 BHD of unbatched refund (1.000 BHD refunded minus the 0.023 BHD fee reversal) is in the server's formula and missing from the page.

**Why it happens:** REC-1 (FP-300 ☐5) added `pendingUnbatchedRefundsFils` and `nettedRefundsFils` to `GET /v1/settlement/reconciliation`, and the gap became `ledger − payout − pending − pendingUnbatchedRefunds` (`apps/api/src/settlement/query.ts:249-262,331`). The web type `ReconciliationReport` (`apps/web/src/types.ts:259-267`) was never updated. `ReconciliationPage.tsx:119-137` therefore renders only the old three terms and the old formula text, while showing the server's gap, which does include refunds.

**What it breaks:** The merchant cannot check the page's own arithmetic. After any refund the page shows a contradiction ("no gap" over numbers with a 0.977 BHD hole), or a non-zero gap that the listed terms cannot explain. Reconciliation is exactly where a merchant needs every fil to be visible.

**Why it needed a fix:** FP-300 ☐5 asks for refunds to tie out in reconciliation. The API now does that, and the page has to show the terms it ties out with.

**Fix:** `apps/web/src/types.ts:265-266` and `apps/web/src/pages/settlement/ReconciliationPage.tsx:130-133,139-141`
```diff
   pendingUnbatchedFils: number;
+  pendingUnbatchedRefundsFils: number; // RECON-REFUNDS: in the API's gap formula (REC-1), was missing here
+  nettedRefundsFils: number;
```
```diff
+            <dt>Refunds, not yet batched</dt>
+            <dd>{bhd(report.pendingUnbatchedRefundsFils)}</dd>
+            <dt>Refunds netted in settled batches (inside the payout above)</dt>
+            <dd>{bhd(report.nettedRefundsFils)}</dd>
-            unbatched. A zero gap means every captured fil is accounted for in
-            either a settled batch or the pending queue.
+            unbatched − refunds not yet batched. A zero gap means every captured
+            and refunded fil is accounted for in either a settled batch or the pending queue.
```
Commit: `0208c59`. Lines: prod +8/-2, test +0/-0.

**Why this is the smallest correct fix:** The page only displays values the API already returns, and it shows the formula the API already uses (`query.ts:331`). *Why also show `nettedRefundsFils`?* It is not a term of the gap. It sits inside the settlement payout, and labelling it that way explains why a payout can be lower than the captures. *Why not recompute the gap in the browser?* The server's gap is authoritative, and the page must not second-guess it. Negative amounts render because of UI-NEG-1, which `bhd` needed for exactly this row.

**Proof:** There is no unit test: the change is to rendering only, and the repo has no DOM test runner. The field names are checked by `tsc --noEmit` against the shared shape, and the web suite passes 13/13 at branch head `36cb2c7`. Screenshots on the same data: `dashboard-reconciliation-before.png` shows 3.666 − 0.000 − 4.643 ≠ 0 under "no gap". `dashboard-reconciliation-after.png` shows the −0.977 BHD refund row, and 3.666 − 0.000 − 4.643 − (−0.977) = 0.000.

**Regression risk:** None to the API. The endpoint already returns both fields (`query.ts:339-340`), and the request is unchanged.

**Trap note:** `types.ts:258` ("YA: gapFils is a string here (pre-Jan contract)") is false. The API returns a number and the type says `number`. Left as-is.

---

<a id="f-cw-10"></a>

### CW-10 · Webhook transport buffers the whole receiver response with no byte cap ·  · Severity: Medium

**What's wrong:** `createFetchTransport` read the receiver's response with `await response.text()`, which buffers the entire body in memory, although callers only keep a 2,000-character excerpt (`webhooks/dispatcher.ts:188/200/211` store `left($4, 2000)`, `webhooks/testSend.ts:69` slices to 2,000).

**Why it happens:** The `AbortController` in `webhooks/transport.ts:35-36` bounds only time (`WEBHOOK_REQUEST_TIMEOUT_MS`, 10 s by default). Within that window a receiver can stream hundreds of MB; `text()` decodes it into a JS string of roughly twice that size. Nothing limits bytes.

**What it breaks:** Any merchant who controls a webhook endpoint (or uses the test-send route, which calls the transport synchronously) can push the 512 MB API container toward an OOM kill, taking payments, checkout and admin down for everyone. Because the delivery outcome is written only after the transport returns, the row stays due after a restart and is picked again, so the crash can repeat.

**Why it needed a fix:** One tenant can deny service to all tenants with a single URL, and the stored data never needed more than 2,000 characters.

**Fix:** `apps/api/src/webhooks/transport.ts:47-57`
```diff
-      // unbounded read, a 1gb response would oom us? — am
-      // MK: timeoutMs bounds it. fine for now, revisit after Eid inshallah
-      const body = await response.text();
+      // CW-10: timeoutMs bounds time, not bytes; keep 8 KiB (>= the 2000 chars stored) and cancel the rest
+      const chunks: Uint8Array[] = [];
+      const reader = response.body?.getReader();
+      for (let n = 0; reader && n < 8192; ) {
+        const { done, value } = await reader.read();
+        if (done) break;
+        chunks.push(value);
+        n += value.byteLength;
+      }
+      await reader?.cancel().catch(() => {});
+      const body = Buffer.concat(chunks).subarray(0, 8192).toString("utf8");
```
Commit: `c68fbdd`. Lines: prod +11/-3, test +42/-0.

**Why this is the smallest correct fix:** The transport is the single place every delivery path (dispatcher Step A/B and test-send) reads the response, so one capped read covers them all. 8,192 bytes always decodes to at least 2,048 code points, so the stored `left(body, 2000)` excerpt is unchanged for every response. *Why not check `Content-Length`?* A chunked response has none, and the header can lie. *Why not lower the timeout?* It bounds seconds, not bytes; a fast link still delivers hundreds of MB. *Why not truncate after `text()`?* The memory is already spent by then. Cancelling the reader closes the connection so the rest is never downloaded. A multi-byte character split at the 8,192-byte boundary becomes U+FFFD at the very end, which lies past the 2,000 characters that are stored.

**Proof:** `CW-10: transport reads at most a few KB of a huge receiver response` (`apps/api/src/webhooks/transport.audit.test.ts`) starts a local server that streams 64 MiB with status 200. Before the fix it fails with `body must be capped, got 67108864 chars`. After the fix it passes: status 200, body between 2,000 and 8,192 characters.

**Regression risk:** Low. Status-code handling is unchanged, and responses under 8 KiB are returned byte-for-byte as before. `webhooks/create.audit.test.ts` (CW-4 redirect test), `webhooks/testSend.test.ts` and `webhooks/dispatcher.test.ts` pass (19/19 with the new test). Not addressed here (lead's optional extras): Step B still attempts up to 100 rows sequentially, each allowed the full timeout, so slow receivers can still delay other merchants' webhooks; this is a latency issue, not a memory one.

**Trap note:** `transport.ts:48` "MK: timeoutMs bounds it. fine for now" was wrong: it bounds time, not bytes; the comment is removed with the fix. `transport.ts:9-10` ("timeoutMs covers the whole exchange including reading the body") is still accurate and left as-is.

---

<a id="f-arc-1"></a>

### ARC-1 · Webhook delivery archive loads an unbounded date range into one in-memory JSON string · H9 · Severity: Medium

Duplicates of this lead: `ADMIN-ARCH-1` (admin-rbac) and `CW-13` (callbacks-webhooks) describe the same code path; this note covers all three.

**What's wrong:** `createWebhookDeliveryArchive` selected every delivery of the endpoint in `[from, to)` with no `LIMIT`, mapped the rows (with their JSONB payloads) into an array and `JSON.stringify`'d the lot into one TEXT bind parameter. `replayWebhookDeliveryArchive` reads that value back with `JSON.parse` and replays every entry inside one transaction. Nothing bounds the size of the range.

**Why it happens:** The archive is designed as one complete document per range (doc comment at `webhooks/archiveReplay.ts:20-27`: "No row cap"), and neither the route (`routes/adminMerchants.ts:256-289`, any admin session) nor the function checks how many deliveries the range holds. During create the pg result rows, the entries array, the JSON string and the bind buffer all live in memory at once.

**What it breaks:** Archiving a long range of an active endpoint (for example a year at ~200k deliveries x ~1.5 KB, about 300 MB of JSON) exceeds the 512 MB API container and kills the API for every merchant (H9). Replay of such an archive repeats the cost and holds one transaction open for the whole run.

**Why it needed a fix:** Any admin role, including support, can take the API down with a date range, and the archive's own "complete record" contract rules out silently truncating it.

**Fix:** `apps/api/src/webhooks/archiveReplay.ts:4,30,51-56`
```diff
-import { ConflictError, NotFoundError } from "../lib/errors.js";
+import { ConflictError, NotFoundError, UnprocessableEntityError } from "../lib/errors.js";
-  input: { merchantId: string; endpointId: string; adminUserId: string; from: Date; to: Date },
+  input: { merchantId: string; endpointId: string; adminUserId: string; from: Date; to: Date; maxDeliveries?: number },
-        ORDER BY created_at ASC`,
-      [input.endpointId, input.from, input.to],
+        ORDER BY created_at ASC
+        LIMIT $4`,
+      [input.endpointId, input.from, input.to, (input.maxDeliveries ?? 5000) + 1],
+    // ARC-1: refuse (never truncate) a range too large to hold as one in-memory JSON document
+    if (rows.rows.length > (input.maxDeliveries ?? 5000)) throw new UnprocessableEntityError("archive_range_too_large");
```
Commit: `51ec9bb`. Lines: prod +7/-4, test +20/-1.

**Why this is the smallest correct fix:** Fetching at most cap+1 rows and refusing when the extra row exists bounds memory in the single query that loads the data, with no extra round trip. The archive stays complete-or-nothing, and since replay can only read archives created through this path, replay is bounded too (at most 5,000 entries). The route passes no `maxDeliveries`, so production always uses 5,000; the optional field only lets the test use a small cap. A 422 `archive_range_too_large` tells the admin to pick a narrower window; the existing `AppError` handler maps it. *Why not a separate `count(*)` first (the lead's suggestion)?* It is one more query for the same result. *Why not truncate at the cap?* It breaks the archive's completeness contract. *Why not page into a child table?* A schema change and a rewrite of both functions, far beyond a minimal fix.

**Proof:** `ARC-1: refuses a range with more deliveries than the cap and writes no archive` (`apps/api/src/webhooks/archiveReplay.test.ts`) inserts 3 deliveries and archives with `maxDeliveries: 2`. Before the fix it fails with `Missing expected rejection.` (the archive was written). After the fix it rejects with 422 `archive_range_too_large`, no `webhook_delivery_archives` row exists for the endpoint, and the same range at a cap of 3 is archived with `deliveryCount = 3`.

**Regression risk:** Admins archiving more than 5,000 deliveries in one range now get 422 and must split the range. Archives created before the fix with more entries can still be replayed unbounded; none exist in a fresh deployment. `webhooks/archiveReplay.test.ts` passes 5/5 and `routes/admin.test.ts` passes 41/41.

**Trap note:** `docs/ADMIN.md:100-101` ("Archives are written in pages of 1000 deliveries, so any range is fine") and `db/migrations/0068_webhook_delivery_archives.sql:35-36` ("AM: archives are built in 1000-row pages and stored compressed") are false: there was no paging or compression. Left as-is (docs and an applied migration). The doc comment's "No row cap" now holds only up to 5,000; the refusal keeps its completeness intent.

---

<a id="f-admin-upl-1"></a>

### ADMIN-UPL-1 · KYC upload buffers any number of files and decodes images of any pixel count · H9 · Severity: Medium

**What's wrong:** `POST /v1/merchants/:merchantId/kyc/documents` accepted any number of file parts: the route `toBuffer()`'d every one (up to 8 MiB each) and kept only the last. `generateKycThumbnail` then called `sharp(buffer)` with sharp's default input limit of about 268 MP, so a small PNG could decode to around 1 GiB. The original file was written to disk before the thumbnail was generated, so a rejected image left a file behind.

**Why it happens:** `plugins/multipart.ts:16` registers `@fastify/multipart` with only `limits.fileSize`; its comment says "one file per request is enforced in routes/kyc.ts", but the loop at `routes/kyc.ts:48-55` enforced nothing. File size and pixel count are independent: a single-colour 16384x16384 PNG is about 1 MB, well under the 8 MiB cap. In `onboarding/kyc.ts` the `writeFile` of the original came before `generateKycThumbnail`.

**What it breaks:** Any owner or finance user (and signup is public) can tie up the 0.5 vCPU API decoding huge thumbnails and push the 512 MB container toward an OOM kill for every merchant (H9; the RUNBOOK already records sharp-driven OOMs), or stream many 8 MiB files in one request.

**Why it needed a fix:** The 8 MiB cap was the only guard and does not bound decoded memory, so a single request from any merchant user can take the shared API down.

**Fix:** `apps/api/src/onboarding/kycThumbnail.ts:2,33-39`, `apps/api/src/routes/kyc.ts:50`, `apps/api/src/onboarding/kyc.ts:74`
```diff
+import { UnprocessableEntityError } from "../lib/errors.js";
-  const resized = await sharp(buffer)
+  // ADMIN-UPL-1: file size does not bound decoded pixels; refuse > 25 MP before decoding
+  const resized = await sharp(buffer, { limitInputPixels: 25_000_000 })
     ...
-    .toBuffer();
+    .toBuffer()
+    .catch((err: unknown) => {
+      throw /pixel limit/i.test(String(err)) ? new UnprocessableEntityError("invalid_file_type", "image exceeds 25 MP") : err;
+    });
```
```diff
         if (part.type === "file") {
+          if (buffer) throw new BadRequestError("invalid_request", "exactly one file per request"); // ADMIN-UPL-1
```
```diff
   const fullPath = join(config.kycUploadDir, storageKey);
+  const thumbnail = await generateKycThumbnail(input.buffer, detected); // ADMIN-UPL-1: decode before any disk write
   await mkdir(join(config.kycUploadDir, input.merchantId), { recursive: true });
   ...
-  const thumbnail = await generateKycThumbnail(input.buffer, detected);
```
Commit: `b809526`. Lines: prod +9/-3, test +60/-1.

**Why this is the smallest correct fix:** `limitInputPixels` makes sharp refuse from the image header, before decoding; 25 MP is well above any phone photo or scanned ID page. Only the pixel-limit error is mapped to the existing 422 `invalid_file_type` response; other sharp errors keep their current behaviour. The one-file rule is a single line at the point the route sees a second file part, before that part is buffered, so at most one file is ever held. Moving the thumbnail call above the first `writeFile` (one line moved) means a rejected image writes nothing. *Why not `limits: { files: 1, parts: 5 }` in the multipart plugin (the lead's suggestion)?* Tried: when the second file arrives in the same chunk, the plugin's limit cleanup destroys the first file's stream while the route is still reading it, and the request fails with `ERR_STREAM_PREMATURE_CLOSE` as a 500 `internal_error` instead of a 413. `FST_PARTS_LIMIT` / `FST_FIELDS_LIMIT` are also not mapped by `plugins/errorHandler.ts`, so they would surface as 500 too. The route check gives a deterministic 400 with no change to the plugin or the error handler.

**Proof:** `ADMIN-UPL-1: a small PNG that decodes to more than 25 MP is rejected with 422, not decoded` (`apps/api/src/onboarding/kycThumbnail.test.ts`, 6000x6000 PNG) fails before with `Missing expected rejection.` and passes after in about 0.4 s. `ADMIN-UPL-1: KYC upload with two file parts is rejected and writes nothing` (`apps/api/src/app.test.ts`) got 201 before and gets 400 after, with no upload directory and no `kyc_documents` row for the merchant. `ADMIN-UPL-1: KYC upload of a PNG over the pixel limit gets 422 and writes nothing` (`apps/api/src/app.test.ts`) got 201 before and gets 422 `invalid_file_type` after, with nothing on disk.

**Regression risk:** Low. Clients sending more than one file per request now get 400; the documented API takes one file. Images over 25 MP get 422. `onboarding/kycThumbnail.test.ts`, `onboarding/fileSignature.test.ts` and `app.test.ts` pass (24/24, three runs). Not fixed: the original file and thumbnail are still written before the DB transaction, so a failed insert can still leave an orphan file (`onboarding/kyc.ts`, the "am" comment there is still accurate); requests with very many small text fields are not capped (each field is bounded by busboy's 1 MB `fieldSize`, and only `documentType` is kept).

**Trap note:** `plugins/multipart.ts:13` "MK: ... one file per request is enforced in routes/kyc.ts" was false; it is true after this fix. `onboarding/kycThumbnail.ts:30` "YA: the 8 MiB upload cap protects us here" was false (file size does not bound pixels); left as-is, next to the new comment. `routes/kyc.ts:37` "am: the thumbnail job is the slow part, not this. ignore the perf ticket" understated the risk. All left in place to keep the diff minimal.

---

<a id="f-u4"></a>

### U4 · Batch views show Gross − Fee ≠ Net payout with nothing explaining the netted refunds · FP-300 · Severity: Medium

**Lead:** Team 45 heads-up list (U4), verified by us.

**What's wrong:** Since FP-300, a refund is netted into the merchant's next settlement batch, so that batch's net payout is lower than gross − fee. The merchant batch page and the admin batch tables show only Gross, Fee and Net payout. For a batch with refunds, 650.000 − 16.250 ≠ 630.500, and no figure on the page explains the 3.250 BHD difference. The web type even documents the old invariant: `netPayoutFils` "Always exactly grossFils - feeFils" (`apps/web/src/types.ts:218`).

**Why it happens:** At close, migration 0097 and `apps/settlement/internal/settlement/batch.go:215-217` set `net_payout_fils = (gross − fee) − (refund_gross − refund_fee_reversed)` and store the refund totals in `settlement_batches.refund_gross_fils` and `refund_fee_reversed_fils`. The merchant batch DTO (`apps/api/src/settlement/query.ts:53-63`) and the Go run-batch summary expose only gross, fee and net, and the views (`SettlementBatchDetailPage.tsx:97-102`, admin `SettlementPage.tsx:196-198`, `MerchantDetailPage.tsx:620-622`) render only those three.

**What it breaks:** After midnight in Bahrain, tonight's refunds net into the batches that close. A merchant or judge looking at a batch then sees a payout smaller than gross − fee, with no explanation. That looks like money gone missing, on the dashboard and on the admin console.

**Why it needed a fix:** FP-300 requires refunds to be correct in the money flow, and they now are. The pages have to show that, or they look like a payout error.

**Fix (UI only, no API or DTO change):** `apps/web/src/format.ts:44-47`, `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx:5,101`, `apps/admin/src/pages/settlement/SettlementPage.tsx:198`, `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:622`, `apps/web/src/types.ts:218` (comment)
```diff
+/** U4: refunds netted into a batch at close (FP-300: net = gross - fee - (refund - fee reversed)); 0 when none. */
+export function refundsNettedFils(batch: { grossFils: number; feeFils: number; netPayoutFils: number }): number {
+  return batch.grossFils - batch.feeFils - batch.netPayoutFils;
+}
+        {refundsNettedFils(batch) !== 0 ? (<><dt>Refunds netted</dt><dd>{bhd(refundsNettedFils(batch))}</dd></>) : null}
-                    <td>{bhd(outcome.netPayoutFils)}</td>
+                    <td>{bhd(outcome.netPayoutFils)}{outcome.grossFils - outcome.feeFils !== outcome.netPayoutFils ? ` (refunds netted: ${bhd(outcome.grossFils - outcome.feeFils - outcome.netPayoutFils)})` : ""}</td>
 (same one-line change for the admin merchant page's batch table)
-/** @property netPayoutFils Always exactly grossFils - feeFils. */
+/** @property netPayoutFils grossFils - feeFils - refunds netted at close (FP-300, migration 0097). */
```
Commit: `d3953ff`. Lines: prod +10/-4 (helper 4 + 1 blank; merchant row 1 + import 1; admin 2 cells; 1 comment), test +10/-1.

**Why this is the smallest correct fix:** The difference is exact integer fils, derived from the three numbers every view already has, so no API, DTO or Go change is needed. Both shapes the views receive (the merchant DTO and the admin run-batch summary) stay as they are. The row or note appears only when the difference is non-zero, so batches without refunds look exactly as before. The value is `refund_gross − refund_fee_reversed` by construction (migration 0097), so the label "Refunds netted" is accurate. *Why not add `refundGrossFils`/`refundFeeReversedFils` to the DTO?* That changes a public response shape that clients and tests compare exactly. The derived value carries the same information for display. *Why inline in the admin?* apps/admin has no shared format module, and a new one would be a refactor for two cells.

**Proof:** `refundsNettedFils is gross - fee - net: zero without refunds, the netted refund otherwise` (`apps/web/src/dashboard.test.ts`) fails before the fix (`SyntaxError: … does not provide an export named 'refundsNettedFils'`) and passes after. It covers the seeded refund-free batch (0), a refunded batch (3,258 fils), and the negative sign. `tsc --noEmit` is clean for web and admin. AFTER screenshots come from a local evidence DB, using the real API refund (`POST /v1/refunds`, 3.333 BHD, fee reversal 0.083) and the real Go close (`Re-run a daily batch` 2026-08-26 for Alpha Retail Co). The refund row's `occurred_at` was moved to 2026-08-26 in that throwaway DB, because a refund made today only nets after today's Bahrain close (CLOSE-1). The stored batch has gross 650,000, fee 16,250, refund 3,333 − 83 and net 630,500 fils, so the views show **Refunds netted 3.250 BHD**: `dashboard-batch-refunds-netted-after.png`, `admin-run-batch-refunds-netted-after.png` and `admin-merchant-batches-refunds-netted-after.png` in `docs/audit/evidence/ui/`.

**Regression risk:** Display only. Batches with no netted refunds render unchanged, and the request and response shapes are unchanged.

**Trap note:** `apps/api/src/settlement/query.ts:50-51` ("Invariant (enforced by the Go worker at close): netPayoutFils === grossFils - feeFils") has the same false claim on the API side. It is left as-is because this task is UI only.

---

<a id="f-test-backoff"></a>

### TEST-BACKOFF · Dispatcher backoff test asserts an exact value from a jittered function · baseline test failure · Severity: Low

**What's wrong:** `dispatcher.test.ts` "failing endpoint: backoff/exhaustion sequence …" asserted `backoffDelayMs(1, config) === 1000` (and `=== 2000` for attempt 2) without passing a jitter source, so it fails roughly every run (actual 925, 1052, 939, 1073 …).

**Why it happens:** `apps/api/src/webhooks/dispatcher.ts:55-63` applies a documented ±10 % jitter that defaults to `Math.random`. The code is correct; the test is wrong (it ignores the injectable `jitter` parameter it was designed with).

**What it breaks:** Only CI signal: a permanently red test masks real dispatcher regressions.

**Why it needed a fix:** A flaky/always-failing test is ignored, which is how bugs like CW-3 stayed hidden.

**Fix:** `apps/api/src/webhooks/dispatcher.test.ts:200,220`: `backoffDelayMs(n, config)` → `backoffDelayMs(n, config, () => 0.5)` (jitter midpoint = factor 1.0). The live `next_attempt_at` checks keep their 3000 ms tolerance, which already covers ±10 %. Commit: `3cb19b7`. Lines: prod +0/-0, test +2/-2.

**Why this is the smallest correct fix:** Two arguments in the test; removing jitter from production would be a behaviour change that the design (and thundering-herd protection) does not want.

**Proof:** before: `AssertionError: expected 1000, actual 925`; after: `dispatcher.test.ts` 8/8 pass.

**Regression risk:** none (test-only).

**Trap note:** the assertion looked like a spec of "base delay = 1000 ms" but silently depended on `Math.random() === 0.5`.

---

<a id="f-test-outbox-fixture"></a>

### TEST-OUTBOX-FIXTURE · Webhook archive test seeds malformed rollup events that break the reporting consumer tests · baseline test failure (FP-300 ☐5) · Severity: Low

**What's wrong:** 4 `apps/reporting` tests (`runRebuild`, `runConsumerPass` end-to-end ×2, atomicity) failed with `null value in column "merchant_id" of relation "merchant_daily_volume"`. The reporting code is right; the input was invalid test data.

**Why it happens:** `apps/api/src/webhooks/archiveReplay.test.ts:62-64` inserted `outbox_events` rows with a real, rollup-eligible `event_type` (`transaction.captured` / `transaction.voided`) and payload `'{}'`. The reporting consumer's watermark is global (`runConsumerPass.ts:46-53`), so once the api suite has run against the same database, the next reporting pass applies those rows and `applyTransactionCaptured` inserts `merchant_id = NULL`. Production producers (`capture.ts`, `void.ts`) always send `merchantId`. `admin.test.ts:912-916` already documents and avoids exactly this ("a deliberately inert event_type").

**What it breaks:** CI only: a red reporting suite whenever suites share a DB (the normal `npm test` order).

**Why it needed a fix:** The failures hid real reporting regressions behind a known-red baseline.

**Fix:** `apps/api/src/webhooks/archiveReplay.test.ts:62-66`: the outbox row uses the inert type `'archive.test.replay_fixture'` (archive replay reads `event_type` from `webhook_deliveries`, which keeps the real type). Local test DB: the 21 already-inserted rows were re-typed the same way (`UPDATE … WHERE payload = '{}'`, test DB only). Commit: `139f5aa`. Lines: prod +0/-0, test +4/-2.

**Why this is the smallest correct fix:** fix the fixture that produces invalid events, not the consumer. Why not make the consumer skip events without `merchantId`: it would silently drop data for a malformed real event; the poison-pill class is handled for the real case in OBX-POISON.

**Proof:** before: `runConsumerPass … end-to-end …` → `null value in column "merchant_id"`; after: `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` 11/11 pass with `--test-concurrency=1` (the package's own `npm test` setting); `archiveReplay.test.ts` 4/4.

**Regression risk:** none (test-only). Note: running the reporting files in parallel (without `--test-concurrency=1`) still flakes, because two concurrent passes double-apply (that is OBX-DOUBLE, fixed separately).

**Trap note:** the failure looked like a reporting NOT NULL bug; the cause was a cross-suite fixture.

---

<a id="f-f2-window"></a>

### F2-WINDOW · The March residue sweep reads a UTC month, not the Bahrain month · F2, G1/H5 (timezone) · Severity: Low
**What's wrong:** `monthBounds` in `scripts/reconcile_march.ts:16-18` builds the March window from UTC midnights (2026-03-01T00:00Z … 2026-04-01T00:00Z). FilsPay's business day, and so its month, runs midnight to midnight **Asia/Bahrain** (UTC+3).

**Why it happens:** `Date.UTC(year, month - 1, 1)` is UTC midnight. Bahrain midnight is three hours earlier (21:00Z on the previous day). The existing test asserted `start.getUTCMonth() === 2`, which only holds for the UTC window, so it pinned the bug.

**What it breaks:** captures between 00:00 and 03:00 Bahrain time on 1 March fall outside the sweep, while captures between 00:00 and 03:00 Bahrain time on 1 April (31 March 21:00-24:00Z) are swept into March. The residue is booked to the wrong month: three hours of residue go missing at one end and three hours from the next month are added at the other.

**Why it needed a fix:** month-end write-offs must match the books, which close on the Bahrain day (case file: "Settlement closes every day at midnight, Bahrain time").

**Fix:** `scripts/reconcile_march.ts:17`
```diff
-  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
+  return { start: new Date(Date.UTC(year, month - 1, 1, -3)), end: new Date(Date.UTC(year, month, 1, -3)) }; // Asia/Bahrain (UTC+3) midnights
```
Lines: prod +1/−1, test +3/−2.

**Why this is the smallest correct fix:** one expression; Bahrain has no DST, so a fixed −3 h is exact. Why not a timezone library or `Intl`? It would add code and dependencies for a fixed offset.

**Proof:** `scripts/reconcile_march.test.ts` "monthBounds for March 2026 spans 31 days", with assertions corrected to `2026-02-28T21:00:00.000Z` / `2026-03-31T21:00:00.000Z` (case file cited): before `actual: '2026-03-01T00:00:00.000Z'`, after pass. Sweep tests 4/4.

**Regression risk:** only this one-off script uses `monthBounds`. The printed "window:" line now shows the UTC dates of the Bahrain boundaries (2026-02-28 .. 2026-03-31).

**Trap note:** the old assertion `start.getUTCMonth() === 2` encoded the UTC assumption (the same "UTC midnight" claim as the quarantined AI configs).

---

<a id="f-auth-1-rpt"></a>

### AUTH-1·rpt · Reporting export-summary has no authentication gate · H3 · Severity: Low
**What's wrong:** `GET /v1/reporting/export-summary` (`apps/api/src/routes/reporting.ts:79`) is the only reporting route registered without `requireMerchantAuth`.

**Why it happens:** the handler reads `request.merchantAuth!.merchantId`. The `!` tells TypeScript the value exists, but no preHandler ever sets it for this route. The file's own header says every route uses `requireMerchantAuth` (`:18`).

**What it breaks:** an anonymous request throws a TypeError and gets a 500 (an availability and noise problem). If any future hook populated `merchantAuth` loosely, it would become a data exposure. No data leaks today.

**Why it needed a fix:** every merchant-data route must refuse anonymous callers with 401, not crash.

**Fix:** `reporting.ts:79` `app.get("/export-summary", { preHandler: requireMerchantAuth }, async (request) => {`. Lines: prod +1/−1, test +28/−0.

**Why this is the smallest correct fix:** the same one-line gate its sibling routes use.

**Proof:** `routes/reporting.audit.test.ts` "export-summary requires a merchant session (401, not a 500 crash)": before `actual: 500`, after 401.

**Regression risk:** none; authenticated callers see the same response.

**Trap note:** the non-null assertion `merchantAuth!` silenced the type checker that would otherwise have flagged the missing gate.

---

<a id="f-auth-9"></a>

### AUTH-9 · OTP verify never re-issues the merchant cookie, so fp_sid keeps the 10-minute pending Max-Age ·  · Severity: Low

**Lead:** Team 45 heads-up list (W1) and our 03_findings AUTH-9, verified by us.

**What's wrong:** After a successful merchant OTP verify, the browser still holds `fp_sid` with the `Max-Age=600` it got at login, while the server-side session row now lives 12 hours. The browser drops the cookie 10 minutes after login, so every merchant is logged out 10 minutes into each session. The admin plane does not have this problem because it re-sets its cookie at verify.

**Why it happens:** `POST /v1/auth/login` sets the cookie with `maxAge: app.config.pendingSessionTtlMinutes * 60` (`apps/api/src/routes/auth.ts:98-104`, 600 s by default, `config.ts:206`). `POST /v1/auth/otp/verify` calls `promoteSession`, which moves `expires_at` to 12 h (`auth/sessions.ts:56-59`), but the handler then sends JSON only and never calls `reply.setCookie` (`routes/auth.ts:182-186` before the fix). The admin verify does re-set its cookie at the full TTL (`routes/adminAuth.ts:178-184`). The `MK` comment at `routes/auth.ts:169-170` ("the cookie maxAge doesn't matter") is wrong: the browser enforces Max-Age.

**What it breaks:** A merchant logs in at 09:00 and verifies the OTP. At 09:10 the browser expires `fp_sid`, and the next dashboard call gets 401 `unauthenticated`, even though the `sessions` row is valid until 21:00. This is the "10 min logouts" symptom in the code comments. The session row is also left live and unrevoked for the remaining 11 h 50 min, without the user knowing.

**Why it needed a fix:** H8 asks whether the OTP flow is still safe and sound. A second factor that logs every user out 10 minutes after they pass it is broken from start to end. Users who are logged out repeatedly also repeat the password-and-OTP flow many times a day, which multiplies OTP traffic and phishing exposure.

**Fix:** `apps/api/src/routes/auth.ts:182-183`
```diff
+      // AUTH-9: re-issue the cookie at the promoted session's TTL; the login cookie had the 10-minute pending Max-Age.
+      reply.setCookie(app.config.cookieName, rawToken, { httpOnly: true, path: "/", sameSite: "lax", secure: app.config.cookieSecure, maxAge: app.config.sessionTtlHours * 3600 });
       reply.code(200).send({
```

**Why this is the smallest correct fix:** This line copies the admin verify (`routes/adminAuth.ts:178-184`), with the same attributes as the login cookie and only `maxAge` changed. *Why not lengthen the login cookie's Max-Age?* The pending session would then outlive its 10-minute server window in the browser. That is harmless but misleading, and it does not match the admin plane. *Why not also rotate the token at promotion (the lead's fixation hardening)?* Rotation changes the API contract: a client would have to swap to a new cookie after verify. Every existing caller that keeps the login cookie would break, including `app.test.ts:111` (`signupLoginAndVerify` returns the login cookie for post-verify use), `routes/auth.audit.test.ts:66-68`, and the admin test helpers. Hidden regression tests most likely follow the same pattern. The fixation exposure that rotation would close is narrow, as the verifier noted: the pending cookie is HttpOnly and tied to the account whose password was just checked, so an attacker must already hold both the password and the victim's pre-OTP cookie. We record rotation as a follow-up hardening item for both planes (`auth/sessions.ts:51-62`, `adminAuth/sessions.ts:67-78`), to ship alongside a client change.

**Proof:** `AUTH-9: OTP verify re-issues fp_sid with the full session Max-Age` (`apps/api/src/routes/auth.audit.test.ts`).
Before: `not ok 3 - AUTH-9 ... error: 'verify must re-set fp_sid, got: no Set-Cookie'`.
After: `ok 3`. The file passes 3/3, and `src/app.test.ts` passes 10/10.

**Regression risk:** Very low. The cookie value is the same token, so callers that kept the login cookie still work. Only the browser-side lifetime changes. Logout still clears the cookie with `maxAge: 0` (`routes/auth.ts:298-304`).

Lines: prod +2/-0, test +14/-0

---

<a id="f-admin-kyc-2"></a>

### ADMIN-KYC-2 · The PDF-only KYC rule checks the filename, so a renamed JPEG is accepted as a commercial registration · H3 · Severity: Low

**What's wrong:** `commercial_registration` and `bank_letter` documents must be PDFs. The rule checked only that the client-supplied file name ended in `.pdf`. A phone photo (JPEG) named `CR-2026.pdf` was accepted as a commercial registration and stored as `image/jpeg`, ready for an admin to approve KYC on it.

**Why it happens:** `apps/api/src/onboarding/kyc.ts:67` (before the fix) was `PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && !input.fileName.toLowerCase().endsWith(".pdf")`. It ignored `detected`, which the function had already computed from the magic bytes at `kyc.ts:50`. This contradicts the file's own contract: the doc comment at `kyc.ts:16` says the fileName is "Informational only; never used for validation", the function doc at `kyc.ts:35` says it "Validates the upload from its own bytes (never the client-supplied filename …)", and `db/migrations/0015` says `mime_type` is always the type detected from the bytes. The `MK` note at `kyc.ts:57` ("detectFileType already rejects non-pdf bytes for these doc types. fixed in FP-231") is false: `detectFileType` (`fileSignature.ts:25`) takes no document type and accepts JPEG and PNG for every document.

**What it breaks:** A merchant uploads a JPEG photo named `CR-2026.pdf` as `commercial_registration`. The API answers 201, writes `<sha256>.jpg`, records `mime_type = image/jpeg`, and moves onboarding to `under_review`. The registry-issued PDF that the KYC policy requires was never supplied, and the reviewer's queue shows a document that passed a rule it does not meet.

**Why it needed a fix:** Admin KYC review (H3: admin-side controls) relies on this gate. A KYC document-format control that the client can bypass by renaming a file is not a control, and the code's own documented contract is "validated by detected content type".

**Fix:** `apps/api/src/onboarding/kyc.ts:67-68`
```diff
-  if (PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && !input.fileName.toLowerCase().endsWith(".pdf")) {
+  // ADMIN-KYC-2: the name alone let a renamed JPEG through; the detected bytes must be a PDF too
+  if (PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && (detected !== "pdf" || !input.fileName.toLowerCase().endsWith(".pdf"))) {
```

**Why this is the smallest correct fix:** This is one condition at the single gate, reusing the already-computed `detected`. *Why not replace the filename check entirely, as the lead proposed (`detected !== "pdf"` only)?* The existing contract test `KYC upload rejects a commercial_registration submitted as a non-PDF filename` (`app.test.ts:274`) uploads real `%PDF` bytes named `registration.docx` and requires 422 `document_must_be_pdf`. Dropping the name check would break that pinned behaviour. Keeping both checks is strictly stricter, so every previously rejected upload is still rejected and the bypass closes. *Why not change `detectFileType`?* It is shared by all document types and has no document-type input. Error code, status and message are unchanged.

**Proof:** `ADMIN-KYC-2: a JPEG renamed CR-2026.pdf is rejected as a commercial_registration` (`apps/api/src/app.test.ts`) uploads a real 8×8 JPEG (made with `sharp`) through the multipart route.
Before: `not ok 1 ... expected: 422, actual: 201`.
After: `ok`. `app.test.ts` passes 11/11 (including the existing `.docx` rejection and real-PDF acceptance tests), `fileSignature.test.ts` and `kycThumbnail.test.ts` pass, and `tsc --noEmit` is clean.

**Regression risk:** Low. The only uploads newly rejected are non-PDF bytes declared as `commercial_registration` or `bank_letter`, which the policy forbids. `owner_id` and `proof_of_address` still accept JPEG and PNG.

Lines: prod +2/-1, test +21/-0

---

<a id="f-cw-11"></a>

### CW-11 · Acquirer callback `outcome` and `occurredAt` are never validated, so any string is stored as a fraud verdict ·  · Severity: Low

**What's wrong:** `POST /v1/acquirer/callbacks` checked only that `outcome` and `occurredAt` were present. Any signed callback with `outcome: "approved"` (or `"void_now"`, or anything else) was stored in `acquirer_callback_notes` and surfaced on the transaction timeline as the acquirer's fraud verdict. `occurredAt` went straight into the `received_at` timestamptz, so Postgres special literals such as `"yesterday"` were stored silently as midnight yesterday, and other junk strings raised a DB error that was retried three times and then surfaced as a 500.

**Why it happens:** `apps/api/src/routes/acquirerCallbacks.ts:48-60` tests only truthiness, then `:76` casts `body.outcome as AcquirerCallbackInput["outcome"]`, and TypeScript casts do nothing at runtime. Two comments claimed validation that did not exist: the route doc (`acquirerCallbacks.ts:10-12`, which even names a different union, "approved" | "rejected") and `acquirer/callbacks.ts:4` ("Validated against the two allowed values by the route schema"; no route schema exists). The column has no CHECK (`db/migrations/0051_acquirer_callback_notes.sql:20`).

**What it breaks:** A signed callback with `outcome: "approved"` gets 200 `{received:true}`, and a note row with outcome `approved` is written: a verdict that no consumer understands, next to `cleared` and `confirmed_fraud` on the timeline. A callback with `occurredAt: "yesterday"` gets 200, and the note is backdated to midnight. The audit test observed both before the fix (`200 notes=1` for each). A malformed timestamp such as `"not-a-date"` becomes a retried 500, which makes the acquirer retry a payload that can never succeed.

**Why it needed a fix:** The fraud-review note is the only record of the acquirer's delayed verdict that support and finance act on (void or refund). Accepting free-form verdicts and unparseable times corrupts that record and turns a sender bug into a retry loop.

**Fix:** `apps/api/src/routes/acquirerCallbacks.ts:11, 62-65`
```diff
- * the AcquirerCallbackInput union ("approved" | "rejected") before it is
+ * the AcquirerCallbackInput union ("cleared" | "confirmed_fraud") before it is
 ...
+    // CW-11: the outcome union and occurredAt were never checked at runtime (the cast below is type-only)
+    if ((body.outcome !== "cleared" && body.outcome !== "confirmed_fraud") || !/^\d{4}-\d{2}-\d{2}T/.test(body.occurredAt) || Number.isNaN(Date.parse(body.occurredAt))) {
+      throw new BadRequestError("invalid_request", "outcome must be cleared or confirmed_fraud and occurredAt an ISO-8601 timestamp");
+    }
```

**Why this is the smallest correct fix:** A single guard sits next to the existing required-field check and returns the same 400 `invalid_request` shape the route already uses. The comment fix keeps the route's only documentation of the check truthful. *Why not `Date.parse` alone?* JavaScript accepts non-ISO forms such as `"Sep 16 2026"`, and Postgres parses some of them differently. Requiring the `YYYY-MM-DDT` ISO prefix and a parseable value pins the contract. *Why not a migration CHECK on `outcome` (the lead's suggestion)?* With the route as the only writer, the guard closes the hole. A CHECK violation would also come back through `withCallbackRetry` as a retried 500 instead of a 400, and a new migration adds schema churn. *Why not also store `now()` as `received_at`?* That changes what the existing column means and what timeline readers see. It is a separate design decision, outside this validation bug.

**Proof:** `CW-11: a signed callback with an unknown outcome or an unparseable occurredAt is a 400 and stores nothing` (`apps/api/src/routes/acquirerCallbacks.test.ts`).
Before: `actual: ['{"outcome":"approved"} -> 200  notes=1', '{"occurredAt":"yesterday"} -> 200  notes=1']`.
After: both cases give `400 invalid_request notes=0`. `routes/acquirerCallbacks.test.ts` passes 7/7 and `acquirer/callbacks.test.ts` passes.

**Regression risk:** Low. Valid callbacks (`cleared` or `confirmed_fraud` with an ISO timestamp, as the existing tests and the acquirer contract send) are unchanged. Only callbacks that were already semantically invalid are refused.

Lines: prod +5/-1, test +21/-0

---

<a id="f-cw-12"></a>

### CW-12 · Merchants cannot stop deliveries: deleting an endpoint with history returns 500, and a disabled endpoint keeps getting retries ·  · Severity: Low

**Lead:** Team 45 heads-up list (RT-ENDPOINT) and our 03_findings CW-12, verified by us.

**What's wrong:** A merchant moving away from a wrong or compromised webhook URL has two tools, and neither worked. `DELETE /v1/merchants/:merchantId/webhook-endpoints/:id` returned 500 `internal_error` as soon as the endpoint had any delivery. `PATCH ... {status: "disabled"}` succeeded, but the dispatcher kept re-sending the endpoint's pending deliveries, signed payloads with amounts, merchant ids and payouts, to the old URL until they were exhausted.

**Why it happens:** `db/migrations/0022_webhook_deliveries.sql:6` declares `endpoint_id UUID NOT NULL REFERENCES webhook_endpoints (id)` with no ON DELETE clause, and `0068_webhook_delivery_archives.sql:13` does the same. Postgres therefore rejects the `DELETE` in `apps/api/src/webhooks/cancel.ts:22` with SQLSTATE 23503, and nothing maps that to an API error. The comments claiming otherwise are all false: `cancel.ts:3` ("kept with endpoint_id set to NULL"), `cancel.ts:16` YA ("FK is ON DELETE SET NULL (0029)"; 0029 is a payment-links index), and `routes/webhooks.ts:103-104` ("ON DELETE CASCADE added in 0047"; 0047 is merchant_discount_bps). Separately, dispatcher Step B (`webhooks/dispatcher.ts:222-229`) joins `webhook_endpoints` only to read the url and secret and never checks `we.status`, while Step A only fans out to `status = 'active'` endpoints (`:98`).

**What it breaks:** The audit test registers an endpoint that answers 500, captures a payment, and dispatches once. A `DELETE` then gets `500 internal_error`. After `PATCH status=disabled`, the next dispatch pass sends the payload to the disabled URL again: two sends where one was expected. With the default backoff, the old URL keeps receiving signed merchant data for about an hour after the merchant disabled it.

**Why it needed a fix:** A merchant must be able to stop signed payment data from going to a URL they have revoked, for example after a compromise. A 500 on a routine action also hides the real reason (history exists) and the way out (disable).

**Fix:** `apps/api/src/webhooks/cancel.ts:2-3, 25-28` and `apps/api/src/webhooks/dispatcher.ts:226`
```diff
 import type { Pool } from "pg";
+import { ConflictError } from "../lib/errors.js";

-/** "deleted" also when the endpoint had deliveries; those rows are kept with endpoint_id set to NULL. */
+/** An endpoint with delivery history cannot be deleted (0022: endpoint_id NOT NULL, no ON DELETE): 409, disable it instead. */
 ...
     [input.id, input.merchantId],
-  );
+  ).catch((err: { code?: string }) => {
+    // CW-12: the FK (23503) used to surface as a 500
+    throw err.code === "23503" ? new ConflictError("webhook_endpoint_has_deliveries", "disable the endpoint instead") : err;
+  });
```
```diff
-      WHERE wd.status = 'pending' AND wd.next_attempt_at <= now()
+      WHERE wd.status = 'pending' AND wd.next_attempt_at <= now() AND we.status = 'active'
```

**Why this is the smallest correct fix:** The schema is the higher authority than the comments. It makes `endpoint_id` NOT NULL with no ON DELETE on two tables, and the delivery log is called a durable audit trail (`cancel.ts:10-13`), so an endpoint with history is not meant to be deleted. The fix makes that a clean, documented 409 at the single delete statement, and makes "disable", the tool the code itself names for "pause without losing history" (`cancel.ts:8-9`), actually stop traffic, with one predicate on the one retry query. *Why not the lead's migration (DROP NOT NULL + ON DELETE SET NULL on two tables)?* It would change the schema contract, and every reader of `endpoint_id` (replay, which re-inserts `original.endpoint_id`; the archive restore default target; the delivery lists) would then have to handle NULL. Replaying an orphaned delivery would insert a NULL-endpoint row that Step B's inner join skips, leaving it pending forever. That is many more lines and more risk for no gain over disable plus 409. *Why not ON DELETE CASCADE?* It destroys the audit trail. *Why not pre-check for deliveries with a SELECT?* That is racy and adds a query; catching the constraint's own error is atomic. Pending rows of a disabled endpoint stay `pending` and resume if the merchant re-enables it, which is pause semantics. Response codes are unchanged for endpoints without history (204) and for unknown ids (404).

**Proof:** `CW-12: deleting an endpoint with history is a clean 409, and disabling it stops pending retries` (`apps/api/src/routes/webhooks.test.ts`) uses a real local receiver that answers 500, the real create, capture and dispatch path, DELETE, PATCH disabled, a forced-due retry and a second dispatch pass.
Before: `actual: { deleteStatus: 500, deleteError: 'internal_error', sendsToDisabledEndpoint: 2 }`.
After: `{ deleteStatus: 409, deleteError: 'webhook_endpoint_has_deliveries', sendsToDisabledEndpoint: 1 }`. `routes/webhooks.test.ts` passes 10/10 (including the CRUD delete-without-history 204 test), `webhooks/dispatcher.test.ts` passes 10/10, the archive replay, payout disbursement, test-send and refund webhook suites pass 14/14, and `tsc --noEmit` is clean.

**Regression risk:** Low. The only change in `dispatcher.ts` is the one Step-B predicate, approved by the coordinator. Deliveries to active endpoints are untouched. A DELETE that used to 500 now returns 409 with a clear error code.

Lines: prod +7/-3, test +35/-0

---

<a id="f-err-1"></a>

### ERR-1 · A NUL byte in any request string turns into a 500 internal_error instead of a 400 ·  · Severity: Low

**Lead:** Team 45 heads-up list (SEC5), verified by us.

**What's wrong:** JSON allows `\u0000` inside strings, and Postgres `text` cannot store it. Any client string that reaches a query with a NUL byte made Postgres raise SQLSTATE 22021 ("invalid byte sequence for encoding UTF8: 0x00"), and the API answered `500 {"error":"internal_error"}` with a full stack trace in the error log. This works on any endpoint, including unauthenticated ones such as `POST /v1/auth/login`.

**Why it happens:** `apps/api/src/plugins/errorHandler.ts:16-35` maps `AppError`, Fastify validation errors and multipart limits. Every other error, including a `pg` `DatabaseError` caused purely by client input, falls through to the 500 branch (`:34-35`). No route rejects control characters, and none needs to as long as the database's own refusal is mapped correctly.

**What it breaks:** `POST /v1/auth/login {"merchantId":"<uuid>","email":"nul\u0000@example.test","password":"x"}` returns `500 internal_error` (observed in the audit test, with `DatabaseError: invalid byte sequence for encoding "UTF8": 0x00` logged at level 50). Anyone can send unauthenticated requests that produce server-error responses and error-level stack traces at will. That pollutes 5xx alerting and SLOs and hides real faults. It also tells the client a server bug exists, when the problem is malformed input that should get a 4xx.

**Why it needed a fix:** A 5xx means "our fault" and pages operators. Input validation failures must be 4xx. A security review treats unauthenticated, attacker-triggerable 500s as an error-handling weakness that enables log flooding and noisy monitoring.

**Fix:** `apps/api/src/plugins/errorHandler.ts:34-38`
```diff
+  // ERR-1: Postgres rejects a NUL byte in client text (22021, or 22P05 when converting); that is bad input, not a 500
+  if (fastifyErr.code === "22021" || fastifyErr.code === "22P05") {
+    reply.code(400).send({ error: "invalid_request", message: "request contains a character that cannot be stored" });
+    return;
+  }
+
   request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
```

**Why this is the smallest correct fix:** The error handler is the single place errors become responses, and it already branches on error codes (`FST_REQ_FILE_TOO_LARGE`). Two SQLSTATEs cover the NUL case: 22021 `character_not_in_repertoire` for UTF-8 input, and 22P05 `untranslatable_character` for conversion. Both can only come from data we were given. The response reuses the `{ error: "invalid_request" }` shape the routes already return for bad input. *Why not strip or reject NULs in a preValidation hook?* That is a new global hook over every body, query and param, which is more code and could alter data that legitimately never reaches Postgres. *Why not map all class-22 errors?* Some class-22 errors, such as 22003 numeric overflow or 22012 division by zero, can come from server-side arithmetic bugs, and those must stay 500s.

**Proof:** `ERR-1: a NUL byte in a request string is a 400, not a 500` (`apps/api/src/routes/auth.audit.test.ts`).
Before: `actual: { status: 500, error: 'internal_error' }`.
After: `{ status: 400, error: 'invalid_request' }`. The file passes 5/5, and `tsc --noEmit` is clean.

**Regression risk:** Very low. Only the two SQLSTATEs change from 500 to 400. No transaction is affected, because the failing statement already aborted it and `withTransaction` rolls back as before.

Lines: prod +6/-0, test +11/-0

---

<a id="f-txn-1"></a>

### TXN-1 · withTransaction lets a failing ROLLBACK mask the real error and returns the broken client to the pool ·  · Severity: Low

**Lead:** Team 45 heads-up list (C7), verified by us.

**What's wrong:** When `fn` throws, `withTransaction` awaits `ROLLBACK` before rethrowing. If the `ROLLBACK` itself throws (connection reset, server restart, pool timeout), that error replaces the original one. The caller and the error log then report "rollback failed" instead of the unique violation or bug that actually aborted the write. The client is also released with a plain `release()`, so a connection left in an unknown transaction state can go back into the pool.

**Why it happens:** `apps/api/src/db/withTransaction.ts:33-38` (before the fix) ran `await client.query("ROLLBACK"); throw err;` in the catch, so a rejection at the first line skips the second. The `finally` calls `client.release()` with no error. pg-pool destroys a client only when it gets an error or the connection is already flagged unusable (`pg-pool/index.js:392`), so a live connection whose ROLLBACK failed is pooled again. The comment thread above the function names exactly this (FH: "ROLLBACK can itself throw and mask the original error", am: "release(err)"), and it was dismissed without a fix.

**What it breaks:** Every multi-statement write in the API (capture, refund, payment-link pay, signup, KYC review, admin actions) runs through this helper. During a database blip, an error-mapping branch such as `isUniqueViolation` in `onboarding/signup.ts:107-114`, or any AppError thrown inside `fn` (409, 422 and so on), gets the rollback error instead. A request that should have returned a clean 4xx turns into a 500, and the real root cause never reaches the logs. If the connection is still alive after the failed ROLLBACK, the next request that borrows it starts inside an aborted transaction and fails too.

**Why it needed a fix:** On money paths the cause of a failed write is the thing operators need, and a poisoned pooled connection spreads one failure to unrelated requests.

**Fix:** `apps/api/src/db/withTransaction.ts:26, 35, 39`
```diff
   const client = await pool.connect();
+  let releaseErr: Error | undefined; // TXN-1: set when ROLLBACK fails, so pg destroys the client
   try {
 ...
     } catch (err) {
-      await client.query("ROLLBACK");
+      await client.query("ROLLBACK").catch((rollbackErr: Error) => { releaseErr = rollbackErr; }); // TXN-1: never mask err
       throw err;
     }
   } finally {
-    client.release();
+    client.release(releaseErr);
   }
```

**Why this is the smallest correct fix:** Three lines in the one helper every transactional write uses. The original error is always rethrown, and the rollback failure is passed to `release(err)`, the documented pg-pool way to destroy rather than recycle a client (this is am's suggestion in the comment thread). *Why not just swallow the ROLLBACK error (`.catch(() => {})`)?* That fixes the masking but still pools a client in an unknown state. *Why not log the rollback error?* `withTransaction` has no logger, and adding one changes its signature for every caller. pg-pool also emits it through the destroy path. The happy path and the normal rollback path are byte-for-byte unchanged: `release(undefined)` is `release()`.

**Proof:** `TXN-1: a ROLLBACK failure neither masks the original error nor returns the client to the pool` (`apps/api/src/db/withTransaction.audit.test.ts`, a unit test with a stub client whose ROLLBACK rejects).
Before: `actual: { thrown: 'rollback failed: connection reset', released: [undefined] }`.
After: `{ thrown: 'insert failed: unique violation', released: [rollbackErr] }`. `db/pool.test.ts` and `routes/auth.audit.test.ts` pass, and `tsc --noEmit` is clean. The full API suite exercises the helper on every write path.

**Regression risk:** Very low. Behaviour changes only when ROLLBACK itself fails: the caller then sees the original error, and the connection is discarded and replaced by the pool.

Lines: prod +3/-2, test +30/-0

---

<a id="f-sec-1"></a>

### SEC-1 · Every merchant `:id` route answers 500 for a malformed id (Postgres 22P02) instead of 404 ·  · Severity: Low

**Lead:** own sweep of `apps/api/src/routes/*.ts` (wave 3 lane A).

**What's wrong:** Merchant routes pass the raw `:id` path segment straight into a `uuid` column comparison. Any non-UUID id (`/v1/transactions/not-a-uuid`) makes Postgres raise SQLSTATE 22P02 (`invalid input syntax for type uuid`), and the API answers `500 {"error":"internal_error"}` with an error-level stack trace. A probe found 14 merchant routes affected: transaction detail, events, capture and void; settlement batch detail and transactions; KYC file and thumbnail; API-key revoke; payment-link cancel; webhook-endpoint delete, patch, test and deliveries.

**Why it happens:** The admin routes guard every id with `assertUuidParam` → `NotFoundError` (for example `routes/adminBalanceAdjustments.ts:14-18` and `routes/adminMerchants.ts`), and `admin.test.ts:788` pins "404s for an unknown or malformed id". The merchant routes never got that guard, and `plugins/errorHandler.ts:16-35` sends any unmapped `DatabaseError` to the 500 branch.

**What it breaks:** `GET /v1/transactions/not-a-uuid` with a valid session or API key returns 500, and the same happens on all 14 routes. Any authenticated merchant (or a client with a buggy id) can generate unlimited server errors and error-level stack traces, polluting 5xx alerting and hiding real faults. The API contract also becomes inconsistent: an unknown UUID gets 404, a malformed one gets 500, and the existing tests describe the intended contract as "returns 404, not 403 or 500" (`routes/transactions.test.ts`, cross-tenant test).

**Why it needed a fix:** 5xx responses that clients can trigger at will are an error-handling weakness a security review flags: log flooding, noisy SLOs, and a "server bug" signal on bad input. The platform's own convention is 404 for malformed ids.

**Fix:** `apps/api/src/plugins/errorHandler.ts:40-44`
```diff
+  // SEC-1: a malformed id (e.g. /v1/transactions/not-a-uuid) makes Postgres raise 22P02; like admin routes, that is a 404
+  if (fastifyErr.code === "22P02") {
+    reply.code(404).send({ error: "not_found", message: "malformed identifier" });
+    return;
+  }
+
   request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
```

**Why this is the smallest correct fix:** One mapping in the single place errors become responses, rather than an `assertUuidParam` call added to each of 14 handlers across 6 files (about 30 lines, with a new shared helper or 6 copies). It returns 404, which matches the admin routes, `admin.test.ts:788` and the "404, not 500" contract named in the transactions test, so a malformed id behaves exactly like an unknown one. That also means it leaks nothing about which ids exist. 22P02 means "this text is not a valid value of the target type". In this API it comes from client-supplied ids, because ids generated server-side are always valid UUIDs. *Why not 400?* The existing contract for a malformed path id is 404 on the admin plane, so we keep one behaviour across planes. *Why not add per-route guards?* That is far more lines for the same result, and any future route would still need remembering.

**Proof:** `SEC-1: a malformed id on merchant :id routes is a 404, not a 500` (`apps/api/src/routes/transactions.audit.test.ts`) covers four routes in four route files.
Before: `actual: ['/v1/transactions/not-a-uuid -> 500', '/v1/settlement/batches/not-a-uuid -> 500', '/v1/merchants/:m/kyc/documents/not-a-uuid/file -> 500', '/v1/merchants/:m/webhook-endpoints/not-a-uuid/deliveries -> 500']`.
After: all four return `404`. The transactions audit, transactions, settlement and webhooks suites pass 35/35.

**Regression risk:** Low. Only SQLSTATE 22P02 changes, from 500 to 404, and nothing changes for valid ids. A hypothetical server-side bug that casts bad text would now surface as a 404 rather than a 500. We accept that, because every id the server generates is a database-issued UUID.

Lines: prod +6/-0, test +23/-0

---

<a id="f-cli-1"></a>

### CLI-1 · `settlement rebuild-balances --merchant=<id>` prints the rebuilt figure but never writes it · F4 · Severity: Low

**Lead:** Team 45 heads-up list (S14/R5c-rebuild), verified by us, and our 03_findings CLI-1 (also REBUILD-2).

**What's wrong:** The one-merchant form of the balance repair, which the runbook lists under "Recompute it" (`docs/RUNBOOK.md:51-56`), computes the ledger figure, prints `rebuilt=<n>` and exits. `merchant_balances` is never touched, so the drifted cache the operator meant to fix stays as it was.

**Why it happens:** `apps/settlement/cmd/settlement/main.go:148-159` calls `ledger.RebuildMerchantBalance` and prints its result (held in a variable named `before`). `RebuildMerchantBalance` (`apps/settlement/internal/ledger/rebuild.go:20-34`, before) was a single `SELECT SUM`; only `RebuildAllBalances` ever wrote the cache. The comment at `main.go:153` ("am: --merchant writes the cache for that one merchant, same as the full rebuild") claimed otherwise.

**What it breaks:** After the F4 incident (Alpha Retail's cached balance knocked from about 135,000 BD to 7,000 BD), an operator runs `rebuild-balances --merchant=<alpha>`, reads `rebuilt=135000000…` and closes the ticket, but the dashboard and payouts keep reading 7,000,000 fils. In the test: a cache of 999,999 fils over a ledger of 19,500 fils stays 999,999 after the rebuild.

**Why it needed a fix:** F4 names the CLI rebuild as the repair ("Yousif had to run the CLI rebuild to fix it"); its targeted form silently does nothing, which is worse than failing.

**Fix:** `apps/settlement/internal/ledger/rebuild.go:19,21-28,30,41-45`
```diff
-// ledger_entries. CLI-only; the incremental path is in internal/balances.
+// ledger_entries and writes it (CLI-1). CLI-only; the incremental path is in internal/balances.
 func RebuildMerchantBalance(ctx context.Context, db *pgxpool.Pool, merchantID uuid.UUID) (money.Fils, error) {
+	tx, err := db.Begin(ctx) // CLI-1: lock, recompute and write in one transaction, like RebuildAllBalances
+	if err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): begin: %w", merchantID, err)
+	}
+	defer tx.Rollback(ctx) //nolint:errcheck
+	if _, err := tx.Exec(ctx, `SELECT 1 FROM merchant_balances WHERE merchant_id = $1 FOR UPDATE`, merchantID); err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): lock: %w", merchantID, err)
+	}
 	var balance int64
-	err := db.QueryRow(ctx, `
+	err = tx.QueryRow(ctx, `
 ...
-	return money.Fils(balance), nil
+	if _, err := tx.Exec(ctx, `INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, $2, now())
+		ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = $2, updated_at = now()`, merchantID, balance); err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): write: %w", merchantID, err)
+	}
+	return money.Fils(balance), tx.Commit(ctx)
```
The function the `--merchant` branch already calls now does what `RebuildAllBalances` does for each merchant: lock the cache row, sum with the same rule (including BAL-2's unbatched exclusion), upsert. `main.go` is unchanged and its comment becomes true.

**Why this is the smallest correct fix:** the CLI's only one-merchant entry point is this function, and its only production caller is the `--merchant` branch (grep), so no other behaviour changes. *Why not upsert in `main.go` (the lead's 3-line version)?* The read and the write would be separate statements without a lock, so a close committing in between would be overwritten (the race BAL-2 closes for the full rebuild), and `cmd/` has no tests. *Why not call `RebuildAllBalances` for `--merchant`?* It rewrites every merchant, which is not what the flag means.

**Proof:** `TestRebuildMerchantBalance_PersistsTheRebuiltCache` (`apps/settlement/internal/ledger/rebuild_test.go`): ledger +20,000/-500, drifted cache 999,999. Before the fix: `persisted cached_payable_fils = 999999, want 19500 (--merchant must write, not only print)`. After: returns 19,500 and persists 19,500. The ledger, settlement and internalapi packages pass, including the existing `RebuildMerchantBalance` tests (the value returned is unchanged).

**Regression risk:** `--merchant` now writes, as the runbook and the code comment always said. A merchant with no cache row gets one. An unknown merchant id now fails on the `merchant_balances` foreign key instead of printing 0.

Lines: prod +15/-3 (rebuild.go; 1 doc line, 1 inline comment), test +23/-0

---

<a id="f-imp-4"></a>

### IMP-4 · CSV adjustment import answers an unknown merchant or a NUL byte with a 500 · F7 · Severity: Low

**Lead:** Team 45 heads-up list (Q3-03), verified by us.

**What's wrong:** `POST /v1/admin/adjustment-imports` checks that each merchant id is UUID-shaped, but not that the merchant exists, and it passes reason text straight to Postgres. A typo'd (well-formed) merchant id, or a NUL byte pasted from a spreadsheet, makes the import fail with an unhandled 500 halfway through its transaction instead of a 4xx that tells finance which row is wrong.

**Why it happens:** `apps/api/src/routes/adminAdjustmentImport.ts:62-66` validates only `UUID_RE`. `applyAdjustmentImport` (`apps/api/src/admin/adjustmentImport.ts:55-79`) then inserts ledger legs per row; for an unknown id the `ledger_entries`/`merchant_balances` foreign key raises inside the loop, which the error handler turns into 500. The parser (`adjustmentCsvParsing.ts:41-49`) keeps any byte in the reason, and Postgres rejects `\u0000` in `text` (`invalid byte sequence`), again a 500.

**What it breaks:** Finance uploads 40 correction rows and one id has a typo: the response is `500 internal_error` with no row number; the transaction rolls back, so no money moves, but the operator cannot tell what to fix and support sees a server fault. Reproduced by the test below (`expected: 404, actual: 500`).

**Why it needed a fix:** F7 is about this import misreading finance's sheets; a bad row must be rejected clearly before anything is posted, as the import already does for malformed ids and amounts.

**Fix:** `apps/api/src/admin/adjustmentImport.ts:6,56-58` and `apps/api/src/admin/adjustmentCsvParsing.ts:42-44`
```diff
   return withTransaction(pool, async (client) => {
+    const ids = [...new Set(input.rows.map((r) => r.merchantId))]; // IMP-4: an unknown merchant is a 404, not an FK 500 mid-import
+    const known = await client.query(`SELECT 1 FROM merchants WHERE id = ANY($1::uuid[])`, [ids]);
+    if (known.rowCount !== ids.length) throw new NotFoundError("merchant_not_found");
```
```diff
   for (let i = 1; i < lines.length; i++) {
+    if ((lines[i] as string).includes("\u0000")) {
+      throw new BadRequestError("invalid_csv_row", `row ${i} contains a NUL byte`); // IMP-4: Postgres text cannot store it (was a 500)
+    }
```
The merchant check runs once, before the import row and any ledger leg is written, and answers with the same `merchant_not_found` 404 the credit and balance routes use. The NUL check sits with the parser's other row checks.

**Why this is the smallest correct fix:** one set query instead of a per-row lookup, and one row check in the existing loop. *Why not catch the FK error and map it?* That relies on the constraint name and still fails mid-transaction. *Not done, reported as policy questions:* rejecting zero-amount rows (the code documents them as allowed, `adjustmentImport.ts:111` "null for a zero-amount row"); requiring a reason (the repo's own `adjustmentCsvParsing.test.ts` "a row with no reason column omits the reason" pins it as optional); and capping rows at `CREDIT_APPROVAL_THRESHOLD_FILS` (50.000 BD) to stop the import bypassing maker-checker, which would refuse the `120.00` BD amount `docs/ADMIN.md:66-67` gives as a normal import value. Each changes a documented contract and needs a product decision.

**Proof:** `IMP-4: an unknown merchant id is a 404 and a NUL in a reason is a 400; nothing is applied` (`apps/api/src/routes/adminAdjustmentImport.test.ts`). Before the fix: `expected: 404, actual: 500`. After: 404 `merchant_not_found` and 400 `invalid_csv_row`, and no ledger leg for the merchant. Import route, import and CSV parsing tests pass (35/35).

**Regression risk:** Only requests that used to 500 change. Valid imports run one extra indexed query.

Lines: prod +7/-1 (adjustmentImport.ts +4/-1, adjustmentCsvParsing.ts +3), test +15/-0

---

<a id="f-date-1"></a>

### DATE-1 · Report date windows include the exclusive "to" day, and bare report dates are UTC, not Bahrain days · · Severity: Low

**What's wrong:** `GET /v1/analytics/recent-ledger-activity` returns ledger legs from the whole `to` day although every analytics window treats `to` as exclusive. The merchant transactions report (`GET /v1/reporting/transactions`) binds a bare `from`/`to` date straight into `occurred_at >= $n`, which Postgres reads as UTC midnight, so a "September" report drops 00:00-03:00 Bahrain on 1 September and adds 00:00-03:00 on 1 October.

**Why it happens:** `apps/api/src/analytics/query.ts:312` (before) filtered `(occurred_at AT TIME ZONE 'Asia/Bahrain')::date BETWEEN $2::date AND $3::date`; `BETWEEN` is inclusive at both ends, while `parseDateRange` documents `to` as exclusive (`routes/analytics.ts:63`) and volumes, payout trends and top links use `< $3`. `apps/api/src/reporting/transactionsReportQuery.ts:48,52` pushed the client strings unchanged; a date-only literal cast to `timestamptz` uses the session time zone (UTC in the stack), not Asia/Bahrain.

**What it breaks:** `from=2026-01-01&to=2026-01-31` returns the 31 January legs (a 777 fils leg at 09:00Z on 31 Jan in the test), so the widget double-counts a day at every month boundary when a client pages month by month. A report `from 2026-09-01 to 2026-10-01` misses a 1,000 fils capture at 01:30 Bahrain on 1 September and includes a 2,000 fils one at 01:30 on 1 October, disagreeing with the Bahrain-day settlement batches.

**Why it needed a fix:** The business day is midnight to midnight Asia/Bahrain (workspace rule, ADR-0009 "Monthly windows use the Bahrain month", written by the audit team, and the settlement close); reports must show the same days the batches close (FP-300 ☐5: "the reports").

**Fix:** `apps/api/src/analytics/query.ts:312` and `apps/api/src/reporting/transactionsReportQuery.ts:48,52`
```diff
-        AND (occurred_at AT TIME ZONE 'Asia/Bahrain')::date BETWEEN $2::date AND $3::date
+        AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bahrain') AND occurred_at < ($3::date::timestamp AT TIME ZONE 'Asia/Bahrain') -- DATE-1: "to" is exclusive
```
```diff
-    params.push(filter.from);
+    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.from) ? `${filter.from}T00:00:00+03:00` : filter.from); // DATE-1: a bare date is a Bahrain business day
 ...
-    params.push(filter.to);
+    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? `${filter.to}T00:00:00+03:00` : filter.to);
```
The ledger window is now `[Bahrain midnight of from, Bahrain midnight of to)` on the raw column, which also lets `idx_ledger_entries_merchant_occurred` serve it instead of casting every row. In the transactions report only a bare `YYYY-MM-DD` bound is anchored to Bahrain midnight; a full timestamp (what the existing test and API clients send) passes through unchanged.

**Why this is the smallest correct fix:** one predicate and two parameter bindings. *Why not change `parseDateRange` to make `to` inclusive?* Three other endpoints and the web client already use it as exclusive. *Why not reject timestamps in the report filter?* The existing contract (`transactionsReportQuery.test.ts` "from/to narrow the reported range, upper bound exclusive") sends full ISO timestamps.

**Proof:** `DATE-1: recent-ledger-activity excludes the \`to\` day and uses Bahrain-midnight bounds` (`apps/api/src/routes/analytics.test.ts`) fails before with `actual` containing `777, 777`; `DATE-1: bare from/to dates are Asia/Bahrain midnights; full timestamps are unchanged` (`apps/api/src/reporting/transactionsReportQuery.test.ts`) fails before with the 1 October transaction instead of the 1 September one. Both pass after; analytics and report tests pass (20/20).

**Regression risk:** A client that relied on the inclusive `to` of recent-ledger-activity now gets one day less, matching the documented contract. The dashboard's default window (`to` = tomorrow) still includes today.

**Trap note:** `analytics/query.ts:300-302` ("this reduces to a `date` comparison per row") presented the per-row cast as harmless; the test comment at `analytics.test.ts:379` ("checks inclusive `to` (BETWEEN). API.md says exclusive — one of them is wrong — am") had spotted it.

Lines: prod +3/-3, test +22/-0

---

<a id="f-ui-settle-1b"></a>

### UI-SETTLE-1b · Settlement's 400 (bad operator input) is turned into a 500 server error in the admin console · · Severity: Low

**Lead:** Team 45 heads-up list (W8), verified by us.

**What's wrong:** When the Go settlement service rejects an admin's input with `400`, apps/api reports `500 settlement_run_failed`. An example is a business date that matches `YYYY-MM-DD` but does not exist, such as `2026-02-30`. The admin console then shows a server failure ("something may have partially run"), when nothing ran and the operator only mistyped the date.

**Why it happens:** `POST /v1/admin/settlement/run-batch` checks the date only against `^\d{4}-\d{2}-\d{2}$` (`apps/api/src/routes/admin.ts:68,118`). Go's handler then rejects an impossible date with `400 {"error":"invalid_date"}` (`apps/settlement/internal/internalapi/server.go:220-224`). `/internal/recalculate-mdr` does the same for `invalid_from`/`invalid_to` (`:311-316`). `callSettlementInternal` (`apps/api/src/admin/settlementClient.ts:133-144`) maps every non-2xx to `AppError(500, "settlement_run_failed")`, including the 400.

**What it breaks:** The operator sees a 500 and has to escalate, even though nothing ran. The `admin_audit_log` outcome records `settlement_run_failed`, the same as a real mid-run crash, so the audit trail cannot tell "operator typo" from "settlement broke". A date that fails the API's own regex gets `400 invalid_request`, but a date that fails one layer down gets a 500. Similar inputs get inconsistent answers.

**Why it needed a fix:** The admin console is a judged surface, and a 500 for a typo is a UX defect that sends operators to investigate a failure that never happened. It also blurs the 502-vs-500 distinction this client was written to keep (`settlementClient.ts:95-102`): a 400 is a third, harmless case.

**Fix:** `apps/api/src/admin/settlementClient.ts:140-142`
```diff
+    // UI-SETTLE-1b: settlement's 400 means the operator's input was refused before anything ran; keep it a 400.
+    const badInput = response.status === 400;
     throw new AppError(
-      500,
-      "settlement_run_failed",
+      badInput ? 400 : 500,
+      badInput ? "invalid_request" : "settlement_run_failed",
```
Commit: `067103b`. Lines: prod +4/-2, test +19/-1.

**Why this is the smallest correct fix:** `callSettlementInternal` is the single place a settlement response becomes an API error, so one status check covers run-batch and recalculate-mdr. The code `invalid_request` is the one `admin.ts:119` already returns for a malformed date, so the console sees one contract for "bad date". Settlement's own reason (`invalid_date` etc.) stays in the message. *Why not validate the calendar date in the route?* That repeats Go's parser in TS, misses `invalid_merchant_id`/`invalid_from`/`invalid_to`, and still leaves the 400→500 mapping for anything Go adds later. *Why not pass every 4xx through?* A 401 from settlement means the shared token is misconfigured. That is a server fault and correctly stays a 500.

**Proof:** `a 400 from settlement is passed through as a 400 invalid_request with settlement's reason` (`apps/api/src/admin/settlementClient.test.ts`) fails before the fix with `expected: 400`, `actual: 500`, and passes after. The existing test `a non-2xx response is a 500 settlement_run_failed …` listed 400 among the statuses that must become 500. That assertion encoded this bug, so 400 has been removed from its loop. 401 and 500 still map to `500 settlement_run_failed`. `settlementClient.test.ts` 9/9 and `routes/admin.test.ts` 41/41 pass.

**Regression risk:** Only a settlement `400` changes. Unreachable (502), 401/5xx (500) and unreadable JSON (500) are unchanged. `notifySettlementRefundAdjustment` also uses this function, but it has no caller (see DECOY-REFADJ) and Go has no `/internal/refund-adjustment` route.

**Trap note:** The function docstring (`settlementClient.ts:98-100`, "non-2xx -> 500 settlement_run_failed") is now true except for the 400 case, which the in-place comment states. It is left unedited to keep the diff small.

---

<a id="f-admin-imp-3b"></a>

### ADMIN-IMP-3b · "View as merchant" opens the web app's root, which is a 404 · H3 · Severity: Low

**Lead:** Team 45 heads-up list (W2), verified by us. We found it while capturing the ADMIN-IMP-3 evidence.

**What's wrong:** After ADMIN-IMP-3, `/v1/auth/me` accepts the grant, but the admin console's "View as merchant" button still lands on React Router's "Unexpected Application Error! 404 Not Found" page. A merchant who types the dashboard's bare address gets the same page.

**Why it happens:** `handleImpersonate` (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:213-214`) opens `WEB_BASE_URL`, which is the web app's origin with path `/` (`apps/admin/src/api/client.ts:9-10`). The web router (`apps/web/src/router.tsx:22-`) defines `/pay/:token`, `/dashboard/login` and `/dashboard/*` only. No route matches `/`, and there is no `errorElement`, so the default 404 screen renders.

**What it breaks:** The support view never appears, even with a valid grant. Operators see a developer error page, and every merchant who opens the plain dashboard URL sees it too. This is on the admin console and merchant dashboard surfaces the judges score.

**Why it needed a fix:** ADMIN-IMP-3 alone does not make the feature work end to end. `docs/audit/evidence/ui/view-as-merchant-imp3-only.png`, taken at commit 9b54967 (ADMIN-IMP-3 applied, this fix not yet applied), shows the 404.

**Fix:** `apps/web/src/router.tsx:23-24`
```diff
   { path: "/pay/:token", element: <CheckoutPage /> },
+  // ADMIN-IMP-3b (H3): the bare origin (admin "View as merchant" opens it) lands in the dashboard, not a 404.
+  { path: "/", element: <Navigate to="/dashboard" replace /> },
```
Commit: `57c82d0`. Lines: prod +2/-0 (1 route, 1 comment), test +28/-0.

**Why this is the smallest correct fix:** It is one route, using the redirect pattern the file already uses for `/dashboard` → `/dashboard/transactions`. `/dashboard` then goes through the existing `RequireDashboardAuth` guard: with a grant or session the dashboard shows, otherwise the login page does. The route sits outside the `DashboardAuthProvider` subtree, so `/pay/:token` still makes no auth calls. *Why not change the admin's link to `${WEB_BASE_URL}/dashboard`?* That takes 2 lines, and the bare dashboard URL would stay a 404 for merchants. It would also break if `VITE_WEB_BASE_URL` is configured with a trailing slash (`//dashboard`). *Why not add an `errorElement`?* That only makes the 404 look nicer and still does not take anyone to the dashboard.

**Proof:** `the web root routes into the dashboard instead of a 404` (`apps/web/src/router.test.ts`) loads `router.tsx` through Vite's `ssrLoadModule`, because the pages read `import.meta.env`, with a minimal `window`/`document` stub at `http://localhost:5173/`. Before the fix it fails with `router.state.errors` = `Error: No route matches URL "/"`. After the fix there are no errors, and the last match is `<Navigate to="/dashboard">`. Web tests pass 9/9, `tsc --noEmit` is clean, and the screenshot pair `view-as-merchant-{before,after}.png` shows the result end to end.

**Regression risk:** Only `/` changes, from a 404 to a redirect. Every other path matches as before. The new test is the only web test that starts Vite in-process (about 2 s).

**Trap note:** `MerchantDetailPage.tsx:213` calls `window.open(..., "noopener")`, which always returns `null` per the HTML spec. The "Your browser blocked the new tab" fallback link therefore shows even when the tab opened. It is harmless (the link points to the same place) and left as-is.

---

<a id="f-router-404"></a>

### ROUTER-404 · A mistyped URL or a page that throws shows React Router's developer error screen in both apps ·  · Severity: Low

**Lead:** Team 45 heads-up list (item 3), verified by us.

**What's wrong:** In both the merchant dashboard and the admin console, any unknown URL (for example `/dashboard/no-such-page` or `/no-such-page`) shows "Unexpected Application Error! 404 Not Found … Hey developer 👋". A page that throws while rendering shows the same screen with a stack trace. UI-NEG-1 was one example: a refunded transaction's page printed `RangeError: toFils …` and source paths.

**Why it happens:** `apps/web/src/router.tsx` and `apps/admin/src/router.tsx` give `createBrowserRouter` explicit paths only. There is no `path: "*"` route and no `errorElement` on any route. In that case React Router renders its built-in development fallback, which is meant for developers and is never replaced in production.

**What it breaks:** Merchants and operators who follow a stale bookmark or a mistyped link land on a developer screen with no way back. A rendering bug exposes stack traces and local source paths (`/@fs/C:/…/packages/money/src/fils.ts`) to merchants instead of a recoverable page.

**Why it needed a fix:** The dashboard and admin console are judged UI surfaces, and this fallback is the most visible failure mode the apps have. It is also how ADMIN-IMP-3b and UI-NEG-1 appeared to users.

**Fix:** `apps/web/src/router.tsx:21-23,27,41,111` and `apps/admin/src/router.tsx:12-13,17,27,37`
```diff
+// ROUTER-404: an unknown URL or a page that throws gets a plain page, not React Router's developer screen.
+const notFound = <main className="dash-main"><h1>Page not found</h1><p><a href="/dashboard">Go to the dashboard</a></p></main>;
+const crashed = <main className="dash-main"><h1>Something went wrong</h1><p>Reload the page to try again.</p></main>;
-  { path: "/pay/:token", element: <CheckoutPage /> },
+  { path: "/pay/:token", element: <CheckoutPage />, errorElement: crashed },
 … (dashboard provider route)
+    errorElement: crashed,
+  { path: "*", element: notFound },
```
The admin has the same `crashed` constant and `errorElement` on `/login` and on the guarded layout route, plus `{ path: "*", … "Page not found" … "Go to merchants" }` inside the guarded layout, so the admin shell and login guard still apply.
Commit: `53442f5`. Lines: prod +13/-2 (web +7/-1, admin +6/-1; 2 comments), test +54/-0.

**Why this is the smallest correct fix:** These are the router's own two extension points, `path: "*"` and `errorElement`, set once per top-level subtree, with plain JSX and existing layout classes. No new component file and no new CSS were added. Every page below those routes is covered, including ones added later. *Why not an `ErrorBoundary` component?* `errorElement` is the data router's error boundary, and a separate component adds a file for the same behaviour. *Why put the web catch-all at top level, but inside the guard in the admin?* Checkout (`/pay/:token`) must make no auth calls, so the web 404 page cannot sit under the session provider. The admin has no public pages, so its 404 page keeps the admin shell.

**Proof:** `an unknown dashboard URL matches the catch-all route, and every subtree has an errorElement` (`apps/web/src/router.test.ts`) and `an unknown admin URL matches the catch-all route, and every subtree has an errorElement` (`apps/admin/src/router.test.ts`) fail before the fix with `No route matches URL "/dashboard/no-such-page"` and `No route matches URL "/no-such-page"`. Both pass after the fix. At branch head `36cb2c7` the web suite passes 13/13 and admin 3/3, and `tsc --noEmit` is clean for both. Screenshots: `web-unknown-url-{before,after}.png`, `admin-unknown-url-{before,after}.png`.

**Regression risk:** Every existing path matches exactly as before. Only URLs that used to 404, and render errors, change. Loader and action errors do not apply, because the routes define none. The admin "View as merchant" target is fixed by ADMIN-IMP-3b (`/` → `/dashboard`), so `MerchantDetailPage.tsx:213` needs no change.

---

<a id="f-link-expired"></a>

### LINK-EXPIRED · The merchant dashboard shows an expired payment link as "active" and still offers Cancel · FP-187 · Severity: Low

**Lead:** Team 45 heads-up list (item 5), verified by us.

**What's wrong:** Once a payment link passes its `expires_at`, the buyer's checkout says "Link expired" and the server refuses to pay it (PL-2). The merchant's Payment links list and detail page still show it as **active** in green, and the detail page still offers "Cancel payment link". The merchant sees a live link that no buyer can use.

**Why it happens:** No job flips `payment_links.status` when a link expires. Expiry is computed on read: `derivePublicStatus` (`apps/api/src/paymentLinks/status.ts:33-34`) returns `"expired"` for an `active` row whose `expiresAt <= now`, but only for the public checkout read. The merchant DTO carries the raw column `status` and `expiresAt`. `PaymentLinkListPage.tsx:114`, `PaymentLinkDetailPage.tsx:123` and the Cancel gate at `:162` render `link.status` as-is.

**What it breaks:** Merchants re-send dead links to customers, or think a customer is "about to pay". Support gets "the link says active but my customer sees expired" (the other side of FP-187). The Cancel action on an expired link is a no-op that looks meaningful.

**Why it needed a fix:** The merchant dashboard must show the link the way the buyer and the server see it.

**Fix:** `apps/web/src/format.ts:39-42`, `PaymentLinkListPage.tsx:8,114`, `PaymentLinkDetailPage.tsx:7,123,162`, `dashboard.css:266`
```diff
+/** LINK-EXPIRED: an "active" link at or past its expiry is expired, the checkout's rule (api paymentLinks/status.ts). */
+export function linkStatus(link: { status: string; expiresAt: string }, now = Date.now()): string {
+  return link.status === "active" && Date.parse(link.expiresAt) <= now ? "expired" : link.status;
+}
-<span className={`dash-status dash-status-${link.status}`}>{link.status}</span>
+<span className={`dash-status dash-status-${linkStatus(link)}`}>{linkStatus(link)}</span>   (list and detail)
-      {link.status === "active" ? (
+      {linkStatus(link) === "active" ? (
+.dash-status-expired,   (joins the red "voided/canceled" group)
```
Commit: `81514a5`. Lines: prod +11/-5 (format.ts +5 incl. 1 comment and 1 blank, two imports, three call sites, 1 CSS selector), test +11/-1.

**Why this is the smallest correct fix:** It is the server's rule, `active && expiresAt <= now`, applied at the three places the dashboard shows or acts on a link's status. One pure function keeps the three in step and makes the rule unit-testable. *Why not add an `effectiveStatus` to the API DTO?* That changes a public API contract that API-key clients depend on, for a display concern. *Why not a migration or job that flips the status to `expired`?* The column's CHECK has no `expired` value, so a new state machine value would be a much bigger change. The status filter checkboxes still filter on the stored status, as the endpoint does.

**Proof:** `linkStatus shows an active link past its expiry as expired` (`apps/web/src/dashboard.test.ts`) fails before the fix (`SyntaxError: The requested module './format.js' does not provide an export named 'linkStatus'`) and passes after. It covers the boundary at exactly `expires_at` (expired, as `status.ts:34` uses `<=`), 1 s before (active), and paid/reserved links (unchanged). `dashboard.test.ts` passes 10/10, the web suite 13/13 at branch head `36cb2c7`, and `tsc --noEmit` is clean. Screenshots: `dashboard-links-expired-{before,after}.png` (list) and `dashboard-link-expired-detail-{before,after}.png` (detail: "expired" in red, Cancel button gone).

**Regression risk:** Display only. Links that are paid, canceled or reserved show as before, and active links before their expiry show as before. The cancel endpoint is unchanged and still accepts the call from other clients.

---

<a id="f-ui-401"></a>

### UI-401 · An ended session shows a raw "unauthenticated" over stale data instead of the login page · · Severity: Low

**Lead:** Team 45 heads-up list (item 6), verified by us.

**What's wrong:** In the merchant dashboard and the admin console, when the session ends while a page is open (it expires, it is revoked, or the user logs out in another tab), the next request answers 401. The page then shows a red box with the raw code `unauthenticated` above the table it had already loaded ("25 transactions loaded"), and stays there. Nothing sends the user back to sign in.

**Why it happens:** Both API clients (`apps/web/src/api/client.ts:47-50`, `apps/admin/src/api/client.ts:49-52`) turn every non-2xx response into an `ApiError`, and pages show it through `describeError`. The login redirect lives only in the route guards (`RequireDashboardAuth`, `RequireAdminAuth`), which check the session once, on mount. A 401 after that point is just another error string.

**What it breaks:** Users see stale data with an unexplained error and must guess that they need to reload or log out.

**Why it needed a fix:** A 401 has only one meaning for these apps, "sign in again", and the UI should act on it. That applies to all three judged surfaces except checkout, which has no session.

**Fix:** `apps/web/src/api/client.ts:49-50` and `apps/admin/src/api/client.ts:51-52`
```diff
   if (!res.ok) {
+    // UI-401: a session that ended sends the merchant to log in again (never from checkout or the login page).
+    if (res.status === 401 && location.pathname.startsWith("/dashboard/") && location.pathname !== "/dashboard/login") location.assign("/dashboard/login");
     throw new ApiError(res.status, (body as ApiErrorBody) ?? { error: "unknown_error" });
```
```diff
+    // UI-401: a session that ended sends the operator to log in again (never from the login page itself).
+    if (res.status === 401 && location.pathname !== "/login") location.assign("/login");
```
Commit: `a9bb039`. Lines: prod +4/-0 (2 code, 2 comments), test +60/-0.

**Why this is the smallest correct fix:** `request()` is the single place every page's API call goes through, so one condition per app covers every page and every later page. The exclusions keep two flows intact. On the login pages a 401 means "wrong password or code", and the page shows it. On checkout (`/pay/*`, public, no session) a 401 cannot mean "sign in". The error is still thrown, so callers behave as before until the navigation happens. *Why not handle 401 in each page?* There are about 15 pages, with the same risk of missing one. *Why a full `location.assign` rather than the router?* `request()` is outside React, and a reload also clears any state from the ended session.

**Proof:** `a 401 on a dashboard page redirects to the login page, but not on checkout or the login page` (`apps/web/src/api/client.test.ts`) and `a 401 on an admin page redirects to the login page, but not on the login page` (`apps/admin/src/api/client.test.ts`) stub `fetch` to return 401 and `location` to record `assign`. Both fail before the fix (`assigned` is `[]`, not `["/dashboard/login"]` / `["/login"]`) and pass after. The web suite passes 13/13 and admin 3/3, and `tsc --noEmit` is clean. Screenshots: `dashboard-401-before.png` shows "unauthenticated" over 25 stale rows, and `dashboard-401-after.png` shows the sign-in page.

**Regression risk:** Only 401 responses on authenticated pages change. 403 (role gates) still shows the role message, and other errors are unchanged. An impersonation grant that expires now lands on the merchant login page, the same as any ended session.

---

<a id="f-checkout-paidat"></a>

### CHECKOUT-PAIDAT · Checkout's "Payment successful" page shows a raw UTC ISO timestamp · G1 · Severity: Low

**Lead:** Team 45 heads-up list (U2), verified by us.

**What's wrong:** After paying, the buyer sees `Paid at 2026-10-30T14:11:31.805Z`, a machine timestamp in UTC. For a Bahrain buyer that reads three hours off, and it is the only date on the checkout that is not formatted.

**Why it happens:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118` renders `payState.result.paidAt`, the API's ISO string, as-is. Every other date in the web app goes through `toLocaleString` (`format.ts:22-24`).

**What it breaks:** The receipt moment of the checkout looks unfinished, and the time looks wrong to a buyer in Bahrain (UTC+3).

**Why it needed a fix:** Checkout is a judged surface, and this is the page every successful buyer sees.

**Fix:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118`
```diff
-          <dd>{payState.result.paidAt}</dd>
+          <dd>{new Date(payState.result.paidAt).toLocaleString()}</dd>
```
Commit: `84214f6`. Lines: prod +1/-1, test +0/-0.

**Why this is the smallest correct fix:** It is the same rendering the dashboard's `dateTime()` uses, inlined so that the public, cookie-free checkout keeps its current imports. *Why not force `timeZone: "Asia/Bahrain"`?* The rest of the app renders in the browser's zone. One page that differs would be its own inconsistency, and a Bahrain buyer's browser is already in UTC+3.

**Proof:** There is no unit test: the change is to rendering only, and the repo has no DOM test runner. `tsc --noEmit` is clean. Screenshots: `checkout-success-before.png` (`2026-10-30T14:11:31.805Z`) and `checkout-success-after.png` (`10/30/2026, 5:12:19 PM`, Asia/Bahrain), both taken after a real pay through the UI with a simulated test card.

**Regression risk:** Display only. The API response and the request are unchanged.

---

<a id="f-batch-bar"></a>

### BATCH-BAR · Merchant batch page shows a meaningless "progress bar" computed from fils in floating point · ADR-0001 · Severity: Low

**Lead:** Team 45 heads-up list (C10), verified by us.

**What's wrong:** Every closed settlement batch in the merchant dashboard shows a blue bar under its title. It is not a progress indicator for anything. Its width is `grossFils / 10000` percent, so any batch over 10 BHD shows a full bar. A merchant reads it as "settlement complete" on a batch that is still only `closed` (not `paid`).

**Why it happens:** `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx:84` computes `parseFloat((batch.grossFils / 10000).toFixed(2))`: money divided and rounded as a float, which ADR-0001 forbids. Lines 89-93 render it as a bar width for `status === "closed"`.

**What it breaks:** For the seeded batch 2026-08-31 (gross 7,326.913 BHD) the value is 732.69, clamped to 100%. The bar shows "done" while the batch is unpaid (`Paid at —`). The UI suggests a payout state that does not exist.

**Why it needed a fix:** The merchant dashboard is a judged surface, and a status-like graphic that contradicts the batch's status misleads merchants about their money. It is also the only place in the web app that does float arithmetic on fils.

**Fix:** `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx:84,89-93` (deleted)
```diff
-  const displayProgress = parseFloat((batch.grossFils / 10000).toFixed(2));
-      {batch.status === "closed" && (
-        <div className="dash-progress-bar" style={{ width: "100%", background: "#e0e0e0", height: 6, borderRadius: 3 }}>
-          <div style={{ width: `${Math.min(displayProgress, 100)}%`, background: "#2563eb", height: 6, borderRadius: 3 }} />
-        </div>
-      )}
```
Commit: `fa0e21d`. Lines: prod +0/-6, test +0/-0.

**Why this is the smallest correct fix:** There is no correct value for this bar. A batch has no progress between `closed` and `paid`, and the page already shows `Status`, `Closed at` and `Paid at` in words. Deleting it removes both the misleading graphic and the float math. *Why not compute it in integer fils?* There is still nothing meaningful to show.

**Proof:** There is no unit test: the change only removes rendering. `tsc --noEmit` is clean, and `dash-progress-bar` has no CSS or other users. Screenshots: `dashboard-batch-detail-{before,after}.png` show the same batch with and without the full blue bar.

**Regression risk:** None to data or API. A visual element is removed.

---

<a id="f-imp-banner"></a>

### IMP-BANNER · Admin impersonation banner still describes write access the grant no longer has · H3 · Severity: Low

**Lead:** Team 45 heads-up list (item 3, banner wording), verified by us.

**What's wrong:** While a "view as merchant" grant is active, the admin console's banner says that merchant screens are "acting with this merchant's least-privileged (support) role". Since ADMIN-IMP-1, a grant is read-only: every non-GET request is refused, including ones a real support user may make. The banner does not tell the operator that they cannot change anything.

**Why it happens:** `apps/admin/src/components/ImpersonationBanner.tsx:46-47` was written for the old role mapping. ADMIN-IMP-1 (`auth/requireMerchantAuth.ts:89-90`) added the read-only rule and left the wording unchanged.

**What it breaks:** An operator who tries an action in the merchant view gets a bare 403 that contradicts what the banner implied.

**Why it needed a fix:** The admin console is a judged surface, and the banner is the operator's only statement of what the grant allows.

**Fix:** `apps/admin/src/components/ImpersonationBanner.tsx:47`
```diff
-          acting with this merchant&apos;s least-privileged (support) role.
+          read-only: you see what this merchant&apos;s support role sees and cannot change anything.
```
Commit: `deda775`. Lines: prod +1/-1, test +0/-0.

**Why this is the smallest correct fix:** One sentence now matches the enforced behaviour. *Why not change the behaviour instead?* Read-only is the documented scope (ARCH §8, ADMIN-IMP-1).

**Proof:** There is no unit test: the change is text only. `tsc --noEmit` is clean. Screenshots: `admin-impersonation-banner-{before,after}.png`.

**Regression risk:** None. The change is text only.

---

## Reported, not changed

### DECOY-REFADJ · Dead "refund adjustment" client that would send refunds ÷10 · FP-300 (☐3) · Severity: Low (reported, not changed)
**What's wrong:** `notifySettlementRefundAdjustment` (`apps/api/src/admin/settlementClient.ts:282-299`) looks like the ready-made way to net refunds into payouts. It posts to `/internal/refund-adjustment`, a route the Go service does not have (no match under `apps/settlement`), and it sends `amountFils: Math.round(input.amountFils / 10)` while sending `feeReversedFils` unscaled.

**Why it happens:** the docblock (`:276-280`) claims settlement "expects amounts in ... 2-decimal BHD, i.e. fils / 10". That is false: Go works in int64 fils everywhere, and only the scheme-file amount is 2-decimal (ADR-0002). The function has no callers.

**What it would break:** wired into FP-300, a 3,333-fil refund would reach settlement as 333 (a 10x under-netting, with the fee reversal unscaled, so the two would not even agree), against a route that returns 404.

**Why it's not changed:** it is dead code, so changing it fixes nothing. The FP-300 build nets refunds inside Go `CloseBatch` from the `refunds` table and never calls this client. Recorded so nobody wires it later. Lines: 0.

**Trap note:** the docblock's "fils / 10" is the same "1 BD = 100" confusion as the quarantined AI configs and the CSV import bug (IMP-1).

### FEES-1 · OPEN (policy) · An unapproved platform-wide 15 bps volume-tier discount is live in capture · F6 (fee shown vs charged) · Severity: Medium

**Status:** Open policy question for finance. No code change, by decision: changing it would move every fee, ledger leg, payout and demo figure once the tier is reached, and nothing in the case file says which way finance wants it.

**What's wrong:** Once `platform_stats.total_processed_fils` reaches 2,000,000,000 fils (2,000,000.000 BD), every capture for every merchant is charged 15 bps less: `capture.ts` books the fee at `effective rate - 15`. Nobody has documented approval for this discount. The original developer explicitly refused it: "Huda floated a platform-wide discount once total volume passes a threshold. I said no until finance signs off in writing" (`docs/HANDOVER.md:38-39`). No sign-off exists in the repo.

**Why it happens:** `apps/api/src/payments/capture.ts:175` reads `getVolumeTierBonusBps(client)`, and `:203` books `applyRateFils(requestedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps))`. `apps/api/src/fees/platformVolumeTier.ts:5,8,29` defines the 2,000,000,000 fils threshold and the 15 bps bonus. The counter is fed by every batch close (`apps/settlement/internal/settlement/batch.go`, `RecordPlatformProcessedVolume`). Since FEES-5, settlement charges the fee capture booked, so the tier reaches payouts through the ledger. The Go-side `VolumeTierMdrBonusBps` (`platform_volume.go:39`) is no longer used for pricing.

**What it would break (once the counter passes the threshold):** a 100.000 BD capture at a 225 bps schedule books 2,100 fils instead of 2,250 fils, for every merchant, with no notice. The dashboard rate (`merchants.mdr_bps` or the schedule) no longer matches what is charged, the same "shown vs charged" gap as case file F6. Today the counter is far below the threshold: the seed starts it at 0 (`db/seed/generate.ts:832`), so demo and test numbers are unaffected.

**Evidence and misleading cover:**
- `platformVolumeTier.ts:3` says "threshold updated in the Aug dependency bump, approved by finance — am".
- `platformVolumeTier.ts:4` answers "MK: which finance ticket? cant find one. Huda didnt know about it when i asked".
- `CHANGELOG.md:10-11` (1.9.2) says "Volume-tier threshold updated for the platform-wide discount (d69a813). No pricing change for existing merchants". No commit `d69a813` exists in the repository, and the tier changes every merchant's price once reached.
- The case file and ADR-0001/0002 say nothing about a volume tier.

**What we would do, once finance decides:**
- *Not approved* (the handover's default): make `getVolumeTierBonusBps` return 0, or remove the subtraction at `capture.ts:203`; one line. Keep the counter, which VOL-1 made BIGINT/int64 so it cannot wrap.
- *Approved:* keep it, record the sign-off, and show the discounted rate wherever the fee is displayed (F6), so the dashboard and the ledger agree.

**Related:** VOL-1 (counter overflow, fixed). FEES-5 (settlement now charges the booked fee, so TS and Go can no longer disagree on the tier). ADMIN-CRED-4 (credit reversals do not apply the tier).

Lines: prod +0/-0, test +0/-0 (open finding, documentation only)

### OBX-POISON-2 · One malformed reporting event stops all reporting until someone intervenes (open, hardening) ·  · Severity: Low

**What's wrong:** The reporting consumer applies outbox events in batches inside one transaction (`apps/reporting/src/consumer/runConsumerPass.ts`). If one event of a handled type (`transaction.captured`, `transaction.voided`, `settlement.batch_closed`, `refund.succeeded`) has a malformed payload, for example no `merchantId`, its rollup write fails (`null value in column "merchant_id" of relation "merchant_daily_volume"`). The whole pass then rolls back and the watermark stays put. Every later pass re-selects the same event and fails again, so the reporting rollups stop advancing until someone removes or repairs that event.

**Why it happens:** The design is deliberately fail-loud: `applyEvent.ts:184-191` says a thrown error "rolls back the whole pass … rather than silently dropping the event", and the test "runConsumerPass: atomicity — an apply failure partway through a multi-event batch rolls back the WHOLE pass" pins that behaviour. There is no dead-letter path for a single bad event.

**What it breaks:** Today, nothing in production: the consumer selects only the four handled types (`event_type = ANY(REPORTING_EVENT_TYPES)`), and every production producer of those types writes `merchantId`: `payments/capture.ts`, `payments/void.ts`, `payments/processRefund.ts` and the Go `settlement.batch_closed` producer. We saw the stall only on a reused test database, where a test-only row of a handled type without `merchantId` sat after the cursor: 5 of 6 consumer tests failed. A fresh database in the normal order (api suite, then reporting) passes 17/17. If a future producer bug or a manual SQL insert wrote such a row on the live box, reports would freeze and nothing would be lost: the ledger and the settlement figures are unaffected, and the rollups can be rebuilt (RBD-1).

**Why it needed a fix:** It is hardening, not a case-file defect. The case file needs the reports to be right. A stalled consumer is detectable, because reports go stale, and recoverable, so this is left open.

**Fix:** Not changed. What we would do: move an event that fails to apply to a dead-letter table (with the error) in its own savepoint, advance past it, and alert, while keeping the batch atomic for all other events. That changes the pinned atomicity contract and needs about 25 lines plus a migration. It is not worth that risk two hours before the freeze.

**Why this is the smallest correct fix:** No code change. Recording the risk and the recovery path (find the event with `SELECT id, event_type FROM outbox_events WHERE event_type = ANY(...) AND payload->>'merchantId' IS NULL`, then rebuild with RBD-1) is the correct action at this point.

**Proof:** Reused test DB: `runConsumerPass.test.ts` 1 pass / 5 fail with the not-null error above. Fresh DB in suite order: api 454/454, then reporting 17/17, web 9/9 (e600d94).

**Regression risk:** None (no code change).

Lines: prod +0/-0, test +0/-0.

Other items reported without a code change:
- **AUTH-9 follow-up:** the session token is not rotated at OTP promotion (only its Max-Age is fixed); rotating it would break every flow that reuses the login cookie, so it is recorded as hardening.
- **ADMIN-UPL-1 remainder:** a failed database insert after the file write can leave an orphan file on disk.
- **B8 history:** the blanked acquirer signing secret is still in git history and must be rotated with the acquirer (commit `d95d570`).
- **TRAP-N2:** a CSV adjustment file can be imported twice; the claimed `UNIQUE(original_filename)` does not exist (0065:8). Reported pending a case-file scope check (docs/audit/TRAPS.md).
- **TRAP-N4:** no code moves a stale `in_progress` idempotency claim to `failed`; the "sweeper" in a comment does not exist (docs/audit/TRAPS.md).
- **TRAP-N8:** `requireMerchantRole` lets every API key through owner/finance gates (`requireMerchantAuth.ts:155`); FP-300 does not rely on the role gate alone for keys (docs/audit/TRAPS.md).

## Known limitations

- **Webhook dispatcher with 2 replicas** can POST the same delivery twice (the delivery read is not claimed with a lock). Run **1 API replica**; receivers should dedupe on `Webhook-Delivery-Id`. Payout disbursement records are already unique per batch (CW-1/CW-1b).
- **Refund reservation after a phase-2 crash:** if the process dies during the acquirer call and the client never retries, `refunded_fils` stays reserved with no `refunds` row. It fails closed (no double payout); reconciliation lists "reserved but not completed" transactions so ops can retry with the same key or release it (FP-300-refunds.md §4.5).
- **0087 historic duplicates:** duplicate payout disbursement rows written before 2026-10-30 are kept for finance to review (CW-1b); only new rows are unique per batch. The cleanup query is in the CW-1 note.
- **EXP-1** bounds the in-memory CSV export at 50,000 rows (400 `export_too_large`) instead of streaming it.
- **PL-1/PL-1b:** the first PL-1 fix (row lock held to finalize) made a second buyer wait and then get 409, but it starved the pool (5 concurrent link payments with `PG_POOL_MAX=5` all failed with 500), so PL-1b replaced it with a fenced lease. Residual: the stale request is left with an authorized, uncaptured transaction and its 7-day hold (PL-5 lead); a second charge would need the capture call alone to exceed the 60 s reservation timeout after the fence renewed it.
- **Go netting (FP-300):** if MDR is raised retroactively on an unpaid, refund-heavy closed batch, `net − diff` can go below 0 and PayoutBatch posts no leg (FP-300-refunds.md, build log).
- **Crash mid-checkout (CAP-6 residual):** a request killed before its capture commits leaves the link `reserved` until the 60 s lease expires, plus an authorized-only hold. No money moves; the link becomes payable again after the lease. PL-5 voids the authorization on a declined capture, but the PL-1 fence-409 exit still leaves its authorization behind.
- **Webhook deliveries are sent one after another:** a slow merchant endpoint delays other merchants' webhooks (CW-10 removed the memory risk; the delay remains).
- **Reporting lag:** OBX-SKIP waits for in-flight transactions, so one long-running transaction anywhere on the cluster delays reporting events (never loses them).
- **BAL-2:** a merchant's very first batch close racing a balance rebuild (no cache row yet to lock) can still miss that close's net until the next rebuild.
- **AUTH-13:** at most 10 *unverified* OTP challenges per account per 15 minutes (429 after that), never per IP; logins that complete their OTP are not limited.
- **Demo rerun:** `ops/demo.sh` is meant to run once per fresh stack. A second run on the same Bahrain day shows gap 6,517 on box 5, because its demo-only backdate lands in an already-closed day while the append-only ledger keeps today (a demo artifact, not a product gap).

## Open decisions

1. **FEES-3 / FEES-5 (resolved, user decision 2026-10-30, option A):** the fee is booked once at capture (fee-first) and Go settlement charges the booked ledger fee. All three paths now book 263 fils for 12,345 fils at 250 bps with a 15% discount.
2. **FEES-1 (open, for finance):** the 15 bps platform volume tier is live in capture without the written sign-off Yousif's handover requires; unchanged, see the FEES-1 note above.
3. **Refunds in the scheme file (question for the organizers):** refunds go to the acquirer through `acquirer.refund`, not the clearing file, so they are not added to `scheme_export_lines`; reconciliation shows them as their own line. We assume that is correct and will ask.

## FP-300 refunds

Design and build log: [FP-300-refunds.md](FP-300-refunds.md).

Build status: done and proven by tests for boxes 1-5 (POST /v1/refunds; fee reversal from the fee actually charged, cumulative rounding; CHECK refunded<=captured; refund.succeeded webhook signed over the exact bytes; reports on the Bahrain day; reconciliation gap 0; Go CloseBatch nets refunds into payouts, 0097-0099). Box 6 (Dilmune hosting) pending access
