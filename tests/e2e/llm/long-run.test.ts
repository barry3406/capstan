import { it, expect } from "bun:test";
import { createSmartAgent } from "../../../packages/ai/src/index.js";
import { InMemoryEvolutionStore } from "../../../packages/ai/src/evolution/store-memory.js";
import { buildStrategyLayer } from "../../../packages/ai/src/evolution/engine.js";
import type { AgentTool, StopHook, LLMMessage } from "../../../packages/ai/src/types.js";
import { describeWithLLM } from "./helpers/env.js";

// ---------------------------------------------------------------------------
// Long-run layer -- 20-50+ turn tests, 10 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Long-run -- compression, stop hooks, error recovery", (provider) => {

  it("survives context compression over many sequential tool calls", async () => {
    // Chain-based lookup: each record tells you which ID to query next.
    // Forces sequential calls (can't batch) because each depends on the prior result.
    const CHAIN: Record<number, { value: number; nextId: number | null }> = {};
    let expectedSum = 0;
    for (let i = 1; i <= 25; i++) {
      const value = i * 7;
      expectedSum += value;
      CHAIN[i] = { value, nextId: i < 25 ? i + 1 : null };
    }
    // expectedSum = 7*(1+2+...+25) = 7*325 = 2275

    let runningSum = 0;
    let lookupsPerformed = 0;

    const queryTool: AgentTool = {
      name: "lookup",
      description: "Look up a record by ID. Returns the value, a running sum of all looked-up values so far, and the next ID to look up.",
      parameters: {
        type: "object",
        properties: { id: { type: "number", description: "Record ID to look up" } },
        required: ["id"],
      },
      async execute(args) {
        const id = args.id as number;
        const rec = CHAIN[id];
        if (!rec) return { error: `No record with ID ${id}.` };
        runningSum += rec.value;
        lookupsPerformed++;
        return {
          id,
          value: rec.value,
          runningSum,
          recordsProcessed: lookupsPerformed,
          nextId: rec.nextId,
          note: rec.nextId
            ? `Record ${id}: value=${rec.value}. Running sum: ${runningSum}. Next: look up ID ${rec.nextId}.`
            : `Last record (${id}): value=${rec.value}. Final running sum: ${runningSum}. All 25 records processed. Report this sum.`,
        };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [queryTool],
      maxIterations: 60,
      // Small context window to force compression mid-run
      contextWindowSize: 4000,
    });

    const result = await agent.run(
      "Follow a chain of records starting at ID 1. Call the lookup tool with ID 1. "
      + "Each result tells you the nextId to look up. Keep following the chain until nextId is null. "
      + "You MUST call lookup one record at a time -- each call depends on the previous result. "
      + "Once done, report the sum of ALL values you collected. The chain has 25 records.",
    );

    expect(result.status).toBe("completed");
    // Must have made at least 20 sequential lookups (some may be lost to compression)
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(20);
    expect(result.iterations).toBeGreaterThan(15);
    // The sum should be 2275
    expect(result.result as string).toContain("2275");
  }, 600_000);

  it("iteratively improves output when stop hook rejects", async () => {
    const lengthHook: StopHook = {
      name: "length-check",
      async evaluate(ctx) {
        // High threshold to ensure even verbose models get rejected at least once
        const pass = ctx.response.length >= 1500;
        return {
          pass,
          feedback: pass
            ? undefined
            : `Response is only ${ctx.response.length} characters. I need a comprehensive response of at least 1500 characters with detailed examples, code snippets, and real-world use cases. Please expand significantly.`,
        };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [],
      maxIterations: 10,
      stopHooks: [lengthHook],
    });

    const result = await agent.run(
      "In one short sentence, explain what TypeScript is.",
    );

    expect(result.status).toBe("completed");
    // After rejections and feedback, the final response should be long
    expect((result.result as string).length).toBeGreaterThanOrEqual(500);
    // Should have been rejected at least once
    expect(result.iterations).toBeGreaterThan(1);
  }, 600_000);

  it("orchestrates a multi-stage pipeline with dependency ordering, varied failure patterns, and retries", async () => {
    // 8-stage data pipeline with strict ordering + intermittent failures.
    // Tests: sequential reasoning, error recovery, dependency enforcement,
    //        multi-tool coordination, state tracking across many iterations.
    const stageAttempts: Record<number, number> = {};
    const completedStages = new Set<number>();

    const STAGE_NAMES: Record<number, string> = {
      1: "fetch_data",
      2: "validate_schema",
      3: "parse_records",
      4: "deduplicate",
      5: "enrich_metadata",
      6: "compute_metrics",
      7: "generate_report",
      8: "archive_results",
    };

    // Which attempt numbers each stage fails on (1-indexed)
    const FAILURE_MAP: Record<number, number[]> = {
      2: [1],         // fails 1st attempt
      4: [1, 2],      // fails 1st and 2nd attempt
      6: [1],         // fails 1st attempt
    };

    const ERROR_MESSAGES: Record<number, string[]> = {
      2: ["Schema cache miss -- temporary failure, please retry"],
      4: [
        "Dedup hash collision detected -- rebuilding index, please retry",
        "Index rebuild incomplete -- needs one more attempt",
      ],
      6: ["Metrics computation timed out -- please retry"],
    };

    const runStageTool: AgentTool = {
      name: "run_stage",
      description:
        "Run a pipeline stage by ID (1-8). Stages must be run in order. "
        + "A stage will fail if any earlier stage has not been completed. "
        + "Some stages may fail with transient errors -- retry them.",
      parameters: {
        type: "object",
        properties: {
          stageId: { type: "number", description: "Stage ID (1-8)" },
        },
        required: ["stageId"],
      },
      async execute(args) {
        const id = args.stageId as number;
        if (id < 1 || id > 8) return { error: "Invalid stage ID. Must be 1-8." };

        // Dependency check
        for (let prev = 1; prev < id; prev++) {
          if (!completedStages.has(prev)) {
            return {
              stageId: id,
              name: STAGE_NAMES[id],
              status: "dependency_failed",
              error: `Stage ${id} (${STAGE_NAMES[id]}) requires stage ${prev} (${STAGE_NAMES[prev]}) first.`,
            };
          }
        }

        stageAttempts[id] = (stageAttempts[id] ?? 0) + 1;
        const attempt = stageAttempts[id]!;

        // Transient failure pattern
        const failAttempts = FAILURE_MAP[id];
        if (failAttempts?.includes(attempt)) {
          const msgs = ERROR_MESSAGES[id]!;
          return {
            stageId: id,
            name: STAGE_NAMES[id],
            status: "failed",
            attempt,
            error: msgs[attempt - 1] ?? msgs[msgs.length - 1],
          };
        }

        completedStages.add(id);
        return {
          stageId: id,
          name: STAGE_NAMES[id],
          status: "completed",
          attempt,
          next: id < 8
            ? `Proceed to stage ${id + 1} (${STAGE_NAMES[id + 1]}).`
            : "All 8 stages complete. Pipeline finished successfully.",
        };
      },
    };

    const pipelineStatusTool: AgentTool = {
      name: "pipeline_status",
      description: "Returns the current status of every pipeline stage and overall progress.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const stages = [];
        for (let i = 1; i <= 8; i++) {
          stages.push({
            id: i,
            name: STAGE_NAMES[i],
            status: completedStages.has(i) ? "completed" : "pending",
            attempts: stageAttempts[i] ?? 0,
          });
        }
        return {
          stages,
          completed: completedStages.size,
          total: 8,
          allDone: completedStages.size === 8,
        };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [runStageTool, pipelineStatusTool],
      maxIterations: 40,
    });

    const result = await agent.run(
      "Run a data pipeline with 8 sequential stages (IDs 1-8). "
      + "Start by calling run_stage with stageId 1. Each successful result tells you the next stage. "
      + "Some stages fail with transient errors -- retry them until they succeed. "
      + "After all 8 stages are done, call pipeline_status to confirm, then report.",
    );

    expect(result.status).toBe("completed");

    // All 8 stages must be completed
    expect(completedStages.size).toBe(8);
    for (let i = 1; i <= 8; i++) {
      expect(completedStages.has(i)).toBe(true);
    }

    // Verify retry behavior for each failing stage
    expect(stageAttempts[2]).toBeGreaterThanOrEqual(2);  // 1 retry
    expect(stageAttempts[4]).toBeGreaterThanOrEqual(3);  // 2 retries
    expect(stageAttempts[6]).toBeGreaterThanOrEqual(2);  // 1 retry

    // Should have needed many tool calls: 8 stages + 4 retries + status checks
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(12);
  }, 600_000);

  it("agent with evolution gets smarter across sequential runs", async () => {
    // Create an evolution store and seed it with an experience + strategy
    const store = new InMemoryEvolutionStore();

    // Run 1: Agent solves a task — record an experience manually
    const agent1 = createSmartAgent({
      llm: provider,
      tools: [
        {
          name: "write_code",
          description: "Write code to a named file. Returns success.",
          parameters: {
            type: "object",
            properties: {
              filename: { type: "string", description: "File name" },
              code: { type: "string", description: "Code content" },
            },
            required: ["filename", "code"],
          },
          async execute(args) {
            return { status: "written", filename: args.filename };
          },
        },
      ],
      maxIterations: 10,
    });

    const run1 = await agent1.run(
      "Write an isPrime function in TypeScript using the write_code tool. File: isPrime.ts",
    );

    expect(run1.status).toBe("completed");
    expect(run1.toolCalls.length).toBeGreaterThanOrEqual(1);

    // Record the experience from Run 1 into the evolution store
    await store.recordExperience({
      goal: "Write an isPrime function in TypeScript",
      outcome: "success",
      trajectory: run1.toolCalls.map((tc, i) => ({
        tool: tc.tool,
        args: (typeof tc.args === "object" && tc.args !== null ? tc.args : {}) as Record<string, unknown>,
        result: tc.result,
        status: (tc.status === "error" ? "error" : "success") as "success" | "error",
        iteration: i,
      })),
      iterations: run1.iterations,
      tokenUsage: 0,
      duration: 1000,
      skillsUsed: [],
    });

    // Store a strategy that captures a "lesson learned"
    await store.storeStrategy({
      content: "When writing functions, always write unit tests first using TDD. Create the test file before the implementation file.",
      source: ["manual-seed"],
      utility: 0.9,
      applications: 0,
    });

    // Run 2: Create agent with strategy layer injected from the store
    const goal2 = "Write a factorial function with tests";
    const strategies = await store.queryStrategies(goal2, 5);
    expect(strategies.length).toBeGreaterThanOrEqual(1);
    expect(strategies[0]!.content).toContain("TDD");

    const layer = buildStrategyLayer(strategies);
    expect(layer).not.toBeNull();
    expect(layer!.content).toContain("Learned Strategies");
    expect(layer!.content).toContain("TDD");

    // Capture messages to verify strategy injection
    const capturedMessages: LLMMessage[] = [];

    const agent2 = createSmartAgent({
      llm: provider,
      tools: [
        {
          name: "write_code",
          description: "Write code to a named file. Returns success.",
          parameters: {
            type: "object",
            properties: {
              filename: { type: "string", description: "File name" },
              code: { type: "string", description: "Code content" },
            },
            required: ["filename", "code"],
          },
          async execute(args) {
            return { status: "written", filename: args.filename };
          },
        },
      ],
      prompt: { layers: [layer!] },
      maxIterations: 10,
      hooks: {
        async afterIteration(snapshot) {
          // Capture messages from the first iteration to inspect system prompt
          if (snapshot.iteration === 1 && capturedMessages.length === 0) {
            capturedMessages.push(...snapshot.messages);
          }
        },
      },
    });

    const run2 = await agent2.run(goal2);

    expect(run2.status).toBe("completed");
    expect(run2.toolCalls.length).toBeGreaterThanOrEqual(1);

    // Verify: the system prompt includes the strategy layer content
    const systemMsg = capturedMessages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("Learned Strategies");
    expect(systemMsg!.content).toContain("TDD");

    // Verify the evolution store has the recorded experience from Run 1
    const stats = await store.getStats();
    expect(stats.totalExperiences).toBeGreaterThanOrEqual(1);
    expect(stats.totalStrategies).toBeGreaterThanOrEqual(1);
  }, 600_000);

});
