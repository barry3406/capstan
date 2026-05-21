import type { LLMMessage } from "../types.js";
import { concatContent, messageText } from "./content-helpers.js";

/**
 * Normalize messages before sending to the LLM API.
 *
 * Invariants enforced:
 * 1. No consecutive messages with the same role (merge them)
 * 2. Conversation starts with system or user (not assistant)
 * 3. Empty content messages are filtered out
 * 4. System messages after the first are converted to user messages
 */
export function normalizeMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) return [];

  const result: LLMMessage[] = [];

  for (const msg of messages) {
    // Skip empty content (only check on string form — multimodal parts are
    // never empty by construction)
    if (typeof msg.content === "string" && msg.content.trim() === "") continue;
    if (Array.isArray(msg.content) && msg.content.length === 0) continue;

    // System messages after the first get converted to user role
    // (Most LLM APIs only allow one system message at the start)
    const effectiveRole =
      msg.role === "system" && result.length > 0 && result[0]!.role === "system"
        ? ("user" as const)
        : msg.role;

    const effectiveMsg =
      effectiveRole !== msg.role
        ? { role: effectiveRole, content: msg.content }
        : msg;

    const last = result[result.length - 1];

    // Merge consecutive same-role messages
    if (last && last.role === effectiveMsg.role) {
      // System messages must stay text-only (most providers reject image
      // parts in system); fall back to text concat for system-system merges.
      if (last.role === "system") {
        result[result.length - 1] = {
          role: last.role,
          content: `${messageText(last.content)}\n${messageText(effectiveMsg.content)}`,
        };
      } else {
        result[result.length - 1] = {
          role: last.role,
          content: concatContent(last.content, effectiveMsg.content),
        };
      }
    } else {
      result.push({ ...effectiveMsg });
    }
  }

  return result;
}
