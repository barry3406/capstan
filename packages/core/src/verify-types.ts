export interface VerifyDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  file?: string;
  line?: number;
  column?: number;
  fixCategory?:
    | "type_error"
    | "schema_mismatch"
    | "missing_file"
    | "policy_violation"
    | "contract_drift"
    | "missing_export"
    | "protocol_drift"
    | "build_contract"
    | "package_contract";
  autoFixable?: boolean;
}

export interface VerifyStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  diagnostics: VerifyDiagnostic[];
}

export interface VerifyReport {
  status: "passed" | "failed";
  appRoot: string;
  timestamp: string;
  steps: VerifyStep[];
  repairChecklist: Array<{
    index: number;
    step: string;
    message: string;
    file?: string;
    line?: number;
    hint?: string;
    fixCategory?: string;
    autoFixable?: boolean;
  }>;
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    errorCount: number;
    warningCount: number;
  };
}
