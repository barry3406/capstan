import type {
  AppGraph,
  ArtifactSpec,
  DomainSpec,
  FieldSpec,
  GraphPackSpec,
  InputFieldSpec,
  RelationSpec,
  ScalarType
} from "@zauso-ai/capstan-app-graph";
import type { GraphPackDefinition } from "@zauso-ai/capstan-packs-core";
import { listBuiltinGraphPacks, resolvePackSelections } from "@zauso-ai/capstan-packs-core";

export const CURRENT_CAPSTAN_BRIEF_VERSION = 1;

export type BriefFieldInput = ScalarType | FieldSpec;
export type BriefInputFieldInput = ScalarType | InputFieldSpec;
export type BriefApplicationProfile = "saas" | "internal_ops" | "agent_tool";
export type BriefModule = "workflow" | "connectors" | "billing" | "commerce" | "revenueOps";
export interface BriefModuleConfig {
  key: BriefModule;
  options?: Record<string, unknown>;
}
export type BriefModuleSelection = BriefModule | BriefModuleConfig;

export interface BriefApplication {
  profile?: BriefApplicationProfile;
  modules?: BriefModuleSelection[];
}

export interface NormalizedBriefApplication {
  profile?: BriefApplicationProfile;
  modules?: BriefModuleConfig[];
}

export interface BriefListAction {
  enabled?: boolean;
  key?: string;
  title?: string;
  description?: string;
  output?: Record<string, BriefFieldInput>;
  viewKey?: string;
  viewTitle?: string;
}

export interface BriefWriteAction {
  enabled?: boolean;
  verb?: string;
  key?: string;
  title?: string;
  description?: string;
  input?: Record<string, BriefInputFieldInput>;
  output?: Record<string, BriefFieldInput>;
  viewKey?: string;
  viewTitle?: string;
}

export interface BriefExecuteAction {
  enabled?: boolean;
  verb?: string;
  key?: string;
  title?: string;
  description?: string;
  input?: Record<string, BriefInputFieldInput>;
  output?: Record<string, BriefFieldInput>;
  taskKey?: string;
  taskTitle?: string;
  taskDescription?: string;
  artifactKey?: string;
  artifactTitle?: string;
  artifactDescription?: string;
  artifactKind?: ArtifactSpec["kind"];
  approvalPolicyKey?: string;
  approvalTitle?: string;
  approvalDescription?: string;
  viewKey?: string;
  viewTitle?: string;
}

export interface BriefRelationTarget {
  target: string;
  kind?: RelationSpec["kind"];
  description?: string;
}

export type BriefRelationInput = RelationSpec | BriefRelationTarget | string;

export interface BriefEntity {
  name: string;
  plural?: string;
  resourceKey?: string;
  title?: string;
  description?: string;
  fields: Record<string, BriefFieldInput>;
  relations?: Record<string, BriefRelationInput>;
  actions?: {
    list?: boolean | BriefListAction;
    write?: boolean | BriefWriteAction;
    execute?: boolean | BriefExecuteAction;
  };
}

export interface CapstanBrief {
  version?: number;
  domain: DomainSpec;
  application?: BriefApplication;
  packs?: GraphPackSpec[];
  entities: BriefEntity[];
}

export interface BriefValidationIssue {
  path: string;
  message: string;
}

export interface BriefValidationResult {
  ok: boolean;
  issues: BriefValidationIssue[];
}

export interface BriefSummary {
  version: number;
  domain: DomainSpec;
  application?: NormalizedBriefApplication;
  counts: {
    packs: number;
    entities: number;
  };
  keys: {
    packs: string[];
    entities: string[];
  };
  packPlan: {
    explicit: string[];
    inferred: string[];
    combined: string[];
    resolved: string[];
  };
}

export function defineCapstanBrief(brief: CapstanBrief): CapstanBrief {
  return brief;
}

export function summarizeCapstanBrief(
  brief: CapstanBrief,
  options: {
    packDefinitions?: readonly GraphPackDefinition[];
  } = {}
): BriefSummary {
  const packPlan = planCapstanBriefPacks(brief, options);
  const summary: BriefSummary = {
    version: resolveBriefVersion(brief),
    domain: normalizeDomain(brief.domain),
    counts: {
      packs: packPlan.combined.length,
      entities: brief.entities.length
    },
    keys: {
      packs: packPlan.combined.map((pack) => pack.key),
      entities: brief.entities.map((entity) => deriveResourceKey(entity)).sort()
    },
    packPlan: {
      explicit: packPlan.explicit.map((pack) => pack.key),
      inferred: packPlan.inferred.map((pack) => pack.key),
      combined: packPlan.combined.map((pack) => pack.key),
      resolved: packPlan.resolved.map((pack) => pack.key)
    }
  };

  const application = normalizeBriefApplication(brief.application);
  if (application) {
    summary.application = application;
  }

  return summary;
}

export function planCapstanBriefPacks(
  brief: CapstanBrief,
  options: {
    packDefinitions?: readonly GraphPackDefinition[];
  } = {}
): {
  explicit: GraphPackSpec[];
  inferred: GraphPackSpec[];
  combined: GraphPackSpec[];
  resolved: GraphPackSpec[];
} {
  const explicit = normalizePackSelections(brief.packs ?? []);
  const inferred = inferBriefPackSelections(brief);
  const explicitKeys = new Set(explicit.map((pack) => pack.key));
  const combined = [
    ...explicit,
    ...inferred.filter((pack) => !explicitKeys.has(pack.key))
  ];
  const registry = new Map(
    [...listBuiltinGraphPacks(), ...(options.packDefinitions ?? [])].map((pack) => [pack.key, pack] as const)
  );
  const resolved = combined.length ? resolvePackSelections(combined, registry) : [];

  return {
    explicit,
    inferred,
    combined,
    resolved
  };
}

export function validateCapstanBrief(brief: CapstanBrief): BriefValidationResult {
  const issues: BriefValidationIssue[] = [];
  const version = resolveBriefVersion(brief);
  const inferredPacks = inferBriefPackSelections(brief);
  const entityLookup = createBriefEntityLookup(brief.entities);

  if (version !== CURRENT_CAPSTAN_BRIEF_VERSION) {
    issues.push({
      path: "version",
      message: `Unsupported brief version "${version}". Current version is "${CURRENT_CAPSTAN_BRIEF_VERSION}".`
    });
  }

  if (!brief.domain.key.trim()) {
    issues.push({
      path: "domain.key",
      message: "Domain key must not be empty."
    });
  }

  if (!brief.domain.title.trim()) {
    issues.push({
      path: "domain.title",
      message: "Domain title must not be empty."
    });
  }

  const application = brief.application;
  if (application?.profile && !isBriefApplicationProfile(application.profile)) {
    issues.push({
      path: "application.profile",
      message: `Unsupported application profile "${application.profile}".`
    });
  }

  const validatedModules: Array<{ key: string; path: string }> = [];
  for (const [index, module] of (application?.modules ?? []).entries()) {
    const normalizedModule = normalizeBriefModuleSelection(module);
    if (!normalizedModule) {
      issues.push({
        path: `application.modules.${index}`,
        message: `Unsupported brief module "${String(module)}".`
      });
      continue;
    }

    if (
      "options" in normalizedModule &&
      normalizedModule.options !== undefined &&
      !isRecordValue(normalizedModule.options)
    ) {
      issues.push({
        path: `application.modules.${index}.options`,
        message: "Brief module options must be a JSON object."
      });
    }

    validatedModules.push({
      key: normalizedModule.key,
      path: `application.modules.${index}`
    });
  }
  validateUniqueKeys(validatedModules, issues);

  if (!(brief.packs?.length ?? 0) && !brief.entities.length && !inferredPacks.length) {
    issues.push({
      path: "entities",
      message:
        "Brief must declare at least one entity, one explicit pack, or application hints that infer at least one pack."
    });
  }

  validateUniqueKeys(
    (brief.packs ?? []).map((pack) => ({
      key: pack.key,
      path: `packs.${pack.key || "<empty>"}`
    })),
    issues
  );

  validateUniqueKeys(
    brief.entities.map((entity) => ({
      key: deriveResourceKey(entity),
      path: `entities.${deriveResourceKey(entity)}`
    })),
    issues
  );

  for (const entity of brief.entities) {
    const resourceKey = deriveResourceKey(entity);

    if (!entity.name.trim()) {
      issues.push({
        path: `entities.${resourceKey}.name`,
        message: "Entity name must not be empty."
      });
    }

    if (!Object.keys(entity.fields).length) {
      issues.push({
        path: `entities.${resourceKey}.fields`,
        message: "Entity must declare at least one field."
      });
    }

    for (const [fieldKey, field] of Object.entries(entity.fields)) {
      if (!fieldKey.trim()) {
        issues.push({
          path: `entities.${resourceKey}.fields.<empty>`,
          message: "Field keys must not be empty."
        });
        continue;
      }

      validateScalarInput(
        field,
        `entities.${resourceKey}.fields.${fieldKey}`,
        issues
      );
    }

    for (const [relationKey, relation] of Object.entries(entity.relations ?? {})) {
      if (!relationKey.trim()) {
        issues.push({
          path: `entities.${resourceKey}.relations.<empty>`,
          message: "Relation keys must not be empty."
        });
      }

      const normalizedRelation = normalizeBriefRelationInput(relation, entityLookup);
      if (!normalizedRelation) {
        issues.push({
          path: `entities.${resourceKey}.relations.${relationKey}`,
          message:
            "Brief relation must declare a resource or reference another declared brief entity."
        });
        continue;
      }

      if (!normalizedRelation.resource.trim()) {
        issues.push({
          path: `entities.${resourceKey}.relations.${relationKey}.resource`,
          message: "Relation resource must not be empty."
        });
      }
    }

    for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
      if (!action || action === true) {
        continue;
      }

      if (!("input" in action) || !action.input) {
        continue;
      }

      for (const [inputKey, inputField] of Object.entries(action.input)) {
        if (!inputKey.trim()) {
          issues.push({
            path: `entities.${resourceKey}.actions.${actionKey}.input.<empty>`,
            message: "Action input keys must not be empty."
          });
          continue;
        }

        validateScalarInput(
          inputField,
          `entities.${resourceKey}.actions.${actionKey}.input.${inputKey}`,
          issues
        );
      }

      for (const [outputKey, outputField] of Object.entries(action.output ?? {})) {
        if (!outputKey.trim()) {
          issues.push({
            path: `entities.${resourceKey}.actions.${actionKey}.output.<empty>`,
            message: "Action output keys must not be empty."
          });
          continue;
        }

        validateScalarInput(
          outputField,
          `entities.${resourceKey}.actions.${actionKey}.output.${outputKey}`,
          issues
        );
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function compileCapstanBrief(
  brief: CapstanBrief,
  options: {
    packDefinitions?: readonly GraphPackDefinition[];
  } = {}
): AppGraph {
  const validation = validateCapstanBrief(brief);
  if (!validation.ok) {
    const message = validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Capstan brief validation failed:\n${message}`);
  }

  const domain = normalizeDomain(brief.domain);
  const packPlan = planCapstanBriefPacks(brief, options);
  const packSelections = packPlan.combined;
  const accessPolicyKey = resolveAccessPolicyKey(packSelections, options.packDefinitions ?? []);
  const entityLookup = createBriefEntityLookup(brief.entities);
  const resources: AppGraph["resources"] = [];
  const capabilities: AppGraph["capabilities"] = [];
  const tasks: NonNullable<AppGraph["tasks"]> = [];
  const policies: NonNullable<AppGraph["policies"]> = [];
  const artifacts: NonNullable<AppGraph["artifacts"]> = [];
  const views: NonNullable<AppGraph["views"]> = [];

  for (const entity of brief.entities) {
    const names = deriveEntityNames(entity);
    const listAction = normalizeToggle(entity.actions?.list, true);
    const writeAction = normalizeToggle(entity.actions?.write, true);
    const executeAction = normalizeToggle(
      entity.actions?.execute,
      entity.actions?.execute !== undefined
    );
    const normalizedFields = normalizeRequiredFieldRecord(entity.fields);
    const normalizedRelations = normalizeRelationRecord(entity.relations, entityLookup);
    const defaultResourceOutput = deriveResourceOutputRecord(
      names.resourceKey,
      normalizedFields,
      normalizedRelations
    );

    resources.push({
      key: names.resourceKey,
      title: entity.title?.trim() || names.entityName,
      ...(entity.description?.trim() ? { description: entity.description.trim() } : {}),
      fields: normalizedFields,
      ...(normalizedRelations ? { relations: normalizedRelations } : {})
    });

    if (listAction.enabled) {
      const capabilityKey = listAction.key?.trim() || `list${names.entityPluralKeyStem}`;
      capabilities.push({
        key: capabilityKey,
        title: listAction.title?.trim() || `List ${names.entityPlural}`,
        ...(listAction.description?.trim()
          ? { description: listAction.description.trim() }
          : {}),
        mode: "read",
        output:
          normalizeOptionalFieldRecord((listAction as BriefListAction).output) ||
          defaultResourceOutput,
        resources: [names.resourceKey],
        ...(accessPolicyKey ? { policy: accessPolicyKey } : {})
      });
      views.push({
        key: listAction.viewKey?.trim() || `${names.resourceKey}List`,
        title: listAction.viewTitle?.trim() || names.entityPlural,
        kind: "list",
        resource: names.resourceKey,
        capability: capabilityKey
      });
    }

      if (writeAction.enabled) {
        const verb = (writeAction as BriefWriteAction).verb?.trim() || "Upsert";
        const capabilityKey =
          (writeAction as BriefWriteAction).key?.trim() ||
          `${toCapabilityVerb(verb)}${names.entityKeyStem}`;
        const writeDescription = (writeAction as BriefWriteAction).description?.trim();
        capabilities.push({
          key: capabilityKey,
          title: (writeAction as BriefWriteAction).title?.trim() || `${verb} ${names.entityName}`,
          ...(writeDescription ? { description: writeDescription } : {}),
          mode: "write",
          output:
            normalizeOptionalFieldRecord((writeAction as BriefWriteAction).output) ||
            defaultResourceOutput,
          resources: [names.resourceKey],
          ...(accessPolicyKey ? { policy: accessPolicyKey } : {}),
        input:
          normalizeInputRecord((writeAction as BriefWriteAction).input) ??
          deriveWriteInputRecord(normalizedFields, normalizedRelations)
      });
      views.push({
        key: (writeAction as BriefWriteAction).viewKey?.trim() || `${names.resourceKey}Form`,
        title:
          (writeAction as BriefWriteAction).viewTitle?.trim() || `${verb} ${names.entityName}`,
        kind: "form",
        resource: names.resourceKey,
        capability: capabilityKey
      });
    }

      if (executeAction.enabled) {
        const execute = executeAction as BriefExecuteAction;
        const verb = execute.verb?.trim() || "Process";
        const capabilityKey = execute.key?.trim() || `${toCapabilityVerb(verb)}${names.entityKeyStem}`;
        const taskKey = execute.taskKey?.trim() || `${capabilityKey}Task`;
        const artifactKey = execute.artifactKey?.trim() || `${names.resourceKey}Artifact`;
        const approvalPolicyKey =
        execute.approvalPolicyKey?.trim() || `${names.resourceKey}ApprovalRequired`;
      const artifactKind = execute.artifactKind ?? "report";

      capabilities.push({
        key: capabilityKey,
        title: execute.title?.trim() || `${verb} ${names.entityName}`,
        ...(execute.description?.trim() ? { description: execute.description.trim() } : {}),
        mode: "external",
        output:
          normalizeOptionalFieldRecord(execute.output) ??
          deriveExecuteOutputRecord(names.resourceKey, taskKey, artifactKey, artifactKind),
        resources: [names.resourceKey],
        policy: approvalPolicyKey,
        task: taskKey,
        input:
          normalizeInputRecord(execute.input) ??
          defaultExecuteInput(names.resourceKey)
      });
      tasks.push({
        key: taskKey,
        title: execute.taskTitle?.trim() || `${verb} ${names.entityName} Task`,
        ...(execute.taskDescription?.trim()
          ? { description: execute.taskDescription.trim() }
          : {
              description: `Durably runs ${verb.toLowerCase()} for one ${names.entityName.toLowerCase()}.`
            }),
        kind: "durable",
        artifacts: [artifactKey]
      });
      policies.push({
        key: approvalPolicyKey,
        title: execute.approvalTitle?.trim() || `${names.entityName} Approval Required`,
        ...(execute.approvalDescription?.trim()
          ? { description: execute.approvalDescription.trim() }
          : {
              description: `Requires approval before ${verb.toLowerCase()} may continue for one ${names.entityName.toLowerCase()}.`
            }),
        effect: "approve"
      });
      artifacts.push({
        key: artifactKey,
        title: execute.artifactTitle?.trim() || `${names.entityName} Artifact`,
        ...(execute.artifactDescription?.trim()
          ? { description: execute.artifactDescription.trim() }
          : {
              description: `A generated ${artifactKind} artifact produced after ${verb.toLowerCase()} completes.`
            }),
        kind: artifactKind
      });
      views.push({
        key: execute.viewKey?.trim() || `${names.resourceKey}Detail`,
        title: execute.viewTitle?.trim() || `${names.entityName} Detail`,
        kind: "detail",
        resource: names.resourceKey,
        capability: capabilityKey
      });
    }
  }

  return {
    version: CURRENT_CAPSTAN_BRIEF_VERSION,
    domain,
    ...(packSelections.length ? { packs: packSelections } : {}),
    resources,
    capabilities,
    ...(tasks.length ? { tasks } : {}),
    ...(policies.length ? { policies } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(views.length ? { views } : {})
  };
}

function resolveBriefVersion(brief: CapstanBrief): number {
  return typeof brief.version === "number" ? brief.version : CURRENT_CAPSTAN_BRIEF_VERSION;
}

function normalizePackSelections(selections: readonly GraphPackSpec[]): GraphPackSpec[] {
  return selections.map((pack) => ({
    key: pack.key.trim(),
    ...(pack.options ? { options: cloneValue(pack.options) } : {})
  }));
}

function inferBriefPackSelections(brief: CapstanBrief): GraphPackSpec[] {
  const inferred = new Map<string, GraphPackSpec>();
  const application = normalizeBriefApplication(brief.application);
  const addPack = (pack: GraphPackSpec): void => {
    if (!inferred.has(pack.key)) {
      inferred.set(pack.key, pack);
    }
  };

  if (application?.profile === "saas") {
    addPack({ key: "auth" });
    addPack({ key: "tenant" });
  }

  if (application?.profile === "internal_ops") {
    addPack({ key: "auth" });
  }

  for (const module of application?.modules ?? []) {
    const packSelection = briefModuleToPackSelection(module);
    if (packSelection) {
      addPack(packSelection);
    }
  }

  return [...inferred.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeBriefApplication(
  application: BriefApplication | undefined
): NormalizedBriefApplication | undefined {
  if (!application) {
    return undefined;
  }

  const normalizedModules = (application.modules ?? [])
    .map((module) => normalizeBriefModuleSelection(module))
    .filter((module): module is BriefModuleConfig => Boolean(module));

  return {
    ...(application.profile ? { profile: application.profile } : {}),
    ...(normalizedModules.length
      ? {
          modules: dedupeByKey(normalizedModules).sort((left, right) =>
            left.key.localeCompare(right.key)
          )
        }
      : {})
  };
}

function isBriefApplicationProfile(value: unknown): value is BriefApplicationProfile {
  return value === "saas" || value === "internal_ops" || value === "agent_tool";
}

function isBriefModule(value: unknown): value is BriefModule {
  return (
    value === "workflow" ||
    value === "connectors" ||
    value === "billing" ||
    value === "commerce" ||
    value === "revenueOps"
  );
}

function normalizeBriefModuleSelection(
  module: BriefModuleSelection
): BriefModuleConfig | undefined {
  if (typeof module === "string") {
    return isBriefModule(module) ? { key: module } : undefined;
  }

  if (!isRecordValue(module)) {
    return undefined;
  }

  if (!isBriefModule(module.key)) {
    return undefined;
  }

  return {
    key: module.key,
    ...(module.options && isRecordValue(module.options)
      ? { options: cloneValue(module.options) }
      : {})
  };
}

function briefModuleToPackSelection(module: BriefModuleConfig): GraphPackSpec | undefined {
  switch (module.key) {
    case "workflow":
      return {
        key: "workflow",
        ...(module.options ? { options: module.options } : {})
      };
    case "connectors":
      return {
        key: "connector",
        ...(module.options ? { options: module.options } : {})
      };
    case "billing":
      return {
        key: "billing",
        ...(module.options ? { options: module.options } : {})
      };
    case "commerce":
      return {
        key: "commerce",
        ...(module.options ? { options: module.options } : {})
      };
    case "revenueOps":
      return {
        key: "revenueOps",
        ...(module.options ? { options: module.options } : {})
      };
    default:
      return undefined;
  }
}

function dedupeByKey<Value extends { key: string }>(values: readonly Value[]): Value[] {
  const seen = new Set<string>();
  const deduped: Value[] = [];

  for (const value of values) {
    if (seen.has(value.key)) {
      continue;
    }

    seen.add(value.key);
    deduped.push(value);
  }

  return deduped;
}

function validateUniqueKeys(
  values: Array<{ key: string; path: string }>,
  issues: BriefValidationIssue[]
): void {
  const seen = new Set<string>();

  for (const value of values) {
    const key = value.key.trim();

    if (!key) {
      issues.push({
        path: value.path,
        message: "Keys must not be empty."
      });
      continue;
    }

    if (seen.has(key)) {
      issues.push({
        path: value.path,
        message: `Duplicate key "${key}".`
      });
      continue;
    }

    seen.add(key);
  }
}

function validateScalarInput(
  value: BriefFieldInput | BriefInputFieldInput,
  path: string,
  issues: BriefValidationIssue[]
): void {
  const type = typeof value === "string" ? value : value.type;

  if (!type.trim()) {
    issues.push({
      path,
      message: "Type must not be empty."
    });
  }
}

function normalizeDomain(domain: DomainSpec): DomainSpec {
  return {
    key: domain.key.trim(),
    title: domain.title.trim(),
    ...(domain.description?.trim() ? { description: domain.description.trim() } : {})
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeToggle<T extends { enabled?: boolean }>(
  value: boolean | T | undefined,
  defaultEnabled: boolean
): T & { enabled: boolean } {
  if (value === false) {
    return { enabled: false } as T & { enabled: boolean };
  }

  if (value === true || value === undefined) {
    return { enabled: defaultEnabled } as T & { enabled: boolean };
  }

  return {
    ...value,
    enabled: value.enabled ?? defaultEnabled
  };
}

function normalizeRequiredFieldRecord(
  fields: Record<string, BriefFieldInput>
): Record<string, FieldSpec> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeFieldInput(value)])
  );
}

function normalizeOptionalFieldRecord(
  fields: Record<string, BriefFieldInput> | undefined
): Record<string, FieldSpec> | undefined {
  if (!fields || !Object.keys(fields).length) {
    return undefined;
  }

  return normalizeRequiredFieldRecord(fields);
}

function normalizeRelationRecord(
  relations: Record<string, BriefRelationInput> | undefined,
  entityLookup: Map<string, string>
): Record<string, RelationSpec> | undefined {
  if (!relations) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(relations)
      .map(([key, value]) => [key, normalizeBriefRelationInput(value, entityLookup)] as const)
      .filter((entry): entry is [string, RelationSpec] => Boolean(entry[1]))
  );

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeFieldInput(value: BriefFieldInput): FieldSpec {
  if (typeof value === "string") {
    return {
      type: value,
      required: true
    };
  }

  return {
    ...cloneValue(value),
    required: value.required ?? true
  };
}

function normalizeInputRecord(
  input: Record<string, BriefInputFieldInput> | undefined
): Record<string, InputFieldSpec> | undefined {
  if (!input) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, normalizeInputField(value)])
  );
}

function deriveResourceOutputRecord(
  resourceKey: string,
  fields: Record<string, FieldSpec>,
  relations: Record<string, RelationSpec> | undefined
): Record<string, FieldSpec> {
  const relationFields = Object.fromEntries(
    Object.entries(relations ?? {}).map(([relationKey, relation]) => [
      toRelationReferenceFieldKey(relationKey, relation.kind),
      {
        type: relation.kind === "many" ? "json" : "string",
        ...(relation.description
          ? {
              description: relation.description
            }
          : {
              description:
                relation.kind === "many"
                  ? `References to related ${relation.resource} records.`
                  : `Reference to one related ${relation.resource} record.`
            })
      } satisfies FieldSpec
    ])
  );

  return {
    id: {
      type: "string",
      required: true,
      description: `Stable identifier for one ${resourceKey} record.`
    },
    ...cloneValue(fields),
    ...relationFields
  };
}

function deriveWriteInputRecord(
  fields: Record<string, FieldSpec>,
  relations: Record<string, RelationSpec> | undefined
): Record<string, InputFieldSpec> {
  const relationInputs = Object.fromEntries(
    Object.entries(relations ?? {}).map(([relationKey, relation]) => [
      toRelationReferenceFieldKey(relationKey, relation.kind),
      {
        type: relation.kind === "many" ? "json" : "string",
        ...(relation.description
          ? { description: relation.description }
          : {
              description:
                relation.kind === "many"
                  ? `References to related ${relation.resource} records.`
                  : `Reference to one related ${relation.resource} record.`
            })
      } satisfies InputFieldSpec
    ])
  );

  return {
    ...fieldRecordToInputRecord(fields),
    ...relationInputs
  };
}

function deriveExecuteOutputRecord(
  resourceKey: string,
  taskKey: string,
  artifactKey: string,
  artifactKind: ArtifactSpec["kind"]
): Record<string, FieldSpec> {
  return {
    status: {
      type: "string",
      required: true,
      description: "Execution status for this capability run."
    },
    [`${resourceKey}Id`]: {
      type: "string",
      description: `Stable identifier for the ${resourceKey} record associated with this execution.`
    },
    taskRunId: {
      type: "string",
      description: `Durable run identifier for task "${taskKey}".`
    },
    artifact: {
      type: "json",
      description: `Produced ${artifactKind} payload or reference for artifact "${artifactKey}".`
    }
  };
}

function normalizeInputField(value: BriefInputFieldInput): InputFieldSpec {
  if (typeof value === "string") {
    return {
      type: value,
      required: true
    };
  }

  return {
    ...cloneValue(value),
    required: value.required ?? true
  };
}

function normalizeBriefRelationInput(
  value: BriefRelationInput,
  entityLookup: Map<string, string>
): RelationSpec | undefined {
  if (typeof value === "string") {
    const shorthand = parseBriefRelationTarget(value);
    const resource = resolveBriefRelationTarget(shorthand.target, entityLookup);

    if (!resource) {
      return undefined;
    }

    return {
      resource,
      kind: shorthand.kind
    };
  }

  if (!isRecordValue(value)) {
    return undefined;
  }

  if ("resource" in value) {
    if (
      typeof value.resource !== "string" ||
      (value.kind !== "one" && value.kind !== "many")
    ) {
      return undefined;
    }

    return {
      resource: value.resource.trim(),
      kind: value.kind,
      ...(typeof value.description === "string" && value.description.trim()
        ? { description: value.description.trim() }
        : {})
    };
  }

  if ("target" in value && typeof value.target === "string") {
    const resource = resolveBriefRelationTarget(value.target, entityLookup);
    if (!resource) {
      return undefined;
    }

    return {
      resource,
      kind: value.kind === "many" ? "many" : "one",
      ...(typeof value.description === "string" && value.description.trim()
        ? { description: value.description.trim() }
        : {})
    };
  }

  return undefined;
}

function fieldRecordToInputRecord(
  fields: Record<string, FieldSpec>
): Record<string, InputFieldSpec> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      normalizeGeneratedInputField(value)
    ])
  );
}

function normalizeGeneratedInputField(value: FieldSpec): InputFieldSpec {
  return {
    type: value.type,
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
    ...(value.description ? { description: value.description } : {}),
    ...(value.constraints ? { constraints: cloneValue(value.constraints) } : {})
  };
}

function defaultExecuteInput(resourceKey: string): Record<string, InputFieldSpec> {
  return {
    [`${resourceKey}Id`]: {
      type: "string",
      required: true
    }
  };
}

function deriveEntityNames(entity: BriefEntity): {
  entityName: string;
  entityPlural: string;
  resourceKey: string;
  entityKeyStem: string;
  entityPluralKeyStem: string;
} {
  const entityName = entity.name.trim();
  const entityPlural = entity.plural?.trim() || pluralize(entityName);
  const resourceKey = deriveResourceKey(entity);

  return {
    entityName,
    entityPlural,
    resourceKey,
    entityKeyStem: toPascalCase(entityName),
    entityPluralKeyStem: toPascalCase(entityPlural)
  };
}

function deriveResourceKey(entity: BriefEntity): string {
  return entity.resourceKey?.trim() || toKey(entity.name);
}

function createBriefEntityLookup(entities: readonly BriefEntity[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const entity of entities) {
    const resourceKey = deriveResourceKey(entity);
    for (const alias of [
      entity.name,
      entity.plural,
      entity.resourceKey,
      resourceKey
    ]) {
      if (!alias?.trim()) {
        continue;
      }

      const normalizedAlias = toLookupKey(alias);
      if (!lookup.has(normalizedAlias)) {
        lookup.set(normalizedAlias, resourceKey);
      }
    }
  }

  return lookup;
}

function parseBriefRelationTarget(value: string): {
  target: string;
  kind: RelationSpec["kind"];
} {
  const trimmed = value.trim();
  if (trimmed.endsWith("[]")) {
    return {
      target: trimmed.slice(0, -2).trim(),
      kind: "many"
    };
  }

  return {
    target: trimmed,
    kind: "one"
  };
}

function resolveBriefRelationTarget(
  target: string,
  entityLookup: Map<string, string>
): string | undefined {
  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }

  return entityLookup.get(toLookupKey(trimmed));
}

function toRelationReferenceFieldKey(
  relationKey: string,
  kind: RelationSpec["kind"]
): string {
  if (kind === "one") {
    return relationKey.endsWith("Id") ? relationKey : `${relationKey}Id`;
  }

  if (relationKey.endsWith("Ids")) {
    return relationKey;
  }

  if (relationKey.endsWith("s")) {
    return `${relationKey.slice(0, -1)}Ids`;
  }

  return `${relationKey}Ids`;
}

function resolveAccessPolicyKey(
  packs: readonly GraphPackSpec[],
  extraPackDefinitions: readonly GraphPackDefinition[]
): string | undefined {
  if (!packs.length) {
    return undefined;
  }

  const registry = new Map(
    [...listBuiltinGraphPacks(), ...extraPackDefinitions].map((pack) => [pack.key, pack] as const)
  );
  const resolvedSelections = resolvePackSelections(packs, registry);
  const keys = new Set(resolvedSelections.map((selection) => selection.key));

  if (keys.has("tenant")) {
    return "tenantScoped";
  }

  if (keys.has("auth")) {
    return "authenticated";
  }

  return undefined;
}

function toCapabilityVerb(value: string): string {
  const stem = toPascalCase(value);
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}

function pluralize(value: string): string {
  const trimmed = value.trim();

  if (trimmed.endsWith("s")) {
    return `${trimmed}es`;
  }

  if (trimmed.endsWith("y") && trimmed.length > 1) {
    return `${trimmed.slice(0, -1)}ies`;
  }

  return `${trimmed}s`;
}

function toKey(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "briefResource";
  }

  const [first, ...rest] = parts;
  return [
    first!.toLowerCase(),
    ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  ].join("");
}

function toPascalCase(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "BriefEntity";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function toLookupKey(value: string): string {
  return toKey(value);
}

function cloneValue<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
