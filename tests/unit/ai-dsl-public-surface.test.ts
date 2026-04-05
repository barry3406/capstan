import { describe, expect, it } from "bun:test";

import * as ai from "@zauso-ai/capstan-ai";

describe("@zauso-ai/capstan-ai framework DSL public surface", () => {
  it("exports the high-level framework contract builders alongside the runtime substrate", () => {
    expect(typeof ai.defineCapability).toBe("function");
    expect(typeof ai.defineWorkflow).toBe("function");
    expect(typeof ai.defineAgentPolicy).toBe("function");
    expect(typeof ai.defineMemorySpace).toBe("function");
    expect(typeof ai.defineOperatorView).toBe("function");
    expect(typeof ai.defineAgentApp).toBe("function");
    expect(typeof ai.summarizeAgentApp).toBe("function");
    expect(typeof ai.AgentFrameworkValidationError).toBe("function");
    expect(typeof ai.createHarness).toBe("function");
    expect(typeof ai.openHarnessRuntime).toBe("function");
    expect(typeof ai.runAgentLoop).toBe("function");
  });

  it("does not leak framework internals or revive removed legacy memory helpers", () => {
    expect("BuiltinMemoryBackend" in ai).toBe(false);
    expect("createMemoryAccessor" in ai).toBe(false);
    expect("frameworkError" in ai).toBe(false);
    expect("normalizeFieldMap" in ai).toBe(false);
    expect("mergeValidatedCollection" in ai).toBe(false);
    expect("dedupeCapabilities" in ai).toBe(false);
  });

  it("lets framework contracts remain plain data without widening createAI", () => {
    const capability = ai.defineCapability({
      id: "inspect-mailbox",
      title: "Inspect mailbox",
      description: "Inspect runtime state.",
    });
    const app = ai.defineAgentApp({
      id: "ops-agent",
      title: "Ops agent",
      description: "A framework-native agent app.",
      capabilities: [capability],
    });
    const summary = ai.summarizeAgentApp(app);

    expect(app.capabilities[0]).toEqual(capability);
    expect(summary).toEqual({
      id: "ops-agent",
      title: "Ops agent",
      description: "A framework-native agent app.",
      defaults: {
        defaultPolicies: [],
        defaultMemorySpaces: [],
      },
      capabilities: [
        {
          id: "inspect-mailbox",
          title: "Inspect mailbox",
          description: "Inspect runtime state.",
        },
      ],
      workflows: [],
      policies: [],
      memorySpaces: [],
      operatorViews: [],
    });

    const instance = ai.createAI({
      llm: {
        name: "mock",
        async chat() {
          return { content: "ok", model: "mock-1" };
        },
      },
    });

    expect(Object.keys(instance).sort()).toEqual([
      "agent",
      "generate",
      "generateStream",
      "think",
      "thinkStream",
    ]);
    expect("framework" in instance).toBe(false);
    expect("memory" in instance).toBe(false);
  });
});
