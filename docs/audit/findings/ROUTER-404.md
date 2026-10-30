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
Commit: this commit. Lines: prod +13/-2 (web +7/-1, admin +6/-1; 2 comments), test +54/-0.

**Why this is the smallest correct fix:** These are the router's own two extension points, `path: "*"` and `errorElement`, set once per top-level subtree, with plain JSX and existing layout classes. No new component file and no new CSS were added. Every page below those routes is covered, including ones added later. *Why not an `ErrorBoundary` component?* `errorElement` is the data router's error boundary, and a separate component adds a file for the same behaviour. *Why put the web catch-all at top level, but inside the guard in the admin?* Checkout (`/pay/:token`) must make no auth calls, so the web 404 page cannot sit under the session provider. The admin has no public pages, so its 404 page keeps the admin shell.

**Proof:** `an unknown dashboard URL matches the catch-all route, and every subtree has an errorElement` (`apps/web/src/router.test.ts`) and `an unknown admin URL matches the catch-all route, and every subtree has an errorElement` (`apps/admin/src/router.test.ts`) fail before the fix with `No route matches URL "/dashboard/no-such-page"` and `No route matches URL "/no-such-page"`. Both pass after the fix. Web tests pass 10/10 and admin 2/2, and `tsc --noEmit` is clean for both. Screenshots: `web-unknown-url-{before,after}.png`, `admin-unknown-url-{before,after}.png`.

**Regression risk:** Every existing path matches exactly as before. Only URLs that used to 404, and render errors, change. Loader and action errors do not apply, because the routes define none. The admin "View as merchant" target is fixed by ADMIN-IMP-3b (`/` → `/dashboard`), so `MerchantDetailPage.tsx:213` needs no change.
