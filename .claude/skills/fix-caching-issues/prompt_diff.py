#!/usr/bin/env python3
"""Find where a chat's prompt stopped matching the previous request (the prompt-cache break point).

Reads the final prompts Marinara stored on replies and swipes (`extra.cachedPrompt`; the engine keeps
it on the last 2 assistant messages and their swipes only), orders them by time, and compares the
newest two (or the pair you name). Read-only; spends no model quota.

    python3 prompt_diff.py --chat <chatId> [--container marinara]
    python3 prompt_diff.py --chat <chatId> --list            # every stored prompt, with usage
    python3 prompt_diff.py --chat <chatId> --pair 0 2        # compare entries 0 and 2 from --list

System messages are kept: on OpenAI-compatible providers they are part of the cached prefix
(engine-inserted blocks get merged into the first system message).
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys

HEADER = re.compile(r"^(<[A-Za-z_][^>\n]{0,60}>|#+ .{0,60}|--- .{0,40} ---|\[[^\]\n]{1,50}\])\s*$", re.M)


def mari(container, *args):
    out = subprocess.run(["docker", "exec", "-i", container, "mari", *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(out.stderr.strip() or out.stdout.strip() or f"mari {' '.join(args)} failed")
    return json.loads(out.stdout)


def extra(row):
    e = row.get("extra")
    return json.loads(e) if isinstance(e, str) else (e or {})


def text(message):
    c = message.get("content")
    return c if isinstance(c, str) else json.dumps(c)


def stored_prompts(container, chat):
    msgs = mari(container, "db", "select", "messages", "--where", f"row.chatId==={json.dumps(chat)} && row.role==='assistant'")
    ids = [m["id"] for m in msgs if extra(m).get("cachedPrompt")]
    entries = [(m["createdAt"], m["id"], "-", extra(m)) for m in msgs if extra(m).get("cachedPrompt")]
    if ids:
        where = " || ".join(f"row.messageId==={json.dumps(i)}" for i in ids)
        for s in mari(container, "db", "select", "message_swipes", "--where", where):
            if extra(s).get("cachedPrompt"):
                entries.append((s["createdAt"], s["messageId"], s.get("index"), extra(s)))
    # A message row mirrors its active swipe; keep one copy of each identical (time, prompt).
    seen, unique = set(), []
    for e in sorted(entries, key=lambda e: e[0]):
        key = (e[0], hashlib.sha1(json.dumps(e[3]["cachedPrompt"]).encode()).hexdigest())
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def usage(e):
    g = e[3].get("generationInfo") or {}
    return f"{g.get('provider')} {g.get('model')} prompt={g.get('tokensPrompt')} hit={g.get('tokensCachedPrompt')} write={g.get('tokensCacheWritePrompt')}"


def layout(prompt):
    rows = []
    for i, m in enumerate(prompt):
        t = text(m)
        rows.append(f"  #{i:<3} {m['role']:<9} {len(t):>7} chars  {hashlib.sha1(t.encode()).hexdigest()[:8]}")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chat", required=True)
    ap.add_argument("--container", default="marinara")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pair", nargs=2, type=int, metavar=("OLD", "NEW"))
    args = ap.parse_args()

    entries = stored_prompts(args.container, args.chat)
    if args.list or len(entries) < 2:
        for i, e in enumerate(entries):
            print(f"[{i}] {e[0]} msg={e[1]} swipe={e[2]} msgs={len(e[3]['cachedPrompt'])} {usage(e)}")
        if len(entries) < 2:
            sys.exit("Need two stored prompts; generate another reply (or swipe) first.")
        return

    old, new = (entries[args.pair[0]], entries[args.pair[1]]) if args.pair else (entries[-2], entries[-1])
    a, b = old[3]["cachedPrompt"], new[3]["cachedPrompt"]
    print(f"OLD {old[0]} msg={old[1]} swipe={old[2]} {usage(old)}")
    print(f"NEW {new[0]} msg={new[1]} swipe={new[2]} {usage(new)}")

    # Walk message by message; the first message whose role or text differs holds the break.
    for i in range(min(len(a), len(b))):
        ta, tb = text(a[i]), text(b[i])
        if a[i]["role"] == b[i]["role"] and ta == tb:
            continue
        k = next((k for k in range(min(len(ta), len(tb))) if ta[k] != tb[k]), min(len(ta), len(tb)))
        before = sum(len(text(m)) for m in b[:i]) + k
        total = sum(len(text(m)) for m in b)
        tokens = (new[3].get("generationInfo") or {}).get("tokensPrompt")
        est = f" (~{int(before * tokens / total)} tokens)" if tokens and total else ""
        headers = [h for h in HEADER.finditer(tb) if h.start() <= k]
        print(f"\nFirst difference: message #{i} ({b[i]['role']}), char {k} of it; char {before} of the prompt{est}")
        print(f"Nearest header above it: {headers[-1].group(1) if headers else '(none)'}")
        print(f"OLD: {ta[max(0, k - 120):k + 160]!r}")
        print(f"NEW: {tb[max(0, k - 120):k + 160]!r}")
        break
    else:
        print("\nNo difference across the shared messages: the old prompt is a prefix of the new one (append-only).")

    print("\nOLD layout:", *layout(a), sep="\n")
    print("NEW layout:", *layout(b), sep="\n")


if __name__ == "__main__":
    main()
