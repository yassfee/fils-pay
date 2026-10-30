"""Token watchdog for Claude Code sessions (stdlib only, read-only).

Flags the patterns that actually waste tokens, so "is this abnormal?" has an answer:
  LOOP         the same tool call (same tool + same input) repeated 3+ times by one agent
  HUGE-OUTPUT  a single tool result over 60,000 characters (~15k tokens) entered the context
  TRAP-FILE    a call touched a known token-trap file in a full-read way
  BIG-CONTEXT  the agent re-sends more than 300k tokens of context on every turn
  LONG-RUN     more than 150 turns for a single agent

Usage (PowerShell or Git Bash):
  py -3 token_watch.py                      # newest FilsPay-Hackathon session
  py -3 token_watch.py <session dir or .jsonl file or folder of transcripts>
"""
import glob
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

PROJECTS = os.path.join(os.path.expanduser("~"), ".claude", "projects")
TRAPS = ("production_seed.sql", "package-lock.json", "docs/exports/", "docs\\exports\\")
SAFE_VERBS = ("grep", "head", "tail", "wc", "ls", "awk", "rg ", "sed -n")


def newest_session():
    dirs = [d for d in glob.glob(os.path.join(PROJECTS, "*FilsPay-Hackathon*")) if os.path.isdir(d)]
    files = [f for d in dirs for f in glob.glob(os.path.join(d, "*.jsonl"))]
    if not files:
        sys.exit("No FilsPay-Hackathon session transcripts found under " + PROJECTS)
    main = max(files, key=os.path.getmtime)
    return main, main[:-6]  # <session>.jsonl and its <session>/ folder (subagents live there)


def transcripts(target):
    if target is None:
        main, folder = newest_session()
        return [main] + glob.glob(os.path.join(folder, "**", "*.jsonl"), recursive=True)
    if os.path.isfile(target):
        folder = target[:-6]
        return [target] + glob.glob(os.path.join(folder, "**", "*.jsonl"), recursive=True)
    return glob.glob(os.path.join(target, "**", "*.jsonl"), recursive=True)


def label_for(path):
    meta = path[:-6] + ".meta.json"
    if os.path.exists(meta):
        try:
            return json.load(open(meta, encoding="utf-8")).get("description") or os.path.basename(path)
        except ValueError:
            pass
    return "MAIN SESSION" if os.sep + "subagents" + os.sep not in path else os.path.basename(path)


def analyse(path):
    seen, sigs, names = set(), defaultdict(set), {}
    r = {"turns": 0, "cache_read": 0, "ctx": 0, "max_out": 0, "max_call": "", "trap": [], "first": None, "last": None}
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        stamp = obj.get("timestamp")
        if stamp:
            try:
                t = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                r["first"] = r["first"] or t
                r["last"] = t
            except ValueError:
                pass
        msg = obj.get("message")
        if not isinstance(msg, dict):
            continue
        usage, mid = msg.get("usage"), msg.get("id")
        if usage and not (mid and mid in seen):
            if mid:
                seen.add(mid)
            r["turns"] += 1
            cr = usage.get("cache_read_input_tokens", 0) or 0
            r["cache_read"] += cr
            r["ctx"] = cr + (usage.get("cache_creation_input_tokens", 0) or 0) + (usage.get("input_tokens", 0) or 0)
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                inp = b.get("input") or {}
                key = json.dumps(inp, sort_keys=True)
                sigs[(b.get("name"), key)].add(b.get("id"))
                what = str(inp.get("file_path") or inp.get("command") or inp.get("pattern") or "")
                names[b.get("id")] = f"{b.get('name')}: {what[-80:]}"
                if any(t in what for t in TRAPS):
                    full_read = b.get("name") == "Read" or not any(v in what for v in SAFE_VERBS)
                    if full_read:
                        r["trap"].append(names[b.get("id")])
            elif b.get("type") == "tool_result":
                c = b.get("content")
                n = len(c if isinstance(c, str) else json.dumps(c))
                if n > r["max_out"]:
                    r["max_out"], r["max_call"] = n, names.get(b.get("tool_use_id"), "?")
    r["repeats"] = sorted(((len(v), k[0]) for k, v in sigs.items() if len(v) >= 3), reverse=True)
    r["calls"] = sum(len(v) for v in sigs.values())
    return r


def main():
    files = transcripts(sys.argv[1] if len(sys.argv) > 1 else None)
    total_cr, first, last, alerts = 0, None, None, 0
    print(f"{'agent':38s} {'turns':>5s} {'calls':>5s} {'ctx/turn':>9s} {'cache-read':>12s} {'biggest-out':>11s}  flags")
    for path in sorted(files):
        if path.endswith("journal.jsonl"):
            continue
        r = analyse(path)
        if r["turns"] == 0:
            continue
        flags = []
        if r["repeats"]:
            flags.append("LOOP(" + ", ".join(f"{n}x {name}" for n, name in r["repeats"][:2]) + ")")
        if r["max_out"] > 60_000:
            flags.append(f"HUGE-OUTPUT({r['max_call']})")
        if r["trap"]:
            flags.append(f"TRAP-FILE({r['trap'][0]})")
        if r["ctx"] > 300_000:
            flags.append("BIG-CONTEXT")
        if r["turns"] > 150:
            flags.append("LONG-RUN")
        alerts += bool(flags)
        total_cr += r["cache_read"]
        if r["first"]:
            first = min(first, r["first"]) if first else r["first"]
            last = max(last, r["last"]) if last else r["last"]
        print(f"{label_for(path)[:38]:38s} {r['turns']:5d} {r['calls']:5d} {r['ctx']:9,d} {r['cache_read']:12,d} {r['max_out']:11,d}  {' '.join(flags) or 'ok'}")
    mins = (last - first).total_seconds() / 60 if first and last else 0
    rate = total_cr / mins / 1e6 if mins else 0
    print(f"\nTotal cache-read {total_cr:,} tokens over {mins:.0f} min ({rate:.1f}M/min). Agents with flags: {alerts}.")
    print("Reading: 'ok' everywhere = expensive-but-normal. Any LOOP / HUGE-OUTPUT / TRAP-FILE = stop that agent and narrow its task.")


if __name__ == "__main__":
    main()
