#!/usr/bin/env python3
"""Fork-only: compare each agent's stored output before and after a model swap. Read-only.

    python3 scripts/agent-model-audit.py 2026-11-05T03:00 [--since 2026-10-20] [--instance marinara-wife ...]

For each agent: runs, failures, empty results, tokens, time, and how often each result key appears, is null or is
empty. A key that collapses after the swap is where to look first. It sees output shape only, not quality, and an
agent with no runs after the swap has not been tested at all.
"""
import argparse
import collections
import glob
import json
import os

ROOT = "/mnt/faststorage/{}/data/storage/tables/"


def load_rows(tables, name):
    rows = []
    for path in glob.glob(f"{tables}{name}/*.json") + glob.glob(f"{tables}{name}.json"):
        try:
            data = json.load(open(path))
        except (OSError, ValueError):
            continue
        if isinstance(data, list):
            rows += data
    return rows


def audit(instance, swap, since):
    tables = ROOT.format(instance)
    configs = {row["id"]: row for row in load_rows(tables, "agent_configs")}
    connections = {row["id"]: row for row in load_rows(tables, "api_connections")}
    agents = collections.defaultdict(lambda: {"before": collections.Counter(), "after": collections.Counter(),
                                              "before_keys": collections.Counter(), "after_keys": collections.Counter()})
    for run in load_rows(tables, "agent_runs"):
        if run.get("createdAt", "") < since:
            continue
        era = "before" if run["createdAt"] < swap else "after"
        agent = agents[run["agentConfigId"]]
        agent[era]["runs"] += 1
        if str(run.get("success")) != "true":
            agent[era]["failed"] += 1
            continue
        agent[era]["tokens"] += int(run.get("tokensUsed") or 0)
        agent[era]["ms"] += int(run.get("durationMs") or 0)
        try:
            result = json.loads(run.get("resultData") or "null")
        except ValueError:
            agent[era]["not_json"] += 1
            continue
        if result in (None, {}, []):
            agent[era]["empty"] += 1
        elif isinstance(result, dict):
            for key, value in result.items():
                suffix = "=null" if value is None else "=empty" if value in ("", [], {}) else ""
                agent[era + "_keys"][key + suffix] += 1
    print(f"===== {instance}: swap {swap}, since {since}")
    for agent_id, agent in sorted(agents.items(), key=lambda item: -item[1]["after"]["runs"]):
        config = configs.get(agent_id, {})
        connection = connections.get(config.get("connectionId"), {})
        print(f"\n{config.get('type', agent_id)} [{connection.get('name', '-')}]")
        for era in ("before", "after"):
            counts = agent[era]
            done = max(1, counts["runs"] - counts["failed"])
            print(f"  {era:6} runs={counts['runs']} failed={counts['failed']} empty={counts['empty']} "
                  f"not_json={counts['not_json']} tokens={counts['tokens'] // done} ms={counts['ms'] // done}")
            keys = agent[era + "_keys"].most_common(14)
            if keys:
                print("        " + " ".join(f"{key}:{round(100 * value / done)}%" for key, value in keys))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("swap", help="UTC time of the swap, e.g. 2026-11-05T03:00")
    parser.add_argument("--since", default="", help="ignore runs older than this")
    parser.add_argument("--instance", action="append", help="default: both instances")
    args = parser.parse_args()
    for instance in args.instance or ["marinara-wife", "marinara"]:
        if os.path.isdir(ROOT.format(instance)):
            audit(instance, args.swap, args.since)
        else:
            print(f"===== {instance}: no storage at {ROOT.format(instance)}")


if __name__ == "__main__":
    main()
