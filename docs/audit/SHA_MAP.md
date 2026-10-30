# Commit ID map (history rewrite at the freeze)

At the freeze we removed one line from history: `ai-setup/START_HERE.md` (added in the 17:36 ai-setup commit) quoted
the answer to the organizers' mystery. The answer is submitted to the organizers separately and must not be readable in a
public fork. The line was replaced with "The mystery flag is submitted to the organizers separately." in every commit
from that one on, so those commits have new IDs. **Nothing else changed:** every code and test file is byte-identical
(`git diff <old> <new>` outside that file is empty), so every test, demo and load result recorded against an old ID
holds for its new ID.

The docs in `docs/audit/` use the new IDs. **Commit messages written before the rewrite still name old IDs**; look
them up here. Commits before `c811e20` (the base, `d4277c3`, and everything earlier) are unchanged.

| old | new | subject |
|---|---|---|
| `c811e20` | `6a23712` | docs(ai-setup): the AI setup we actually ran, for the judges' "AI usage and setup" criterion |
| `5b4ede6` | `18b3704` | docs(ai-setup): verify the CLAUDE.md hash on the committed blob (line endings) |
| `fedf383` | `9ac6076` | fix(Q2): CSV import rejects a decimal-comma amount instead of posting its integer part |
| `b7d88d6` | `075c663` | fix(SEC9): transactions CSV export neutralises formula-leading references and quotes CR |
| `2bbbca8` | `1d8a228` | fix(G12): migration runner takes an advisory lock so two concurrent runs cannot race |
| `8d3d62f` | `3d82a99` | fix(SEC4): API responses set nosniff, no-store and anti-framing headers |
| `1c4a9c6` | `c0ecf38` | fix(SEC4b): KYC file download encodes the filename per RFC 5987 instead of a 500 |
| `2ee4083` | `4b584d4` | fix(C5): admin_audit_log is append-only except the outcome update |
| `b7ad4ad` | `1563182` | docs(Q3-11): open finding, admin Adjust balance reads 0x10, 1e3 and 4.000 as fils |
| `acd3311` | `981c90e` | fix(HUNT-1): a malformed or impossible date query parameter is a 400, not a 500 |
| `b7896dc` | `730d910` | fix(HUNT-2): settlement reconciliation/summary reject malformed and rolled-over dates with 400 |
| `bba5680` | `77979a6` | fix(HUNT-3): reporting consumer applies settlement.paid so payout trends show paid batches |
| `1bd429d` | `1f80389` | docs(HUNT-4): open finding, signup and business-profile PATCH 500 on invalid fields |
| `15cf607` | `0fd40d6` | docs(HUNT-5): open finding, March residue sweep legs contradict ADR-0002 |
| `d3d7137` | `a2c08e6` | fix(HUNT-4): public signup rejects an unknown businessType or long country with 400, not 500 |
| `1337d0b` | `3a2a449` | docs(Q3-11): note the same Number() amount parsing on three dashboard money forms |
| `a8e8d3c` | `8a00696` | chore(C5): renumber the admin audit append-only migration 0101 -> 0102 |
| `3f78b7c` | `898ca88` | docs(HUNT-5): reframe as a finance question (sweep counter-account vs ADR-0002 export legs), per case file F2  |
| `9c7cb8d` | `34b35d4` | revert(Q2): undo the code change after the false-positive review; reported, not changed |
| `4daab2b` | `6ec6d8c` | revert(IMP-3): undo the code change after the false-positive review; reported, not changed |
| `d04b5ab` | `79616f4` | revert(UI-SETTLE-1b): undo the code change after the false-positive review; reported, not changed |
| `ce4a030` | `df4b91f` | revert(CAP-EXP-1): undo the code change after the false-positive review; reported, not changed |
| `d1ad36f` | `7e425e6` | revert(BAL-2): undo the code change after the false-positive review; reported, not changed |
| `a3b87cb` | `ee94bdb` | revert(CW-7): drop the 300 s freshness check on inbound acquirer callbacks; keep raw-body HMAC and timing-safe |
| `ec0b02d` | `f198a66` | revert(PL-6): restore the public merchantPublicKey (key prefix) field; keep the key hash removed |
| `a9abf28` | `1ca3671` | revert(CW-7): drop the stale-timestamp assertion from the inbound verify unit test (follow-up to a3b87cb) |
| `f910bc2` | `32ed326` | style(UI-CSS): checkout card and dashboard tokens, primary buttons, tables, nav, visible focus (web) |
| `7a2a63a` | `44f7564` | style(UI-CSS): admin console shares the dashboard tokens, primary buttons, tables, nav, visible focus |
| `d3dbc07` | `7938e01` | docs(UI-UX): "UI/UX improvements (CSS only)" section with desktop and 375 px before/after |
| `4ed5325` | `183634a` | ops(WEB-1): serve the web and admin SPAs and front the API with Caddy (HTTPS) |
| `2b3876b` | `f2c93fe` | docs(WEB-1): deploy steps, HTTPS modes and URLs for the web service |
| `8ec56f2` | `8e76342` | fix(CHECKOUT-PAIDAT): show paidAt in Asia/Bahrain time |
| `e316e5d` | `1aceba0` | docs(fp-review): reverted fixes become "reported, not changed" notes |
| `723c108` | `2276aad` | docs(fp-review): CW-7 and PL-6 notes match their partial code reverts |
| `a102390` | `b21e0f3` | docs(fp-review): merge our own follow-ups into their original rows |
| `2915767` | `6a9d847` | docs(fp-review): recategorise hardening, capacity, UI/UX and FP-300 build notes |
| `ee59967` | `bace7f5` | docs(fp-review): reword bug notes so each claim is defensible |
| `18a413f` | `4311fd2` | docs(fp-review): every note header parses as "### ID Â· title Â· [refs Â·] Severity: X" |
| `a2ed813` | `bf189da` | style(UI-CSS): brand-coloured body links and bordered secondary buttons in the dashboard and admin (CSS only) |
| `37cf2a8` | `8acd676` | test(CW-7): comments match the partial revert (raw-body HMAC checked; inbound freshness is reported as hardeni |
| `ee665aa` | `aca949d` | docs(ERR-1): fold HUNT-1 (malformed dates) and HUNT-4 (invalid signup fields) into the client-input 500 row, s |
| `d9295f7` | `6d72ac1` | docs(audit): FINDINGS regenerated after the independent false-positive review: 93 bugs in the handed-over code |
| `d88a48b` | `9841632` | fix(YA-1): March residue sweep skips test-mode merchants (F2, G3, ADR-0002) |
| `17fc3ab` | `4cf44f0` | docs(SCHEMA-1): refund_merchant_summary joins refunds.id to transactions.id (reported, not changed) |
| `8070aa7` | `21479fd` | docs(SCHEMA-2, SEED-1, SEED-2): reported, not changed (Team 45 leads G10, G7, S12) |
| `6e585d8` | `edcdd31` | fix(GO-1): scheme amount column holds every fils figure (NUMERIC(10,2) -> (18,2)) |
| `6b6d510` | `872bad6` | docs(YA-1): correct the regression-risk note (the filter reads the current test_mode flag) |
| `f4e1ef3` | `b44a36c` | docs(GO-2): a capture committing across a manual midnight close is never settled (reported, not changed) |
| `9f7ffd4` | `f027faa` | ops(WEB-1): Caddy cpus 0.1 -> 0.25 (a cap, not a reservation); GO-1 filed as hardening |
| `63b6711` | `756083d` | docs(UI-UX): links and secondary buttons screenshot |
| `0a5c804` | `f771f28` | docs(MDR-1): how we read F5's "closed ones" (paid-out batches), and why the one-line 'open' alternative was re |
| `574d668` | `1df7661` | fix(API-1): a malformed, empty, oversized or non-JSON body is a 4xx, not a 500 |
| `042c740` | `2f87f41` | fix(API-2): admin merchant search with a repeated q is a 400, not a 500 |
| `c098ff0` | `773feb7` | fix(API-3): a JSON null report filter is treated as no filter, not a 500 |
| `d392e30` | `54f8f28` | fix(API-4): a balance adjustment past the safe-integer range is a 400, not a 500 |
| `f09c04c` | `d92e917` | fix(HUNT-6): business-profile PATCH answers 400, not 500, for unknown keys and invalid values |
| `8deb4c6` | `ee144d5` | docs(API-1,HUNT-6): exact line-count wording |
| `2b55008` | `1337b18` | docs(DOC-1,DOC-2,API-5): reported, not changed: saved-filter cap claim, seed wipe, manual entries in reconcili |
| `cd95697` | `1a4b67b` | fix(UI-1): admin credit form pre-fills the Bahrain business day, not the browser's date |
| `f87e5bb` | `c3881cc` | docs(API-6): reported, not changed: authorize/capture 500 on a fractional amount or malformed card |
| `4574d80` | `ac3e788` | fix(API-7): a zero-fils payment link is a 400, not a 500 |
| `9fbdedd` | `be65826` | fix(API-8): a webhook endpoint PATCH with an unknown status is a 400, not a 500 |
| `c11e2f5` | `5e919e7` | fix(API-9): a KYC image with a valid signature but corrupt data is a 422, not a 500 |
| `e0c3ec9` | `2fffc29` | docs(API-6): authorize with amountFils 0 is a 500 too (CHECK amount_fils > 0) |
| `c7f2826` | `144504a` | docs(Q3-11): re-checked, kept open: all four fields are labelled in fils; the refund drawer is not mounted |
| `8b0aaca` | `fe7665f` | docs(API-10): reported, not changed: a fully refunded partial capture keeps status partially_captured |
| `d9c31de` | `5aca7e8` | fix(API-11): a non-numeric ?limit on merchant list routes uses the default page, not LIMIT NaN |
| `566671d` | `5e7e2b4` | fix(API-12): signup with a non-string owner password is a 400, not a 500 |
| `c5ddfc2` | `215eedb` | docs(API-9): drop the H9 case ref (H9 is about large exports, not corrupt images) |
| `4eb40a8` | `5c2c11c` | docs(lane H notes): headers follow the fp-review convention (### ID Â· title Â· [refs Â·] Severity) with a Cat |
| `51d7b6d` | `61cd1e3` | fix(UI-2): admin credit form shows the MDR the server reverses (schedule in force), not the display rate |
| `7251aa6` | `e7ec8c6` | fix(UI-3): admin 'Issue credit' help text no longer claims legs are booked on the effective date |
| `c303dd0` | `990cdc4` | docs(API-5): reproduced on a seeded DB: four manual credits show as an unexplained 163.600 BHD gap (screenshot |
| `447a095` | `f276833` | docs(ERR-1,UI-SETTLE-1,ADMIN-CRED-4,CRED-1): fold lane H's same-class fixes into their rows |
| `1a2e0dd` | `829a821` | docs(FINDINGS): regenerate after lane G and lane H (94 bugs; lane H folded into ERR-1, UI-SETTLE-1, ADMIN-CRED |
| `ab06b06` | `8c42cd4` | docs(ERR-1): per-site line counts (+55/-9 across 15 sites, 1-7 each); HUNT-1 is +6/-0, not +5 |
| `096a9dd` | `5a5f31d` | fix(K-1): one merchant's failing close/payout no longer stops the daily run for the rest |
| `b071d00` | `af26154` | fix(K-4): analytics date validator rejects impossible dates like 2026-02-30 |
| `0f6bded` | `683f19c` | fix(K-5): authorize and capture reject a bad amountFils with 400 instead of 500 |
| `ad25cf3` | `3e20aaa` | fix(K-7): a batch disbursed before the 0087 cutoff gets no second payout instruction on replay |
| `af18c40` | `8ad029b` | fix(K-8): deliveries that throw before sending no longer starve other merchants' webhooks |
| `179f76b` | `d434986` | docs(K-9): single KYC review approves a merchant with no documents (reported, not changed) |
| `abdc2d0` | `e240e23` | docs(K-3,K-5): correct the cited pre-fix line numbers |
| `060ef27` | `6c49da0` | test(K-1): close the deliberately broken split parent after the test |
| `df53f51` | `1a4d9a0` | docs(ERR-1,HUNT-2,CW-1,API-6): fold lane K's same-class fixes into their rows |
| `f11ca64` | `acb9da8` | docs(FINDINGS): regenerate after lane K (96 bugs: K-1 and K-8 new; K-4, K-5, K-7 folded) |
| `2b35f3a` | `dbaf2e9` | test(K-1): a rerun after a partial failure posts, pays and notifies nothing twice; ERR-1 states K-5's acquirer |
| `6df87d0` | `3e2142c` | test(case-file): acceptance scenarios for F1, F3/H2, F5, G1/H5, G2, G3/H7, INC-2026-08-21 (Go settlement) |
| `7baa076` | `f7bf462` | test(case-file): acceptance scenario for G1/H5 (daemon closes the Bahrain day after Bahrain midnight) |
| `f69e0c3` | `82f0140` | test(case-file): F3/H2 scenario uses Delta Marketplace's real terms (275 bps, 12.5% booked discount) |
| `ee2b5d4` | `d9780fa` | test(case-file): G2 adds small odd payouts after the busy days; INC-2026-08-21 also races the split payout pat |
| `c9f6e95` | `43554f6` | test(case-file): acceptance scenario for F4/FP-203 |
| `1ed6fa3` | `6a2e8b1` | test(case-file): acceptance scenarios for F6, F7, G4, G5, FP-187, FP-201, FP-209, FP-240, INC-2026-05-14, H1,  |
| `228464a` | `9d577e9` | test(case-file): acceptance scenario for F2 |
| `7c2cb85` | `815e64c` | test(case-file): acceptance scenarios for FP-300 reports/reconciliation, G3/H7 admin tools, H1 chargebacks, H9 |
| `a9a57ec` | `44eb8b4` | test(case-file): adversarial variants for FP-209, H1, G4, H8 and the FP-300 webhook through the dispatcher |
| `f1fe2c5` | `87f3600` | test(case-file): acceptance scenarios for H3 impersonation writes and INC-2026-05-14 simultaneous buyers |
| `10aeaa2` | `d4b7c09` | test(case-file): acceptance scenario for FP-300 refund payouts |
| `2539517` | `c22c74f` | test(case-file): H9 fixture uses voided rows on an unused 2019 day |
| `7ffe202` | `84b0992` | docs(case-file): acceptance table for every case-file item |
| `6e6bf0e` | `b5c7cd4` | test(case-file): acceptance scenario for G1/H5 in the merchant summary and report |
| `e6f4604` | `ddecb0a` | docs(freeze): final gate at 6e6bf0e; demo evidence, capacity re-measurement, FINDINGS regenerated |
