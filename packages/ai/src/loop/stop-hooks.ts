import type { StopHook, StopHookContext } from "../types.js";

export interface StopHooksResult {
  pass: boolean;
  feedback?: string;
  hookName?: string;
}

export async function runStopHooks(
  hooks: StopHook[],
  context: StopHookContext,
): Promise<StopHooksResult> {
  for (const hook of hooks) {
    try {
      const result = await hook.evaluate(context);
      if (!result.pass) {
        return { pass: false, ...(result.feedback !== undefined ? { feedback: result.feedback } : {}), hookName: hook.name };
      }
    } catch {
      continue; // Broken hooks fail open
    }
  }
  return { pass: true };
}
