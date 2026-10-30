### LINK-EXPIRED · The merchant dashboard shows an expired payment link as "active" and still offers Cancel · Severity: Low

**Lead:** Team 45 heads-up list (item 5), verified by us.
**Category:** UI/UX improvement

**What's wrong:** Once a payment link passes its `expires_at`, the buyer's checkout says "Link expired" and the server refuses to pay it (PL-2). The merchant's Payment links list and detail page still show it as **active** in green, and the detail page still offers "Cancel payment link". The merchant sees a live link that no buyer can use.

**Why it happens:** No job flips `payment_links.status` when a link expires. Expiry is computed on read: `derivePublicStatus` (`apps/api/src/paymentLinks/status.ts:33-34`) returns `"expired"` for an `active` row whose `expiresAt <= now`, but only for the public checkout read. The merchant DTO carries the raw column `status` and `expiresAt`. `PaymentLinkListPage.tsx:114`, `PaymentLinkDetailPage.tsx:123` and the Cancel gate at `:162` render `link.status` as-is.

**What it breaks:** Merchants re-send dead links to customers, or think a customer is "about to pay". Support gets "the link says active but my customer sees expired" (the merchant-side mirror of FP-187; FP-187 itself, the server accepting a payment after expiry, was fixed by PL-2). The Cancel action on an expired link is a no-op that looks meaningful.

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
Commit: this commit. Lines: prod +11/-5 (format.ts +5 incl. 1 comment and 1 blank, two imports, three call sites, 1 CSS selector), test +11/-1.

**Why this is the smallest correct fix:** It is the server's rule, `active && expiresAt <= now`, applied at the three places the dashboard shows or acts on a link's status. One pure function keeps the three in step and makes the rule unit-testable. *Why not add an `effectiveStatus` to the API DTO?* That changes a public API contract that API-key clients depend on, for a display concern. *Why not a migration or job that flips the status to `expired`?* The column's CHECK has no `expired` value, so a new state machine value would be a much bigger change. The status filter checkboxes still filter on the stored status, as the endpoint does.

**Proof:** `linkStatus shows an active link past its expiry as expired` (`apps/web/src/dashboard.test.ts`) fails before the fix (`SyntaxError: The requested module './format.js' does not provide an export named 'linkStatus'`) and passes after. It covers the boundary at exactly `expires_at` (expired, as `status.ts:34` uses `<=`), 1 s before (active), and paid/reserved links (unchanged). `dashboard.test.ts` passes 10/10, the web suite 13/13 at branch head `36cb2c7`, and `tsc --noEmit` is clean. Screenshots: `dashboard-links-expired-{before,after}.png` (list) and `dashboard-link-expired-detail-{before,after}.png` (detail: "expired" in red, Cancel button gone).

**Regression risk:** Display only. Links that are paid, canceled or reserved show as before, and active links before their expiry show as before. The cancel endpoint is unchanged and still accepts the call from other clients.
