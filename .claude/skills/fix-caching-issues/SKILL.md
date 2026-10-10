---
name: fix-caching-issues
description: Diagnose why a Marinara chat or agent gets few or no prompt-cache hits (any provider - Claude subscription/API, NanoGPT, OpenRouter, GLM, ...). Use when the user asks why caching fails, why "cache hit" is low, why a turn was expensive or slow, or wants caching fixed. Measures first (stored usage + a diff of consecutive stored prompts), then maps the break point to a known breaker and a config-first fix.
---

# Fix prompt-cache issues

Every provider's cache (Anthropic markers, OpenRouter, NanoGPT, GLM/DeepSeek implicit caching) only
reuses an **identical prefix**. A hit of N tokens means the request matched the previous one for
about N tokens and then changed. So the job is always: find what changed at token ~N, and move or
stabilize it. Do not theorize from code first; two past sessions guessed wrong (the "provider sends no
cache flag" and "it's the tracker agent" theories) before looking at the data.

Pairs with `manage-marinara` (the `mari` CLI, instances). Default instance is `marinara`; touch
`marinara-wife` only when the user means Erin's.

## 1. Identify the call (from data, not from guessing)

The `model · P→C tok · cache hit N · Ts` line under a reply is the **main generation** of that reply
(`packages/client/src/components/chat/ChatMessage.tsx`, `extra.generationInfo`), not an agent call.
Find the chat: the user's most recent chat on that connection is usually it.

```bash
docker exec -i marinara mari db select api_connections --where "row.provider==='nanogpt'"   # connection id, model, enableCaching
docker exec -i marinara mari db select chats --where "row.connectionId==='<connId>'"         # mode, promptPresetId, updatedAt
```

Agent calls (trackers etc.) record their own usage in `agent_runs`, not on the reply. An agent with
`connectionId: None` uses the chat's connection.

## 2. Per-turn numbers

```bash
python3 ~/git/minecraftdocker/marinara/tests/experiments/chat_cache_report.py --container marinara --chat <chatId> --last 12
```

Read each turn against the previous one (`prompt` = previous prompt tokens):

| Pattern | Meaning |
|---|---|
| hit ≈ prev prompt − (last exchange + tail) | Healthy, append-only. |
| hit flat at the same ~N every fresh turn | Something at ~N changes every turn. Go to step 3. |
| hit ≈ whole prompt, bigger than prev prompt | A swipe/regenerate re-sent an identical prompt (`activeSwipeIndex` > 0). Proves the cache works; not a breaker. |
| hit 0 after a gap | TTL expiry, or (NanoGPT) routed to another upstream provider. Check the gap before blaming the prompt. |
| hit 0 / null always | The provider isn't caching at all; see step 5. |

## 3. Find the break point

```bash
python3 .claude/skills/fix-caching-issues/prompt_diff.py --chat <chatId>          # newest two stored prompts
python3 .claude/skills/fix-caching-issues/prompt_diff.py --chat <chatId> --list   # what's available
```

It prints the first differing message and char offset, an estimated token position (compare it to
the hit), the nearest section header, and both snippets. Limits: the engine keeps `extra.cachedPrompt`
only on the **last 2 assistant messages** (and their swipes), so you get at most a few prompts. If you
need more, have the user send one more turn and rerun. System messages are kept on purpose: on
OpenAI-compatible providers engine-inserted system blocks merge into the first system message, which
is exactly where the worked example below broke. (The "drop system messages" advice in the Claude
cache doc applies to the Claude CLI passthrough only.)

## 4. Known breakers

| Breaker | Where | Fix (config first) |
|---|---|---|
| Plain **memory recall** (`The following are recalled fragments...`, `--- Memory N ---`) | `injectMemoryRecallContext` (`services/generation/memory-recall-context.ts`) splices it **before the first history message**, i.e. at the end of the system prefix. Query = latest user message, so it changes every turn and kills caching of all history. **On by default for scene chats and conversation mode** (`generate.routes.ts`, `memoryRecallDefault`). | Chat setting: turn memory recall off (`metadata.enableMemoryRecall: false`), or use Advanced Memory (plain recall is skipped when it's on) with a preset whose Recalled Scenes marker sits after Chat History; verify with a diff that AM's block lands there. Conversation mode: place the `{{memories}}` slot in the preset. |
| Cross-chat awareness block | Same splice point (`convoAwarenessBlock`, `generate.routes.ts`) | Usually stable; check if diff lands there. |
| Author's note / post-history sections at depth > 0 | Merged into the message N from the end, moves every turn | Depth 0. |
| Lorebook / volatile preset markers before Chat History | Preset section order | Move after Chat History. |
| Sliding context window (`contextMessageLimit` at cap, AM `open-scene-prefix-excerpts`) | Oldest message drops every turn | Cut in chunks (grow-then-trim), not per turn. |
| Agents: `<current_game_state>` in the system message, plus each agent's sliding `contextSize` window | `buildAgentExtras` / `buildAgentMessages` (`services/agents/agent-executor.ts`) | Agent prompts cache only their static head (role + lore + template); accept or fix in code. |

## 5. Provider facts

| Fact | Status |
|---|---|
| The connection's `enableCaching` only does something on the **Anthropic** provider and **OpenRouter** (`openai.provider.ts` `applyOpenRouterPromptCaching`). | Code |
| NanoGPT **GLM 5.2** caches implicitly with nothing set (hits of 4.6k-13.9k seen 2026-10-10). | Observed |
| NanoGPT can route to a different upstream between turns; a full hit 0 after a 4-min gap was seen on GLM 5.2. Its `stickyProvider: true` (body `prompt_caching`) trades failover for cache locality. Marinara does not send it. | Observed / documented |
| NanoGPT **Claude** models need the `prompt_caching` body field or inline `cache_control`; Marinara sends neither. | Documented (docs.nano-gpt.com, prompt-caching) |
| Claude subscription / CLI passthrough: whole-block matching, markers, TTL, cost model. | `~/git/minecraftdocker/docs/llm/claude-cli-cache-matches-whole-blocks-not-prefixes.md` |

## 6. Fix order

1. Chat / preset / agent config (recall setting, section order, depths). Copy presets, never edit
   them in place.
2. Only then fork code, as its own atomic commit, after checking `upstream/staging` hasn't fixed it.
3. Verify: one more turn, rerun steps 2-3; the hit should reach about prev prompt minus the tail.

Troubleshooting runs on the user's quota: everything above is local DB reads. Don't make test model calls.

## Worked example (2026-10-10)

"Scene: The Weight of the Move" (`jA_spmbBdkUr5LTiS21HX`, NanoGPT `z-ai/glm-5.2`, preset
`QHGtiwaQCvJ1wVhMMqJv5`): fresh turns hit 4.6k-5.4k of 10-15k. The diff broke at ~4.9k tokens,
`--- Memory 1 ---` in system message #0: plain memory recall (scene chat default). A swipe of the
same turn 23 s later hit 13,894 / 13,895, so the cache itself was fine.
