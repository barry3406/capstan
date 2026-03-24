export const LEGACY_APP_GRAPH_VERSION = 0;
export const CURRENT_APP_GRAPH_VERSION = 1;

export type ScalarType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "json";

export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface FieldSpec {
  type: ScalarType;
  required?: boolean;
  description?: string;
  constraints?: FieldConstraints;
}

export interface RelationSpec {
  resource: string;
  kind: "one" | "many";
  description?: string;
}

export interface ResourceSpec {
  key: string;
  title: string;
  description?: string;
  fields: Record<string, FieldSpec>;
  relations?: Record<string, RelationSpec>;
}

export interface InputFieldSpec {
  type: ScalarType;
  required?: boolean;
  description?: string;
  constraints?: FieldConstraints;
}

export interface CapabilitySpec {
  key: string;
  title: string;
  description?: string;
  mode: "read" | "write" | "external";
  input?: Record<string, InputFieldSpec>;
  output?: Record<string, FieldSpec>;
  resources?: string[];
  task?: string;
  policy?: string;
}

export interface TaskSpec {
  key: string;
  title: string;
  description?: string;
  kind: "sync" | "durable";
  artifacts?: string[];
}

export interface PolicySpec {
  key: string;
  title: string;
  description?: string;
  effect: "allow" | "approve" | "deny" | "redact";
}

export interface ArtifactSpec {
  key: string;
  title: string;
  description?: string;
  kind: "record" | "file" | "report" | "dataset" | "message";
}

export interface ViewSpec {
  key: string;
  title: string;
  description?: string;
  kind: "list" | "detail" | "form" | "dashboard" | "workspace";
  resource?: string;
  capability?: string;
}

export interface DomainSpec {
  key: string;
  title: string;
  description?: string;
}

export interface GraphPackSpec {
  key: string;
  options?: Record<string, unknown>;
}

export interface AppGraph {
  version?: number;
  domain: DomainSpec;
  packs?: GraphPackSpec[];
  resources: ResourceSpec[];
  capabilities: CapabilitySpec[];
  tasks?: TaskSpec[];
  policies?: PolicySpec[];
  artifacts?: ArtifactSpec[];
  views?: ViewSpec[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface NormalizedAppGraph {
  version: typeof CURRENT_APP_GRAPH_VERSION;
  domain: DomainSpec;
  packs: GraphPackSpec[];
  resources: ResourceSpec[];
  capabilities: CapabilitySpec[];
  tasks: TaskSpec[];
  policies: PolicySpec[];
  artifacts: ArtifactSpec[];
  views: ViewSpec[];
}

export interface GraphMetadata {
  sourceVersion: number;
  normalizedVersion: typeof CURRENT_APP_GRAPH_VERSION;
  upgraded: boolean;
  graphHash: string;
}

export interface GraphSummary {
  version: typeof CURRENT_APP_GRAPH_VERSION;
  domain: DomainSpec;
  valid: boolean;
  issueCount: number;
  counts: {
    packs: number;
    resources: number;
    capabilities: number;
    tasks: number;
    policies: number;
    artifacts: number;
    views: number;
  };
  keys: {
    packs: string[];
    resources: string[];
    capabilities: string[];
    tasks: string[];
    policies: string[];
    artifacts: string[];
    views: string[];
  };
}

export interface GraphIntrospection {
  metadata: GraphMetadata;
  summary: GraphSummary;
  normalizedGraph: NormalizedAppGraph;
  validation: ValidationResult;
}

export interface GraphCollectionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export interface GraphDiff {
  beforeDomain: DomainSpec;
  afterDomain: DomainSpec;
  domainChanged: boolean;
  packs: GraphCollectionDiff;
  resources: GraphCollectionDiff;
  capabilities: GraphCollectionDiff;
  tasks: GraphCollectionDiff;
  policies: GraphCollectionDiff;
  artifacts: GraphCollectionDiff;
  views: GraphCollectionDiff;
}

export function defineAppGraph(graph: AppGraph): AppGraph {
  return graph;
}

export function normalizeAppGraph(graph: AppGraph): NormalizedAppGraph {
  const upgraded = upgradeAppGraph(graph);

  return {
    version: CURRENT_APP_GRAPH_VERSION,
    domain: normalizeDomain(upgraded.domain),
    packs: sortByKey((upgraded.packs ?? []).map((pack) => normalizePack(pack))),
    resources: sortByKey(upgraded.resources.map((resource) => normalizeResource(resource))),
    capabilities: sortByKey(
      upgraded.capabilities.map((capability) => normalizeCapability(capability))
    ),
    tasks: sortByKey((upgraded.tasks ?? []).map((task) => normalizeTask(task))),
    policies: sortByKey((upgraded.policies ?? []).map((policy) => normalizePolicy(policy))),
    artifacts: sortByKey((upgraded.artifacts ?? []).map((artifact) => normalizeArtifact(artifact))),
    views: sortByKey((upgraded.views ?? []).map((view) => normalizeView(view)))
  };
}

export function validateAppGraph(graph: AppGraph): ValidationResult {
  const issues: ValidationIssue[] = [];
  const sourceVersion = resolveAppGraphVersion(graph);

  if (sourceVersion > CURRENT_APP_GRAPH_VERSION) {
    issues.push({
      path: "version",
      message: `Unsupported graph version "${sourceVersion}". Current version is "${CURRENT_APP_GRAPH_VERSION}".`
    });
  }

  if (sourceVersion < LEGACY_APP_GRAPH_VERSION) {
    issues.push({
      path: "version",
      message: `Graph version "${sourceVersion}" is not supported.`
    });
  }

  if (!graph.domain.key.trim()) {
    issues.push({
      path: "domain.key",
      message: "Domain key must not be empty."
    });
  }

  if (!graph.domain.title.trim()) {
    issues.push({
      path: "domain.title",
      message: "Domain title must not be empty."
    });
  }

  validateUniqueKeys(
    (graph.packs ?? []).map((pack) => ({
      key: pack.key,
      path: `packs.${pack.key || "<empty>"}`
    })),
    issues
  );
  const resourceKeys = validateUniqueKeys(
    graph.resources.map((resource) => ({
      key: resource.key,
      path: `resources.${resource.key || "<empty>"}`
    })),
    issues
  );
  const taskKeys = validateUniqueKeys(
    (graph.tasks ?? []).map((task) => ({
      key: task.key,
      path: `tasks.${task.key || "<empty>"}`
    })),
    issues
  );
  const policyKeys = validateUniqueKeys(
    (graph.policies ?? []).map((policy) => ({
      key: policy.key,
      path: `policies.${policy.key || "<empty>"}`
    })),
    issues
  );
  const artifactKeys = validateUniqueKeys(
    (graph.artifacts ?? []).map((artifact) => ({
      key: artifact.key,
      path: `artifacts.${artifact.key || "<empty>"}`
    })),
    issues
  );
  const capabilityKeys = validateUniqueKeys(
    graph.capabilities.map((capability) => ({
      key: capability.key,
      path: `capabilities.${capability.key || "<empty>"}`
    })),
    issues
  );
  const viewKeys = validateUniqueKeys(
    (graph.views ?? []).map((view) => ({
      key: view.key,
      path: `views.${view.key || "<empty>"}`
    })),
    issues
  );

  for (const resource of graph.resources) {
    if (!resource.title.trim()) {
      issues.push({
        path: `resources.${resource.key}.title`,
        message: "Resource title must not be empty."
      });
    }

    if (!Object.keys(resource.fields).length) {
      issues.push({
        path: `resources.${resource.key}.fields`,
        message: "Resource must declare at least one field."
      });
    }

    for (const [fieldKey, field] of Object.entries(resource.fields)) {
      validateFieldConstraints(
        field,
        `resources.${resource.key}.fields.${fieldKey}`,
        issues
      );
    }

    for (const [relationKey, relation] of Object.entries(resource.relations ?? {})) {
      if (!resourceKeys.has(relation.resource)) {
        issues.push({
          path: `resources.${resource.key}.relations.${relationKey}`,
          message: `Unknown resource reference "${relation.resource}".`
        });
      }
    }
  }

  for (const capability of graph.capabilities) {
    if (!capability.title.trim()) {
      issues.push({
        path: `capabilities.${capability.key}.title`,
        message: "Capability title must not be empty."
      });
    }

    for (const resourceKey of capability.resources ?? []) {
      if (!resourceKeys.has(resourceKey)) {
        issues.push({
          path: `capabilities.${capability.key}.resources`,
          message: `Unknown resource reference "${resourceKey}".`
        });
      }
    }

    for (const [fieldKey, field] of Object.entries(capability.input ?? {})) {
      validateFieldConstraints(
        field,
        `capabilities.${capability.key}.input.${fieldKey}`,
        issues
      );
    }

    for (const [fieldKey, field] of Object.entries(capability.output ?? {})) {
      validateFieldConstraints(
        field,
        `capabilities.${capability.key}.output.${fieldKey}`,
        issues
      );
    }

    if (capability.task && !taskKeys.has(capability.task)) {
      issues.push({
        path: `capabilities.${capability.key}.task`,
        message: `Unknown task reference "${capability.task}".`
      });
    }

    if (capability.policy && !policyKeys.has(capability.policy)) {
      issues.push({
        path: `capabilities.${capability.key}.policy`,
        message: `Unknown policy reference "${capability.policy}".`
      });
    }
  }

  for (const task of graph.tasks ?? []) {
    if (!task.title.trim()) {
      issues.push({
        path: `tasks.${task.key}.title`,
        message: "Task title must not be empty."
      });
    }

    for (const artifactKey of task.artifacts ?? []) {
      if (!artifactKeys.has(artifactKey)) {
        issues.push({
          path: `tasks.${task.key}.artifacts`,
          message: `Unknown artifact reference "${artifactKey}".`
        });
      }
    }
  }

  for (const policy of graph.policies ?? []) {
    if (!policy.title.trim()) {
      issues.push({
        path: `policies.${policy.key}.title`,
        message: "Policy title must not be empty."
      });
    }
  }

  for (const artifact of graph.artifacts ?? []) {
    if (!artifact.title.trim()) {
      issues.push({
        path: `artifacts.${artifact.key}.title`,
        message: "Artifact title must not be empty."
      });
    }
  }

  for (const view of graph.views ?? []) {
    if (!view.title.trim()) {
      issues.push({
        path: `views.${view.key}.title`,
        message: "View title must not be empty."
      });
    }

    if (view.resource && !resourceKeys.has(view.resource)) {
      issues.push({
        path: `views.${view.key}.resource`,
        message: `Unknown resource reference "${view.resource}".`
      });
    }

    if (view.capability && !capabilityKeys.has(view.capability)) {
      issues.push({
        path: `views.${view.key}.capability`,
        message: `Unknown capability reference "${view.capability}".`
      });
    }
  }

  if (!graph.resources.length) {
    issues.push({
      path: "resources",
      message: "Graph must contain at least one resource."
    });
  }

  if (!graph.capabilities.length) {
    issues.push({
      path: "capabilities",
      message: "Graph must contain at least one capability."
    });
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function inspectAppGraph(graph: AppGraph): GraphSummary {
  return introspectAppGraph(graph).summary;
}

export function getAppGraphMetadata(graph: AppGraph): GraphMetadata {
  const normalized = normalizeAppGraph(graph);

  return {
    sourceVersion: resolveAppGraphVersion(graph),
    normalizedVersion: CURRENT_APP_GRAPH_VERSION,
    upgraded: resolveAppGraphVersion(graph) !== CURRENT_APP_GRAPH_VERSION,
    graphHash: stableHash(normalized)
  };
}

export function introspectAppGraph(graph: AppGraph): GraphIntrospection {
  const normalized = normalizeAppGraph(graph);
  const validation = validateAppGraph(graph);
  const summary: GraphSummary = {
    version: normalized.version,
    domain: normalized.domain,
    valid: validation.ok,
    issueCount: validation.issues.length,
    counts: {
      packs: normalized.packs.length,
      resources: normalized.resources.length,
      capabilities: normalized.capabilities.length,
      tasks: normalized.tasks.length,
      policies: normalized.policies.length,
      artifacts: normalized.artifacts.length,
      views: normalized.views.length
    },
    keys: {
      packs: normalized.packs.map((pack) => pack.key),
      resources: normalized.resources.map((resource) => resource.key),
      capabilities: normalized.capabilities.map((capability) => capability.key),
      tasks: normalized.tasks.map((task) => task.key),
      policies: normalized.policies.map((policy) => policy.key),
      artifacts: normalized.artifacts.map((artifact) => artifact.key),
      views: normalized.views.map((view) => view.key)
    }
  };

  return {
    metadata: getAppGraphMetadata(graph),
    summary,
    normalizedGraph: normalized,
    validation
  };
}

export function diffAppGraphs(before: AppGraph, after: AppGraph): GraphDiff {
  const normalizedBefore = normalizeAppGraph(before);
  const normalizedAfter = normalizeAppGraph(after);

  return {
    beforeDomain: normalizedBefore.domain,
    afterDomain: normalizedAfter.domain,
    domainChanged: stableStringify(normalizedBefore.domain) !== stableStringify(normalizedAfter.domain),
    packs: diffCollection(normalizedBefore.packs, normalizedAfter.packs),
    resources: diffCollection(normalizedBefore.resources, normalizedAfter.resources),
    capabilities: diffCollection(normalizedBefore.capabilities, normalizedAfter.capabilities),
    tasks: diffCollection(normalizedBefore.tasks, normalizedAfter.tasks),
    policies: diffCollection(normalizedBefore.policies, normalizedAfter.policies),
    artifacts: diffCollection(normalizedBefore.artifacts, normalizedAfter.artifacts),
    views: diffCollection(normalizedBefore.views, normalizedAfter.views)
  };
}

export function upgradeAppGraph(graph: AppGraph): AppGraph {
  const sourceVersion = resolveAppGraphVersion(graph);

  if (sourceVersion > CURRENT_APP_GRAPH_VERSION) {
    throw new Error(
      `Cannot upgrade graph version "${sourceVersion}". Current version is "${CURRENT_APP_GRAPH_VERSION}".`
    );
  }

  if (sourceVersion < LEGACY_APP_GRAPH_VERSION) {
    throw new Error(`Cannot upgrade unsupported graph version "${sourceVersion}".`);
  }

  return {
    version: CURRENT_APP_GRAPH_VERSION,
    domain: graph.domain,
    packs: graph.packs ?? [],
    resources: graph.resources,
    capabilities: graph.capabilities,
    tasks: graph.tasks ?? [],
    policies: graph.policies ?? [],
    artifacts: graph.artifacts ?? [],
    views: graph.views ?? []
  };
}

export function resolveAppGraphVersion(graph: AppGraph): number {
  return graph.version ?? LEGACY_APP_GRAPH_VERSION;
}

function validateUniqueKeys(
  entries: Array<{ key: string; path: string }>,
  issues: ValidationIssue[]
): Set<string> {
  const keys = new Set<string>();

  for (const entry of entries) {
    const normalized = entry.key.trim();

    if (!normalized) {
      issues.push({
        path: entry.path,
        message: "Key must not be empty."
      });
      continue;
    }

    if (keys.has(normalized)) {
      issues.push({
        path: entry.path,
        message: `Duplicate key "${normalized}".`
      });
      continue;
    }

    keys.add(normalized);
  }

  return keys;
}

function normalizePack(pack: GraphPackSpec): GraphPackSpec {
  return {
    key: pack.key.trim(),
    ...(pack.options ? { options: normalizeRecord(pack.options) } : {})
  };
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key.trim(), normalizeUnknown(value)])
  );
}

function normalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknown(entry));
  }

  if (value && typeof value === "object") {
    return normalizeRecord(value as Record<string, unknown>);
  }

  return value;
}

function normalizeDomain(domain: DomainSpec): DomainSpec {
  return {
    key: domain.key.trim(),
    title: domain.title.trim(),
    ...optionalStringProperty("description", domain.description)
  };
}

function normalizeResource(resource: ResourceSpec): ResourceSpec {
  return {
    key: resource.key.trim(),
    title: resource.title.trim(),
    ...optionalStringProperty("description", resource.description),
    fields: sortRecord(resource.fields, (field) => normalizeField(field)),
    ...optionalRecordProperty(
      "relations",
      resource.relations,
      (relation) => normalizeRelation(relation)
    )
  };
}

function normalizeField(field: FieldSpec): FieldSpec {
  return {
    type: field.type,
    ...optionalBooleanProperty("required", field.required),
    ...optionalStringProperty("description", field.description),
    ...optionalConstraintsProperty("constraints", field.constraints)
  };
}

function normalizeInputField(field: InputFieldSpec): InputFieldSpec {
  return {
    type: field.type,
    ...optionalBooleanProperty("required", field.required),
    ...optionalStringProperty("description", field.description),
    ...optionalConstraintsProperty("constraints", field.constraints)
  };
}

function normalizeRelation(relation: RelationSpec): RelationSpec {
  return {
    resource: relation.resource.trim(),
    kind: relation.kind,
    ...optionalStringProperty("description", relation.description)
  };
}

function normalizeCapability(capability: CapabilitySpec): CapabilitySpec {
  return {
    key: capability.key.trim(),
    title: capability.title.trim(),
    mode: capability.mode,
    ...optionalStringProperty("description", capability.description),
    ...optionalRecordProperty("input", capability.input, (field) => normalizeInputField(field)),
    ...optionalRecordProperty("output", capability.output, (field) => normalizeField(field)),
    ...optionalArrayProperty(
      "resources",
      capability.resources?.map((resource) => resource.trim()).sort((left, right) =>
        left.localeCompare(right)
      )
    ),
    ...optionalStringProperty("task", capability.task),
    ...optionalStringProperty("policy", capability.policy)
  };
}

function normalizeTask(task: TaskSpec): TaskSpec {
  return {
    key: task.key.trim(),
    title: task.title.trim(),
    kind: task.kind,
    ...optionalStringProperty("description", task.description),
    ...optionalArrayProperty(
      "artifacts",
      task.artifacts?.map((artifact) => artifact.trim()).sort((left, right) =>
        left.localeCompare(right)
      )
    )
  };
}

function normalizePolicy(policy: PolicySpec): PolicySpec {
  return {
    key: policy.key.trim(),
    title: policy.title.trim(),
    effect: policy.effect,
    ...optionalStringProperty("description", policy.description)
  };
}

function normalizeArtifact(artifact: ArtifactSpec): ArtifactSpec {
  return {
    key: artifact.key.trim(),
    title: artifact.title.trim(),
    kind: artifact.kind,
    ...optionalStringProperty("description", artifact.description)
  };
}

function normalizeView(view: ViewSpec): ViewSpec {
  return {
    key: view.key.trim(),
    title: view.title.trim(),
    kind: view.kind,
    ...optionalStringProperty("description", view.description),
    ...optionalStringProperty("resource", view.resource),
    ...optionalStringProperty("capability", view.capability)
  };
}

function optionalStringProperty<Key extends string>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } as Record<Key, string> : {};
}

function optionalBooleanProperty<Key extends string>(
  key: Key,
  value: boolean | undefined
): Partial<Record<Key, boolean>> {
  return typeof value === "boolean" ? ({ [key]: value } as Record<Key, boolean>) : {};
}

function optionalArrayProperty<Key extends string>(
  key: Key,
  value: string[] | undefined
): Partial<Record<Key, string[]>> {
  return value && value.length ? ({ [key]: value } as Record<Key, string[]>) : {};
}

function optionalConstraintsProperty<Key extends string>(
  key: Key,
  value: FieldConstraints | undefined
): Partial<Record<Key, FieldConstraints>> {
  if (!value) {
    return {};
  }

  const normalized = normalizeConstraints(value);
  return Object.keys(normalized).length
    ? ({ [key]: normalized } as Record<Key, FieldConstraints>)
    : {};
}

function optionalRecordProperty<
  Key extends string,
  Value,
  NormalizedValue
>(
  key: Key,
  value: Record<string, Value> | undefined,
  normalize: (entry: Value) => NormalizedValue
): Partial<Record<Key, Record<string, NormalizedValue>>> {
  if (!value || !Object.keys(value).length) {
    return {};
  }

  return {
    [key]: sortRecord(value, normalize)
  } as Record<Key, Record<string, NormalizedValue>>;
}

function sortRecord<Value, NormalizedValue>(
  record: Record<string, Value>,
  normalize: (entry: Value) => NormalizedValue
): Record<string, NormalizedValue> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key.trim(), normalize(value)])
  );
}

function sortByKey<Value extends { key: string }>(entries: Value[]): Value[] {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

function diffCollection<Value extends { key: string }>(
  before: Value[],
  after: Value[]
): GraphCollectionDiff {
  const beforeMap = new Map(before.map((entry) => [entry.key, stableStringify(entry)]));
  const afterMap = new Map(after.map((entry) => [entry.key, stableStringify(entry)]));
  const allKeys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((left, right) =>
    left.localeCompare(right)
  );

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const key of allKeys) {
    const beforeValue = beforeMap.get(key);
    const afterValue = afterMap.get(key);

    if (!beforeValue && afterValue) {
      added.push(key);
      continue;
    }

    if (beforeValue && !afterValue) {
      removed.push(key);
      continue;
    }

    if (beforeValue === afterValue) {
      unchanged.push(key);
      continue;
    }

    changed.push(key);
  }

  return {
    added,
    removed,
    changed,
    unchanged
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  return hashString(stableStringify(value));
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function normalizeConstraints(constraints: FieldConstraints): FieldConstraints {
  return {
    ...optionalNumberProperty("minimum", constraints.minimum),
    ...optionalNumberProperty("maximum", constraints.maximum),
    ...optionalNumberProperty("minLength", constraints.minLength),
    ...optionalNumberProperty("maxLength", constraints.maxLength),
    ...optionalStringProperty("pattern", constraints.pattern),
    ...optionalArrayProperty(
      "enum",
      constraints.enum?.map((value) => value.trim()).filter(Boolean).sort((left, right) =>
        left.localeCompare(right)
      )
    )
  };
}

function optionalNumberProperty<Key extends string>(
  key: Key,
  value: number | undefined
): Partial<Record<Key, number>> {
  return typeof value === "number" ? ({ [key]: value } as Record<Key, number>) : {};
}

function validateFieldConstraints(
  field: FieldSpec | InputFieldSpec,
  path: string,
  issues: ValidationIssue[]
): void {
  const constraints = field.constraints;
  if (!constraints) {
    return;
  }

  if (
    typeof constraints.minLength === "number" &&
    typeof constraints.maxLength === "number" &&
    constraints.minLength > constraints.maxLength
  ) {
    issues.push({
      path: `${path}.constraints`,
      message: "minLength cannot be greater than maxLength."
    });
  }

  if (
    typeof constraints.minimum === "number" &&
    typeof constraints.maximum === "number" &&
    constraints.minimum > constraints.maximum
  ) {
    issues.push({
      path: `${path}.constraints`,
      message: "minimum cannot be greater than maximum."
    });
  }

  if (
    (typeof constraints.minLength === "number" ||
      typeof constraints.maxLength === "number" ||
      typeof constraints.pattern === "string") &&
    field.type !== "string"
  ) {
    issues.push({
      path: `${path}.constraints`,
      message: "String constraints require the field type to be \"string\"."
    });
  }

  if (
    (typeof constraints.minimum === "number" || typeof constraints.maximum === "number") &&
    field.type !== "number" &&
    field.type !== "integer"
  ) {
    issues.push({
      path: `${path}.constraints`,
      message: "Numeric constraints require the field type to be \"number\" or \"integer\"."
    });
  }

  if (typeof constraints.pattern === "string") {
    try {
      new RegExp(constraints.pattern);
    } catch {
      issues.push({
        path: `${path}.constraints.pattern`,
        message: "Pattern must be a valid regular expression."
      });
    }
  }

  if (constraints.enum) {
    if (!constraints.enum.length) {
      issues.push({
        path: `${path}.constraints.enum`,
        message: "Enum constraints must contain at least one value."
      });
    }

    if (new Set(constraints.enum).size !== constraints.enum.length) {
      issues.push({
        path: `${path}.constraints.enum`,
        message: "Enum constraints must not contain duplicate values."
      });
    }
  }
}
