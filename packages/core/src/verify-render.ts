import type { VerifyReport } from "./verify.js";

/**
 * Render a VerifyReport as human-readable text output.
 *
 * Uses simple ASCII indicators: check mark for pass, x for fail, dash for skip.
 */
export function renderRuntimeVerifyText(report: VerifyReport): string {
  const lines: string[] = [];

  lines.push("Capstan Verify");
  lines.push("");

  for (const step of report.steps) {
    const icon =
      step.status === "passed" ? "\u2713" : step.status === "failed" ? "\u2717" : "-";
    const durationLabel =
      step.status === "skipped" ? "skipped" : `${step.durationMs}ms`;

    lines.push(`  ${icon} ${step.name.padEnd(14)} (${durationLabel})`);

    for (const diagnostic of step.diagnostics) {
      if (diagnostic.severity === "info") {
        continue;
      }

      const marker = diagnostic.severity === "error" ? "\u2717" : "!";
      lines.push(`    ${marker} ${diagnostic.message}`);
      if (diagnostic.hint) {
        lines.push(`      \u2192 ${diagnostic.hint}`);
      }
    }
  }

  lines.push("");
  lines.push(
    `  ${report.summary.errorCount} error${report.summary.errorCount !== 1 ? "s" : ""}, ${report.summary.warningCount} warning${report.summary.warningCount !== 1 ? "s" : ""}`,
  );

  if (report.repairChecklist.length > 0) {
    lines.push("");
    lines.push("  Repair Checklist:");
    for (const item of report.repairChecklist) {
      lines.push(`    ${item.index}. [${item.step}] ${item.message}`);
      if (item.hint) {
        lines.push(`       \u2192 ${item.hint}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
