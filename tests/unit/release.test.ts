import { describe, expect, it } from "vitest";
import {
  renderReleaseHistoryText,
  renderReleasePlanText,
  renderRollbackRunText,
  renderReleaseRunText,
  validateReleaseContract,
  validateReleaseEnvironmentSnapshot,
  validateReleaseMigrationPlan,
  type ReleaseHistoryReport,
  type ReleasePlanReport,
  type ReleaseRollbackRunReport,
  type ReleaseRunReport
} from "../../packages/release/src/index.ts";

describe("release", () => {
  it("validates a minimal release contract", () => {
    const issues = validateReleaseContract({
      version: 1,
      domain: {
        key: "operations",
        title: "Operations Console"
      },
      application: {
        key: "operations.app",
        title: "Operations Release Contract",
        generatedBy: "capstan"
      },
      environments: [
        {
          key: "preview",
          title: "Preview Environment",
          strategy: "ephemeral",
          variables: [],
          secrets: []
        }
      ],
      inputs: {
        environmentSnapshot: {
          path: "capstan.release-env.json",
          title: "Release Environment Snapshot"
        },
        migrationPlan: {
          path: "capstan.migrations.json",
          title: "Release Migration Plan"
        }
      },
      artifacts: [
        {
          key: "dist",
          title: "Compiled Dist",
          kind: "directory",
          path: "dist",
          required: true
        }
      ],
      healthChecks: [
        {
          key: "verify",
          title: "Capstan Verify",
          kind: "verify_pass",
          required: true
        }
      ],
      preview: {
        steps: [
          {
            key: "verify",
            title: "Run Verify"
          }
        ]
      },
      release: {
        steps: [
          {
            key: "build",
            title: "Build"
          }
        ]
      },
      rollback: {
        strategy: "restore_previous_artifacts",
        steps: ["Restore dist/."]
      },
      trace: {
        captures: ["verify_report"]
      }
    });

    expect(issues).toEqual([]);
  });

  it("validates release environment snapshots and migration plans", () => {
    expect(
      validateReleaseEnvironmentSnapshot({
        version: 1,
        environments: [
          {
            key: "preview",
            variables: {
              NODE_ENV: "production"
            },
            secrets: []
          }
        ]
      })
    ).toEqual([]);

    expect(
      validateReleaseMigrationPlan({
        version: 1,
        generatedBy: "capstan",
        status: "safe",
        steps: [
          {
            key: "graphProjection",
            title: "Graph Projection",
            status: "applied"
          }
        ]
      })
    ).toEqual([]);
  });

  it("renders a readable release plan summary", () => {
    const report: ReleasePlanReport = {
      appRoot: "/tmp/example",
      status: "blocked",
      contract: {
        version: 1,
        domain: {
          key: "operations",
          title: "Operations Console"
        },
        application: {
          key: "operations.app",
          title: "Operations Release Contract",
          generatedBy: "capstan"
        },
        environments: [
          {
            key: "preview",
            title: "Preview Environment",
            strategy: "ephemeral",
            variables: [],
            secrets: []
          }
        ],
        inputs: {
          environmentSnapshot: {
            path: "/tmp/example/capstan.release-env.json",
            title: "Release Environment Snapshot"
          },
          migrationPlan: {
            path: "/tmp/example/capstan.migrations.json",
            title: "Release Migration Plan"
          }
        },
        artifacts: [],
        healthChecks: [],
        preview: {
          steps: [
            {
              key: "verify",
              title: "Run Capstan Verify",
              command: "capstan verify . --json"
            }
          ]
        },
        release: {
          steps: [
            {
              key: "build",
              title: "Build Generated App",
              command: "tsc -p tsconfig.json"
            }
          ]
        },
        rollback: {
          strategy: "restore_previous_artifacts",
          steps: ["Restore dist/."]
        },
        trace: {
          captures: ["verify_report"]
        }
      },
      verify: {
        appRoot: "/tmp/example",
        status: "failed",
        generatedBy: "capstan-feedback",
        steps: [],
        diagnostics: [],
        summary: {
          status: "failed",
          stepCount: 0,
          passedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          diagnosticCount: 0,
          errorCount: 1,
          warningCount: 0
        }
      },
      gates: [
        {
          key: "verify",
          label: "Capstan Verify",
          status: "failed",
          summary: "Capstan verify must pass before preview or release can continue.",
          hint: "Resolve verify failures."
        }
      ],
      preview: {
        steps: [
          {
            key: "verify",
            title: "Run Capstan Verify",
            command: "capstan verify . --json"
          }
        ]
      },
      release: {
        steps: [
          {
            key: "build",
            title: "Build Generated App",
            command: "tsc -p tsconfig.json"
          }
        ]
      },
      rollback: {
        strategy: "restore_previous_artifacts",
        steps: ["Restore dist/."]
      },
      trace: {
        generatedAt: "2026-03-22T00:00:00.000Z",
        captures: ["verify_report"],
        contractPath: "/tmp/example/capstan.release.json",
        environmentSnapshotPath: "/tmp/example/capstan.release-env.json",
        migrationPlanPath: "/tmp/example/capstan.migrations.json",
        verifyStatus: "failed"
      }
    };

    const output = renderReleasePlanText(report);

    expect(output).toContain("Capstan Release Plan");
    expect(output).toContain("Status: blocked");
    expect(output).toContain("Safety Gates");
    expect(output).toContain("Preview");
    expect(output).toContain("Rollback");
    expect(output).toContain("Resolve verify failures.");
    expect(output).toContain("environmentSnapshotPath");
    expect(output).toContain("migrationPlanPath");
  });

  it("renders a readable release run summary", () => {
    const report: ReleaseRunReport = {
      appRoot: "/tmp/example",
      target: "release",
      status: "completed",
      plan: {
        appRoot: "/tmp/example",
        status: "ready",
        contract: {
          version: 1,
          domain: {
            key: "operations",
            title: "Operations Console"
          },
          application: {
            key: "operations.app",
            title: "Operations Release Contract",
            generatedBy: "capstan"
          },
          environments: [],
          inputs: {
            environmentSnapshot: {
              path: "/tmp/example/capstan.release-env.json",
              title: "Release Environment Snapshot"
            },
            migrationPlan: {
              path: "/tmp/example/capstan.migrations.json",
              title: "Release Migration Plan"
            }
          },
          artifacts: [],
          healthChecks: [],
          preview: { steps: [] },
          release: { steps: [] },
          rollback: {
            strategy: "restore_previous_artifacts",
            steps: []
          },
          trace: {
            captures: ["release_contract"]
          }
        },
        verify: {
          appRoot: "/tmp/example",
          status: "passed",
          generatedBy: "capstan-feedback",
          steps: [],
          diagnostics: [],
          summary: {
            status: "passed",
            stepCount: 0,
            passedSteps: 0,
            failedSteps: 0,
            skippedSteps: 0,
            diagnosticCount: 0,
            errorCount: 0,
            warningCount: 0
          }
        },
        gates: [],
        preview: { steps: [] },
        release: { steps: [] },
        rollback: {
          strategy: "restore_previous_artifacts",
          steps: []
        },
        trace: {
          generatedAt: "2026-03-22T00:00:00.000Z",
          captures: ["release_contract"],
          contractPath: "/tmp/example/capstan.release.json",
          environmentSnapshotPath: "/tmp/example/capstan.release-env.json",
          migrationPlanPath: "/tmp/example/capstan.migrations.json",
          verifyStatus: "passed"
        }
      },
      steps: [
        {
          key: "publishArtifacts",
          label: "Publish Compiled And Surface Artifacts",
          status: "completed",
          durationMs: 42,
          summary: "Simulated release publication completed.",
          artifactKeys: ["compiledDist", "humanSurfaceDocument"]
        }
      ],
      artifactInventory: [
        {
          key: "compiledDist",
          title: "Compiled Dist",
          kind: "directory",
          path: "dist",
          required: true,
          exists: true
        }
      ],
      trace: {
        generatedAt: "2026-03-22T00:00:00.000Z",
        tracePath: "/tmp/example/.capstan/release-runs/example-release.json",
        target: "release",
        captures: ["release_contract"],
        environmentSnapshotPath: "/tmp/example/capstan.release-env.json",
        migrationPlanPath: "/tmp/example/capstan.migrations.json"
      }
    };

    const output = renderReleaseRunText(report);

    expect(output).toContain("Capstan Release Run");
    expect(output).toContain("Target: release");
    expect(output).toContain("Status: completed");
    expect(output).toContain("Artifact Inventory");
    expect(output).toContain("tracePath");
    expect(output).toContain("Publish Compiled And Surface Artifacts");
  });

  it("renders release history and rollback summaries", () => {
    const history: ReleaseHistoryReport = {
      appRoot: "/tmp/example",
      runs: [
        {
          appRoot: "/tmp/example",
          target: "release",
          status: "completed",
          generatedAt: "2026-03-22T00:00:00.000Z",
          tracePath: "/tmp/example/.capstan/release-runs/release.json",
          stepCount: 4
        },
        {
          appRoot: "/tmp/example",
          target: "rollback",
          status: "completed",
          generatedAt: "2026-03-22T01:00:00.000Z",
          tracePath: "/tmp/example/.capstan/release-runs/rollback.json",
          stepCount: 3,
          sourceTracePath: "/tmp/example/.capstan/release-runs/release.json"
        }
      ]
    };

    const rollback: ReleaseRollbackRunReport = {
      appRoot: "/tmp/example",
      target: "rollback",
      status: "completed",
      summary: "Rollback steps completed.",
      contract: {
        version: 1,
        domain: {
          key: "operations",
          title: "Operations Console"
        },
        application: {
          key: "operations.app",
          title: "Operations Release Contract",
          generatedBy: "capstan"
        },
        environments: [],
        inputs: {
          environmentSnapshot: {
            path: "capstan.release-env.json",
            title: "Release Environment Snapshot"
          },
          migrationPlan: {
            path: "capstan.migrations.json",
            title: "Release Migration Plan"
          }
        },
        artifacts: [],
        healthChecks: [],
        preview: { steps: [] },
        release: { steps: [] },
        rollback: {
          strategy: "restore_previous_artifacts",
          steps: ["Restore dist/."]
        },
        trace: {
          captures: ["release_contract"]
        }
      },
      rollback: {
        strategy: "restore_previous_artifacts",
        steps: ["Restore dist/."]
      },
      sourceRun: history.runs[0],
      steps: [
        {
          key: "rollback:1",
          label: "Rollback Step 1",
          status: "completed",
          durationMs: 0,
          summary: "Restore dist/."
        }
      ],
      artifactInventory: [],
      trace: {
        generatedAt: "2026-03-22T02:00:00.000Z",
        tracePath: "/tmp/example/.capstan/release-runs/rollback-run.json",
        target: "rollback",
        captures: ["release_contract"],
        sourceTracePath: "/tmp/example/.capstan/release-runs/release.json"
      }
    };

    const historyOutput = renderReleaseHistoryText(history);
    const rollbackOutput = renderRollbackRunText(rollback);

    expect(historyOutput).toContain("Capstan Release History");
    expect(historyOutput).toContain("[completed] release");
    expect(historyOutput).toContain("source:");
    expect(rollbackOutput).toContain("Capstan Rollback Run");
    expect(rollbackOutput).toContain("Strategy: restore_previous_artifacts");
    expect(rollbackOutput).toContain("sourceTracePath");
  });
});
