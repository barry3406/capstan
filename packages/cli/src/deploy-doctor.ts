import type { DeployContractDiagnostic } from "./deploy-integrity.js";
import type { BuildTarget } from "./deploy-targets.js";

export interface DeploymentDoctorAction {
  title: string;
  reasonCodes: string[];
  steps: string[];
}

function pushAction(
  actions: DeploymentDoctorAction[],
  title: string,
  reasonCodes: string[],
  steps: string[],
): void {
  const existing = actions.find((action) => action.title === title);
  if (existing) {
    existing.reasonCodes = [...new Set([...existing.reasonCodes, ...reasonCodes])].sort();
    existing.steps = [...new Set([...existing.steps, ...steps])];
    return;
  }

  actions.push({
    title,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    steps: [...new Set(steps)],
  });
}

export function createDeploymentDoctorActions(
  target: BuildTarget,
  diagnostics: readonly DeployContractDiagnostic[],
): DeploymentDoctorAction[] {
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  const actions: DeploymentDoctorAction[] = [];

  if (
    codes.has("missing_deploy_manifest")
    || codes.has("missing_target_contract")
    || codes.has("missing_portable_runtime")
  ) {
    pushAction(
      actions,
      "Rebuild the deployment bundle",
      ["missing_deploy_manifest", "missing_target_contract", "missing_portable_runtime"],
      [
        `Run \`capstan build --target ${target}\` from the project root.`,
        "Avoid copying partial files into dist/ after the build completes.",
      ],
    );
  }

  if (codes.has("target_mismatch")) {
    pushAction(
      actions,
      "Align verify/start with the built target",
      ["target_mismatch"],
      [
        "Re-run build with the target you want to ship, or verify against the manifest's current target.",
        "Do not reuse a dist/ directory produced for a different deployment target.",
      ],
    );
  }

  if (codes.has("artifact_hash_mismatch")) {
    pushAction(
      actions,
      "Regenerate tampered artifacts",
      ["artifact_hash_mismatch"],
      [
        "Delete the current dist/ output and rebuild from source.",
        "Do not hand-edit generated deployment artifacts after build time.",
      ],
    );
  }

  if (
    codes.has("sqlite_edge_unsupported")
    || codes.has("sqlite_distribution_risk")
    || codes.has("edge_auth_runtime")
    || codes.has("worker_auth_runtime")
    || codes.has("node_runtime_imports")
  ) {
    pushAction(
      actions,
      "Fix target/runtime compatibility",
      [
        "sqlite_edge_unsupported",
        "sqlite_distribution_risk",
        "edge_auth_runtime",
        "worker_auth_runtime",
        "node_runtime_imports",
      ],
      [
        "Move the app back to a Node target if it depends on SQLite, session auth, or node: imports.",
        "If you need edge/worker deployment, replace Node-only APIs and switch to a network database.",
      ],
    );
  }

  if (codes.has("config_load_failed")) {
    pushAction(
      actions,
      "Fix config evaluation",
      ["config_load_failed"],
      [
        "Make sure capstan.config only imports modules that exist in the current environment.",
        "Re-run verify after the config loads cleanly.",
      ],
    );
  }

  if (actions.length === 0 && diagnostics.length > 0) {
    pushAction(
      actions,
      "Review deployment diagnostics",
      diagnostics.map((diagnostic) => diagnostic.code),
      [
        "Read the failing diagnostics in order and address the first error before chasing later warnings.",
      ],
    );
  }

  return actions;
}
