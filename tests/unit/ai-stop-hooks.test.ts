import { describe, expect, it } from "bun:test";

import type {
  StopHook,
  StopHookContext,
} from "../../packages/ai/src/types.ts";
import { runStopHooks } from "../../packages/ai/src/loop/stop-hooks.ts";

const baseContext: StopHookContext = {
  response: "Here is the answer.",
  messages: [
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "Here is the answer." },
  ],
  toolCalls: [],
  goal: "Answer the question",
};

function passingHook(name: string): StopHook {
  return {
    name,
    async evaluate() {
      return { pass: true };
    },
  };
}

function failingHook(name: string, feedback: string): StopHook {
  return {
    name,
    async evaluate() {
      return { pass: false, feedback };
    },
  };
}

function throwingHook(name: string): StopHook {
  return {
    name,
    async evaluate() {
      throw new Error("hook exploded");
    },
  };
}

describe("runStopHooks", () => {
  it("returns pass when no hooks configured", async () => {
    const result = await runStopHooks([], baseContext);
    expect(result.pass).toBe(true);
    expect(result.feedback).toBeUndefined();
    expect(result.hookName).toBeUndefined();
  });

  it("returns pass when all hooks pass", async () => {
    const hooks = [passingHook("a"), passingHook("b"), passingHook("c")];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(true);
  });

  it("returns fail with feedback from first failing hook", async () => {
    const hooks = [
      passingHook("ok"),
      failingHook("guard", "Response is too short"),
      passingHook("later"),
    ];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(false);
    expect(result.feedback).toBe("Response is too short");
    expect(result.hookName).toBe("guard");
  });

  it("stops at first failing hook and does not run later hooks", async () => {
    const callOrder: string[] = [];
    const hooks: StopHook[] = [
      {
        name: "first",
        async evaluate() {
          callOrder.push("first");
          return { pass: true };
        },
      },
      {
        name: "blocker",
        async evaluate() {
          callOrder.push("blocker");
          return { pass: false, feedback: "blocked" };
        },
      },
      {
        name: "never",
        async evaluate() {
          callOrder.push("never");
          return { pass: true };
        },
      },
    ];
    await runStopHooks(hooks, baseContext);
    expect(callOrder).toEqual(["first", "blocker"]);
  });

  it("handles hook throwing an error gracefully (fail open)", async () => {
    const hooks = [throwingHook("broken"), passingHook("ok")];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(true);
  });

  it("passes full context to hook evaluate function", async () => {
    let receivedContext: StopHookContext | undefined;
    const hook: StopHook = {
      name: "inspector",
      async evaluate(ctx) {
        receivedContext = ctx;
        return { pass: true };
      },
    };
    await runStopHooks([hook], baseContext);
    expect(receivedContext).toBeDefined();
    expect(receivedContext!.response).toBe(baseContext.response);
    expect(receivedContext!.messages).toEqual(baseContext.messages);
    expect(receivedContext!.toolCalls).toEqual(baseContext.toolCalls);
    expect(receivedContext!.goal).toBe(baseContext.goal);
  });

  it("feedback and hookName are included in failure result", async () => {
    const hooks = [failingHook("policy-check", "Violates safety policy")];
    const result = await runStopHooks(hooks, baseContext);
    expect(result).toEqual({
      pass: false,
      feedback: "Violates safety policy",
      hookName: "policy-check",
    });
  });

  it("returns pass when only throwing hooks are configured", async () => {
    const hooks = [throwingHook("err1"), throwingHook("err2")];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(true);
  });

  it("throwing hook before a failing hook still reaches the failure", async () => {
    const hooks = [throwingHook("broken"), failingHook("guard", "bad output")];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(false);
    expect(result.hookName).toBe("guard");
    expect(result.feedback).toBe("bad output");
  });

  it("single failing hook with no feedback still returns fail", async () => {
    const hook: StopHook = {
      name: "bare-fail",
      async evaluate() {
        return { pass: false };
      },
    };
    const result = await runStopHooks([hook], baseContext);
    expect(result.pass).toBe(false);
    expect(result.hookName).toBe("bare-fail");
    expect(result.feedback).toBeUndefined();
  });
});
