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

describe("generated agent surface control plane", () => {
  it("exposes search, task, artifact, and execute through the generated control plane", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-surface-"));
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
        '      reportId: "digest-001",',
        '      ticketId: String(input.ticketId ?? "T-100")',
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
    expect(buildResult.stderr).toBe("");

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/control-plane/index.js")).href}?t=${Date.now()}`;
    const controlPlaneModule = (await import(moduleUrl)) as {
      search: (query?: string) => {
        resources: Array<{ key: string }>;
        capabilities: Array<{ key: string }>;
        tasks: Array<{
          task: { key: string };
          status: string;
          workflowAttention?: {
            openCount: number;
            statusCounts: Record<string, number>;
            queues?: Array<{
              status: string;
              openCount: number;
              filter: Record<string, unknown>;
            }>;
          };
        }>;
        artifacts: Array<{ key: string }>;
      };
      resource: (key: string) => {
        resource: { key: string };
        capabilities: Array<{ key: string }>;
        routes: Array<{
          key: string;
          path: string;
          actions: Array<{
            key: string;
            entry: boolean;
            execution: {
              operation: string;
              routeKey: string;
              actionKey: string;
              scope: { kind: string; resourceKey: string };
            };
            taskStart?: {
              operation: string;
              routeKey: string;
              actionKey: string;
              task: { key: string; title: string; kind: string; artifactKeys: string[] };
            };
            workflow?: {
              kind: string;
              runtime: string;
              interface: string;
              routeKey: string;
              actionKey: string;
              start: { command: string; args: string[] };
              observe: Array<{ key: string; command: string; args: string[] }>;
              controlPlane: {
                getRun: { operation: string };
                listRuns: {
                  operation: string;
                  defaultFilter: Record<string, unknown>;
                };
                attention: {
                  operation: string;
                  defaultFilter: Record<string, unknown>;
                  queues: {
                    operation: string;
                    defaultFilter: Record<string, unknown>;
                    statuses: string[];
                  };
                };
                advance: {
                  operation: string;
                  transitions: Array<{ key: string }>;
                };
              };
              recover: {
                nextActions: Record<string, string>;
                commands: Array<{ key: string; command: string; args: string[] }>;
              };
            };
          }>;
        }>;
        relations: Array<{ relation: { key: string } }>;
        workflowAttention?: {
          openCount: number;
          statusCounts: Record<string, number>;
          latestRun?: {
            id: string;
            status: string;
            nextAction: string;
            attempt: number;
            updatedAt: string;
            route?: {
              routeKey: string;
              actionKey: string;
              path: string;
              kind: string;
              resourceKey: string;
              sourceResourceKey?: string;
              sourceRelationKey?: string;
            };
          };
          runs?: Array<{
            id: string;
            status: string;
            nextAction: string;
            attempt: number;
            updatedAt: string;
            route?: {
              routeKey: string;
              actionKey: string;
              path: string;
              kind: string;
              resourceKey: string;
              sourceResourceKey?: string;
              sourceRelationKey?: string;
            };
          }>;
          queues?: Array<{
            status: string;
            openCount: number;
            filter: Record<string, unknown>;
            latestItem?: {
              id: string;
              status: string;
              nextAction: string;
              attempt: number;
            };
          }>;
        };
      };
      executeAction: (
        routeKey: string,
        actionKey: string,
        input?: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<{
        capability: string;
        status: string;
        input: Record<string, unknown>;
        output?: unknown;
      }>;
      startTaskAction: (
        routeKey: string,
        actionKey: string,
        input?: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<{
        id: string;
        taskKey: string;
        capabilityKey: string;
        attempt: number;
        status: string;
        input: Record<string, unknown>;
        artifacts: Array<{ artifactKey: string; payload: unknown }>;
        result?: { status: string; input: Record<string, unknown> };
      }>;
      listWorkflowRuns: (filter?: {
        taskKey?: string;
        routeKey?: string;
        actionKey?: string;
        status?: string;
        attentionOnly?: boolean;
      }) => Array<{
        id: string;
        status: string;
        nextAction: string;
        attempt: number;
        route?: { routeKey: string; actionKey: string; path: string; kind: string; resourceKey: string };
      }>;
      listAttentionItems: (filter?: {
        taskKey?: string;
        resourceKey?: string;
        routeKey?: string;
        actionKey?: string;
        status?: string;
      }) => Array<{
        kind: string;
        id: string;
        status: string;
        nextAction: string;
        attempt: number;
        updatedAt: string;
        task: { key: string; title: string; kind: string; artifactKeys: string[] };
        capability: { key: string; title: string };
        route?: {
          routeKey: string;
          actionKey: string;
          path: string;
          kind: string;
          resourceKey: string;
          sourceResourceKey?: string;
          sourceRelationKey?: string;
        };
        availableTransitions: Array<{ key: string }>;
      }>;
      listAttentionQueues: (filter?: {
        taskKey?: string;
        resourceKey?: string;
        routeKey?: string;
        actionKey?: string;
      }) => Array<{
        status: string;
        openCount: number;
        filter: Record<string, unknown>;
        latestItem?: {
          id: string;
          status: string;
          nextAction: string;
          attempt: number;
          route?: {
            routeKey: string;
            actionKey: string;
            path: string;
            kind: string;
            resourceKey: string;
            sourceResourceKey?: string;
            sourceRelationKey?: string;
          };
        };
      }>;
      getWorkflowRun: (id: string) => {
        id: string;
        status: string;
        nextAction: string;
        attempt: number;
        availableTransitions: Array<{ key: string }>;
        activeCheckpoint?: { type: string; note?: string };
        route?: { routeKey: string; actionKey: string; path: string; kind: string; resourceKey: string };
      };
      advanceWorkflowRun: (
        id: string,
        action: "approve" | "provideInput" | "retry" | "cancel",
        input?: Record<string, unknown>,
        note?: string
      ) => Promise<{
        id: string;
        status: string;
        nextAction: string;
        attempt: number;
        availableTransitions: Array<{ key: string }>;
        activeCheckpoint?: { type: string; note?: string };
      }>;
      task: (key: string) => {
        task: { key: string; kind: string };
        status: string;
        capabilities: Array<{ key: string }>;
        artifacts: Array<{ key: string }>;
        runCount: number;
        workflowAttention?: {
          openCount: number;
          statusCounts: Record<string, number>;
          latestRun?: {
            id: string;
            status: string;
            nextAction: string;
            attempt: number;
            updatedAt: string;
            route?: { routeKey: string; actionKey: string; path: string; kind: string; resourceKey: string };
          };
          queues?: Array<{
            status: string;
            openCount: number;
            filter: Record<string, unknown>;
            latestItem?: {
              id: string;
              status: string;
              nextAction: string;
              attempt: number;
            };
          }>;
        };
        latestRun?: { id: string; status: string; artifacts: Array<{ id: string; artifactKey: string }> };
      };
      artifact: (key: string) => {
        artifact: { key: string };
        tasks: Array<{ key: string }>;
        capabilities: Array<{ key: string }>;
        records: Array<{ id: string; artifactKey: string; taskRunId: string; payload: unknown }>;
        latestRecord?: { id: string; artifactKey: string; taskRunId: string; payload: unknown };
      };
      startTask: (key: string, input?: Record<string, unknown>) => Promise<{
        id: string;
        taskKey: string;
        capabilityKey: string;
        status: string;
        artifacts: Array<{ id: string; artifactKey: string; taskRunId: string; payload: unknown }>;
        result?: {
          capability: string;
          status: string;
          input: Record<string, unknown>;
          output?: unknown;
        };
      }>;
      getTaskRun: (id: string) => {
        id: string;
        taskKey: string;
        capabilityKey: string;
        status: string;
      } | undefined;
      listTaskRuns: (taskKey?: string) => Array<{
        id: string;
        taskKey: string;
        capabilityKey: string;
        status: string;
        artifacts: Array<{ id: string; artifactKey: string; taskRunId: string }>;
      }>;
      getArtifactRecord: (id: string) => {
        id: string;
        artifactKey: string;
        taskRunId: string;
        payload: unknown;
      } | undefined;
      listArtifactRecords: (artifactKey?: string) => Array<{
        id: string;
        artifactKey: string;
        taskRunId: string;
        payload: unknown;
      }>;
      execute: (key: string, input?: Record<string, unknown>) => Promise<{
        capability: string;
        status: string;
        input: Record<string, unknown>;
        output?: unknown;
      }>;
      controlPlane: {
        domain: string;
        resource: (key: string) => unknown;
        task: (key: string) => unknown;
        artifact: (key: string) => unknown;
        startTask: (key: string, input?: Record<string, unknown>) => Promise<unknown>;
        listArtifactRecords: (artifactKey?: string) => unknown;
      };
    };

    const searchResult = controlPlaneModule.search("ticket");
    expect(searchResult.resources.map((entry) => entry.key)).toContain("ticket");
    expect(searchResult.capabilities.map((entry) => entry.key)).toContain("generateDigest");
    expect(searchResult.tasks.map((entry) => entry.task.key)).toContain("generateDigestTask");
    expect(searchResult.tasks.find((entry) => entry.task.key === "generateDigestTask")?.workflowAttention).toEqual({
      openCount: 0,
      statusCounts: {},
      queues: []
    });
    expect(searchResult.artifacts.map((entry) => entry.key)).toContain("ticketDigest");

    const resourceResult = controlPlaneModule.resource("ticket");
    expect(resourceResult.resource.key).toBe("ticket");
    expect(resourceResult.capabilities.map((entry) => entry.key)).toEqual([
      "generateDigest",
      "listTickets"
    ]);
    expect(resourceResult.routes.map((entry) => entry.key)).toEqual([
      "ticketList",
      "ticketDetail",
      "ticketForm"
    ]);
    expect(resourceResult.routes[0]?.actions.map((entry) => entry.key)).toEqual([
      "generateDigest",
      "listTickets"
    ]);
    expect(resourceResult.routes[0]?.actions.find((entry) => entry.entry)?.key).toBe("listTickets");
    expect(resourceResult.workflowAttention).toEqual({
      openCount: 0,
      statusCounts: {},
      runs: [],
      queues: []
    });
    expect(resourceResult.routes[0]?.actions[0]?.execution).toEqual({
      operation: "executeAction",
      routeKey: "ticketList",
      actionKey: "generateDigest",
      inputSchema: {
        ticketId: {
          type: "string",
          required: true
        }
      },
      scope: {
        kind: "resource",
        resourceKey: "ticket"
      }
    });
    expect(resourceResult.routes[0]?.actions[0]?.taskStart).toEqual({
      operation: "startTaskAction",
      routeKey: "ticketList",
      actionKey: "generateDigest",
      task: {
        key: "generateDigestTask",
        title: "Generate Ticket Digest",
        kind: "durable",
        artifactKeys: ["ticketDigest"]
      },
      inputSchema: {
        ticketId: {
          type: "string",
          required: true
        }
      },
      scope: {
        kind: "resource",
        resourceKey: "ticket"
      }
    });
    expect(resourceResult.routes[0]?.actions[0]?.workflow).toEqual({
      kind: "starter_run_recipe",
      runtime: "harness",
      interface: "cli",
      routeKey: "ticketList",
      actionKey: "generateDigest",
      task: {
        key: "generateDigestTask",
        title: "Generate Ticket Digest",
        kind: "durable",
        artifactKeys: ["ticketDigest"]
      },
      inputSchema: {
        ticketId: {
          type: "string",
          required: true
        }
      },
      scope: {
        kind: "resource",
        resourceKey: "ticket"
      },
      inputEnvelope: {
        injectedRoute: {
          routeKey: "ticketList",
          actionKey: "generateDigest",
          path: "/resources/ticket/list",
          kind: "list",
          resourceKey: "ticket"
        }
      },
      start: {
        key: "start",
        command: "capstan",
        args: [
          "harness:start",
          "<app-dir>",
          "generateDigestTask",
          "--json",
          "--input",
          "<input-path>"
        ],
        placeholders: ["appDir", "inputPath"]
      },
      observe: [
        {
          key: "get",
          command: "capstan",
          args: ["harness:get", "<app-dir>", "<run-id>", "--json"],
          placeholders: ["appDir", "runId"]
        },
        {
          key: "summary",
          command: "capstan",
          args: ["harness:summary", "<app-dir>", "<run-id>", "--json"],
          placeholders: ["appDir", "runId"]
        },
        {
          key: "memory",
          command: "capstan",
          args: ["harness:memory", "<app-dir>", "<run-id>", "--json"],
          placeholders: ["appDir", "runId"]
        }
      ],
      controlPlane: {
        getRun: {
          operation: "getWorkflowRun"
        },
        listRuns: {
          operation: "listWorkflowRuns",
          defaultFilter: {
            taskKey: "generateDigestTask",
            routeKey: "ticketList",
            actionKey: "generateDigest",
            attentionOnly: true
          }
        },
        attention: {
          operation: "listAttentionItems",
          defaultFilter: {
            taskKey: "generateDigestTask",
            routeKey: "ticketList",
            actionKey: "generateDigest"
          },
          queues: {
            operation: "listAttentionQueues",
            defaultFilter: {
              taskKey: "generateDigestTask",
              routeKey: "ticketList",
              actionKey: "generateDigest"
            },
            statuses: [
              "approval_required",
              "input_required",
              "blocked",
              "failed",
              "paused",
              "cancelled"
            ]
          }
        },
        advance: {
          operation: "advanceWorkflowRun",
          transitions: [
            {
              key: "approve",
              inputSchema: {
                ticketId: {
                  type: "string",
                  required: true
                }
              }
            },
            {
              key: "provideInput",
              inputSchema: {
                ticketId: {
                  type: "string",
                  required: true
                }
              }
            },
            {
              key: "retry",
              inputSchema: {
                ticketId: {
                  type: "string",
                  required: true
                }
              }
            },
            {
              key: "cancel"
            }
          ]
        }
      },
      recover: {
        nextActions: {
          running: "continue",
          paused: "resume",
          approval_required: "await_approval",
          input_required: "await_input",
          failed: "retry",
          blocked: "resolve_block",
          completed: "inspect_output",
          cancelled: "review_cancellation"
        },
        commands: [
          {
            key: "pause",
            command: "capstan",
            args: ["harness:pause", "<app-dir>", "<run-id>", "--json"],
            placeholders: ["appDir", "runId"]
          },
          {
            key: "resume",
            command: "capstan",
            args: ["harness:resume", "<app-dir>", "<run-id>", "--json"],
            placeholders: ["appDir", "runId"]
          },
          {
            key: "approve",
            command: "capstan",
            args: ["harness:approve", "<app-dir>", "<run-id>", "--json"],
            placeholders: ["appDir", "runId"]
          },
          {
            key: "provideInput",
            command: "capstan",
            args: [
              "harness:provide-input",
              "<app-dir>",
              "<run-id>",
              "--input",
              "<input-path>",
              "--json"
            ],
            placeholders: ["appDir", "runId", "inputPath"]
          },
          {
            key: "retry",
            command: "capstan",
            args: ["harness:retry", "<app-dir>", "<run-id>", "--json"],
            placeholders: ["appDir", "runId"]
          }
        ]
      }
    });
    expect(resourceResult.relations).toEqual([]);

    const actionExecution = await controlPlaneModule.executeAction("ticketList", "generateDigest", {
      ticketId: "T-2049"
    });
    expect(actionExecution.capability).toBe("generateDigest");
    expect(actionExecution.status).toBe("completed");
    expect(actionExecution.input.ticketId).toBe("T-2049");
    expect(actionExecution.input._capstanRoute).toEqual({
      routeKey: "ticketList",
      actionKey: "generateDigest",
      path: "/resources/ticket/list",
      kind: "list",
      resourceKey: "ticket"
    });

    const taskResult = controlPlaneModule.task("generateDigestTask");
    expect(taskResult.task.key).toBe("generateDigestTask");
    expect(taskResult.status).toBe("awaiting_execution");
    expect(taskResult.capabilities.map((entry) => entry.key)).toContain("generateDigest");
    expect(taskResult.artifacts.map((entry) => entry.key)).toContain("ticketDigest");
    expect(taskResult.runCount).toBe(0);
    expect(taskResult.workflowAttention).toEqual({
      openCount: 0,
      statusCounts: {},
      queues: []
    });

    const artifactResult = controlPlaneModule.artifact("ticketDigest");
    expect(artifactResult.artifact.key).toBe("ticketDigest");
    expect(artifactResult.tasks.map((entry) => entry.key)).toContain("generateDigestTask");
    expect(artifactResult.capabilities.map((entry) => entry.key)).toContain("generateDigest");
    expect(artifactResult.records).toHaveLength(0);

    const execution = await controlPlaneModule.execute("generateDigest", {
      ticketId: "T-2048"
    });

    expect(execution.capability).toBe("generateDigest");
    expect(execution.status).toBe("completed");
    expect(execution.input.ticketId).toBe("T-2048");

    const startedRun = await controlPlaneModule.startTask("generateDigestTask", {
      ticketId: "T-4096"
    });

    expect(startedRun.taskKey).toBe("generateDigestTask");
    expect(startedRun.capabilityKey).toBe("generateDigest");
    expect(startedRun.status).toBe("completed");
    expect(startedRun.result?.status).toBe("completed");
    expect(startedRun.result?.input.ticketId).toBe("T-4096");
    expect(startedRun.artifacts).toHaveLength(1);
    expect(startedRun.artifacts[0]?.artifactKey).toBe("ticketDigest");

    const fetchedRun = controlPlaneModule.getTaskRun(startedRun.id);
    expect(fetchedRun?.id).toBe(startedRun.id);
    expect(fetchedRun?.status).toBe("completed");

    const runs = controlPlaneModule.listTaskRuns("generateDigestTask");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(startedRun.id);
    expect(runs[0]?.artifacts).toHaveLength(1);

    const refreshedTask = controlPlaneModule.task("generateDigestTask");
    expect(refreshedTask.runCount).toBe(1);
    expect(refreshedTask.latestRun?.id).toBe(startedRun.id);
    expect(refreshedTask.latestRun?.status).toBe("completed");
    expect(refreshedTask.latestRun?.artifacts).toHaveLength(1);
    expect(refreshedTask.status).toBe("completed");
    expect(refreshedTask.workflowAttention).toEqual({
      openCount: 0,
      statusCounts: {},
      queues: []
    });

    const approvalRun = await controlPlaneModule.startTask("generateDigestTask", {
      ticketId: "T-8192",
      mode: "needs_approval"
    });
    expect(approvalRun.status).toBe("approval_required");
    expect(approvalRun.result?.status).toBe("approval_required");
    expect(approvalRun.artifacts).toHaveLength(0);

    const inputRequiredRun = await controlPlaneModule.startTask("generateDigestTask", {
      mode: "needs_input"
    });
    expect(inputRequiredRun.status).toBe("input_required");
    expect(inputRequiredRun.result?.status).toBe("input_required");
    expect(inputRequiredRun.artifacts).toHaveLength(0);

    const blockedRun = await controlPlaneModule.startTask("generateDigestTask", {
      ticketId: "T-32768",
      mode: "blocked"
    });
    expect(blockedRun.status).toBe("blocked");
    expect(blockedRun.result?.status).toBe("blocked");
    expect(blockedRun.artifacts).toHaveLength(0);

    const attentionRuns = controlPlaneModule.listWorkflowRuns({
      taskKey: "generateDigestTask",
      attentionOnly: true
    });
    expect(attentionRuns.map((run) => run.id)).toEqual([
      blockedRun.id,
      inputRequiredRun.id,
      approvalRun.id
    ]);
    expect(attentionRuns.map((run) => run.status)).toEqual([
      "blocked",
      "input_required",
      "approval_required"
    ]);

    const latestTask = controlPlaneModule.task("generateDigestTask");
    expect(latestTask.runCount).toBe(4);
    expect(latestTask.latestRun?.id).toBe(blockedRun.id);
    expect(latestTask.latestRun?.status).toBe("blocked");
    expect(latestTask.status).toBe("blocked");
    expect(latestTask.workflowAttention).toMatchObject({
      openCount: 3,
      statusCounts: {
        blocked: 1,
        input_required: 1,
        approval_required: 1
      },
      queues: [
        {
          status: "approval_required",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "approval_required"
          }
        },
        {
          status: "input_required",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "input_required"
          }
        },
        {
          status: "blocked",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "blocked"
          }
        }
      ],
      latestRun: {
        id: blockedRun.id,
        status: "blocked",
        nextAction: "resolve_block",
        attempt: 1
      }
    });

    const refreshedArtifact = controlPlaneModule.artifact("ticketDigest");
    expect(refreshedArtifact.records).toHaveLength(1);
    expect(refreshedArtifact.latestRecord?.artifactKey).toBe("ticketDigest");
    expect(refreshedArtifact.latestRecord?.taskRunId).toBe(startedRun.id);

    const artifactRecords = controlPlaneModule.listArtifactRecords("ticketDigest");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.taskRunId).toBe(startedRun.id);

    const fetchedArtifactRecord = controlPlaneModule.getArtifactRecord(artifactRecords[0]!.id);
    expect(fetchedArtifactRecord?.id).toBe(artifactRecords[0]?.id);

    const actionRun = await controlPlaneModule.startTaskAction("ticketList", "generateDigest", {
      ticketId: "T-2050"
    });
    expect(actionRun.taskKey).toBe("generateDigestTask");
    expect(actionRun.capabilityKey).toBe("generateDigest");
    expect(actionRun.status).toBe("completed");
    expect(actionRun.result?.status).toBe("completed");
    expect(actionRun.input._capstanRoute).toEqual({
      routeKey: "ticketList",
      actionKey: "generateDigest",
      path: "/resources/ticket/list",
      kind: "list",
      resourceKey: "ticket"
    });
    expect(actionRun.artifacts).toHaveLength(1);
    expect(actionRun.artifacts[0]?.artifactKey).toBe("ticketDigest");

    const approvalActionRun = await controlPlaneModule.startTaskAction("ticketList", "generateDigest", {
      ticketId: "T-2051",
      mode: "needs_approval"
    });
    expect(approvalActionRun.status).toBe("approval_required");

    const routeAttentionRuns = controlPlaneModule.listWorkflowRuns({
      routeKey: "ticketList",
      actionKey: "generateDigest",
      attentionOnly: true
    });
    expect(routeAttentionRuns).toHaveLength(1);
    expect(routeAttentionRuns[0]?.id).toBe(approvalActionRun.id);
    expect(routeAttentionRuns[0]?.status).toBe("approval_required");
    expect(routeAttentionRuns[0]?.route).toEqual({
      routeKey: "ticketList",
      actionKey: "generateDigest",
      path: "/resources/ticket/list",
      kind: "list",
      resourceKey: "ticket"
    });

    const attentionResource = controlPlaneModule.resource("ticket");
    expect(attentionResource.workflowAttention).toMatchObject({
      openCount: 1,
      statusCounts: {
        approval_required: 1
      },
      queues: [
        {
          status: "approval_required",
          openCount: 1,
          filter: {
            resourceKey: "ticket",
            status: "approval_required"
          }
        }
      ],
      latestRun: {
        id: approvalActionRun.id,
        status: "approval_required",
        nextAction: "await_approval",
        route: {
          routeKey: "ticketList",
          actionKey: "generateDigest",
          path: "/resources/ticket/list",
          kind: "list",
          resourceKey: "ticket"
        }
      },
      runs: [
        {
          id: approvalActionRun.id,
          status: "approval_required",
          nextAction: "await_approval"
        }
      ]
    });

    const attentionTask = controlPlaneModule.task("generateDigestTask");
    expect(attentionTask.workflowAttention).toMatchObject({
      openCount: 4,
      statusCounts: {
        approval_required: 2,
        input_required: 1,
        blocked: 1
      },
      queues: [
        {
          status: "approval_required",
          openCount: 2,
          filter: {
            taskKey: "generateDigestTask",
            status: "approval_required"
          }
        },
        {
          status: "input_required",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "input_required"
          }
        },
        {
          status: "blocked",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "blocked"
          }
        }
      ],
      latestRun: {
        id: approvalActionRun.id,
        status: "approval_required",
        nextAction: "await_approval"
      }
    });

    const attentionSearch = controlPlaneModule.search("digest");
    const searchedTask = attentionSearch.tasks.find(
      (entry) => entry.task.key === "generateDigestTask"
    );
    expect(searchedTask?.workflowAttention).toMatchObject({
      openCount: 4,
      statusCounts: {
        approval_required: 2,
        input_required: 1,
        blocked: 1
      },
      queues: [
        {
          status: "approval_required",
          openCount: 2,
          filter: {
            taskKey: "generateDigestTask",
            status: "approval_required"
          }
        },
        {
          status: "input_required",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "input_required"
          }
        },
        {
          status: "blocked",
          openCount: 1,
          filter: {
            taskKey: "generateDigestTask",
            status: "blocked"
          }
        }
      ]
    });

    const attentionItems = controlPlaneModule.listAttentionItems();
    expect(attentionItems.map((item) => item.id)).toEqual([
      approvalActionRun.id,
      blockedRun.id,
      inputRequiredRun.id,
      approvalRun.id
    ]);
    expect(attentionItems.map((item) => item.status)).toEqual([
      "approval_required",
      "blocked",
      "input_required",
      "approval_required"
    ]);
    expect(attentionItems[0]).toMatchObject({
      kind: "workflow_run",
      id: approvalActionRun.id,
      status: "approval_required",
      nextAction: "await_approval",
      task: {
        key: "generateDigestTask"
      },
      capability: {
        key: "generateDigest"
      },
      route: {
        routeKey: "ticketList",
        actionKey: "generateDigest",
        path: "/resources/ticket/list",
        kind: "list",
        resourceKey: "ticket"
      }
    });
    expect(attentionItems[0]?.availableTransitions.map((entry) => entry.key)).toEqual([
      "approve",
      "cancel"
    ]);

    const ticketAttentionItems = controlPlaneModule.listAttentionItems({
      resourceKey: "ticket"
    });
    expect(ticketAttentionItems.map((item) => item.id)).toEqual([approvalActionRun.id]);

    const routeAttentionItems = controlPlaneModule.listAttentionItems({
      routeKey: "ticketList",
      actionKey: "generateDigest"
    });
    expect(routeAttentionItems.map((item) => item.id)).toEqual([approvalActionRun.id]);

    const attentionQueues = controlPlaneModule.listAttentionQueues({
      taskKey: "generateDigestTask"
    });
    expect(attentionQueues).toEqual([
      {
        status: "approval_required",
        openCount: 2,
        filter: {
          taskKey: "generateDigestTask",
          status: "approval_required"
        },
        latestItem: expect.objectContaining({
          id: approvalActionRun.id,
          status: "approval_required",
          nextAction: "await_approval"
        })
      },
      {
        status: "input_required",
        openCount: 1,
        filter: {
          taskKey: "generateDigestTask",
          status: "input_required"
        },
        latestItem: expect.objectContaining({
          id: inputRequiredRun.id,
          status: "input_required",
          nextAction: "await_input"
        })
      },
      {
        status: "blocked",
        openCount: 1,
        filter: {
          taskKey: "generateDigestTask",
          status: "blocked"
        },
        latestItem: expect.objectContaining({
          id: blockedRun.id,
          status: "blocked",
          nextAction: "resolve_block"
        })
      }
    ]);

    const routeAttentionQueues = controlPlaneModule.listAttentionQueues({
      routeKey: "ticketList",
      actionKey: "generateDigest"
    });
    expect(routeAttentionQueues).toEqual([
      {
        status: "approval_required",
        openCount: 1,
        filter: {
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "approval_required"
        },
        latestItem: expect.objectContaining({
          id: approvalActionRun.id,
          status: "approval_required"
        })
      }
    ]);

    const taskAttentionItems = controlPlaneModule.listAttentionItems({
      taskKey: "generateDigestTask"
    });
    expect(taskAttentionItems).toHaveLength(4);

    const approvalAttentionItems = controlPlaneModule.listAttentionItems({
      status: "approval_required"
    });
    expect(approvalAttentionItems.map((item) => item.id)).toEqual([
      approvalActionRun.id,
      approvalRun.id
    ]);

    const completedWorkflow = controlPlaneModule.getWorkflowRun(actionRun.id);
    expect(completedWorkflow.status).toBe("completed");
    expect(completedWorkflow.nextAction).toBe("inspect_output");
    expect(completedWorkflow.availableTransitions).toEqual([]);
    expect(completedWorkflow.route).toEqual({
      routeKey: "ticketList",
      actionKey: "generateDigest",
      path: "/resources/ticket/list",
      kind: "list",
      resourceKey: "ticket"
    });

    const approvalWorkflow = controlPlaneModule.getWorkflowRun(approvalRun.id);
    expect(approvalWorkflow.status).toBe("approval_required");
    expect(approvalWorkflow.nextAction).toBe("await_approval");
    expect(approvalWorkflow.activeCheckpoint).toEqual({
      type: "approval",
      note: "Manager approval required before digest generation."
    });
    expect(approvalWorkflow.availableTransitions.map((entry) => entry.key)).toEqual([
      "approve",
      "cancel"
    ]);

    const approvedWorkflow = await controlPlaneModule.advanceWorkflowRun(
      approvalRun.id,
      "approve",
      {
        approved: true
      }
    );
    expect(approvedWorkflow.status).toBe("completed");
    expect(approvedWorkflow.nextAction).toBe("inspect_output");
    expect(approvedWorkflow.attempt).toBe(1);

    const inputWorkflow = controlPlaneModule.getWorkflowRun(inputRequiredRun.id);
    expect(inputWorkflow.status).toBe("input_required");
    expect(inputWorkflow.nextAction).toBe("await_input");
    expect(inputWorkflow.activeCheckpoint).toEqual({
      type: "input",
      note: "Ticket selection is incomplete."
    });
    expect(inputWorkflow.availableTransitions.map((entry) => entry.key)).toEqual([
      "provideInput",
      "cancel"
    ]);

    const providedWorkflow = await controlPlaneModule.advanceWorkflowRun(
      inputRequiredRun.id,
      "provideInput",
      {
        ticketId: "T-16384"
      }
    );
    expect(providedWorkflow.status).toBe("completed");
    expect(providedWorkflow.nextAction).toBe("inspect_output");
    expect(providedWorkflow.attempt).toBe(1);

    const blockedWorkflow = controlPlaneModule.getWorkflowRun(blockedRun.id);
    expect(blockedWorkflow.status).toBe("blocked");
    expect(blockedWorkflow.nextAction).toBe("resolve_block");
    expect(blockedWorkflow.availableTransitions.map((entry) => entry.key)).toEqual([
      "retry",
      "cancel"
    ]);

    const retriedWorkflow = await controlPlaneModule.advanceWorkflowRun(blockedRun.id, "retry", {
      unblocked: true
    });
    expect(retriedWorkflow.status).toBe("completed");
    expect(retriedWorkflow.nextAction).toBe("inspect_output");
    expect(retriedWorkflow.attempt).toBe(2);

    expect(controlPlaneModule.controlPlane.domain).toBe("support");
    expect(controlPlaneModule.controlPlane.resource("ticket")).toBeDefined();
  }, 15_000);

  it("projects relation-aware resource routes through the generated control plane", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "capstan-agent-resource-relations-"));
    tempDirs.push(tempRoot);

    const graphPath = join(tempRoot, "relation-agent-app-graph.json");
    const outputDir = join(tempRoot, "generated-app");

    await writeFile(
      graphPath,
      `${JSON.stringify(
        {
          version: 1,
          domain: {
            key: "crm",
            title: "CRM Workspace"
          },
          resources: [
            {
              key: "account",
              title: "Account",
              fields: {
                name: {
                  type: "string",
                  required: true
                }
              },
              relations: {
                primaryContact: {
                  resource: "contact",
                  kind: "one",
                  description: "Primary contact for the account."
                }
              }
            },
            {
              key: "contact",
              title: "Contact",
              fields: {
                fullName: {
                  type: "string",
                  required: true
                }
              }
            }
          ],
          tasks: [
            {
              key: "reviewContactTask",
              title: "Review Contact Task",
              kind: "durable",
              artifacts: ["contactReview"]
            }
          ],
          artifacts: [
            {
              key: "contactReview",
              title: "Contact Review",
              kind: "report"
            }
          ],
          capabilities: [
            {
              key: "listAccounts",
              title: "List Accounts",
              mode: "read",
              resources: ["account"]
            },
            {
              key: "reviewContact",
              title: "Review Contact",
              mode: "external",
              resources: ["contact"],
              task: "reviewContactTask"
            }
          ],
          views: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const scaffoldResult = await runCapstanCli(["graph:scaffold", graphPath, outputDir]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/review-contact.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { reviewContactCapability } from "./generated/review-contact.js";',
        "",
        "function relationSourceRecordId(input: Record<string, unknown>): string {",
        '  const relation = input._capstanRelation;',
        '  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {',
        '    return "missing";',
        "  }",
        "  const scopedRelation = relation as Record<string, unknown>;",
        '  return typeof scopedRelation.sourceRecordId === "string" ? scopedRelation.sourceRecordId : "missing";',
        "}",
        "",
        "export async function reviewContact(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: reviewContactCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      artifacts: {",
        "        contactReview: {",
        '          reviewId: `review-${relationSourceRecordId(input)}`',
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

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/control-plane/index.js")).href}?t=${Date.now()}`;
    const controlPlaneModule = (await import(moduleUrl)) as {
      resource: (key: string) => {
        resource: { key: string };
        relations: Array<{
          relation: { key: string; label: string };
          resource: { key: string };
          route: {
            key: string;
            path: string;
            capabilityKey?: string;
            actions: Array<{
              key: string;
              entry: boolean;
              execution: {
                operation: string;
                routeKey: string;
                actionKey: string;
                scope: {
                  kind: string;
                  resourceKey: string;
                  sourceResourceKey?: string;
                  sourceRelationKey?: string;
                  contextSchema?: Record<string, { type: string; required?: boolean; description?: string }>;
                };
              };
              taskStart?: {
                operation: string;
                routeKey: string;
                actionKey: string;
                task: { key: string; title: string; kind: string; artifactKeys: string[] };
              };
              workflow?: {
                kind: string;
                runtime: string;
                interface: string;
                controlPlane?: {
                  getRun: { operation: string };
                  advance: { operation: string; transitions: Array<{ key: string }> };
                };
              };
            }>;
          };
          capabilities: Array<{ key: string }>;
        }>;
      };
      executeAction: (
        routeKey: string,
        actionKey: string,
        input?: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<{
        capability: string;
        status: string;
        input: Record<string, unknown>;
      }>;
      startTaskAction: (
        routeKey: string,
        actionKey: string,
        input?: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<{
        taskKey: string;
        capabilityKey: string;
        status: string;
        input: Record<string, unknown>;
        artifacts: Array<{ artifactKey: string; payload: unknown }>;
        result?: { status: string; input: Record<string, unknown> };
      }>;
      getWorkflowRun: (id: string) => {
        id: string;
        status: string;
        nextAction: string;
        route?: {
          routeKey: string;
          actionKey: string;
          path: string;
          kind: string;
          resourceKey: string;
          sourceResourceKey?: string;
          sourceRelationKey?: string;
        };
        relation?: Record<string, unknown>;
      };
    };

    const resourceResult = controlPlaneModule.resource("account");

    expect(resourceResult.resource.key).toBe("account");
    expect(resourceResult.relations).toEqual([
      {
        relation: {
          key: "primaryContact",
          label: "Primary Contact",
          kind: "one",
          description: "Primary contact for the account."
        },
        resource: {
          key: "contact",
          title: "Contact",
          fields: {
            fullName: {
              type: "string",
              required: true
            }
          }
        },
        route: {
          key: "accountPrimaryContactRelationDetail",
          title: "Account Primary Contact Detail",
          kind: "detail",
          path: "/resources/account/relations/primary-contact/detail",
          resourceKey: "contact",
          capabilityKey: "reviewContact",
          generated: true,
          sourceResourceKey: "account",
          sourceRelationKey: "primaryContact",
          actions: [
            {
              key: "reviewContact",
              title: "Review Contact",
              mode: "external",
              resourceKeys: ["contact"],
              task: "reviewContactTask",
              inputFieldKeys: [],
              outputFieldKeys: [],
              entry: true,
              execution: {
                operation: "executeAction",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                }
              },
              taskStart: {
                operation: "startTaskAction",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                task: {
                  key: "reviewContactTask",
                  title: "Review Contact Task",
                  kind: "durable",
                  artifactKeys: ["contactReview"]
                },
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                }
              },
              workflow: {
                kind: "starter_run_recipe",
                runtime: "harness",
                interface: "cli",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                task: {
                  key: "reviewContactTask",
                  title: "Review Contact Task",
                  kind: "durable",
                  artifactKeys: ["contactReview"]
                },
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                },
                inputEnvelope: {
                  injectedRoute: {
                    routeKey: "accountPrimaryContactRelationDetail",
                    actionKey: "reviewContact",
                    path: "/resources/account/relations/primary-contact/detail",
                    kind: "detail",
                    resourceKey: "contact",
                    sourceResourceKey: "account",
                    sourceRelationKey: "primaryContact"
                  },
                  relationContext: {
                    sourceResourceKey: "account",
                    sourceRelationKey: "primaryContact",
                    contextSchema: {
                      sourceRecordId: {
                        type: "string",
                        required: true,
                        description:
                          "Identifier for the Account record whose Primary Contact relation scopes this action."
                      }
                    }
                  }
                },
                start: {
                  key: "start",
                  command: "capstan",
                  args: [
                    "harness:start",
                    "<app-dir>",
                    "reviewContactTask",
                    "--json",
                    "--input",
                    "<input-path>"
                  ],
                  placeholders: ["appDir", "inputPath"]
                },
                observe: [
                  {
                    key: "get",
                    command: "capstan",
                    args: ["harness:get", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  },
                  {
                    key: "summary",
                    command: "capstan",
                    args: ["harness:summary", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  },
                  {
                    key: "memory",
                    command: "capstan",
                    args: ["harness:memory", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  }
                ],
                controlPlane: {
                  getRun: {
                    operation: "getWorkflowRun"
                  },
                  listRuns: {
                    operation: "listWorkflowRuns",
                    defaultFilter: {
                      taskKey: "reviewContactTask",
                      routeKey: "accountPrimaryContactRelationDetail",
                      actionKey: "reviewContact",
                      attentionOnly: true
                    }
                  },
                  attention: {
                    operation: "listAttentionItems",
                    defaultFilter: {
                      taskKey: "reviewContactTask",
                      routeKey: "accountPrimaryContactRelationDetail",
                      actionKey: "reviewContact"
                    },
                    queues: {
                      operation: "listAttentionQueues",
                      defaultFilter: {
                        taskKey: "reviewContactTask",
                        routeKey: "accountPrimaryContactRelationDetail",
                        actionKey: "reviewContact"
                      },
                      statuses: [
                        "approval_required",
                        "input_required",
                        "blocked",
                        "failed",
                        "paused",
                        "cancelled"
                      ]
                    }
                  },
                  advance: {
                    operation: "advanceWorkflowRun",
                    transitions: [
                      {
                        key: "approve",
                        inputSchema: {}
                      },
                      {
                        key: "provideInput",
                        inputSchema: {}
                      },
                      {
                        key: "retry",
                        inputSchema: {}
                      },
                      {
                        key: "cancel"
                      }
                    ]
                  }
                },
                recover: {
                  nextActions: {
                    running: "continue",
                    paused: "resume",
                    approval_required: "await_approval",
                    input_required: "await_input",
                    failed: "retry",
                    blocked: "resolve_block",
                    completed: "inspect_output",
                    cancelled: "review_cancellation"
                  },
                  commands: [
                    {
                      key: "pause",
                      command: "capstan",
                      args: ["harness:pause", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "resume",
                      command: "capstan",
                      args: ["harness:resume", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "approve",
                      command: "capstan",
                      args: ["harness:approve", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "provideInput",
                      command: "capstan",
                      args: [
                        "harness:provide-input",
                        "<app-dir>",
                        "<run-id>",
                        "--input",
                        "<input-path>",
                        "--json"
                      ],
                      placeholders: ["appDir", "runId", "inputPath"]
                    },
                    {
                      key: "retry",
                      command: "capstan",
                      args: ["harness:retry", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    }
                  ]
                }
              }
            }
          ]
        },
        capabilities: [
          {
            key: "reviewContact",
            title: "Review Contact",
            mode: "external",
            resources: ["contact"],
            task: "reviewContactTask"
          }
        ]
      }
    ]);

    const execution = await controlPlaneModule.executeAction(
      "accountPrimaryContactRelationDetail",
      "reviewContact",
      {},
      {
        sourceRecordId: "account-001"
      }
    );
    expect(execution.status).toBe("completed");
    expect(execution.input._capstanRoute).toEqual({
      routeKey: "accountPrimaryContactRelationDetail",
      actionKey: "reviewContact",
      path: "/resources/account/relations/primary-contact/detail",
      kind: "detail",
      resourceKey: "contact",
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact"
    });
    expect(execution.input._capstanRelation).toEqual({
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact",
      sourceRecordId: "account-001"
    });

    const startedRun = await controlPlaneModule.startTaskAction(
      "accountPrimaryContactRelationDetail",
      "reviewContact",
      {},
      {
        sourceRecordId: "account-001"
      }
    );
    expect(startedRun.taskKey).toBe("reviewContactTask");
    expect(startedRun.capabilityKey).toBe("reviewContact");
    expect(startedRun.status).toBe("completed");
    expect(startedRun.result?.status).toBe("completed");
    expect(startedRun.input._capstanRelation).toEqual({
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact",
      sourceRecordId: "account-001"
    });
    expect(startedRun.artifacts).toHaveLength(1);
    expect(startedRun.artifacts[0]).toMatchObject({
      artifactKey: "contactReview",
      taskKey: "reviewContactTask",
      capabilityKey: "reviewContact",
      payload: {
        reviewId: "review-account-001"
      }
    });

    const workflowRun = controlPlaneModule.getWorkflowRun(startedRun.id);
    expect(workflowRun.status).toBe("completed");
    expect(workflowRun.nextAction).toBe("inspect_output");
    expect(workflowRun.route).toEqual({
      routeKey: "accountPrimaryContactRelationDetail",
      actionKey: "reviewContact",
      path: "/resources/account/relations/primary-contact/detail",
      kind: "detail",
      resourceKey: "contact",
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact"
    });
    expect(workflowRun.relation).toEqual({
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact",
      sourceRecordId: "account-001"
    });
  });
});
