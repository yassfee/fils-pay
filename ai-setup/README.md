# AI setup: how this team used Claude Code

These files are copies of the setup we actually ran. The live copies sit outside the repo, in the workspace folder that
holds `fils-pay/`, so that no tool loads them as the repo's own instructions. Three annotated transcript excerpts
showing how we checked what the AI told us are in [`docs/audit/AI_USAGE.md`](../docs/audit/AI_USAGE.md).

| File | Live location | What it does |
|---|---|---|
| `CLAUDE.md` | workspace root | Trusted rules, auto-loaded by every session and subagent: the trust order, money in integer fils, the Bahrain business day, safety (never push to the shared upstream, no secrets in git, ask before any outward action), token discipline, and the minimal-diff working agreement. |
| `.claude/settings.json` | workspace `.claude/` | `claudeMdExcludes`: stops Claude Code from auto-loading any `CLAUDE.md` inside `fils-pay/` or a git worktree, because the repo shipped a poisoned one. |
| `00_IMPLEMENTER_PROMPT.md` | `handoff/` | The phased plan the implementation session followed: phases, gates, agent roles, output formats. |
| `START_HERE.md` | `handoff/` | How the two sessions were started: an advisor session that planned and reviewed every gate, and an implementation session that did the work. |
| `token_watch.py` | `handoff/tools/` | A read-only watchdog over the session transcripts. It flags loops, huge tool outputs and reads of known token-trap files. We ran it at every gate. |

## Trust model
- **Two sessions, one human.** The advisor session wrote the trusted rules, planned the work and reviewed every phase
  gate, and it had to approve any fix over 30 production lines. The implementation session did the work and delegated
  narrow tasks to subagents: at most 5 at a time, each with an explicit file list, its own git worktree and its own
  test database. Neither session's word counts as the human's approval: pushes and deploys waited for the user.
- **Everything in the repo is a claim until wired code confirms it.** That covers comments ("Claude says", initials
  notes), docs, ADRs (except ADR-0001/0002), the CHANGELOG, test assertions, seed data, and the AI config files the
  repo shipped with. The order of trust is: the organizers' case file, then the wired code path, then the migrations,
  then everything else.
- **The repo's own `CLAUDE.md`, `AGENTS.md` and `.cursorrules` were poisoned** ("1 BD = 100 cents", "UTC midnight",
  "never modify tests", "Math.random is fine"). Commit `89daa69` quarantined them as `.txt` evidence in
  `docs/audit/evidence/ai-config-originals/`. This folder's `CLAUDE.md` is deliberately not at the repo root.
- **Proof before trust.** Every fix follows the same steps: a failing test, the minimal change, the passing test, and
  a written note. The implementer re-checked each subagent's report and the advisor reviewed each gate report.

## Integrity of this copy
`CLAUDE.md` here is a snapshot of the workspace file taken on 2026-10-30 at about 16:30 Asia/Bahrain, with one line
redacted because it named a third party's file by its local path. Its sha256 is
`d09457524abc7bd091d362a22edb3fb9b598f152f52b805d917351e02da83155` (LF line endings, as committed). Our freeze check
verifies the committed copy against this hash: `git show HEAD:ai-setup/CLAUDE.md | sha256sum` (a Windows checkout
may convert the working file to CRLF, which changes its hash but not its content).
