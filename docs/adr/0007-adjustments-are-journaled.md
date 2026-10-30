# 0007. Balance adjustments are journaled postings

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** audit team (FilsPay handover audit)
- **Supersedes:** [0006](0006-display-adjustments.md) "Adjustments are display corrections, not postings"
- **Related:** F4, FP-203, ADJ-1, BAL-1, `docs/audit/findings/ADJ-1.md`

## Context

ADR-0006 let "Adjust balance" write `merchant_balances.cached_payable_fils` only, with no ledger entry. The cache is
rebuilt from the ledger (ADR-0008), so every rebuild silently erased those adjustments, and between rebuilds the
dashboard and payouts disagreed with the ledger: one of the two sources behind F4 (the "135K → 7K" balance).
ADR-0001 makes the ledger the source of truth for money.

## Decision

Every balance adjustment posts a balanced ledger group (merchant_payable against the existing manual-adjustment
contra account) and updates the cache in the same transaction, with an admin audit row. Only `finance` and
`super_admin` may adjust (`requireAdminRole`); support cannot. Corrections to a wrong adjustment are new compensating
adjustments (the ledger is append-only, LED-1).

## Consequences

- The cache and the ledger can no longer drift through adjustments; a rebuild preserves them.
- Adjustments now need finance authority, as any posting does.
