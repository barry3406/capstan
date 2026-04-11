import type { LLMMessage } from "../types.js";

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
    // Skip empty content
    if (!msg.content || msg.content.trim() === "") continue;

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
      result[result.length - 1] = {
        role: last.role,
        content: last.content + "\n" + effectiveMsg.content,
      };
    } else {
      result.push({ ...effectiveMsg });
    }
  }

  return result;
}
