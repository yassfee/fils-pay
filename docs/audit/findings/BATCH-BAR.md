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
Commit: this commit. Lines: prod +0/-6, test +0/-0.

**Why this is the smallest correct fix:** There is no correct value for this bar. A batch has no progress between `closed` and `paid`, and the page already shows `Status`, `Closed at` and `Paid at` in words. Deleting it removes both the misleading graphic and the float math. *Why not compute it in integer fils?* There is still nothing meaningful to show.

**Proof:** There is no unit test: the change only removes rendering. `tsc --noEmit` is clean, and `dash-progress-bar` has no CSS or other users. Screenshots: `dashboard-batch-detail-{before,after}.png` show the same batch with and without the full blue bar.

**Regression risk:** None to data or API. A visual element is removed.
