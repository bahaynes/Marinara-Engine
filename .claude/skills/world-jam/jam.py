#!/usr/bin/env python3
"""World-jam helper: one cheap read of a chat's world, and safe exact-text edits.

  jam.py bundle  <chatId> [--last N]     write /tmp/jam/<chatId>/*.md, print a small index
  jam.py preview <chatId>                render the real prompt to prompt.md, print its outline
  jam.py edit <table> <id> <field> --old TEXT --new TEXT [--apply --reason R]
        field may be a dotted path into a JSON-string column, e.g. data.extensions.backstory

Reads go through `docker exec <container> mari` and the in-container API, so the
running engine's cache and writer lease stay authoritative. Edits are dry-run unless
--apply, and refuse unless --old occurs exactly once.
"""
import argparse
import json
import os
import re
import subprocess
import sys

CONTAINER = os.environ.get("JAM_CONTAINER", "marinara")
OUT = "/tmp/jam"


def mari(*args):
    r = subprocess.run(["docker", "exec", "-i", CONTAINER, "mari", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"mari {' '.join(args[:3])} failed: {r.stderr.strip() or r.stdout[:300]}")
    return json.loads(r.stdout)


def api(path, body=None):
    js = (
        'process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";'
        f"fetch('https://127.0.0.1:7860{path}',"
        + (f"{{method:'POST',headers:{{'content-type':'application/json'}},body:{json.dumps(json.dumps(body))}}}" if body is not None else "{}")
        + ").then(r=>r.text()).then(t=>process.stdout.write(t))"
    )
    r = subprocess.run(["docker", "exec", "-i", CONTAINER, "node", "-e", js], capture_output=True, text=True)
    return json.loads(r.stdout)


def loads(v, default=None):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return default if default is not None else v
    return v if v is not None else default


def block(title, fields):
    out = [f"## {title}"]
    for k, v in fields:
        if v not in (None, "", [], {}):
            out.append(f"### {k}\n{v}")
    return "\n\n".join(out) + "\n"


def bundle(chat_id, last):
    d = os.path.join(OUT, chat_id)
    os.makedirs(d, exist_ok=True)
    chat = mari("db", "get", "chats", chat_id)
    meta = loads(chat["metadata"], {})
    files = {}

    cards = []
    for cid in loads(chat["characterIds"], []):
        c = loads(mari("db", "get", "characters", cid)["data"], {})
        ext = c.get("extensions", {})
        cards.append(block(f"{c.get('name')} [characters {cid}]", [
            ("description", c.get("description")), ("personality", c.get("personality")),
            ("scenario", c.get("scenario")), ("extensions.backstory", ext.get("backstory")),
            ("extensions.appearance", ext.get("appearance")), ("post_history_instructions", c.get("post_history_instructions")),
            ("system_prompt", c.get("system_prompt")), ("first_mes", c.get("first_mes")),
            ("alternate_greetings", f"{len(c['alternate_greetings'])} alternates" if c.get("alternate_greetings") else None),
        ]))
    files["cards.md"] = "\n".join(cards)

    if chat.get("personaId"):
        p = mari("db", "get", "personas", chat["personaId"])
        files["persona.md"] = block(f"{p['name']} [personas {p['id']}]", [
            (k, p.get(k)) for k in ("description", "personality", "backstory", "appearance", "aboutMe")])

    # Lorebooks the chat can see: chat-activated, chat-scoped, global, and character/persona-linked.
    active = set(meta.get("activeLorebookIds") or [])
    chars = set(loads(chat["characterIds"], []))
    books = []
    for b in mari("db", "list", "lorebooks", "--limit", "5000"):
        scope = loads(b.get("scope"), {}) or {}
        if b.get("enabled") == "false":
            continue
        if (b["id"] in active or b.get("chatId") == chat_id or chat_id in (scope.get("chatIds") or [])
                or b.get("isGlobal") == "true" or b.get("characterId") in chars
                or (chat.get("personaId") and b.get("personaId") == chat["personaId"])):
            books.append(b)
    lore = []
    defaults = {"sticky": 0, "cooldown": 0, "delay": 0, "group": "", "probability": 100, "decisionMode": "off"}
    for b in books:
        lore.append(f"# {b['name']} [lorebooks {b['id']}]\n")
        entries = mari("db", "select", "lorebook_entries", "--where", f"row.lorebookId === '{b['id']}'")
        for e in sorted(entries, key=lambda e: e.get("order") or 0):
            flags = ["CONSTANT"] if e.get("constant") == "true" else []
            if e.get("enabled") == "false":
                flags.append("DISABLED")
            flags += [f"{k}={e[k]}" for k, dv in defaults.items() if e.get(k) not in (None, dv, str(dv))]
            keys = ", ".join(loads(e.get("keys"), []) or [])
            lore.append(f"## {e['name']} [lorebook_entries {e['id']}] {' '.join(flags)}\nkeys: {keys}\n\n{e.get('content', '')}\n")
    files["lore.md"] = "\n".join(lore)

    preset_id = chat.get("promptPresetId")
    if preset_id:
        p = mari("db", "get", "prompt_presets", preset_id)
        chosen = meta.get("presetChoices") or {}
        out = [f"# {p['name']} [prompt_presets {preset_id}]\n"]
        for sid in loads(p["sectionOrder"], []):
            s = mari("db", "get", "prompt_sections", sid)
            where = f"depth {s.get('injectionDepth')}" if s.get("injectionPosition") == "depth" else "ordered"
            if s.get("isMarker") == "true":
                out.append(f"## {s['name']} [marker {loads(s.get('markerConfig'), {}).get('type')}; {where}]")
            else:
                out.append(f"## {s['name']} [prompt_sections {sid}; {where}; enabled={s.get('enabled')}]\n{s.get('content', '')}\n")
        for cb in sorted(mari("db", "select", "choice_blocks", "--where", f"row.presetId === '{preset_id}'"), key=lambda c: c.get("sortOrder", 0)):
            opts = loads(cb["options"], [])
            pick = next((o["label"] for o in opts if o["value"] == chosen.get(cb["variableName"])), f"(default: {opts[0]['label'] if opts else '-'})")
            out.append(f"- choice {{{{{cb['variableName']}}}}} = {pick}   options: {', '.join(o['label'] for o in opts)}")
        files["preset.md"] = "\n".join(out) + "\n"

    msgs = mari("chats", "messages", chat_id, "--last", str(last))
    files["messages.md"] = "\n".join(f"#{m['postNumber']} {m['role']}:\n{m['content']}\n" for m in msgs)

    scan = api(f"/api/lorebooks/scan/{chat_id}")
    files["active.md"] = f"Entries active now ({scan.get('totalTokens')} tokens):\n" + "\n".join(
        f"- {e['name']} [{e['id']}]" for e in scan.get("entries", []))

    files["chat.md"] = "\n".join([
        f"# {chat['name']} [chats {chat_id}] mode={chat['mode']}",
        f"connection={chat.get('connectionId')} preset={preset_id} persona={chat.get('personaId')}",
        f"agents: {', '.join(meta.get('activeAgentIds') or [])}",
        f"roleplay commands: {json.dumps(meta.get('roleplayCommandToggles'))}",
        f"advanced memory: {json.dumps({k: (meta.get('advancedMemory') or {}).get(k) for k in ('enabled', 'decisionEnabled', 'sceneCheckInterval')})}",
        f"context: last {meta.get('contextMessageLimit')} msgs; macro vars: {json.dumps(meta.get('macroVariables') or {})}",
    ]) + "\n"

    for name, text in files.items():
        with open(os.path.join(d, name), "w") as f:
            f.write(text)
    print(f"bundle: {d}")
    for name, text in files.items():
        heads = [l[3:].split(" [")[0] for l in text.splitlines() if l.startswith("## ")]
        print(f"  {name:12} {len(text):>7} chars  {'; '.join(heads)[:160]}")


def preview(chat_id):
    chat = mari("db", "get", "chats", chat_id)
    data = api(f"/api/prompts/{chat['promptPresetId']}/preview", {"chatId": chat_id})
    msgs = data.get("messages") or sys.exit(f"no preview: {str(data)[:300]}")
    path = os.path.join(OUT, chat_id, "prompt.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("\n".join(f"===== [{i}] {m['role']}\n{m['content']}" for i, m in enumerate(msgs)))
    print(f"prompt: {path}  ({sum(len(m['content']) for m in msgs)} chars, {len(msgs)} messages)")
    for i, m in enumerate(msgs):
        tags = re.findall(r"^<([a-z_]+)>", m["content"], re.M)
        print(f"  [{i}] {m['role']:9} {len(m['content']):>6}  {' '.join(tags)[:150]}")
    left = re.findall(r"\{\{[^}]+\}\}", "\n".join(m["content"] for m in msgs))
    if left:
        print(f"  unresolved macros: {sorted(set(left))}")


def edit(table, row_id, field, old, new, apply, reason):
    row = mari("db", "get", table, row_id)
    top, *path = field.split(".")
    holder = loads(row[top], {}) if path else row
    target = holder
    for k in path[:-1]:
        target = target[k]
    key = path[-1] if path else top
    text = target[key]
    n = text.count(old)
    if n != 1:
        sys.exit(f"--old occurs {n} times in {table} {row_id} {field}; make it unique")
    target[key] = text.replace(old, new)
    value = (json.dumps(holder, ensure_ascii=False) if isinstance(row[top], str) else holder) if path else target[key]
    args = ["db", "patch", table, row_id, "--json", json.dumps({top: value}, ensure_ascii=False)]
    if apply:
        args += ["--apply", "--reason", reason or f"jam edit {field}"]
    res = mari(*args)
    print(f"{res.get('status')}: {table} {row_id} {field}\n- {old}\n+ {new}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bundle"); b.add_argument("chat"); b.add_argument("--last", type=int, default=12)
    p = sub.add_parser("preview"); p.add_argument("chat")
    e = sub.add_parser("edit")
    for a in ("table", "id", "field"):
        e.add_argument(a)
    e.add_argument("--old", required=True); e.add_argument("--new", required=True)
    e.add_argument("--apply", action="store_true"); e.add_argument("--reason")
    a = ap.parse_args()
    if a.cmd == "bundle":
        bundle(a.chat, a.last)
    elif a.cmd == "preview":
        preview(a.chat)
    else:
        edit(a.table, a.id, a.field, a.old, a.new, a.apply, a.reason)


if __name__ == "__main__":
    main()
