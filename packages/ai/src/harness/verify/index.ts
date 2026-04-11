/**
 * Harness verification layer — self-loop that validates agent actions.
 *
 * After each tool call:
 * 1. Snapshot the action + result
 * 2. Ask LLM: "Did this succeed? Is the result safe/expected?"
 * 3. If failed + retryable → re-execute (up to maxRetries)
 * 4. If failed + not retryable → signal abort
 */

import type { LLMProvider, LLMMessage } from "../../types.js";
import type { HarnessAction, VerifyResult, HarnessVerifierFn } from "../types.js";

const VERIFY_SYSTEM_PROMPT = `You are a verification agent. You review the result of a tool action and decide whether it succeeded.

Respond with a single JSON object (no markdown):
{
  "passed": true | false,
  "reason": "<explanation>",
  "retry": true | false
}

Rules:
- "passed": true if the action achieved its intent and the result looks correct.
- "passed": false if there's an error, unexpected result, or safety concern.
- "retry": true if the failure is transient and retrying might help (network error, timeout).
- "retry": false if the failure is permanent (wrong selector, invalid URL, security issue).
- Always include a brief "reason".`;

export class HarnessVerifier {
  private llm: LLMProvider;
  private maxRetries: number;
  private customVerifier: HarnessVerifierFn | undefined;

  constructor(
    llm: LLMProvider,
    config: { maxRetries?: number; verifier?: HarnessVerifierFn },
  ) {
    this.llm = llm;
    this.maxRetries = config.maxRetries ?? 3;
    this.customVerifier = config.verifier;
  }

  /** Verify a tool action result. Returns the verification outcome. */
  async verify(action: HarnessAction, result: unknown): Promise<VerifyResult> {
    // Use custom verifier if provided
    if (this.customVerifier) {
      return this.customVerifier(action, result);
    }

    // Default: LLM-based verification
    return this.llmVerify(action, result);
  }

  /** Get max retries setting */
  getMaxRetries(): number {
    return this.maxRetries;
  }

  private async llmVerify(
    action: HarnessAction,
    result: unknown,
  ): Promise<VerifyResult> {
    const resultStr =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);

    // Truncate very long results to avoid context overflow
    const truncated =
      resultStr.length > 2000
        ? resultStr.slice(0, 2000) + "\n... (truncated)"
        : resultStr;

    const messages: LLMMessage[] = [
      { role: "system", content: VERIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Tool: ${action.tool}\nArguments: ${JSON.stringify(action.args)}\n\nResult:\n${truncated}`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, {
        temperature: 0,
        maxTokens: 200,
      });

      return parseVerifyResponse(response.content);
    } catch (err) {
      // If verification itself fails, pass through (don't block on verify errors)
      return {
        passed: true,
        reason: `Verification skipped: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

function parseVerifyResponse(text: string): VerifyResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        passed: parsed["passed"] === true,
        reason: (parsed["reason"] as string) ?? undefined,
        retry: parsed["retry"] === true,
      };
    } catch {
      // Fall through
    }
  }

  // If we can't parse, assume passed (don't block agent on verify parse failures)
  return { passed: true, reason: "Could not parse verification response" };
}
