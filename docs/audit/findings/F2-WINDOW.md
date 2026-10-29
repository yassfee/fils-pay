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
