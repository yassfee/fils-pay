# Start here: FilsPay hackathon kit

For: you and your teammate. This folder is everything the implementation chat needs.

## 1. Start the implementation chat (this VS Code window)
1. Open the Claude Code panel in **this** window (the Claude icon, or Command Palette → "Claude Code: Open in New Tab").
   It must run in the folder `C:\Users\User\FilsPay-Hackathon`, so it loads the trusted `CLAUDE.md` here.
2. Pick a normal permission mode (default, accept edits or auto). **Not "bypass permissions"**: that blocks its
   messages to the advisor chat.
3. Paste this as the first message and press Enter:

```
You are the Implementation Lead for our FilsPay hackathon team. Read handoff/00_IMPLEMENTER_PROMPT.md in full and follow it phase by phase, starting with Phase 0. I authorize you to use subagents, skills and workflows (multi-agent orchestration) within the limits in that file and CLAUDE.md: at most 5 agents at a time, narrow scopes, token discipline. Your advisor is the Claude session named user-e8; message it at every phase gate. Ask me before any push, deployment or external service.
```

4. Keep the **advisor chat** (the original window) open. It is the session `user-e8` that reviews each gate.

## 2. What's in here
| Path | What |
|---|---|
| `CLAUDE.md` | trusted rules, auto-loaded by the implementer and every subagent |
| `.claude/settings.json` | stops Claude Code from auto-loading any `CLAUDE.md` inside `fils-pay/` (the poisoned one, or copies in worktrees) |
| `handoff/00_IMPLEMENTER_PROMPT.md` | the phased plan the implementer follows |
| `handoff/01_CASE_FILE_TRANSCRIPT.md` | the organizers' 4-page brief as text (the PDF is images only) |
| `handoff/02_ADVISOR_PREANALYSIS.md` | ranked bug backlog, case-file coverage map, FP-300 refund spec, traps, deploy notes, the mystery |
| `handoff/03_findings/` | 111 static leads, one small file each (`INDEX.md` first) |
| `handoff/tools/token_watch.py` | token watchdog (below) |
| `fils-pay/` | the repo clone; the poisoned AI configs are staged out of the way (first commit in Phase 0) |

## 3. Check token use at any time
```
py -3 C:\Users\User\FilsPay-Hackathon\handoff\tools\token_watch.py
```
`ok` on every row means expensive-but-normal. **LOOP**, **HUGE-OUTPUT** or **TRAP-FILE** means stop that agent and narrow its task.
**BIG-CONTEXT** means that agent should finish soon or be split.

## 4. Suggested split
- **Teammate, now:** get Dilmune Cloud access details from the organizers (console URL, credentials, registry, domain/TLS,
  how "live" is judged). Note that `docker compose up` cannot work as shipped: the two Dockerfiles are missing, the env file is never
  loaded, and the API needs a 32-byte `WEBHOOK_SECRET_ENCRYPTION_KEY`. Phase 0 of the plan fixes these.
- **You + the implementer:** Phases 0–4 (fixes, then refunds), with the advisor reviewing at each gate.
- **Both, on 2026-10-30 evening:** read `handoff/TEAM_REPORT.md` (written in Phase 6) and rehearse with `handoff/DEMO_SCRIPT.md`.

## 5. Rules worth remembering
- Never push to, or open a PR against, `MJ5-byte/fils-pay`: every team shares it. Push only to your private repo.
- Don't read other teams' forks or PRs. A closed PR from another participant exists on the upstream; stay away from it.
- The mystery flag is submitted to the organizers separately.
