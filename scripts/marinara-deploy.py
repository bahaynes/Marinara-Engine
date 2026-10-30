#!/usr/bin/env python3
"""Fork-only host tooling: deploy a custom-mods commit to Ben's `marinara` instance without cutting off a turn.

  marinara-deploy.py idle
      Prints {"idle": bool, "reason": str}: whether restarting a container now would cut off a generation.
  marinara-deploy.py deploy [REF] [--tree DIR] [--wait-minutes N | --until HH:MM] [--retry-seconds N]
                            [--allow-untested]
      Builds marinara-engine:nightly from a clean worktree of REF (default custom-mods), waits until both
      instances and llama-backend are idle, keeps the running image as :nightly-prev, recreates marinara, and
      rolls back if /api/health doesn't report REF. --tree builds an existing clean checkout instead.

Refuses: a tree that never passed `pnpm check` + `pnpm regression` (the pre-push hook and the nightly record
passing trees in ~/.cache/marinara-rebase/validated-trees), a storage-format change (one-way; back up and
deploy by hand), and a second deploy while one runs. Erin's marinara-wife is never deployed from here.
The waits are flags because nobody has settled on numbers; the defaults are guesses.
"""
import argparse, datetime, fcntl, json, os, subprocess, sys, tempfile, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPOSE_DIR = os.environ.get("MARINARA_COMPOSE_DIR", "/home/bah/git/minecraftdocker/marinara")
CACHE = os.path.expanduser("~/.cache")
VALIDATED = f"{CACHE}/marinara-rebase/validated-trees"
LOCK = f"{CACHE}/marinara-deploy.lock"
IMAGE = "marinara-engine:nightly"
RECENT_CHATS = 10  # a turn bumps its chat's updatedAt, so a running generation is in the newest few
# (container, in-container URL): marinara serves https, marinara-wife plain http.
INSTANCES = [("marinara", "https://localhost:7860"), ("marinara-wife", "http://localhost:7860")]
STATUS_JS = (
    "const [base, ...ids] = process.argv.slice(1);"
    "const h = { 'x-admin-secret': process.env.ADMIN_SECRET || '' };"
    "(async () => { for (const id of ids) { const r = await fetch(`${base}/api/generate/status/${id}`, { headers: h });"
    "console.log(JSON.stringify({ id, status: r.status, body: r.ok ? await r.json() : null })); } })()"
    ".catch((e) => { console.log(JSON.stringify({ error: String(e) })); });")
HEALTH_JS = (
    "fetch(`${process.argv[1]}/api/health`, { headers: { 'x-admin-secret': process.env.ADMIN_SECRET || '' } })"
    ".then((r) => r.json()).then((j) => console.log(JSON.stringify(j))).catch((e) => console.log(String(e)));")
# llama-backend's /slots needs its API key, which only the container's own command line knows.
SLOTS_SH = ('k=$(tr "\\0" "\\n" < /proc/1/cmdline | grep -A1 -- "^--api-key" | tail -1); '
            '[ "${k#@}" != "$k" ] && k=$(cat "${k#@}" 2>/dev/null); '
            'curl -s -m 5 -H "Authorization: Bearer $k" localhost:8082/slots')


def say(text):
    print(f"{datetime.datetime.now():%H:%M:%S} {text}", flush=True)


def docker(*args, timeout=600):
    r = subprocess.run(["docker", *args], cwd=COMPOSE_DIR, capture_output=True, text=True, timeout=timeout)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def node_in(container, js, *args):
    ok, text = docker("exec", "-e", "NODE_TLS_REJECT_UNAUTHORIZED=0", "-e", "NODE_NO_WARNINGS=1", container, "node", "-e", js, *args, timeout=60)
    return text if ok else ""


def busy_reason():
    """Why a restart now could cut off a generation, or "" when both instances and the backend are idle."""
    for container, base in INSTANCES:
        ok, text = docker("exec", container, "mari", "chats", "list", "--limit", str(RECENT_CHATS), timeout=60)
        try:
            ids = [c["id"] for c in json.loads(text)]
        except Exception:
            return f"{container}: could not list chats"
        for line in node_in(container, STATUS_JS, base, *ids).splitlines() or ["{}"]:
            st = json.loads(line)
            body = st.get("body") or {}
            if st.get("status") != 200:
                return f"{container}: generation status unreadable ({line[:120]})"
            if body.get("active") or body.get("translating"):
                return f"{container}: chat {st['id']} is generating"
    ok, text = docker("exec", "llama-backend", "sh", "-c", SLOTS_SH, timeout=30)
    try:
        if any(slot.get("is_processing") for slot in json.loads(text)):
            return "llama-backend: a slot is processing"
    except Exception:
        return "llama-backend: slots unreadable"
    return ""


def healthy(commit):
    """The recreated marinara answers /api/health with the commit just built, after 3 minutes at most."""
    deadline = time.time() + 180
    while time.time() < deadline:
        time.sleep(10)
        try:
            health = json.loads(node_in("marinara", HEALTH_JS, INSTANCES[0][1]) or "{}")
        except ValueError:
            continue
        if health.get("status") == "ok":
            return str(health.get("commit") or "").startswith(commit)
    return False


def deploy(tree, commit, deadline, retry_seconds, allow_untested):
    """Builds `tree` (a clean checkout of `commit`) and deploys it to marinara. Returns one line for the report."""
    if datetime.datetime.now() > deadline:  # the nightly's cutoff keeps it clear of the 04:00 reboot
        return f"NOT DEPLOYED: already past {deadline:%H:%M}"
    validated = open(VALIDATED).read().split() if os.path.exists(VALIDATED) else []
    if not allow_untested and git("rev-parse", "HEAD^{tree}", cwd=tree) not in validated:
        return f"NOT DEPLOYED: {commit} never passed check + regression; push it (the pre-push hook runs them) first"
    want = json.load(open(f"{tree}/storage-format.json"))["storageFormat"]
    ok, text = docker("exec", "marinara", "cat", "/app/data/storage/manifest.json", timeout=30)
    have = json.loads(text).get("version") if ok else None
    if have != want:
        return f"NOT DEPLOYED: storage format {have} -> {want}; back up the data directory and deploy by hand"
    say(f"building {IMAGE}-candidate from {commit}")
    ok, text = docker("build", "-q", "--build-arg", "BUILD_BRANCH=staging", "--build-arg", f"BUILD_COMMIT={commit}",
                      "-t", f"{IMAGE}-candidate", tree, timeout=3600)
    if not ok:
        return f"NOT DEPLOYED: image build failed: {text[-400:]}"
    while (reason := busy_reason()):
        if datetime.datetime.now() + datetime.timedelta(seconds=retry_seconds) > deadline:
            return f"NOT DEPLOYED: still busy at {deadline:%H:%M} ({reason}); {IMAGE}-candidate is built"
        say(f"waiting: {reason}")
        time.sleep(retry_seconds)
    # Checked idle just above; the recreate follows within seconds (the compose build only copies ffmpeg in).
    ok, text = docker("tag", IMAGE, f"{IMAGE}-prev")
    if not ok:  # e.g. pruned; without it a failed health check would have nothing to roll back to
        return f"NOT DEPLOYED: no {IMAGE} to keep as the rollback image ({text[-200:]})"
    docker("tag", f"{IMAGE}-candidate", IMAGE)
    say("recreating marinara")
    ok, text = docker("compose", "up", "-d", "--build", "--force-recreate", "marinara", timeout=900)
    if ok and healthy(commit):
        return f"DEPLOYED {commit} to marinara"
    docker("tag", f"{IMAGE}-prev", IMAGE)
    ok2, text2 = docker("compose", "up", "-d", "--build", "--force-recreate", "marinara", timeout=900)
    return (f"ROLLED BACK: {commit} did not come up healthy ({text[-300:]}); "
            + ("marinara is back on the previous image" if ok2 else f"ROLLBACK FAILED TOO: {text2[-300:]}"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("idle")
    dep = sub.add_parser("deploy")
    dep.add_argument("ref", nargs="?", default="custom-mods")
    dep.add_argument("--tree", help="build this clean checkout instead of a fresh worktree of REF")
    dep.add_argument("--wait-minutes", type=float, default=30)
    dep.add_argument("--until", help="give up waiting for idle at this local time (HH:MM); overrides --wait-minutes")
    dep.add_argument("--retry-seconds", type=int, default=60)
    dep.add_argument("--allow-untested", action="store_true")
    args = parser.parse_args()

    if args.cmd == "idle":
        reason = busy_reason()
        print(json.dumps({"idle": not reason, "reason": reason}))
        return 0

    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        say("NOT DEPLOYED: another deploy is running")
        return 1
    now = datetime.datetime.now()
    if args.until:
        deadline = datetime.datetime.combine(now.date(), datetime.time.fromisoformat(args.until))
    else:
        deadline = now + datetime.timedelta(minutes=args.wait_minutes)
    if args.tree:
        tree = args.tree
        if git("status", "--porcelain", "--untracked-files=no", cwd=tree):
            say(f"NOT DEPLOYED: {tree} has uncommitted changes")
            return 1
        commit = git("rev-parse", "--short", "HEAD", cwd=tree)
        result = deploy(tree, commit, deadline, args.retry_seconds, args.allow_untested)
    else:
        commit = git("rev-parse", "--short", f"{args.ref}^{{commit}}")
        tree = tempfile.mkdtemp(prefix="marinara-deploy-")
        git("worktree", "add", "--detach", tree, commit)
        try:
            result = deploy(tree, commit, deadline, args.retry_seconds, args.allow_untested)
        finally:
            git("worktree", "remove", "--force", tree)
    say(result)
    return 0 if result.startswith("DEPLOYED") else 1


if __name__ == "__main__":
    sys.exit(main())
