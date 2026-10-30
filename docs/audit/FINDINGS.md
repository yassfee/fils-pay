# FilsPay audit: findings

We audited the FilsPay monorepo (TypeScript API, Go settlement daemon, reporting consumer, Postgres schema) against the organizers' case file.
Ground truth was the case file, then the wired code path, then the migrations; comments, docs, AI configs and test assertions were treated as claims to verify.
Every bug was handled the same way: a failing test first, then the smallest fix at the single narrowest point, then the same test passing.
Each bug is one commit `fix(<ID>/<case refs>): …` on branch `audit/handover`; line counts below are computed from `git log --numstat 89daa69..audit/handover` (net per bug when a fix took more than one commit, see below).
Production lines = code, SQL migrations and ops files; test files (`*.test.ts`, `*_test.go`) and docs are counted separately.

**67 bugs fixed (+ 2 broken tests repaired) · 679 production lines changed · every fix proven by a failing-then-passing test**

- 70 `fix(...)` commits for those 67 bugs (follow-up commits CW-1b and PL-1b are counted under CW-1 and PL-1). Median production lines per bug: **7**. Bugs fixed in ≤ 6 production lines: **31 of 67**.
- A bug fixed in more than one commit is counted by its **net** production change: `git diff <first>^ <last>` over that bug's production files, used only when no other commit touched those files in between. PL-1 +10/−5 net (per-commit sum +43/−38: `104c871` + `f487401`); CW-1 +9/−1 net (per-commit sum +17/−9: `14db87c` + `ec100ed`). TEAM_REPORT's change log keeps the per-commit history.
- By severity: Critical 9, High 42, Medium 14, Low 2.
- Proof exceptions: MIG-1 (migrations) and B8 (a committed secret) have no unit test; they are proven by a reproducible runtime check in their notes (fresh `migrate` applies every file; `git ls-files ops` / `git grep` finds no secret value).
- REC-1's commit `b4e6b95` also carries the FP-300 reconciliation lines (refunds on their own lines), so its +29/−28 is included in the per-bug total.
- Test suites on a fresh database (77 migrations): **TS 502/502** (api 427, reporting 15, money 40, events 4, web 8, scripts 8) and **Go 7/7 packages**. Baseline before the audit: TS 414/430.

- **Net production footprint vs. the handed-over main (`8b58b0f`):** 89 files, **+767/−396 = 1163 lines** (superseded attempts such as PL-1's first version drop out). This includes the FP-300 feature code and the ops/compose infrastructure; the per-bug total above counts bug fixes only.

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
| 52 | CW-8 | The API cannot boot in development: the built-in webhook key is 34 bytes | FP-300 (☐6), G4 | Medium | +1/−1 | +10/−0 | `bf810ef` |
| 53 | CW-9 | refund.succeeded is enqueued but never delivered as a webhook | FP-300 ☐4 | Medium | +19/−2 | +27/−0 | `152e27e` |
| 54 | CW-7 | Inbound acquirer HMAC is computed over re-serialized JSON, with no freshness check | FP-240, FP-201 | Medium | +14/−11 | +46/−11 | `1cca258` |
| 55 | SCHED-1 | Daemon takes "today" from the UTC date, so the Bahrain close runs at 03:00 + delay | G1, H5 | Medium | +6/−4 | +22/−0 | `649e4dd` |
| 56 | EST-1 | Lifetime payout total is a REAL accumulated through float32 | G2 | Medium | +6/−1 | +35/−1 | `d88497a` |
| 57 | SUM-2 | No index serves batched capture events by time, so the settlement summary scans transaction_events | H6 | Medium | +7/−0 | +24/−0 | `c55c71e` |
| 58 | FEES-4 | Dashboard fee shows the most recently entered schedule, not the one in force | F6 | Medium | +5/−13 | +6/−5 | `5a329f6` |
| 59 | REF-8 | Partial refunds round the fee reversal per partial, so they can reverse more fee than was charged | H1 | Medium | +5/−4 | +25/−0 | `01e6cd7` |
| 60 | REF-6b | Acquirer simulator caches transport errors, so a same-key refund retry can never succeed | FP-209, FP-300 (☐1) | Medium | +1/−1 | +22/−0 | `de6d70a` |
| 61 | AUTH-7 | OTP resend resets the guess budget | H8 | Medium | +3/−2 | +25/−0 | `730526d` |
| 62 | CW-6 | Webhook replays mint a new Webhook-Delivery-Id, so receivers cannot dedupe them | INC-2026-08-21 | Medium | +12/−20 | +12/−7 | `cffcb17` (CW-6), `cbbeb38` (CW-6b) |
| 63 | ADMIN-IMP-2 | Impersonation grants survive admin disable and logout | H3 | Medium | +9/−3 | +31/−0 | `88a5616` |
| 64 | LED-1 | The ledger can be edited and deleted as long as each group still balances | F2 | Medium | +13/−0 | +43/−0 | `3c35a5e` |
| 65 | FEES-5 | Settlement re-prices each capture with its own formula, so the batch fee drifts from the ledger and strands fils in merchant_payable | FP-300 ☐3 | Medium | +11/−22 | +248/−16 | `5542c53` |
| 66 | TEST-BACKOFF | Dispatcher backoff test asserts an exact value from a jittered function | baseline test failure | Low | +0/−0 | +2/−2 | `3cb19b7` |
| 67 | TEST-OUTBOX-FIXTURE | Webhook archive test seeds malformed rollup events that break the reporting consumer tests | baseline test failure (FP-300 ☐5) | Low | +0/−0 | +4/−2 | `139f5aa` |
| 68 | F2-WINDOW | The March residue sweep reads a UTC month, not the Bahrain month | F2, G1/H5 (timezone) | Low | +1/−1 | +3/−2 | `13831ee` |
| 69 | AUTH-1·rpt | Reporting export-summary has no authentication gate | H3 | Low | +1/−1 | +28/−0 | `622a94f` |

## Case-file coverage

| item | case-file wording (short) | fixed by |
|---|---|---|
| F1 | Scheme statement always a few fils over | SCHEME-1, SCHEME-2 |
| F2 | March sweep doubled when re-run | SCHEME-2, F2-SWEEP, LED-1, F2-WINDOW |
| F3 | Split payouts don't add up | SPLIT-1 |
| F4 | Admin balance button vs CLI | MIG-1, BAL-1, ADJ-1 |
| F5 | MDR recalculation changed paid batches | MDR-1 |
| F6 | Dashboard fee ≠ charged fee | FEES-4 |
| F7 | CSV import 10x too small | IMP-1, IMP-2 |
| G1 | Daily close at 3 am | SCHED-1, F2-WINDOW |
| G2 | Lifetime payout estimate drifts | EST-1 |
| G3 | Test merchants in real settlement | ADMIN-TEST-1 |
| G4 | Login without OTP | AUTH-1, CW-8 |
| G5 | Cancel another merchant's link | PL-3 |
| FP-187 | Link paid after expiry | PL-2 |
| FP-201 | Duplicate acquirer callbacks | CW-5, CW-7 |
| FP-203 | Balance cache wrong after admin action | BAL-1, ADJ-1 |
| FP-209 | Concurrent refund double payout | REF-1, REF-1b, REF-6b |
| FP-240 | Webhook signatures rejected | B8, CW-3, CW-2, CW-7 |
| INC-2026-05-14 | Payment link charged twice | PL-1 |
| INC-2026-08-21 | Duplicate payout notifications | CW-1, NOTIFY-1, CW-6 |
| H1 | Refund more than charged | REF-3, REF-5, REF-7, REF-1b, REC-1, REF-8 |
| H2 | Splits a few fils short | SPLIT-1 |
| H3 | Admin role checks | ADMIN-IMP-1, ADMIN-CRED-1, B8, ADMIN-CRED-2, AUTHZ-1, ADMIN-KYC-1, CW-6, ADMIN-IMP-2, AUTH-1·rpt |
| H4 | Key rotation | AUTH-3 |
| H5 | Close timing vs docs | CLOSE-1, SCHED-1, F2-WINDOW |
| H6 | Slow reporting query | SUM-1, SUM-2 |
| H7 | Test merchants and admin tools | ADMIN-TEST-1, REF-5 |
| H8 | OTP safety | AUTH-1, AUTH-2, AUTH-4, AUTH-5, AUTH-7 |
| H9 | Large export | EXP-1 |
| FP-300 | Finish the missing feature (refunds) | REF-2, MIG-1, NET-1, CW-3, REF-4, REF-5, REF-6, OBX-POISON, OBX-DOUBLE, SUM-1, IDEM-1, REC-1, FEES-3, CW-8, CW-9, REF-6b, FEES-5 · plus feature commits `f76d86b`, `8afc127`, `e6f6160`, `c1d13e2`, `5e9cbd9`, `198e5cf`, `b4e6b95`, `79eaf16` (see FP-300 section) |

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

## Reported, not changed

### DECOY-REFADJ · Dead "refund adjustment" client that would send refunds ÷10 · FP-300 (☐3) · Severity: Low (reported, not changed)
**What's wrong:** `notifySettlementRefundAdjustment` (`apps/api/src/admin/settlementClient.ts:282-299`) looks like the ready-made way to net refunds into payouts. It posts to `/internal/refund-adjustment`, a route the Go service does not have (no match under `apps/settlement`), and it sends `amountFils: Math.round(input.amountFils / 10)` while sending `feeReversedFils` unscaled.

**Why it happens:** the docblock (`:276-280`) claims settlement "expects amounts in ... 2-decimal BHD, i.e. fils / 10". That is false: Go works in int64 fils everywhere, and only the scheme-file amount is 2-decimal (ADR-0002). The function has no callers.

**What it would break:** wired into FP-300, a 3,333-fil refund would reach settlement as 333 (a 10x under-netting, with the fee reversal unscaled, so the two would not even agree), against a route that returns 404.

**Why it's not changed:** it is dead code, so changing it fixes nothing. The FP-300 build nets refunds inside Go `CloseBatch` from the `refunds` table and never calls this client. Recorded so nobody wires it later. Lines: 0.

**Trap note:** the docblock's "fils / 10" is the same "1 BD = 100" confusion as the quarantined AI configs and the CSV import bug (IMP-1).

Other items reported without a code change:
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

## Open decisions

1. **FEES-3 / FEES-5: three fee formulas.** For 12,345 fils at 250 bps with a 15% negotiated discount, the capture route books **263** fils, Go settlement charges **262**, and the payment-link capture **309** (figures from the lead's computation; not yet in a per-fix note). Refunds reverse the fee the ledger actually booked, so refund math is unaffected, but batch fees ≠ ledger fees until one formula wins.
   - **Option A (recommended):** Go CloseBatch sums the fee capture already booked in the ledger, and the payment-link capture applies the route's rebate. One source of truth; payouts always equal the ledger.
   - **Option B:** Go adopts the TypeScript formula.
2. **Refunds in the scheme file (question for the organizers):** refunds go to the acquirer through `acquirer.refund`, not the clearing file, so they are not added to `scheme_export_lines`; reconciliation shows them as their own line. We assume that is correct and will ask.

## FP-300 refunds

Design and build log: [FP-300-refunds.md](FP-300-refunds.md).

Build status: done and proven by tests for boxes 1-5 (POST /v1/refunds; fee reversal from the fee actually charged, cumulative rounding; CHECK refunded<=captured; refund.succeeded webhook signed over the exact bytes; reports on the Bahrain day; reconciliation gap 0; Go CloseBatch nets refunds into payouts, 0097-0099). Box 6 (Dilmune hosting) pending access
