export type AgentFrameworkSchema = Readonly<Record<string, unknown>>;
export type AgentFrameworkContractKind =
  | "capability"
  | "workflow"
  | "policy"
  | "memory_space"
  | "operator_view"
  | "agent_app";

export type AgentRiskLevel = "low" | "medium" | "high" | "critical";
export type AgentPolicyDecision = "allow" | "require_approval" | "deny";
export type AgentCapabilityVerificationMode = "none" | "assert" | "human";
export type AgentWorkflowConcurrency = "enqueue" | "replace" | "skip" | "parallel";
export type AgentMemoryScopeKind =
  | "run"
  | "project"
  | "resource"
  | "entity"
  | "capability"
  | "workflow"
  | "policy"
  | "custom";
export type AgentMemoryPromotionMode = "manual" | "verified" | "automatic";
export type AgentMemoryRetentionMode = "session" | "ttl" | "forever";
export type AgentMemoryRetrievalStrategy = "scope_first" | "recent_first" | "priority_first";
export type AgentOperatorProjectionKind =
  | "run_timeline"
  | "task_board"
  | "approval_inbox"
  | "artifact_feed"
  | "custom";
export type AgentOperatorActionKind =
  | "pause"
  | "resume"
  | "retry"
  | "cancel"
  | "approve"
  | "deny"
  | "request_input"
  | "open_artifact";
export type AgentPolicyTargetKind =
  | "capability"
  | "workflow"
  | "memory_space"
  | "operator_view"
  | "tool"
  | "task";

export interface AgentBaseContractInput {
  id: string;
  title?: string | undefined;
  description: string;
  tags?: readonly string[] | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AgentBaseContract<TKind extends AgentFrameworkContractKind> {
  readonly kind: TKind;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly metadata?: AgentFrameworkSchema | undefined;
}

export interface AgentCapabilityVerificationInput {
  mode?: AgentCapabilityVerificationMode | undefined;
  description?: string | undefined;
  requiredArtifacts?: readonly string[] | undefined;
}

export interface AgentCapabilityVerificationContract {
  readonly mode: AgentCapabilityVerificationMode;
  readonly description?: string | undefined;
  readonly requiredArtifacts: readonly string[];
}

export interface AgentCapabilityInput extends AgentBaseContractInput {
  input?: AgentFrameworkSchema | undefined;
  output?: AgentFrameworkSchema | undefined;
  tools?: readonly string[] | undefined;
  tasks?: readonly string[] | undefined;
  defaultPolicies?: readonly string[] | undefined;
  defaultMemorySpaces?: readonly string[] | undefined;
  artifactKinds?: readonly string[] | undefined;
  operatorSignals?: readonly string[] | undefined;
  verification?: AgentCapabilityVerificationInput | undefined;
}

export interface AgentCapabilityContract extends AgentBaseContract<"capability"> {
  readonly input?: AgentFrameworkSchema | undefined;
  readonly output?: AgentFrameworkSchema | undefined;
  readonly tools: readonly string[];
  readonly tasks: readonly string[];
  readonly defaultPolicies: readonly string[];
  readonly defaultMemorySpaces: readonly string[];
  readonly artifactKinds: readonly string[];
  readonly operatorSignals: readonly string[];
  readonly verification?: AgentCapabilityVerificationContract | undefined;
}

export interface AgentWorkflowTriggerInput {
  type: "manual" | "cron" | "event" | "webhook" | "queue";
  schedule?: string | undefined;
  event?: string | undefined;
  source?: string | undefined;
  queue?: string | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AgentWorkflowTriggerContract {
  readonly type: "manual" | "cron" | "event" | "webhook" | "queue";
  readonly schedule?: string | undefined;
  readonly event?: string | undefined;
  readonly source?: string | undefined;
  readonly queue?: string | undefined;
  readonly metadata?: AgentFrameworkSchema | undefined;
}

export interface AgentWorkflowRetryInput {
  maxAttempts?: number | undefined;
  backoffMs?: number | undefined;
}

export interface AgentWorkflowRetryContract {
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

export interface AgentWorkflowStageInput {
  id: string;
  capability: string;
  description: string;
  next?: readonly string[] | undefined;
  terminal?: boolean | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AgentWorkflowStageContract {
  readonly id: string;
  readonly capability: string;
  readonly description: string;
  readonly next: readonly string[];
  readonly terminal: boolean;
  readonly metadata?: AgentFrameworkSchema | undefined;
}

export interface AgentWorkflowCompletionInput {
  mode?: "final_stage" | "signal" | "operator" | "custom";
  signal?: string | undefined;
  description?: string | undefined;
}

export interface AgentWorkflowCompletionContract {
  readonly mode: "final_stage" | "signal" | "operator" | "custom";
  readonly signal?: string | undefined;
  readonly description?: string | undefined;
}

export interface AgentWorkflowInput extends AgentBaseContractInput {
  entryCapability: string;
  stages: readonly AgentWorkflowStageInput[];
  triggers?: readonly AgentWorkflowTriggerInput[] | undefined;
  retry?: AgentWorkflowRetryInput | undefined;
  completion?: AgentWorkflowCompletionInput | undefined;
  concurrency?: AgentWorkflowConcurrency | undefined;
  defaultPolicies?: readonly string[] | undefined;
  defaultMemorySpaces?: readonly string[] | undefined;
}

export interface AgentWorkflowContract extends AgentBaseContract<"workflow"> {
  readonly entryCapability: string;
  readonly stages: readonly AgentWorkflowStageContract[];
  readonly triggers: readonly AgentWorkflowTriggerContract[];
  readonly retry: AgentWorkflowRetryContract;
  readonly completion: AgentWorkflowCompletionContract;
  readonly concurrency: AgentWorkflowConcurrency;
  readonly defaultPolicies: readonly string[];
  readonly defaultMemorySpaces: readonly string[];
}

export interface AgentPolicyTargetInput {
  kind: AgentPolicyTargetKind;
  ids: readonly string[];
}

export interface AgentPolicyTargetContract {
  readonly kind: AgentPolicyTargetKind;
  readonly ids: readonly string[];
}

export interface AgentPolicyRuleInput {
  id: string;
  appliesTo: readonly AgentPolicyTargetInput[];
  action: AgentPolicyDecision;
  reason: string;
  risk?: AgentRiskLevel | undefined;
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AgentPolicyRuleContract {
  readonly id: string;
  readonly appliesTo: readonly AgentPolicyTargetContract[];
  readonly action: AgentPolicyDecision;
  readonly reason: string;
  readonly risk: AgentRiskLevel;
  readonly metadata?: AgentFrameworkSchema | undefined;
}

export interface AgentPolicyFallbackInput {
  action: AgentPolicyDecision;
  reason: string;
  risk?: AgentRiskLevel | undefined;
}

export interface AgentPolicyFallbackContract {
  readonly action: AgentPolicyDecision;
  readonly reason: string;
  readonly risk: AgentRiskLevel;
}

export interface AgentPolicyInput extends AgentBaseContractInput {
  rules: readonly AgentPolicyRuleInput[];
  fallback?: AgentPolicyFallbackInput | undefined;
}

export interface AgentPolicyContract extends AgentBaseContract<"policy"> {
  readonly rules: readonly AgentPolicyRuleContract[];
  readonly fallback: AgentPolicyFallbackContract;
}

export interface AgentMemoryPromotionInput {
  mode?: AgentMemoryPromotionMode | undefined;
  minConfidence?: number | undefined;
}

export interface AgentMemoryPromotionContract {
  readonly mode: AgentMemoryPromotionMode;
  readonly minConfidence?: number | undefined;
}

export interface AgentMemoryRetentionInput {
  mode?: AgentMemoryRetentionMode | undefined;
  ttlDays?: number | undefined;
  maxItems?: number | undefined;
}

export interface AgentMemoryRetentionContract {
  readonly mode: AgentMemoryRetentionMode;
  readonly ttlDays?: number | undefined;
  readonly maxItems?: number | undefined;
}

export interface AgentMemoryRetrievalInput {
  strategy?: AgentMemoryRetrievalStrategy | undefined;
  maxItems?: number | undefined;
  minScore?: number | undefined;
}

export interface AgentMemoryRetrievalContract {
  readonly strategy: AgentMemoryRetrievalStrategy;
  readonly maxItems: number;
  readonly minScore: number;
}

export interface AgentMemoryGraphBindingInput {
  enabled?: boolean | undefined;
  nodeKinds?: readonly string[] | undefined;
}

export interface AgentMemoryGraphBindingContract {
  readonly enabled: boolean;
  readonly nodeKinds: readonly string[];
}

export interface AgentMemorySpaceInput extends AgentBaseContractInput {
  scope: AgentMemoryScopeKind;
  recordKinds?: readonly string[] | undefined;
  promotion?: AgentMemoryPromotionInput | undefined;
  retention?: AgentMemoryRetentionInput | undefined;
  retrieval?: AgentMemoryRetrievalInput | undefined;
  graphBinding?: AgentMemoryGraphBindingInput | undefined;
}

export interface AgentMemorySpaceContract extends AgentBaseContract<"memory_space"> {
  readonly scope: AgentMemoryScopeKind;
  readonly recordKinds: readonly string[];
  readonly promotion: AgentMemoryPromotionContract;
  readonly retention: AgentMemoryRetentionContract;
  readonly retrieval: AgentMemoryRetrievalContract;
  readonly graphBinding: AgentMemoryGraphBindingContract;
}

export interface AgentOperatorViewFilterInput {
  capabilityIds?: readonly string[] | undefined;
  workflowIds?: readonly string[] | undefined;
  policyIds?: readonly string[] | undefined;
  memorySpaceIds?: readonly string[] | undefined;
  nodeKinds?: readonly string[] | undefined;
  artifactKinds?: readonly string[] | undefined;
  text?: string | undefined;
}

export interface AgentOperatorViewFilterContract {
  readonly capabilityIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly policyIds: readonly string[];
  readonly memorySpaceIds: readonly string[];
  readonly nodeKinds: readonly string[];
  readonly artifactKinds: readonly string[];
  readonly text?: string | undefined;
}

export interface AgentOperatorViewInput extends AgentBaseContractInput {
  scope: AgentMemoryScopeKind;
  projection?: AgentOperatorProjectionKind | undefined;
  customProjection?: string | undefined;
  filters?: AgentOperatorViewFilterInput | undefined;
  actions?: readonly AgentOperatorActionKind[] | undefined;
}

export interface AgentOperatorViewContract extends AgentBaseContract<"operator_view"> {
  readonly scope: AgentMemoryScopeKind;
  readonly projection: AgentOperatorProjectionKind;
  readonly customProjection?: string | undefined;
  readonly filters: AgentOperatorViewFilterContract;
  readonly actions: readonly AgentOperatorActionKind[];
}

export interface AgentAppDefaultsInput {
  defaultWorkflow?: string | undefined;
  defaultPolicies?: readonly string[] | undefined;
  defaultMemorySpaces?: readonly string[] | undefined;
}

export interface AgentAppDefaultsContract {
  readonly defaultWorkflow?: string | undefined;
  readonly defaultPolicies: readonly string[];
  readonly defaultMemorySpaces: readonly string[];
}

export interface AgentAppInput extends AgentBaseContractInput {
  capabilities: readonly AgentCapabilityInput[];
  workflows?: readonly AgentWorkflowInput[] | undefined;
  policies?: readonly AgentPolicyInput[] | undefined;
  memorySpaces?: readonly AgentMemorySpaceInput[] | undefined;
  operatorViews?: readonly AgentOperatorViewInput[] | undefined;
  defaults?: AgentAppDefaultsInput | undefined;
}

export interface AgentAppCatalog {
  readonly capabilities: Readonly<Record<string, AgentCapabilityContract>>;
  readonly workflows: Readonly<Record<string, AgentWorkflowContract>>;
  readonly policies: Readonly<Record<string, AgentPolicyContract>>;
  readonly memorySpaces: Readonly<Record<string, AgentMemorySpaceContract>>;
  readonly operatorViews: Readonly<Record<string, AgentOperatorViewContract>>;
}

export interface AgentAppContract extends AgentBaseContract<"agent_app"> {
  readonly capabilities: readonly AgentCapabilityContract[];
  readonly workflows: readonly AgentWorkflowContract[];
  readonly policies: readonly AgentPolicyContract[];
  readonly memorySpaces: readonly AgentMemorySpaceContract[];
  readonly operatorViews: readonly AgentOperatorViewContract[];
  readonly defaults: AgentAppDefaultsContract;
  readonly indexes: AgentAppCatalog;
}

export interface AgentAppSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly defaults: {
    readonly defaultWorkflow?: string | undefined;
    readonly defaultPolicies: readonly string[];
    readonly defaultMemorySpaces: readonly string[];
  };
  readonly capabilities: ReadonlyArray<Pick<AgentCapabilityContract, "id" | "title" | "description">>;
  readonly workflows: ReadonlyArray<
    Pick<AgentWorkflowContract, "id" | "title" | "description" | "entryCapability">
  >;
  readonly policies: ReadonlyArray<Pick<AgentPolicyContract, "id" | "title" | "description">>;
  readonly memorySpaces: ReadonlyArray<
    Pick<AgentMemorySpaceContract, "id" | "title" | "description" | "scope">
  >;
  readonly operatorViews: ReadonlyArray<
    Pick<AgentOperatorViewContract, "id" | "title" | "description" | "scope" | "projection">
  >;
}
