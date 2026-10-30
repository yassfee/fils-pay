# 0009. Monthly windows use the Bahrain month

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** audit team (FilsPay handover audit)
- **Supersedes:** [0003](0003-report-date-windows.md) "Date windows for reports and finance scripts"
- **Related:** case file ("settlement closes every day at midnight, Bahrain time (UTC+3)"), G1, H5, SCHED-1,
  F2-WINDOW, `docs/audit/findings/F2-WINDOW.md`

## Context

ADR-0003 allowed calendar-month reports and finance scripts to use UTC month boundaries. The business day closes at
midnight Asia/Bahrain, so a UTC month moves the first three hours of the month into the previous one and the last
three hours of the next month into this one. The March residue sweep (`scripts/reconcile_march.ts`) used such a
window, and the same UTC assumption put the daily close at 03:00 Bahrain (SCHED-1, G1).

## Decision

Every date window, daily or monthly, in reports, finance scripts and settlement, runs midnight to midnight
**Asia/Bahrain** (UTC+3, no DST). A month runs from the 1st 00:00 Bahrain time (the previous day 21:00 UTC) to the
next 1st 00:00 Bahrain time.

## Consequences

- Monthly figures match the daily batches they are made of.
- Any remaining UTC-month query is a bug, to be fixed to this rule.
