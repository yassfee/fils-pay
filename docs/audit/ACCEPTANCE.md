# Case-file acceptance sweep

Every case-file item (handoff case file, pages 2-4) has at least one end-to-end scenario. Each scenario is written from the organizers' wording, not copied from the fix's own test, and runs against the current code. Every scenario creates its own merchants (random ids) and asserts on those rows only. None uses a real sleep, and none depends on which side of Bahrain midnight it runs.

**Result:** every scenario passes on the current code. No new bug was found, and no production line was changed.

**Test files**

| file | tests | runtime |
|---|---|---|
| `apps/api/src/caseFile.acceptance.test.ts` | 26 | about 7 s |
| `scripts/caseFile.acceptance.test.ts` | 1 | under 1 s |
| `apps/settlement/internal/settlement/case_file_acceptance_test.go` | 8 | about 2.5 s |
| `apps/settlement/internal/scheduler/case_file_acceptance_test.go` | 1 | under 1 s |
| `apps/settlement/internal/internalapi/case_file_acceptance_test.go` | 1 | under 1 s |

**Gate (18:58 Bahrain, filspay_w3j):** the full api suite passes 492/492, scripts 13/13, and Go `./...` is ok in every package, with these files included.

**How to run**
- api: `cd apps/api && DATABASE_URL=... npx tsx --test --test-concurrency=1 src/caseFile.acceptance.test.ts`
- scripts: `DATABASE_URL=... npx tsx --test scripts/caseFile.acceptance.test.ts`
- Go: `cd apps/settlement && DATABASE_URL=... go test -p 1 ./internal/settlement/ ./internal/scheduler/ ./internal/internalapi/ -run TestCaseFile -count=1`

| case item | scenario test name (file) | result |
|---|---|---|
| F1 | `TestCaseFile_F1` (settlement) | PASS |
| F2 | "F2: running the March sweep script twice doubled the gap, now a second run posts nothing and the sweep takes exactly the March residue" (scripts) | PASS |
| F3 | `TestCaseFile_F3` (settlement) | PASS |
| F4 | `TestCaseFile_F4` (internalapi): per-merchant CLI rebuild from a stale 7,000-fils cache gives the ledger balance | PASS |
| F4 (admin button / full CLI) | `TestCaseFile_F4`, nested subtest, runs only with `CASEFILE_PLATFORM_REBUILD=1` | manual check: the rebuild is platform-wide, so run it on an isolated DB |
| F5 | `TestCaseFile_F5` (settlement) | PASS |
| F6 | "F6: the dashboard fee shows a later-entered backfill rate (245 bps) while payments go through at 225 bps, now it shows the rate actually charged" (api) | PASS |
| F7 | "F7: a CSV import of 4.755 BD lands as 4.750 and 4.75 BD as 0.475, now the ledger shows 4,755 and 4,750 fils" (api) | PASS |
| G1 | `TestCaseFile_G1` (settlement: close window; scheduler: daemon timing) | PASS |
| G2 | `TestCaseFile_G2` (settlement) | PASS |
| G3 | `TestCaseFile_G3` (settlement); "G3/H7 (admin tools): running the finance status backfill on a test merchant took it live ..., now it stays a test merchant" (api) | PASS |
| G4 | "G4: login works without entering the OTP code, now a password-only (pending) session is refused until the OTP is verified"; "G4 (admin console): ... a pending admin session is refused" (api) | PASS |
| G5 | "G5: merchant A could cancel merchant B's payment link from A's dashboard, now the cancel is refused and B's link stays payable" (api) | PASS |
| FP-187 | "FP-187: a link that shows 'expired' still took a payment because the server trusted the checkout's submittedAt, now it is refused and nothing is charged" (api) | PASS |
| FP-201 | "FP-201: the bank sent the same callback twice and two identical notes were saved, now one payment keeps exactly one note" (api) | PASS |
| FP-203 | `TestCaseFile_F4` (internalapi), as for F4 | PASS (button path: manual check, as for F4) |
| FP-209 | "FP-209: two refunds of the same payment at the same time both went through, now exactly one succeeds ..."; "FP-209 (partial refunds): three concurrent partial refunds ..., now only those that fit go through" (api) | PASS |
| FP-240 | "FP-240: merchants could not verify our webhook signatures, now the signature verifies as HMAC(secret, t + '.' + the exact body sent)"; "FP-240 (incoming): ... a callback signed over its exact raw bytes is accepted and a tampered one is not"; "FP-300 (webhook)" (api) | PASS |
| INCIDENT 2026-05-14 | "INCIDENT 2026-05-14: a slow payment let a second buyer use the same link before the first finished and both were charged, now only one buyer is charged"; "INCIDENT 2026-05-14 (simultaneous buyers)" (api) | PASS |
| INCIDENT 2026-08-21 | `TestCaseFile_INC20260821` (settlement) | PASS |
| H1 | "H1: a refund could exceed what was actually charged, now a refund above the captured amount is refused and writes nothing"; "H1 (chargebacks)"; "H1 (nothing charged)" (api) | PASS |
| H2 | `TestCaseFile_F3` (settlement) | PASS |
| H3 | "H3: some admin actions lacked role checks, now a support admin is refused every money-moving admin action"; "H3 (impersonation): ... it can read but every write is refused" (api) | PASS |
| H4 | "H4: the key rotation flow did not do what you'd expect, now rotating an API key revokes the old key and only the new one works" (api) | PASS |
| H5 | `TestCaseFile_G1` (settlement, scheduler) | PASS |
| H6 | Correctness half: "FP-300 (reports and reconciliation)" checks that the summary counts a two-part capture once (SUM-1). Speed half: no scenario | PASS / manual check (query speed is a plan/volume property; see SUM-2) |
| H7 | "G3/H7 (admin tools)" (api); `TestCaseFile_G3` (settlement) | PASS |
| H8 | "H8: the OTP implementation changed, now a wrong code never authenticates and the right code does"; "H8 (brute force): ... after the attempt budget even the right code is refused"; G4 (api) | PASS |
| H9 | "H9: a really large export was built whole in memory, now an export past 50,000 rows is refused up front and a narrower range still exports" (api) | PASS |
| FP-300 ☐1 works end to end through the API | "FP-300: a refund through the API was never finished, now ledger, fee, webhook event and timeline are right to the fils" (api) | PASS |
| FP-300 ☐2 money right in the ledger | same test: every entry group balances, and each account moves by exactly the refund | PASS |
| FP-300 ☐3 fees and payouts | same test (fee reversal 100 of 250); `TestCaseFile_FP300` (settlement: payouts net the refunds, payable ends at 0) | PASS |
| FP-300 ☐4 right webhook | "FP-300 (webhook): ... its endpoint gets exactly one signed refund.succeeded for the refund" (api, real dispatcher) | PASS |
| FP-300 ☐5 timeline, reports, reconciliation | "FP-300" (timeline); "FP-300 (reports and reconciliation): ... summary, the report and reconciliation, which ties out to 0" (api) | PASS |
| FP-300 ☐6 live on Dilmune Cloud | none | manual check (deployment; see DEPLOYMENT.md) |

## The scenarios catch the old bugs

Each fix below was reverted temporarily in the working tree, the matching scenario was run, and the file was restored with `git checkout`. Every scenario failed against the reverted code:

| scenario | fix reverted |
|---|---|
| G4 | AUTH-1 |
| FP-201 | CW-5 |
| FP-240 | CW-3, both test-send and dispatcher |
| FP-240 (incoming) | CW-7 |
| H4 | AUTH-3 |
| FP-187 | PL-2 |
| INCIDENT 2026-05-14 | PL-1, lease fence and in-capture finalize |
| H1 | REF-3 (the over-refund guard loosened) |
| FP-209 | REF-1 row lock |
| F6 | FEES-4 |
| F2 | F2-SWEEP |
| F1 | SCHEME-2 |
| F3 | SPLIT-1 |
| F5 | MDR-1 |
| G3 | CloseBatch `test_mode` guard |
| G1 | SCHED-1 |
| G2 | EST-1 |
| F4 | CLI-1 |

## Observed, not counted

`splits.PayoutSplitBatch` never updates `lifetime_net_payout_monitoring_estimate`, so a split parent's estimate stays at 0. It is not counted because G2's complaint is drift, which EST-1 fixed, and no API path reads the column.
