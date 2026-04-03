import { describe, expect, it } from "bun:test";

import { createDeploymentDoctorActions } from "../../packages/cli/src/deploy-doctor.js";

describe("createDeploymentDoctorActions", () => {
  it("groups related deployment diagnostics into actionable repair steps", () => {
    const actions = createDeploymentDoctorActions("cloudflare", [
      {
        severity: "error",
        code: "missing_deploy_manifest",
        message: "dist/deploy-manifest.json is missing.",
      },
      {
        severity: "error",
        code: "target_mismatch",
        message: "The built target does not match the requested target.",
      },
      {
        severity: "error",
        code: "sqlite_edge_unsupported",
        message: "SQLite is not supported on edge targets.",
      },
      {
        severity: "error",
        code: "config_load_failed",
        message: "capstan.config.ts failed to load.",
      },
    ]);

    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({
      title: "Rebuild the deployment bundle",
      reasonCodes: ["missing_deploy_manifest", "missing_portable_runtime", "missing_target_contract"],
    });
    expect(actions.some((action) => action.title === "Align verify/start with the built target")).toBe(true);
    expect(actions.some((action) => action.title === "Fix target/runtime compatibility")).toBe(true);
    expect(actions.some((action) => action.title === "Fix config evaluation")).toBe(true);
  });

  it("falls back to a generic review action when diagnostics do not match a known repair playbook", () => {
    const actions = createDeploymentDoctorActions("node-standalone", [
      {
        severity: "warning",
        code: "custom_warning",
        message: "Something unusual happened.",
      },
    ]);

    expect(actions).toEqual([
      {
        title: "Review deployment diagnostics",
        reasonCodes: ["custom_warning"],
        steps: [
          "Read the failing diagnostics in order and address the first error before chasing later warnings.",
        ],
      },
    ]);
  });
});
