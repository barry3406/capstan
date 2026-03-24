import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/paths.ts";
import { runCapstanCli, runTypeScriptBuild } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("generated agent surface a2a adapter", () => {
  it("projects the generated agent surface through a preview A2A adapter", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-a2a-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/generate-digest.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { generateDigestCapability } from "./generated/generate-digest.js";',
        "",
        "export async function generateDigest(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        '  if (input.mode === "needs_approval" && input.approved !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "approval_required",',
        "      input,",
        '      note: "Manager approval required before digest generation."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "needs_input" && typeof input.ticketId !== "string") {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "input_required",',
        "      input,",
        '      note: "Ticket selection is incomplete."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "blocked" && input.unblocked !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "blocked",',
        "      input,",
        '      note: "Execution is blocked by policy."',
        "    };",
        "  }",
        "",
        "  return {",
        "    capability: generateDigestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      artifacts: {",
        "        ticketDigest: {",
        '          reportId: "digest-a2a-001",',
        '          ticketId: String(input.ticketId ?? "T-A2A")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/agent-surface/a2a.js")).href}?t=${Date.now()}`;
    const a2aModule = (await import(moduleUrl)) as {
      getAgentSurfaceA2aCard: () => {
        protocol: string;
        skills: Array<{ id: string; name: string }>;
      };
      sendAgentSurfaceA2aMessage: (message: {
        id?: string;
        operation:
          | "manifest"
          | "resource"
          | "search"
          | "listAttentionItems"
          | "listAttentionQueues"
          | "executeAction"
          | "startTaskAction"
          | "execute"
          | "task"
          | "artifact"
          | "startTask"
          | "getTaskRun"
          | "getWorkflowRun"
          | "advanceWorkflowRun"
          | "listTaskRuns"
          | "listWorkflowRuns"
          | "getArtifactRecord"
          | "listArtifactRecords";
        params?: Record<string, unknown>;
      }) => Promise<{
        id: string;
        state: string;
        structuredContent?: unknown;
        error?: { code?: string; message: string };
      }>;
    };

    const card = a2aModule.getAgentSurfaceA2aCard();
    expect(card.protocol).toBe("a2a");
    expect(card.skills.map((skill) => skill.id)).toContain("resource:ticket");
    expect(card.skills.map((skill) => skill.id)).toContain("capability:generateDigest");
    expect(card.skills.map((skill) => skill.id)).toContain("task:generateDigestTask");
    expect(card.skills.map((skill) => skill.id)).toContain("artifact:ticketDigest");

    const manifestTask = await a2aModule.sendAgentSurfaceA2aMessage({
      id: "manifest-a2a",
      operation: "manifest"
    });
    expect(manifestTask.id).toBe("manifest-a2a");
    expect(manifestTask.state).toBe("completed");
    expect(JSON.stringify(manifestTask.structuredContent)).toContain('"a2a"');
    expect(JSON.stringify(manifestTask.structuredContent)).toContain('"resources"');

    const resourceTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "resource",
      params: {
        key: "ticket"
      }
    });
    expect(resourceTask.state).toBe("completed");
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"resource"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"routes"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"actions"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"execution"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"taskStart"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"workflow"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"starter_run_recipe"');
    expect(JSON.stringify(resourceTask.structuredContent)).toContain('"workflowAttention"');

    const actionTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "executeAction",
      params: {
        routeKey: "ticketList",
        actionKey: "generateDigest",
        input: {
          ticketId: "T-9901"
        }
      }
    });
    expect(actionTask.state).toBe("completed");
    expect(JSON.stringify(actionTask.structuredContent)).toContain('"capability":"generateDigest"');
    expect(JSON.stringify(actionTask.structuredContent)).toContain('"routeKey":"ticketList"');

    const actionTaskRun = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "startTaskAction",
      params: {
        routeKey: "ticketList",
        actionKey: "generateDigest",
        input: {
          ticketId: "T-9902"
        }
      }
    });
    expect(actionTaskRun.state).toBe("completed");
    expect(JSON.stringify(actionTaskRun.structuredContent)).toContain('"taskKey":"generateDigestTask"');
    expect(JSON.stringify(actionTaskRun.structuredContent)).toContain('"routeKey":"ticketList"');

    const workflowRunTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "getWorkflowRun",
      params: {
        id: (actionTaskRun.structuredContent as { id: string }).id
      }
    });
    expect(workflowRunTask.state).toBe("completed");
    expect(JSON.stringify(workflowRunTask.structuredContent)).toContain('"nextAction":"inspect_output"');

    const searchTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "search",
      params: {
        query: "ticket"
      }
    });
    expect(searchTask.state).toBe("completed");
    expect(JSON.stringify(searchTask.structuredContent)).toContain('"resources"');
    expect(JSON.stringify(searchTask.structuredContent)).toContain("generateDigest");
    expect(JSON.stringify(searchTask.structuredContent)).toContain('"queues":[]');

    const startTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "startTask",
      params: {
        key: "generateDigestTask",
        input: {
          ticketId: "T-9900"
        }
      }
    });
    expect(startTask.state).toBe("completed");
    expect(JSON.stringify(startTask.structuredContent)).toContain("digest-a2a-001");

    const approvalStartTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "startTask",
      params: {
        key: "generateDigestTask",
        input: {
          ticketId: "T-9903",
          mode: "needs_approval"
        }
      }
    });
    expect(approvalStartTask.state).toBe("input-required");
    expect(JSON.stringify(approvalStartTask.structuredContent)).toContain('"status":"approval_required"');

    const attentionInboxTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listAttentionItems",
      params: {
        taskKey: "generateDigestTask"
      }
    });
    expect(attentionInboxTask.state).toBe("completed");
    expect(JSON.stringify(attentionInboxTask.structuredContent)).toContain('"kind":"workflow_run"');
    expect(JSON.stringify(attentionInboxTask.structuredContent)).toContain('"status":"approval_required"');

    const attentionQueueTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listAttentionQueues",
      params: {
        taskKey: "generateDigestTask"
      }
    });
    expect(attentionQueueTask.state).toBe("completed");
    expect(JSON.stringify(attentionQueueTask.structuredContent)).toContain('"status":"approval_required"');
    expect(JSON.stringify(attentionQueueTask.structuredContent)).toContain('"openCount":1');

    const approvalWorkflowTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "getWorkflowRun",
      params: {
        id: (approvalStartTask.structuredContent as { id: string }).id
      }
    });
    expect(approvalWorkflowTask.state).toBe("input-required");
    expect(JSON.stringify(approvalWorkflowTask.structuredContent)).toContain('"nextAction":"await_approval"');

    const workflowRunsTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listWorkflowRuns",
      params: {
        taskKey: "generateDigestTask",
        attentionOnly: true
      }
    });
    expect(workflowRunsTask.state).toBe("completed");
    expect(JSON.stringify(workflowRunsTask.structuredContent)).toContain('"status":"approval_required"');
    expect(JSON.stringify(workflowRunsTask.structuredContent)).not.toContain('"status":"completed"');

    const approvedWorkflowTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "advanceWorkflowRun",
      params: {
        id: (approvalStartTask.structuredContent as { id: string }).id,
        action: "approve",
        input: {
          approved: true
        }
      }
    });
    expect(approvedWorkflowTask.state).toBe("completed");
    expect(JSON.stringify(approvedWorkflowTask.structuredContent)).toContain('"status":"completed"');

    const listRunsTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listTaskRuns",
      params: {
        taskKey: "generateDigestTask"
      }
    });
    expect(listRunsTask.state).toBe("completed");
    const taskRuns = listRunsTask.structuredContent as Array<{ id: string }>;
    expect(taskRuns).toHaveLength(3);

    const artifactRecordsTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listArtifactRecords",
      params: {
        artifactKey: "ticketDigest"
      }
    });
    expect(artifactRecordsTask.state).toBe("completed");
    const records = artifactRecordsTask.structuredContent as Array<{ id: string }>;
    expect(records).toHaveLength(3);

    const getRecordTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "getArtifactRecord",
      params: {
        id: records[0]!.id
      }
    });
    expect(getRecordTask.state).toBe("completed");
    expect(JSON.stringify(getRecordTask.structuredContent)).toContain("digest-a2a-001");

    const errorTask = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "getTaskRun",
      params: {
        id: "missing-run"
      }
    });
    expect(errorTask.state).toBe("failed");
    expect(errorTask.error?.code).toBe("task_run_not_found");
  }, 15_000);
});
