---
name: Cache check
description: Checking how well a chat's replies hit the prompt cache with chat.cacheReport — the hit rate against what the cache could have given, what was left out and why, and the settings the report names. Main replies only, not agents.
---

# Cache check

Purpose: tell the user how much of each reply's prompt came from the provider's prompt cache, with the real numbers, and relay the findings the report already worked out. This is a report: change nothing unless the user asks for a specific setting change.

Actions: reads `chat.cacheReport`. Agents (trackers and the like) record their own usage and are not in this report; say so if the user asks about them.

## Workflow

1. Call `chat.cacheReport` with `chatId` from `activeChat` (or the chat the user named). `last` sets how many recent replies to read, default 12, at most 50.
2. Lead with `overall["Hit of should-have"]`: the share of what the previous prompt held that the cache actually returned, over `overall["Counted replies"]`. This, not the raw `Cache hit`, is the number that says whether caching works. Then say what was left out (`overall["Left out"]`) in a short phrase.
3. Relay `findings` in order, in plain words, and quote two or three replies' numbers (post, prompt, cached) as evidence. Do not add causes the findings do not name, and do not guess a cache lifetime: the report states it when it knows it.

## Why the prompt breaks the cache

When the findings say no chat setting explains the misses, or the user asks "why isn't my preset cache-friendly", call `chat.cacheCompare` with `chatId` (and `presetId` to score another preset on the same chat). It assembles the chat's next prompt without calling a model and returns only numbers, never prompt text, for two pairs:

- `After a new turn is added`: the prompt as it stands vs with a made-up next message. Anything placed a few messages from the end, or built from the latest message, shows up here.
- `Between two different next messages`: anything that follows the wording of the new message.

Each pair gives `Would hit` (the share of the prompt identical before the first change) and `First change`: which message of how many, its role, how many messages from the end it sits, and its token size. A change far from the end means a dynamic section sits before Chat History; one near the end is usual. The estimate cannot see time macros or tracker and game state that change between real turns. Report the numbers and where the first change lands; do not name a preset section unless the user's preset text shows it, and re-run after any change to confirm it.

## Reading the report

Each reply row is `{post, model, "Prompt tokens", "Cached tokens", "Cache-written tokens", "Cache hit", "Minutes since previous reply", Status, "Should have hit"?, "Hit of should-have"?, requests?}`. Prompt tokens already include the cached part. `Status` is one of:

- `counted`: judged against the previous prompt. `Should have hit` is the most an append-only prompt could reuse.
- `cache expired between replies`, `model changed`, `swipe`, `first reply`: left out of the rate. A cache that lapsed or belongs to another model is not a fault, and a swipe re-sends the same prompt.

A row with `requests` made several model calls (tool use) and its token counts are the sum of all of them: compare its `Cache hit` only. `Cache-written tokens` null means the provider does not report writes; not a fault.

## Suggestions

Assume the user plays at the pace they like. Never suggest replying faster, slower, or switching models to fix the cache. Offer only settings that make that pace cheaper, and only the ones in `findings`. When `findings` is empty, the cache is working for this chat: say so.

## Empty or missing numbers

- `replies: []` means no reply in the chat has saved usage: imported chats, replies from before usage was recorded, and repaired swipes have none. Say so plainly.
- An empty chat returns `replies: []` too. A missing chat returns `No chat has the id "<id>". …`.
