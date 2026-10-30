# 0008. The balance cache is rebuilt from the ledger only

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** audit team (FilsPay handover audit)
- **Supersedes:** [0004](0004-balance-rebuild-source.md) "Balance cache rebuild source"
- **Related:** F4, FP-203, BAL-1, `docs/audit/findings/BAL-1.md`

## Context

ADR-0004 let the admin "Recalculate cached balances" button rebuild from the `merchant_payable_position` view over
`scheme_export_lines`, because the ledger walk was slow. Scheme lines are truncated gross amounts, not what merchants
are owed (no fees, refunds, credits or adjustments), so the button produced a different number from the CLI. That is
case file F4/FP-203: Alpha Retail's balance went from 135K to 7K, and only the CLI rebuild restored it.

## Decision

The button and the CLI run the same ledger rebuild (`RebuildAllBalances`). `ledger_entries` is the only source for
`merchant_balances.cached_payable_fils`. Speed is handled by indexes and per-merchant rebuilds, never by reading a
different table.

## Consequences

- The button and the CLI always agree.
- A rebuild takes as long as the ledger walk (about 40 s cold, per ADR-0004); acceptable for an admin action.
