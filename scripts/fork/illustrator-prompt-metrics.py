#!/usr/bin/env python3
"""custom-mods: read-only quality metrics for prompts sent to the image model.

Measures the patterns that make small edit models (FLUX.2 klein) fuse objects and duplicate limbs:
length, repeated style text, trait dumps, crowding, non-visual lines, motion verbs, unnamed extras and
sequence words. Reads chat_images through `mari` inside the running container; never writes.

    python3 scripts/fork/illustrator-prompt-metrics.py --since 2026-09-20
    python3 scripts/fork/illustrator-prompt-metrics.py --since 2026-10-03T00:00 --model klein --show 3
"""
import argparse
import json
import re
import statistics
import subprocess

CHECKS = {
    "style text repeated": lambda p: max(
        (len(re.findall(term, p, re.I)) for term in (r"cel[- ]shad", r"ink outline", r"line ?work|line art", r"flat colou?r")),
        default=0,
    )
    >= 2,
    "trait dump (>=3 body traits)": lambda p: len(re.findall(r"\b(hair|eyes|skin|scales|build|complexion)\b", p, re.I)) >= 3,
    "crowded (>=3 placed subjects)": lambda p: len(
        re.findall(
            r"\b(on the left|in the center|on the right|beside (?:him|her|them)|behind (?:him|her|them)|nearby|to (?:his|her|their) (?:left|right))\b",
            p,
            re.I,
        )
    )
    >= 3,
    "non-visual lines": lambda p: re.search(
        r"\b(atmosphere|tension|mood is|scent|smell|realization|feeling of|sense of|heavy with|thick with)\b", p, re.I
    ),
    "motion verbs": lambda p: re.search(
        r"\b(flicker\w*|gutter\w*|dancing|trembl\w*|heav(?:es|ing)|streak\w*|swirl\w*|billow\w*|rushing|spinning)\b", p, re.I
    ),
    "unnamed extras": lambda p: re.search(
        r"\b(guards?|soldiers?|crowd|figures|onlookers|bystanders|merchants|clerk|monk|servants?)\b", p, re.I
    ),
    "sequence words": lambda p: re.search(
        r"\b(then|while|before|after|as (?:she|he|they|it)|followed by|begins to|starts to|about to)\b", p, re.I
    ),
}


def load_images(container: str, since: str) -> list[dict]:
    where = f"row.createdAt >= '{since}'"
    out = subprocess.run(
        ["docker", "exec", container, "mari", "db", "select", "chat_images", "--where", where],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", required=True, help="ISO timestamp lower bound for chat_images.createdAt")
    parser.add_argument("--container", default="marinara")
    parser.add_argument("--model", default="", help="only images whose model contains this text")
    parser.add_argument("--show", type=int, default=0, help="print the N most recent prompts")
    args = parser.parse_args()

    rows = [r for r in load_images(args.container, args.since) if r.get("prompt") and args.model in (r.get("model") or "")]
    rows.sort(key=lambda r: r["createdAt"])
    prompts = [r["prompt"] for r in rows]
    if not prompts:
        print("no prompts found")
        return

    words = [len(p.split()) for p in prompts]
    print(f"{len(prompts)} prompts {rows[0]['createdAt']} .. {rows[-1]['createdAt']}")
    print(f"words: median {statistics.median(words)}, min {min(words)}, max {max(words)} (BFL guidance: < 100)")
    for name, check in CHECKS.items():
        print(f"{name}: {sum(1 for p in prompts if check(p))}/{len(prompts)}")
    for row in rows[-args.show :] if args.show else []:
        print(f"\n== {row['createdAt']} {row.get('model')} ({len(row['prompt'].split())} words)\n{row['prompt']}")


if __name__ == "__main__":
    main()
