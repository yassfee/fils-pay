# UI and UX: before/after evidence

This file covers the three judged surfaces: hosted **checkout** (`apps/web`, `/pay/:token`), the **merchant dashboard** (`apps/web`, `/dashboard/*`) and the **admin console** (`apps/admin`). For each visible change it gives the finding ID, the commit on `fix/w3e`, and a before and an after screenshot of the same page on the same data. Every fix has a note in `docs/audit/findings/<ID>.md`, in the standard format.

All screenshots are in [`evidence/ui/`](evidence/ui/). Each one carries a dark caption bar added by the harness, giving the state (BEFORE/AFTER), the finding ID and what was measured. Pages are 1280 × 860, or 375 × 812 for the phone shots, rendered with the browser timezone set to **Asia/Bahrain**.

## Checkout

| What the user sees | Fix (commit) | Before | After |
|---|---|---|---|
| On a 375 px phone the expiry/CVV row overflowed and **CVV started off-screen**: the page laid out 549 px wide. It now fits in 375 px (CVV right edge at 343 px). | CHECKOUT-375 (`0ac1f53`) | [checkout-375-before](evidence/ui/checkout-375-before.png) | [checkout-375-after](evidence/ui/checkout-375-after.png) |
| "Payment successful" showed **`Paid at 2026-10-30T14:11:31.805Z`** (raw UTC). It now shows a local date and time. | CHECKOUT-PAIDAT (`bb5d5dc`) | [checkout-success-before](evidence/ui/checkout-success-before.png) | [checkout-success-after](evidence/ui/checkout-success-after.png) |
| Expired link: the page said "Link expired" in both states, but before PL-2 a pay call carrying a stale `submittedAt` was **charged** (`200 paid`, 4.750 BHD). It is now refused with `410 payment_link_expired` (FP-187). | PL-2 (`0d292af`, merged earlier) | [checkout-expired-before](evidence/ui/checkout-expired-before.png) · [api-evidence-before.txt](evidence/ui/api-evidence-before.txt) | [checkout-expired-after](evidence/ui/checkout-expired-after.png) · [api-evidence-after.txt](evidence/ui/api-evidence-after.txt) |
| Amount display: 4,755 fils is shown as **4.755 BHD** (integer fils, 3 decimals). Unchanged, included as a reference. | none | [checkout-open-before](evidence/ui/checkout-open-before.png) | [checkout-open-after](evidence/ui/checkout-open-after.png) |

## Merchant dashboard

| What the user sees | Fix (commit) | Before | After |
|---|---|---|---|
| Date filter From 2026-08-27 To 2026-08-28 used the **UTC day** (`from=…T00:00:00.000Z`, which is 03:00 in Bahrain). It showed 1 row and missed the 01:03 Bahrain sale. It now uses the Bahrain day (`+03:00`) and shows both rows. | UI-DATE-1 (`5966bd1`) | [dashboard-date-filter-before](evidence/ui/dashboard-date-filter-before.png) | [dashboard-date-filter-after](evidence/ui/dashboard-date-filter-after.png) |
| A refunded transaction's page **crashed** ("Unexpected Application Error! toFils: expected a non-negative amount, got -1000"). It now renders, with the refund at −1.000 BHD. | UI-NEG-1 (`cdefb5c`, cherry-pick of `158f140`) | [dashboard-refunded-txn-before](evidence/ui/dashboard-refunded-txn-before.png) | [dashboard-refunded-txn-after](evidence/ui/dashboard-refunded-txn-after.png) |
| Password accepted, **OTP never entered**: the full dashboard opened. It now goes to the login page. | AUTH-1 (`87a6b42`, merged earlier) | [dashboard-pre-otp-before](evidence/ui/dashboard-pre-otp-before.png) | [dashboard-pre-otp-after](evidence/ui/dashboard-pre-otp-after.png) |
| Reconciliation said "Reconciled — no gap" over 3.666 − 0.000 − 4.643 BHD, which **does not add up**. It now shows the −0.977 BHD unbatched refund row and the formula the API uses. | RECON-REFUNDS (`111773d`) | [dashboard-reconciliation-before](evidence/ui/dashboard-reconciliation-before.png) | [dashboard-reconciliation-after](evidence/ui/dashboard-reconciliation-after.png) |
| An expired payment link was shown as **active**, with a Cancel button. It is now shown as **expired**, in red, and Cancel is hidden. | LINK-EXPIRED (`71b0d60`) | [list](evidence/ui/dashboard-links-expired-before.png) · [detail](evidence/ui/dashboard-link-expired-detail-before.png) | [list](evidence/ui/dashboard-links-expired-after.png) · [detail](evidence/ui/dashboard-link-expired-detail-after.png) |
| Session ended in another tab: the page showed a raw **"unauthenticated"** over 25 stale rows. It now goes to the login page. | UI-401 (`604a9f3`) | [dashboard-401-before](evidence/ui/dashboard-401-before.png) | [dashboard-401-after](evidence/ui/dashboard-401-after.png) |
| Unknown URL `/dashboard/no-such-page` showed React Router's **developer 404 screen**. It now shows "Page not found" with a link back. | ROUTER-404 (`b8fc29e`) | [web-unknown-url-before](evidence/ui/web-unknown-url-before.png) | [web-unknown-url-after](evidence/ui/web-unknown-url-after.png) |
| A closed, **unpaid** batch showed a full blue "progress" bar (width = `grossFils/10000` %, float math on fils). The bar is removed. | BATCH-BAR (`7fc0f33`) | [dashboard-batch-detail-before](evidence/ui/dashboard-batch-detail-before.png) | [dashboard-batch-detail-after](evidence/ui/dashboard-batch-detail-after.png) |
| A batch with netted refunds showed Gross 650.000 − Fee 16.250 ≠ Net 630.500 BHD **with nothing explaining the difference**. It now has a **Refunds netted 3.250 BHD** row, shown only when non-zero. | U4 (`6238967`, branch `fix/w3e2`) | AFTER only, see [U4.md](findings/U4.md) | [dashboard-batch-refunds-netted-after](evidence/ui/dashboard-batch-refunds-netted-after.png) |
| On a 375 px phone the transactions page laid out 665 px wide and the detail page 411 px. Both now fit in 375 px: the table scrolls inside itself and label/value pairs stack. | CHECKOUT-375 (`0ac1f53`) | [table](evidence/ui/dashboard-table-375-before.png) · [detail](evidence/ui/dashboard-detail-375-before.png) | [table](evidence/ui/dashboard-table-375-after.png) · [detail](evidence/ui/dashboard-detail-375-after.png) |

## Admin console

| What the user sees | Fix (commit) | Before | After |
|---|---|---|---|
| "View as merchant" first landed on the **merchant login page**: `/v1/auth/me` ignored the grant. With ADMIN-IMP-3 alone it landed on a **404**, because the web app had no `/` route. With both fixes it opens the merchant's dashboard as the read-only **support** role (a smaller nav, no email). | ADMIN-IMP-3 (`9b54967`) + ADMIN-IMP-3b (`c4fbb83`) | [view-as-merchant-before](evidence/ui/view-as-merchant-before.png) · [ADMIN-IMP-3 only](evidence/ui/view-as-merchant-imp3-only.png) | [view-as-merchant-after](evidence/ui/view-as-merchant-after.png) |
| The impersonation banner said screens were "acting with … (support) role". It now says they are **read-only**, which matches ADMIN-IMP-1. | IMP-BANNER (`36cb2c7`) | [admin-impersonation-banner-before](evidence/ui/admin-impersonation-banner-before.png) | [admin-impersonation-banner-after](evidence/ui/admin-impersonation-banner-after.png) |
| "Re-run a daily batch" at **01:30 Bahrain on 30 Oct** pre-filled **2026-10-28**, the day before yesterday. It now pre-fills **2026-10-29**. | UI-SETTLE-1 (`3d27389`) | [admin-run-batch-default-before](evidence/ui/admin-run-batch-default-before.png) | [admin-run-batch-default-after](evidence/ui/admin-run-batch-default-after.png) |
| Run-batch with an impossible date (`2026-02-30`) returned **500 settlement_run_failed**, as if settlement had crashed. It now returns **400 invalid_request** with settlement's reason (`invalid_date`). The date picker cannot produce this date, so the evidence is at the API level. | UI-SETTLE-1b (`3b7d2ba`) | [api-evidence-before.txt](evidence/ui/api-evidence-before.txt) | [api-evidence-after.txt](evidence/ui/api-evidence-after.txt) |
| Batch net payout cells now say **"(refunds netted: 3.250 BHD)"** when gross − fee ≠ net, both in the run-batch result and in the merchant page's batch table. Before, nothing explained the gap. | U4 (`6238967`, branch `fix/w3e2`) | AFTER only | [run-batch result](evidence/ui/admin-run-batch-refunds-netted-after.png) · [merchant batches](evidence/ui/admin-merchant-batches-refunds-netted-after.png) |
| Merchant page "Current negotiated rate" showed **2.45%**, a backfilled period entered later. It now shows the **2.25%** actually in force (F6). | FEES-4 (`5a329f6`, merged earlier) | [admin-fee-schedule-before](evidence/ui/admin-fee-schedule-before.png) | [admin-fee-schedule-after](evidence/ui/admin-fee-schedule-after.png) |
| Unknown URL showed the **developer 404 screen**. It now shows "Page not found" inside the admin shell. | ROUTER-404 (`b8fc29e`) | [admin-unknown-url-before](evidence/ui/admin-unknown-url-before.png) | [admin-unknown-url-after](evidence/ui/admin-unknown-url-after.png) |

## What "before" means

- **This lane's fixes** (UI-DATE-1, UI-SETTLE-1/1b, ADMIN-IMP-3/3b): the files as on `audit/handover` `8cd09b6`. The changed lines were reverted with `git diff 8cd09b6 HEAD -- <files> | git apply -R`, the screenshots were taken, and then the files were restored with `git checkout HEAD -- apps/`.
- **Fixes merged earlier** (AUTH-1, FEES-4, PL-2): `8cd09b6` with only that fix's own lines reversed (`git show <commit> -- <prod files> | git apply -R`), so each pair isolates one fix.
- **The Team 45 follow-ups** (UI-NEG-1, CHECKOUT-375, ROUTER-404, RECON-REFUNDS, LINK-EXPIRED, UI-401, CHECKOUT-PAIDAT, BATCH-BAR, IMP-BANNER): every file each fix touches was unchanged from `8cd09b6` when its BEFORE shot was taken.
- **AFTER**: branch head `36cb2c7` for every pair.
- No commit before `89daa69` and no `main` checkout was used.

## How to reproduce

1. Use a **local throwaway** Postgres database, never the team stack. Run `npm run migrate` and then `npm run seed > /dev/null` against it (the seed prints API keys).
2. **API** (repo root): `DATABASE_URL=<local db> NODE_ENV=development PORT=3157 OTP_DEV_EXPOSE=true COOKIE_SECURE=false SETTLEMENT_INTERNAL_URL=http://127.0.0.1:8197 SETTLEMENT_INTERNAL_TOKEN=<openssl rand -base64 32> WEBHOOK_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32> npx tsx apps/api/src/index.ts`
3. **Settlement** (only needed for UI-SETTLE-1b): `go build -o settlement ./apps/settlement/cmd/settlement`, then run `settlement daemon` with the same `DATABASE_URL` and token and `SETTLEMENT_INTERNAL_PORT=8197`.
4. **Web and admin**: `node node_modules/vite/bin/vite.js --config docs/audit/evidence/ui/harness/web.vite.mjs`, and the same with `admin.vite.mjs`. These configs proxy `/v1` to the API on the same origin (ports 5287 and 5288), because the API sends no CORS headers.
5. **Browser**: `msedge --headless=new --remote-debugging-port=9337 --user-data-dir=<tmp> about:blank`
6. **Harness** (Node 22, no dependencies): `SEED_USER_PASSWORD=… SEED_ADMIN_PASSWORD=… node docs/audit/evidence/ui/harness/shot.mjs <before|after> "<caption>" <scenario…>`. The scenarios are `dateFilter settleDefault viewAs fees preOtp checkout runBatchBad negRefund mobile links recon ui401 notFound paySuccess batchDetail banner`. The passwords are the seed's dev values from `db/seed/generate.ts`. They are sent only in `fetch` bodies, and no password, OTP or API key appears in any screenshot or in this file.

The harness changes three things in the browser, each stated in the screenshot's caption:
- **UI-SETTLE-1**: the browser's `Date` is pinned to 2026-10-30 01:30 Asia/Bahrain with an init script, because the bug only shows between 00:00 and 03:00.
- **"View as merchant"**: `window.open` is replaced with a same-tab navigation, so the landing page can be captured.
- **Logins**: done by `fetch` to the real login and OTP endpoints. The OTP comes from `devOtpCode` in development mode and is never displayed.

## Tests at branch head (`36cb2c7`)

- `apps/web`: **14/14** on `fix/w3e2`, which adds the U4 test; it was 13/13 at `36cb2c7` (dashboard.test.ts, router.test.ts, api/client.test.ts).
- `apps/admin`: **3/3**. The `test` script is new, added in UI-SETTLE-1.
- `apps/api`: **429/429**, against a migrated test database.
- `tsc --noEmit` is clean for web, admin and api.

Pages whose code reads `import.meta.env` are loaded in tests through Vite's `ssrLoadModule` with a minimal `window`/`document` stub. The repo has no DOM test runner, so render-only and CSS changes (CHECKOUT-375, RECON-REFUNDS, CHECKOUT-PAIDAT, BATCH-BAR, IMP-BANNER) are proven by the screenshot pairs and, for CHECKOUT-375, by the layout widths measured in the browser.

## Not done (out of time or out of scope)

- **Batch refund column** (Team 45 U4): done UI-only in U4 (`fix/w3e2`). The rows are derived as gross − fee − net, with no DTO change. The AFTER screenshots use a refund whose `occurred_at` was moved to 2026-08-26 in the throwaway evidence DB, because a refund made today only nets after today's Bahrain close (CLOSE-1). The API-side comment `query.ts:50-51` still states the old invariant.
- **Capture input in fils** (`TransactionDetailPage.tsx:183`): already labelled "Amount in fils". Nothing to fix.
- **Tab title** "FilsPay Checkout" on the whole web app (`apps/web/index.html:7`): not changed. A single title is wrong for one of the two areas either way, and a per-area title is more than a one-line change.
- `window.open(…, "noopener")` always returns `null`, so the admin's "Your browser blocked the new tab" fallback link always shows. It is harmless and noted in ADMIN-IMP-3b.
