// custom-mods: the one network call of a speculative agent prefill (see prefillAgent in agent-executor).
// It deliberately skips completeAgentCall: a prefill is not an agent run, so it must not report progress
// or claim the scene check that the real tracker call carries.
import type { BaseLLMProvider, ChatMessage, ChatOptions } from "../llm/base-provider.js";
import { logger } from "../../lib/logger.js";

/** Send a 1-token request so a local server's prompt cache holds this prompt's prefix. */
export async function sendAgentPrefill(
  label: string,
  provider: BaseLLMProvider,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<void> {
  logger.debug("[agent-prefill] %s (%s, %d msgs)", label, options.model, messages.length);
  try {
    await provider.chatComplete(messages, {
      ...options,
      // Marks the request so an OpenAI-compatible proxy can keep it off paid upstreams.
      customParameters: { ...options.customParameters, prefill: true },
      maxTokens: 1,
      stream: false,
    });
  } catch (err) {
    logger.debug(err, "[agent-prefill] %s failed", label);
  }
}
