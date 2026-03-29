export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface DomainDefinition {
  key: string;
  title: string;
  description?: string;
}

export interface ResourceDefinition {
  key: string;
  title: string;
  description?: string;
  fields: Record<string, FieldDefinition>;
  relations?: Record<string, RelationDefinition>;
}

export interface FieldDefinition {
  type: "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "json";
  required?: boolean;
  description?: string;
  constraints?: FieldConstraints;
}

export interface RelationDefinition {
  resource: string;
  kind: "one" | "many";
  description?: string;
}

export interface CapabilityDefinition {
  key: string;
  title: string;
  description?: string;
  mode: "read" | "write" | "external";
  input?: Record<string, FieldDefinition>;
  output?: Record<string, FieldDefinition>;
  resources?: string[];
  task?: string;
  policy?: string;
}

export interface CapabilityExecutionResult {
  capability: string;
  status:
    | "not_implemented"
    | "completed"
    | "failed"
    | "blocked"
    | "approval_required"
    | "input_required"
    | "cancelled";
  input: Record<string, unknown>;
  output?: unknown;
  note?: string;
}

export interface TaskDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "sync" | "durable";
  artifacts?: string[];
}

export interface PolicyDefinition {
  key: string;
  title: string;
  description?: string;
  effect: "allow" | "approve" | "deny" | "redact";
}

export interface ArtifactDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "record" | "file" | "report" | "dataset" | "message";
}

export interface ViewDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "list" | "detail" | "form" | "dashboard" | "workspace";
  resource?: string;
  capability?: string;
}

export interface AppAssertionContext {
  domain: DomainDefinition;
  resources: readonly ResourceDefinition[];
  capabilities: readonly CapabilityDefinition[];
  tasks: readonly TaskDefinition[];
  policies: readonly PolicyDefinition[];
  artifacts: readonly ArtifactDefinition[];
  views: readonly ViewDefinition[];
  controlPlane: {
    search(query?: string): unknown;
  };
  agentSurface: {
    summary?: {
      capabilityCount?: number;
      taskCount?: number;
      artifactCount?: number;
    };
    capabilities?: readonly unknown[];
    tasks?: readonly unknown[];
    artifacts?: readonly unknown[];
  };
  humanSurface: {
    summary?: {
      resourceCount?: number;
      capabilityCount?: number;
      routeCount?: number;
    };
    routes?: readonly { key?: string }[];
  };
  createHumanSurfaceRuntimeSnapshot(): {
    activeRouteKey: string;
    results: Record<string, unknown>;
  };
}

export interface AppAssertionResult {
  status: "passed" | "failed";
  summary: string;
  detail?: string;
  hint?: string;
  file?: string;
}

export interface AppAssertion {
  key: string;
  title: string;
  source?: "generated" | "custom";
  run(
    context: AppAssertionContext
  ): AppAssertionResult | Promise<AppAssertionResult>;
}

export interface ReleaseEnvironmentVariable {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface ReleaseSecret {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface ReleaseArtifact {
  key: string;
  title: string;
  kind: "directory" | "json" | "html" | "file";
  path: string;
  required?: boolean;
}

export interface ReleaseHealthCheck {
  key: string;
  title: string;
  kind: "verify_pass" | "path_exists" | "json_parse";
  target?: string;
  description?: string;
  required?: boolean;
}

export interface ReleaseStep {
  key: string;
  title: string;
  description?: string;
  command?: string;
}

export interface ReleaseEnvironment {
  key: string;
  title: string;
  strategy: "ephemeral" | "managed";
  baseUrl?: string;
  variables: readonly ReleaseEnvironmentVariable[];
  secrets: readonly ReleaseSecret[];
}

export interface ReleaseInputReference {
  path: string;
  title: string;
  description?: string;
}

export interface ReleaseEnvironmentSnapshotEntry {
  key: string;
  variables: Record<string, string>;
  secrets: readonly string[];
}

export interface ReleaseEnvironmentSnapshot {
  version: 1;
  environments: readonly ReleaseEnvironmentSnapshotEntry[];
}

export interface ReleaseMigrationStep {
  key: string;
  title: string;
  status: "applied" | "pending" | "unsafe";
  description?: string;
  command?: string;
}

export interface ReleaseMigrationPlan {
  version: 1;
  generatedBy: "capstan";
  status: "safe" | "pending" | "unsafe";
  steps: readonly ReleaseMigrationStep[];
}

export interface ReleaseRollbackPlan {
  strategy: string;
  steps: readonly string[];
}

export interface ReleaseTraceSpec {
  captures: readonly string[];
}

export interface ReleaseContract {
  version: 1;
  domain: DomainDefinition;
  application: {
    key: string;
    title: string;
    generatedBy: "capstan";
  };
  environments: readonly ReleaseEnvironment[];
  inputs: {
    environmentSnapshot: ReleaseInputReference;
    migrationPlan: ReleaseInputReference;
  };
  artifacts: readonly ReleaseArtifact[];
  healthChecks: readonly ReleaseHealthCheck[];
  preview: {
    steps: readonly ReleaseStep[];
  };
  release: {
    steps: readonly ReleaseStep[];
  };
  rollback: ReleaseRollbackPlan;
  trace: ReleaseTraceSpec;
}
