import { describe, expect, it } from "vitest";
import {
  parseTypeScriptDiagnostics,
  renderVerifyReportText,
  suggestRepairHint,
  type VerifyReport
} from "../../packages/feedback/src/index.ts";

describe("feedback", () => {
  it("parses TypeScript diagnostics into structured repairable entries", () => {
    const diagnostics = parseTypeScriptDiagnostics(`
/tmp/example/src/capabilities/list-tickets.ts(7,5): error TS2322: Type '"pending"' is not assignable to type '"completed" | "failed"'.
/tmp/example/src/agent-surface/transport.ts(12,18): error TS2339: Property 'task' does not exist on type '{}'.
`);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      code: "typescript_error",
      severity: "error",
      detail: "TS2322",
      line: 7,
      column: 5,
      source: "typescript"
    });
    expect(diagnostics[0]?.hint).toContain("Align the handler output");
    expect(diagnostics[1]?.hint).toContain("Compare the handler payload");
  });

  it("renders a readable verify report summary", () => {
    const report: VerifyReport = {
      appRoot: "/tmp/example",
      status: "failed",
      generatedBy: "capstan-feedback",
      steps: [
        {
          key: "structure",
          label: "Generated Structure",
          status: "passed",
          durationMs: 4,
          diagnostics: []
        },
        {
          key: "typecheck",
          label: "TypeScript Check",
          status: "failed",
          durationMs: 22,
          diagnostics: [
            {
              code: "typescript_error",
              severity: "error",
              summary: `Type '"pending"' is not assignable to type '"completed" | "failed"'`,
              hint: suggestRepairHint(`Type '"pending"' is not assignable to type '"completed" | "failed"'`),
              file: "/tmp/example/src/capabilities/list-tickets.ts",
              line: 7,
              column: 5,
              source: "typescript"
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "typescript_error",
          severity: "error",
          summary: `Type '"pending"' is not assignable to type '"completed" | "failed"'`,
          hint: suggestRepairHint(`Type '"pending"' is not assignable to type '"completed" | "failed"'`),
          file: "/tmp/example/src/capabilities/list-tickets.ts",
          line: 7,
          column: 5,
          source: "typescript"
        }
      ],
      summary: {
        status: "failed",
        stepCount: 2,
        passedSteps: 1,
        failedSteps: 1,
        skippedSteps: 0,
        diagnosticCount: 1,
        errorCount: 1,
        warningCount: 0
      }
    };

    const output = renderVerifyReportText(report);

    expect(output).toContain("Capstan Verify");
    expect(output).toContain("Status: failed");
    expect(output).toContain("[passed] Generated Structure");
    expect(output).toContain("[failed] TypeScript Check");
    expect(output).toContain("hint: Align the handler output");
    expect(output).toContain("Repair Checklist");
    expect(output).toContain("1. TypeScript Check");
    expect(output).toContain("next: Align the handler output");
  });
});
