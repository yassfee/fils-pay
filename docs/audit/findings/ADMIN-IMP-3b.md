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
Commit: this commit. Lines: prod +2/-0 (1 route, 1 comment), test +28/-0.

**Why this is the smallest correct fix:** It is one route, using the redirect pattern the file already uses for `/dashboard` → `/dashboard/transactions`. `/dashboard` then goes through the existing `RequireDashboardAuth` guard: with a grant or session the dashboard shows, otherwise the login page does. The route sits outside the `DashboardAuthProvider` subtree, so `/pay/:token` still makes no auth calls. *Why not change the admin's link to `${WEB_BASE_URL}/dashboard`?* That takes 2 lines, and the bare dashboard URL would stay a 404 for merchants. It would also break if `VITE_WEB_BASE_URL` is configured with a trailing slash (`//dashboard`). *Why not add an `errorElement`?* That only makes the 404 look nicer and still does not take anyone to the dashboard.

**Proof:** `the web root routes into the dashboard instead of a 404` (`apps/web/src/router.test.ts`) loads `router.tsx` through Vite's `ssrLoadModule`, because the pages read `import.meta.env`, with a minimal `window`/`document` stub at `http://localhost:5173/`. Before the fix it fails with `router.state.errors` = `Error: No route matches URL "/"`. After the fix there are no errors, and the last match is `<Navigate to="/dashboard">`. Web tests pass 9/9, `tsc --noEmit` is clean, and the screenshot pair `view-as-merchant-{before,after}.png` shows the result end to end.

**Regression risk:** Only `/` changes, from a 404 to a redirect. Every other path matches as before. The new test is the only web test that starts Vite in-process (about 2 s).

**Trap note:** `MerchantDetailPage.tsx:213` calls `window.open(..., "noopener")`, which always returns `null` per the HTML spec. The "Your browser blocked the new tab" fallback link therefore shows even when the tab opened. It is harmless (the link points to the same place) and left as-is.
