import type {
  AppGraph,
  ArtifactSpec,
  CapabilitySpec,
  FieldSpec,
  GraphPackSpec,
  InputFieldSpec,
  PolicySpec,
  ResourceSpec,
  TaskSpec,
  ViewSpec
} from "@capstan/app-graph";

const PACKS_APPLIED = Symbol.for("capstan.graph-packs.applied");

type InternalAppGraph = AppGraph & {
  [PACKS_APPLIED]?: true;
};

export interface GraphPackContribution {
  resources?: ResourceSpec[];
  capabilities?: CapabilitySpec[];
  tasks?: TaskSpec[];
  policies?: PolicySpec[];
  artifacts?: ArtifactSpec[];
  views?: ViewSpec[];
}

export interface GraphPackContext {
  graph: AppGraph;
  selection: GraphPackSpec;
  appliedPackKeys: string[];
}

export interface GraphPackDefinition {
  key: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  apply(context: GraphPackContext): GraphPackContribution;
}

type TemplateValue<Names> = string | ((names: Names) => string);
type TemplateRecord<Names, Value> = Value | ((names: Names) => Value);

export interface DurableEntityPackNames {
  entityName: string;
  entityPlural: string;
  resourceKey: string;
  entityKeyStem: string;
  entityPluralKeyStem: string;
  accessPolicyKey: string;
  listCapabilityKey: string;
  writeCapabilityKey: string;
  executeCapabilityKey: string;
  taskKey: string;
  artifactKey: string;
  approvalPolicyKey: string;
  listViewKey: string;
  formViewKey: string;
  detailViewKey: string;
}

export interface DurableEntityPackBuilder {
  key: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  entity: {
    name: string;
    plural?: string;
    resourceKey?: string;
    title?: TemplateValue<DurableEntityPackNames>;
    description?: TemplateValue<DurableEntityPackNames>;
    fields: TemplateRecord<DurableEntityPackNames, Record<string, FieldSpec>>;
  };
  list?: {
    capabilityKey?: string;
    title?: TemplateValue<DurableEntityPackNames>;
    description?: TemplateValue<DurableEntityPackNames>;
    resources?: TemplateRecord<DurableEntityPackNames, string[]>;
    viewKey?: string;
    viewTitle?: TemplateValue<DurableEntityPackNames>;
  };
  write: {
    capabilityKey?: string;
    title?: TemplateValue<DurableEntityPackNames>;
    description?: TemplateValue<DurableEntityPackNames>;
    resources?: TemplateRecord<DurableEntityPackNames, string[]>;
    input: TemplateRecord<DurableEntityPackNames, Record<string, InputFieldSpec>>;
    viewKey?: string;
    viewTitle?: TemplateValue<DurableEntityPackNames>;
  };
  execute: {
    capabilityKey?: string;
    title?: TemplateValue<DurableEntityPackNames>;
    description?: TemplateValue<DurableEntityPackNames>;
    resources?: TemplateRecord<DurableEntityPackNames, string[]>;
    input?: TemplateRecord<DurableEntityPackNames, Record<string, InputFieldSpec>>;
    taskKey?: string;
    taskTitle?: TemplateValue<DurableEntityPackNames>;
    taskDescription?: TemplateValue<DurableEntityPackNames>;
    artifactKey?: string;
    artifactTitle?: TemplateValue<DurableEntityPackNames>;
    artifactDescription?: TemplateValue<DurableEntityPackNames>;
    artifactKind: ArtifactSpec["kind"];
    approvalPolicyKey?: string;
    approvalTitle?: TemplateValue<DurableEntityPackNames>;
    approvalDescription?: TemplateValue<DurableEntityPackNames>;
    viewKey?: string;
    viewTitle?: TemplateValue<DurableEntityPackNames>;
  };
}

export interface LinkedEntityPackNames {
  primaryName: string;
  primaryPlural: string;
  primaryResourceKey: string;
  primaryKeyStem: string;
  primaryPluralKeyStem: string;
  secondaryName: string;
  secondaryPlural: string;
  secondaryResourceKey: string;
  secondaryKeyStem: string;
  secondaryPluralKeyStem: string;
  accessPolicyKey: string;
  primaryListCapabilityKey: string;
  primaryWriteCapabilityKey: string;
  secondaryListCapabilityKey: string;
  secondaryExecuteCapabilityKey: string;
  taskKey: string;
  artifactKey: string;
  approvalPolicyKey: string;
  primaryListViewKey: string;
  primaryFormViewKey: string;
  secondaryListViewKey: string;
  secondaryDetailViewKey: string;
}

export interface LinkedEntityPackOptionKeys {
  primaryName?: string;
  primaryPlural?: string;
  primaryResourceKey?: string;
  secondaryName?: string;
  secondaryPlural?: string;
  secondaryResourceKey?: string;
  primaryListCapabilityKey?: string;
  primaryWriteCapabilityKey?: string;
  secondaryListCapabilityKey?: string;
  secondaryExecuteCapabilityKey?: string;
  taskKey?: string;
  artifactKey?: string;
  approvalPolicyKey?: string;
  primaryListViewKey?: string;
  primaryFormViewKey?: string;
  secondaryListViewKey?: string;
  secondaryDetailViewKey?: string;
}

export interface LinkedEntityPackBuilder {
  key: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  optionKeys?: LinkedEntityPackOptionKeys;
  primary: {
    name: string;
    plural?: string;
    resourceKey?: string;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    fields: TemplateRecord<LinkedEntityPackNames, Record<string, FieldSpec>>;
  };
  secondary: {
    name: string;
    plural?: string;
    resourceKey?: string;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    fields: TemplateRecord<LinkedEntityPackNames, Record<string, FieldSpec>>;
  };
  primaryList?: {
    capabilityKey?: TemplateValue<LinkedEntityPackNames>;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    resources?: TemplateRecord<LinkedEntityPackNames, string[]>;
    viewKey?: TemplateValue<LinkedEntityPackNames>;
    viewTitle?: TemplateValue<LinkedEntityPackNames>;
  };
  primaryWrite: {
    capabilityKey?: TemplateValue<LinkedEntityPackNames>;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    resources?: TemplateRecord<LinkedEntityPackNames, string[]>;
    input: TemplateRecord<LinkedEntityPackNames, Record<string, InputFieldSpec>>;
    viewKey?: TemplateValue<LinkedEntityPackNames>;
    viewTitle?: TemplateValue<LinkedEntityPackNames>;
  };
  secondaryList?: {
    capabilityKey?: TemplateValue<LinkedEntityPackNames>;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    resources?: TemplateRecord<LinkedEntityPackNames, string[]>;
    viewKey?: TemplateValue<LinkedEntityPackNames>;
    viewTitle?: TemplateValue<LinkedEntityPackNames>;
  };
  secondaryExecute: {
    capabilityKey?: TemplateValue<LinkedEntityPackNames>;
    title?: TemplateValue<LinkedEntityPackNames>;
    description?: TemplateValue<LinkedEntityPackNames>;
    resources?: TemplateRecord<LinkedEntityPackNames, string[]>;
    input?: TemplateRecord<LinkedEntityPackNames, Record<string, InputFieldSpec>>;
    taskKey?: TemplateValue<LinkedEntityPackNames>;
    taskTitle?: TemplateValue<LinkedEntityPackNames>;
    taskDescription?: TemplateValue<LinkedEntityPackNames>;
    artifactKey?: TemplateValue<LinkedEntityPackNames>;
    artifactTitle?: TemplateValue<LinkedEntityPackNames>;
    artifactDescription?: TemplateValue<LinkedEntityPackNames>;
    artifactKind: ArtifactSpec["kind"];
    approvalPolicyKey?: TemplateValue<LinkedEntityPackNames>;
    approvalTitle?: TemplateValue<LinkedEntityPackNames>;
    approvalDescription?: TemplateValue<LinkedEntityPackNames>;
    viewKey?: TemplateValue<LinkedEntityPackNames>;
    viewTitle?: TemplateValue<LinkedEntityPackNames>;
  };
}

const authPack = defineGraphPack({
  key: "auth",
  title: "Authentication Pack",
  description: "Adds user, role, and invitation primitives for operator-facing applications.",
  apply(context) {
    const subjectName = readOptionString(context.selection, "subjectName") ?? "User";
    const subjectPlural = readOptionString(context.selection, "subjectPlural") ?? pluralize(subjectName);
    const subjectKeyStem = toPackPascalName(subjectName);
    const subjectPluralKeyStem = toPackPascalName(subjectPlural);
    const userResourceKey = readOptionString(context.selection, "userResourceKey") ?? "user";
    const roleResourceKey = readOptionString(context.selection, "roleResourceKey") ?? "role";
    const listCapabilityKey =
      readOptionString(context.selection, "listCapabilityKey") ?? `list${subjectPluralKeyStem}`;
    const inviteCapabilityKey =
      readOptionString(context.selection, "inviteCapabilityKey") ?? `invite${subjectKeyStem}`;
    const listViewKey = readOptionString(context.selection, "listViewKey") ?? `${userResourceKey}List`;
    const formViewKey = readOptionString(context.selection, "formViewKey") ?? `${userResourceKey}Form`;

    return {
      resources: [
        {
          key: userResourceKey,
          title: subjectName,
          description: `An authenticated ${subjectName.toLowerCase()} who can operate the application.`,
          fields: {
            email: {
              type: "string",
              required: true
            },
            displayName: {
              type: "string",
              required: true
            },
            status: {
              type: "string",
              required: true,
              constraints: {
                enum: ["active", "invited", "disabled"]
              }
            }
          }
        },
        {
          key: roleResourceKey,
          title: "Role",
          description: "An authorization role assignable to authenticated operators.",
          fields: {
            name: {
              type: "string",
              required: true
            },
            description: {
              type: "string"
            }
          }
        }
      ],
      capabilities: [
        {
          key: listCapabilityKey,
          title: `List ${subjectPlural}`,
          description: `Read the current ${subjectPlural.toLowerCase()} in the system.`,
          mode: "read",
          resources: [userResourceKey],
          policy: "authenticated"
        },
        {
          key: inviteCapabilityKey,
          title: `Invite ${subjectName}`,
          description: `Invite a new ${subjectName.toLowerCase()} and assign an initial role.`,
          mode: "write",
          resources: [userResourceKey, roleResourceKey],
          policy: "authenticated",
          input: {
            email: {
              type: "string",
              required: true
            },
            roleKey: {
              type: "string",
              required: true
            }
          }
        }
      ],
      policies: [
        {
          key: "authenticated",
          title: "Authenticated Access",
          description: "Allows access only for authenticated operators.",
          effect: "allow"
        }
      ],
      views: [
        {
          key: listViewKey,
          title: subjectPlural,
          kind: "list",
          resource: userResourceKey,
          capability: listCapabilityKey
        },
        {
          key: formViewKey,
          title: `Invite ${subjectName}`,
          kind: "form",
          resource: userResourceKey,
          capability: inviteCapabilityKey
        }
      ]
    };
  }
});

const tenantPack = defineGraphPack({
  key: "tenant",
  title: "Organization And Tenant Pack",
  description: "Adds multi-tenant organization and membership primitives.",
  dependsOn: ["auth"],
  apply(context) {
    const entityName = readOptionString(context.selection, "entityName") ?? "Organization";
    const entityPlural =
      readOptionString(context.selection, "entityPlural") ?? pluralize(entityName);
    const entityKeyStem = toPackPascalName(entityName);
    const entityPluralKeyStem = toPackPascalName(entityPlural);
    const entityResourceKey =
      readOptionString(context.selection, "entityResourceKey") ?? toPackKey(entityName);
    const membershipResourceKey =
      readOptionString(context.selection, "membershipResourceKey") ?? "membership";
    const listEntitiesCapabilityKey =
      readOptionString(context.selection, "listEntitiesCapabilityKey") ??
      `list${entityPluralKeyStem}`;
    const provisionEntityCapabilityKey =
      readOptionString(context.selection, "provisionEntityCapabilityKey") ??
      `provision${entityKeyStem}`;
    const listMembershipsCapabilityKey =
      readOptionString(context.selection, "listMembershipsCapabilityKey") ?? "listMemberships";
    const entityListViewKey =
      readOptionString(context.selection, "entityListViewKey") ?? `${entityResourceKey}List`;
    const membershipListViewKey =
      readOptionString(context.selection, "membershipListViewKey") ?? `${membershipResourceKey}List`;

    return {
      resources: [
        {
          key: entityResourceKey,
          title: entityName,
          description: `A tenant container that scopes work inside the application.`,
          fields: {
            name: {
              type: "string",
              required: true
            },
            slug: {
              type: "string",
              required: true
            },
            status: {
              type: "string",
              required: true,
              constraints: {
                enum: ["active", "suspended"]
              }
            }
          }
        },
        {
          key: membershipResourceKey,
          title: `${entityName} Membership`,
          description: `A link between one user and one ${entityName.toLowerCase()}.`,
          fields: {
            userId: {
              type: "string",
              required: true
            },
            [`${entityResourceKey}Id`]: {
              type: "string",
              required: true
            },
            roleKey: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: listEntitiesCapabilityKey,
          title: `List ${entityPlural}`,
          description: `Read the ${entityPlural.toLowerCase()} that scope work inside the application.`,
          mode: "read",
          resources: [entityResourceKey],
          policy: "tenantScoped"
        },
        {
          key: provisionEntityCapabilityKey,
          title: `Provision ${entityName}`,
          description: `Create a new ${entityName.toLowerCase()} in a controlled way.`,
          mode: "write",
          resources: [entityResourceKey],
          policy: "tenantScoped",
          input: {
            name: {
              type: "string",
              required: true
            },
            slug: {
              type: "string",
              required: true
            }
          }
        },
        {
          key: listMembershipsCapabilityKey,
          title: "List Memberships",
          description: `Read membership assignments for ${entityPlural.toLowerCase()}.`,
          mode: "read",
          resources: [membershipResourceKey, entityResourceKey, "user"],
          policy: "tenantScoped"
        }
      ],
      policies: [
        {
          key: "tenantScoped",
          title: "Tenant Scoped Access",
          description: "Allows access only when a request is correctly scoped to one tenant.",
          effect: "allow"
        }
      ],
      views: [
        {
          key: entityListViewKey,
          title: entityPlural,
          kind: "list",
          resource: entityResourceKey,
          capability: listEntitiesCapabilityKey
        },
        {
          key: membershipListViewKey,
          title: "Memberships",
          kind: "list",
          resource: membershipResourceKey,
          capability: listMembershipsCapabilityKey
        }
      ]
    };
  }
});

const workflowPack = defineGraphPack({
  key: "workflow",
  title: "Workflow Pack",
  description: "Adds durable workflow requests, approval semantics, and generated artifacts.",
  dependsOn: ["auth"],
  apply(context) {
    const entityName = readOptionString(context.selection, "entityName") ?? "Work Request";
    const entityPlural =
      readOptionString(context.selection, "entityPlural") ?? pluralize(entityName);
    const entityKeyStem = toPackPascalName(entityName);
    const entityPluralKeyStem = toPackPascalName(entityPlural);
    const resourceKey =
      readOptionString(context.selection, "resourceKey") ?? toPackKey(entityName);
    const listCapabilityKey =
      readOptionString(context.selection, "listCapabilityKey") ?? `list${entityPluralKeyStem}`;
    const submitCapabilityKey =
      readOptionString(context.selection, "submitCapabilityKey") ?? `submit${entityKeyStem}`;
    const processCapabilityKey =
      readOptionString(context.selection, "processCapabilityKey") ?? `process${entityKeyStem}`;
    const taskKey = readOptionString(context.selection, "taskKey") ?? `${processCapabilityKey}Task`;
    const artifactKey =
      readOptionString(context.selection, "artifactKey") ?? `${resourceKey}Report`;
    const approvalPolicyKey =
      readOptionString(context.selection, "approvalPolicyKey") ?? "workflowApprovalRequired";
    const listViewKey = readOptionString(context.selection, "listViewKey") ?? `${resourceKey}List`;
    const formViewKey = readOptionString(context.selection, "formViewKey") ?? `${resourceKey}Form`;
    const detailViewKey =
      readOptionString(context.selection, "detailViewKey") ?? `${resourceKey}Detail`;
    const accessPolicyKey = getAccessPolicyKey(context);
    const durableRuntime = createDurableRuntimeFragments({
      taskKey,
      taskTitle: `Process ${entityName} Task`,
      taskDescription: `Durably processes one ${entityName.toLowerCase()} through review and completion.`,
      artifactKey,
      artifactTitle: `${entityName} Report`,
      artifactDescription: `A generated report artifact produced when one ${entityName.toLowerCase()} finishes processing.`,
      artifactKind: "report",
      approvalPolicyKey,
      approvalTitle: `${entityName} Approval Required`,
      approvalDescription: `Requires explicit approval before ${entityName.toLowerCase()} processing may continue.`
    });

    return {
      resources: [
        {
          key: resourceKey,
          title: entityName,
          description: `A durable workflow request that can be reviewed and completed over time.`,
          fields: {
            title: {
              type: "string",
              required: true
            },
            summary: {
              type: "string"
            },
            status: {
              type: "string",
              required: true,
              constraints: {
                enum: ["draft", "submitted", "in_review", "completed", "blocked"]
              }
            },
            requestedById: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: listCapabilityKey,
          title: `List ${entityPlural}`,
          description: `Read the ${entityPlural.toLowerCase()} currently tracked by the workflow system.`,
          mode: "read",
          resources: [resourceKey],
          policy: accessPolicyKey
        },
        {
          key: submitCapabilityKey,
          title: `Submit ${entityName}`,
          description: `Create and submit a new ${entityName.toLowerCase()} for review.`,
          mode: "write",
          resources: [resourceKey],
          policy: accessPolicyKey,
          input: {
            title: {
              type: "string",
              required: true
            },
            summary: {
              type: "string"
            }
          }
        },
        {
          key: processCapabilityKey,
          title: `Process ${entityName}`,
          description: `Advance one ${entityName.toLowerCase()} through a durable review workflow.`,
          mode: "external",
          resources: [resourceKey],
          policy: approvalPolicyKey,
          task: taskKey,
          input: {
            [`${resourceKey}Id`]: {
              type: "string",
              required: true
            }
          }
        }
      ],
      tasks: durableRuntime.tasks,
      policies: durableRuntime.policies,
      artifacts: durableRuntime.artifacts,
      views: [
        {
          key: listViewKey,
          title: entityPlural,
          kind: "list",
          resource: resourceKey,
          capability: listCapabilityKey
        },
        {
          key: formViewKey,
          title: `Submit ${entityName}`,
          kind: "form",
          resource: resourceKey,
          capability: submitCapabilityKey
        },
        {
          key: detailViewKey,
          title: `${entityName} Detail`,
          kind: "detail",
          resource: resourceKey,
          capability: processCapabilityKey
        }
      ]
    };
  }
});

const connectorPack = defineGraphPack({
  key: "connector",
  title: "Connector Pack",
  description: "Adds external system connectors, durable sync tasks, and sync artifacts.",
  dependsOn: ["tenant"],
  apply(context) {
    const entityName = readOptionString(context.selection, "entityName") ?? "Connector";
    const entityPlural =
      readOptionString(context.selection, "entityPlural") ?? pluralize(entityName);
    const entityKeyStem = toPackPascalName(entityName);
    const entityPluralKeyStem = toPackPascalName(entityPlural);
    const resourceKey =
      readOptionString(context.selection, "resourceKey") ?? toPackKey(entityName);
    const listCapabilityKey =
      readOptionString(context.selection, "listCapabilityKey") ?? `list${entityPluralKeyStem}`;
    const configureCapabilityKey =
      readOptionString(context.selection, "configureCapabilityKey") ??
      `configure${entityKeyStem}`;
    const syncCapabilityKey =
      readOptionString(context.selection, "syncCapabilityKey") ?? `sync${entityKeyStem}`;
    const taskKey = readOptionString(context.selection, "taskKey") ?? `${syncCapabilityKey}Task`;
    const artifactKey =
      readOptionString(context.selection, "artifactKey") ?? `${resourceKey}SyncReport`;
    const approvalPolicyKey =
      readOptionString(context.selection, "approvalPolicyKey") ?? "connectorSyncApprovalRequired";
    const listViewKey = readOptionString(context.selection, "listViewKey") ?? `${resourceKey}List`;
    const formViewKey = readOptionString(context.selection, "formViewKey") ?? `${resourceKey}Form`;
    const detailViewKey =
      readOptionString(context.selection, "detailViewKey") ?? `${resourceKey}Detail`;
    const accessPolicyKey = getAccessPolicyKey(context);
    const durableRuntime = createDurableRuntimeFragments({
      taskKey,
      taskTitle: `Sync ${entityName} Task`,
      taskDescription: `Durably synchronizes one ${entityName.toLowerCase()} and records the result.`,
      artifactKey,
      artifactTitle: `${entityName} Sync Report`,
      artifactDescription: `A generated sync report artifact produced after one ${entityName.toLowerCase()} sync completes.`,
      artifactKind: "report",
      approvalPolicyKey,
      approvalTitle: `${entityName} Sync Approval Required`,
      approvalDescription: `Requires approval before ${entityName.toLowerCase()} sync may continue.`
    });

    return {
      resources: [
        {
          key: resourceKey,
          title: entityName,
          description: `A configured external ${entityName.toLowerCase()} that can sync data into the application.`,
          fields: {
            name: {
              type: "string",
              required: true
            },
            provider: {
              type: "string",
              required: true
            },
            status: {
              type: "string",
              required: true,
              constraints: {
                enum: ["connected", "degraded", "disconnected"]
              }
            },
            lastSyncedAt: {
              type: "datetime"
            }
          }
        }
      ],
      capabilities: [
        {
          key: listCapabilityKey,
          title: `List ${entityPlural}`,
          description: `Read the configured ${entityPlural.toLowerCase()} available to this application.`,
          mode: "read",
          resources: [resourceKey],
          policy: accessPolicyKey
        },
        {
          key: configureCapabilityKey,
          title: `Configure ${entityName}`,
          description: `Create or update a configured ${entityName.toLowerCase()} for one tenant.`,
          mode: "write",
          resources: [resourceKey],
          policy: accessPolicyKey,
          input: {
            name: {
              type: "string",
              required: true
            },
            provider: {
              type: "string",
              required: true
            },
            secretReference: {
              type: "string"
            }
          }
        },
        {
          key: syncCapabilityKey,
          title: `Sync ${entityName}`,
          description: `Trigger a durable sync for one configured ${entityName.toLowerCase()}.`,
          mode: "external",
          resources: [resourceKey],
          policy: approvalPolicyKey,
          task: taskKey,
          input: {
            [`${resourceKey}Id`]: {
              type: "string",
              required: true
            }
          }
        }
      ],
      tasks: durableRuntime.tasks,
      policies: durableRuntime.policies,
      artifacts: durableRuntime.artifacts,
      views: [
        {
          key: listViewKey,
          title: entityPlural,
          kind: "list",
          resource: resourceKey,
          capability: listCapabilityKey
        },
        {
          key: formViewKey,
          title: `Configure ${entityName}`,
          kind: "form",
          resource: resourceKey,
          capability: configureCapabilityKey
        },
        {
          key: detailViewKey,
          title: `${entityName} Detail`,
          kind: "detail",
          resource: resourceKey,
          capability: syncCapabilityKey
        }
      ]
    };
  }
});

const billingPack = createLinkedEntityPack({
  key: "billing",
  title: "Billing Pack",
  description:
    "Adds subscription and invoice primitives, durable collection tasks, and billing receipts.",
  dependsOn: ["tenant"],
  optionKeys: {
    primaryName: "subscriptionName",
    primaryPlural: "subscriptionPlural",
    primaryResourceKey: "subscriptionResourceKey",
    secondaryName: "invoiceName",
    secondaryPlural: "invoicePlural",
    secondaryResourceKey: "invoiceResourceKey",
    primaryListCapabilityKey: "listSubscriptionsCapabilityKey",
    primaryWriteCapabilityKey: "provisionSubscriptionCapabilityKey",
    secondaryListCapabilityKey: "listInvoicesCapabilityKey",
    secondaryExecuteCapabilityKey: "collectInvoicePaymentCapabilityKey",
    taskKey: "taskKey",
    artifactKey: "artifactKey",
    approvalPolicyKey: "approvalPolicyKey",
    primaryListViewKey: "subscriptionListViewKey",
    primaryFormViewKey: "subscriptionFormViewKey",
    secondaryListViewKey: "invoiceListViewKey",
    secondaryDetailViewKey: "invoiceDetailViewKey"
  },
  primary: {
    name: "Subscription",
    resourceKey: "subscription",
    description: (names) =>
      `A billable ${names.primaryName.toLowerCase()} that governs service access for one tenant.`,
    fields: {
      planName: {
        type: "string",
        required: true
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["trial", "active", "past_due", "canceled"]
        }
      },
      billingEmail: {
        type: "string",
        required: true
      },
      renewsAt: {
        type: "datetime"
      }
    }
  },
  secondary: {
    name: "Invoice",
    resourceKey: "invoice",
    description: (names) =>
      `A billable ${names.secondaryName.toLowerCase()} tied to one ${names.primaryName.toLowerCase()}.`,
    fields: (names) => ({
      [`${names.primaryResourceKey}Id`]: {
        type: "string",
        required: true
      },
      amountCents: {
        type: "integer",
        required: true,
        constraints: {
          minimum: 0
        }
      },
      currency: {
        type: "string",
        required: true
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["draft", "open", "paid", "failed", "void"]
        }
      },
      dueAt: {
        type: "date"
      },
      collectedAt: {
        type: "datetime"
      }
    })
  },
  primaryList: {
    description: (names) =>
      `Read the ${names.primaryPlural.toLowerCase()} currently tracked by the billing system.`
  },
  primaryWrite: {
    capabilityKey: (names) => `provision${names.primaryKeyStem}`,
    title: (names) => `Provision ${names.primaryName}`,
    description: (names) =>
      `Create a new ${names.primaryName.toLowerCase()} and attach it to one tenant.`,
    input: {
      planName: {
        type: "string",
        required: true
      },
      billingEmail: {
        type: "string",
        required: true
      }
    },
    viewTitle: (names) => `Provision ${names.primaryName}`
  },
  secondaryList: {
    description: (names) =>
      `Read the ${names.secondaryPlural.toLowerCase()} generated by the billing system.`
  },
  secondaryExecute: {
    capabilityKey: (names) => `collect${names.secondaryKeyStem}Payment`,
    title: (names) => `Collect ${names.secondaryName} Payment`,
    description: (names) =>
      `Run a durable payment collection flow for one ${names.secondaryName.toLowerCase()}.`,
    taskTitle: (names) => `Collect ${names.secondaryName} Payment Task`,
    taskDescription: (names) =>
      `Durably collects payment for one ${names.secondaryName.toLowerCase()} and records the receipt.`,
    artifactKey: (names) => `${names.secondaryResourceKey}CollectionReceipt`,
    artifactTitle: (names) => `${names.secondaryName} Collection Receipt`,
    artifactDescription: (names) =>
      `A structured receipt artifact produced after one ${names.secondaryName.toLowerCase()} payment collection completes.`,
    artifactKind: "record",
    approvalPolicyKey: "billingCollectionApprovalRequired",
    approvalTitle: (names) => `${names.secondaryName} Collection Approval Required`,
    approvalDescription: (names) =>
      `Requires approval before ${names.secondaryName.toLowerCase()} collection may continue.`,
    viewTitle: (names) => `${names.secondaryName} Detail`
  }
});

const commercePack = createLinkedEntityPack({
  key: "commerce",
  title: "Commerce Pack",
  description:
    "Adds catalog and order primitives, durable fulfillment tasks, and fulfillment receipts.",
  dependsOn: ["tenant"],
  optionKeys: {
    primaryName: "catalogItemName",
    primaryPlural: "catalogItemPlural",
    primaryResourceKey: "catalogItemResourceKey",
    secondaryName: "orderName",
    secondaryPlural: "orderPlural",
    secondaryResourceKey: "orderResourceKey",
    primaryListCapabilityKey: "listCatalogCapabilityKey",
    primaryWriteCapabilityKey: "upsertCatalogCapabilityKey",
    secondaryListCapabilityKey: "listOrdersCapabilityKey",
    secondaryExecuteCapabilityKey: "fulfillOrderCapabilityKey",
    taskKey: "taskKey",
    artifactKey: "artifactKey",
    approvalPolicyKey: "approvalPolicyKey",
    primaryListViewKey: "catalogListViewKey",
    primaryFormViewKey: "catalogFormViewKey",
    secondaryListViewKey: "orderListViewKey",
    secondaryDetailViewKey: "orderDetailViewKey"
  },
  primary: {
    name: "Catalog Item",
    resourceKey: "catalogItem",
    description: (names) =>
      `A sellable ${names.primaryName.toLowerCase()} in the application catalog.`,
    fields: {
      title: {
        type: "string",
        required: true
      },
      sku: {
        type: "string",
        required: true
      },
      priceCents: {
        type: "integer",
        required: true,
        constraints: {
          minimum: 0
        }
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["draft", "active", "archived"]
        }
      }
    }
  },
  secondary: {
    name: "Order",
    resourceKey: "order",
    description: (names) =>
      `A customer-facing ${names.secondaryName.toLowerCase()} that references one or more catalog items.`,
    fields: (names) => ({
      [`${names.primaryResourceKey}Id`]: {
        type: "string",
        required: true
      },
      quantity: {
        type: "integer",
        required: true,
        constraints: {
          minimum: 1
        }
      },
      totalCents: {
        type: "integer",
        required: true,
        constraints: {
          minimum: 0
        }
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["draft", "confirmed", "fulfilling", "fulfilled", "canceled"]
        }
      }
    })
  },
  primaryList: {
    description: (names) =>
      `Read the ${names.primaryPlural.toLowerCase()} available to be ordered.`
  },
  primaryWrite: {
    capabilityKey: (names) => `upsert${names.primaryKeyStem}`,
    title: (names) => `Upsert ${names.primaryName}`,
    description: (names) =>
      `Create or update one ${names.primaryName.toLowerCase()} in the application catalog.`,
    input: {
      title: {
        type: "string",
        required: true
      },
      sku: {
        type: "string",
        required: true
      },
      priceCents: {
        type: "integer",
        required: true
      }
    },
    viewTitle: (names) => `Upsert ${names.primaryName}`
  },
  secondaryList: {
    description: (names) =>
      `Read the ${names.secondaryPlural.toLowerCase()} currently managed by the commerce system.`
  },
  secondaryExecute: {
    capabilityKey: (names) => `fulfill${names.secondaryKeyStem}`,
    title: (names) => `Fulfill ${names.secondaryName}`,
    description: (names) =>
      `Run a durable fulfillment flow for one ${names.secondaryName.toLowerCase()}.`,
    taskTitle: (names) => `Fulfill ${names.secondaryName} Task`,
    taskDescription: (names) =>
      `Durably fulfills one ${names.secondaryName.toLowerCase()} and records the fulfillment receipt.`,
    artifactKey: (names) => `${names.secondaryResourceKey}FulfillmentReceipt`,
    artifactTitle: (names) => `${names.secondaryName} Fulfillment Receipt`,
    artifactDescription: (names) =>
      `A structured receipt artifact produced after one ${names.secondaryName.toLowerCase()} fulfillment completes.`,
    artifactKind: "record",
    approvalPolicyKey: "commerceFulfillmentApprovalRequired",
    approvalTitle: (names) => `${names.secondaryName} Fulfillment Approval Required`,
    approvalDescription: (names) =>
      `Requires approval before ${names.secondaryName.toLowerCase()} fulfillment may continue.`,
    viewTitle: (names) => `${names.secondaryName} Detail`
  }
});

const revenueOpsPack = createDurableEntityPack({
  key: "revenueOps",
  title: "Revenue Operations Pack",
  description:
    "Bundles commerce, billing, and connectors, then adds a durable reconciliation surface on top.",
  dependsOn: ["commerce", "billing", "connector"],
  entity: {
    name: "Revenue Ops Exception",
    resourceKey: "revenueOpsException",
    description:
      "A tracked issue raised when commerce, billing, or connector state drifts out of sync.",
    fields: {
      title: {
        type: "string",
        required: true
      },
      severity: {
        type: "string",
        required: true,
        constraints: {
          enum: ["low", "medium", "high", "critical"]
        }
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["open", "investigating", "resolved"]
        }
      },
      ownerId: {
        type: "string"
      }
    }
  },
  list: {
    description:
      "Read the revenue operations issues currently tracked across commerce and billing flows."
  },
  write: {
    capabilityKey: "captureRevenueOpsException",
    title: (names) => `Capture ${names.entityName}`,
    description:
      "Create or update a revenue operations issue when a cross-system mismatch is discovered.",
    input: {
      title: {
        type: "string",
        required: true
      },
      severity: {
        type: "string",
        required: true
      }
    },
    viewTitle: (names) => `Capture ${names.entityName}`
  },
  execute: {
    capabilityKey: "reconcileRevenueOps",
    title: "Reconcile Revenue Ops",
    description:
      "Run a durable reconciliation flow across commerce, billing, and connector state.",
    input: {
      tenantId: {
        type: "string",
        required: true
      }
    },
    taskTitle: "Reconcile Revenue Ops Task",
    taskDescription:
      "Durably reconciles commerce, billing, and connector state into one operator digest.",
    artifactKey: "revenueOpsDigest",
    artifactTitle: "Revenue Ops Digest",
    artifactDescription:
      "A generated digest artifact produced after one revenue operations reconciliation completes.",
    artifactKind: "report",
    approvalPolicyKey: "revenueOpsApprovalRequired",
    approvalTitle: "Revenue Ops Approval Required",
    approvalDescription: "Requires approval before revenue operations reconciliation may continue.",
    viewTitle: (names) => `${names.entityName} Detail`
  }
});

const builtinGraphPacks = [authPack, tenantPack, workflowPack, connectorPack, billingPack, commercePack, revenueOpsPack] as const satisfies readonly GraphPackDefinition[];

export function defineGraphPack(definition: GraphPackDefinition): GraphPackDefinition {
  return definition;
}

export function createDurableEntityPack(definition: DurableEntityPackBuilder): GraphPackDefinition {
  return defineGraphPack({
    key: definition.key,
    title: definition.title,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.dependsOn ? { dependsOn: definition.dependsOn } : {}),
    apply(context) {
      const names = resolveDurableEntityPackNames(context, definition);
      const resourceFields = resolveRequiredTemplateRecord(definition.entity.fields, names);
      const resourceTitle = renderTemplateValue(definition.entity.title, names) ?? names.entityName;
      const resourceDescription =
        renderTemplateValue(definition.entity.description, names) ??
        `A durable ${names.entityName.toLowerCase()} managed by this pack.`;
      const listDescription = renderTemplateValue(definition.list?.description, names);
      const listResources = resolveTemplateRecord(definition.list?.resources, names) ?? [
        names.resourceKey
      ];
      const writeDescription = renderTemplateValue(definition.write.description, names);
      const writeResources = resolveTemplateRecord(definition.write.resources, names) ?? [
        names.resourceKey
      ];
      const writeInput = resolveRequiredTemplateRecord(definition.write.input, names);
      const executeDescription = renderTemplateValue(definition.execute.description, names);
      const executeResources = resolveTemplateRecord(definition.execute.resources, names) ?? [
        names.resourceKey
      ];
      const executeInput =
        resolveTemplateRecord(definition.execute.input, names) ??
        defaultExecuteInput(names);

      const durableRuntime = createDurableRuntimeFragments({
        taskKey: names.taskKey,
        taskTitle:
          renderTemplateValue(definition.execute.taskTitle, names) ??
          `${names.executeCapabilityKey} Task`,
        taskDescription:
          renderTemplateValue(definition.execute.taskDescription, names) ??
          `Durably executes ${names.executeCapabilityKey} and records one artifact.`,
        artifactKey: names.artifactKey,
        artifactTitle:
          renderTemplateValue(definition.execute.artifactTitle, names) ?? names.artifactKey,
        artifactDescription:
          renderTemplateValue(definition.execute.artifactDescription, names) ??
          `A generated artifact produced after ${names.executeCapabilityKey} completes.`,
        artifactKind: definition.execute.artifactKind,
        approvalPolicyKey: names.approvalPolicyKey,
        approvalTitle:
          renderTemplateValue(definition.execute.approvalTitle, names) ??
          `${names.entityName} Approval Required`,
        approvalDescription:
          renderTemplateValue(definition.execute.approvalDescription, names) ??
          `Requires approval before ${names.executeCapabilityKey} may continue.`
      });

      return {
        resources: [
          {
            key: names.resourceKey,
            title: resourceTitle,
            description: resourceDescription,
            fields: resourceFields
          }
        ],
        capabilities: [
          {
            key: names.listCapabilityKey,
            title:
              renderTemplateValue(definition.list?.title, names) ??
              `List ${names.entityPlural}`,
            ...(listDescription ? { description: listDescription } : {}),
            mode: "read",
            resources: listResources,
            policy: names.accessPolicyKey
          },
          {
            key: names.writeCapabilityKey,
            title:
              renderTemplateValue(definition.write.title, names) ??
              `Upsert ${names.entityName}`,
            ...(writeDescription ? { description: writeDescription } : {}),
            mode: "write",
            resources: writeResources,
            policy: names.accessPolicyKey,
            input: writeInput
          },
          {
            key: names.executeCapabilityKey,
            title:
              renderTemplateValue(definition.execute.title, names) ??
              `Execute ${names.entityName}`,
            ...(executeDescription ? { description: executeDescription } : {}),
            mode: "external",
            resources: executeResources,
            policy: names.approvalPolicyKey,
            task: names.taskKey,
            input: executeInput
          }
        ],
        tasks: durableRuntime.tasks,
        policies: durableRuntime.policies,
        artifacts: durableRuntime.artifacts,
        views: [
          {
            key: names.listViewKey,
            title:
              renderTemplateValue(definition.list?.viewTitle, names) ?? names.entityPlural,
            kind: "list",
            resource: names.resourceKey,
            capability: names.listCapabilityKey
          },
          {
            key: names.formViewKey,
            title:
              renderTemplateValue(definition.write.viewTitle, names) ??
              `Upsert ${names.entityName}`,
            kind: "form",
            resource: names.resourceKey,
            capability: names.writeCapabilityKey
          },
          {
            key: names.detailViewKey,
            title:
              renderTemplateValue(definition.execute.viewTitle, names) ??
              `${names.entityName} Detail`,
            kind: "detail",
            resource: names.resourceKey,
            capability: names.executeCapabilityKey
          }
        ]
      };
    }
  });
}

export function createLinkedEntityPack(definition: LinkedEntityPackBuilder): GraphPackDefinition {
  return defineGraphPack({
    key: definition.key,
    title: definition.title,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.dependsOn ? { dependsOn: definition.dependsOn } : {}),
    apply(context) {
      const names = resolveLinkedEntityPackNames(context, definition);
      const primaryTitle =
        renderTemplateValue(definition.primary.title, names) ?? names.primaryName;
      const primaryDescription =
        renderTemplateValue(definition.primary.description, names) ??
        `A durable ${names.primaryName.toLowerCase()} managed by this pack.`;
      const secondaryTitle =
        renderTemplateValue(definition.secondary.title, names) ?? names.secondaryName;
      const secondaryDescription =
        renderTemplateValue(definition.secondary.description, names) ??
        `A durable ${names.secondaryName.toLowerCase()} managed by this pack.`;
      const primaryFields = resolveRequiredTemplateRecord(definition.primary.fields, names);
      const secondaryFields = resolveRequiredTemplateRecord(definition.secondary.fields, names);
      const primaryListDescription = renderTemplateValue(definition.primaryList?.description, names);
      const primaryWriteDescription = renderTemplateValue(
        definition.primaryWrite.description,
        names
      );
      const secondaryListDescription = renderTemplateValue(
        definition.secondaryList?.description,
        names
      );
      const secondaryExecuteDescription = renderTemplateValue(
        definition.secondaryExecute.description,
        names
      );
      const primaryListResources = resolveTemplateRecord(
        definition.primaryList?.resources,
        names
      ) ?? [names.primaryResourceKey];
      const primaryWriteResources = resolveTemplateRecord(
        definition.primaryWrite.resources,
        names
      ) ?? [names.primaryResourceKey];
      const secondaryListResources = resolveTemplateRecord(
        definition.secondaryList?.resources,
        names
      ) ?? [names.secondaryResourceKey, names.primaryResourceKey];
      const secondaryExecuteResources = resolveTemplateRecord(
        definition.secondaryExecute.resources,
        names
      ) ?? [names.secondaryResourceKey, names.primaryResourceKey];
      const primaryWriteInput = resolveRequiredTemplateRecord(definition.primaryWrite.input, names);
      const secondaryExecuteInput =
        resolveTemplateRecord(definition.secondaryExecute.input, names) ??
        defaultLinkedExecuteInput(names);
      const durableRuntime = createDurableRuntimeFragments({
        taskKey: names.taskKey,
        taskTitle:
          renderTemplateValue(definition.secondaryExecute.taskTitle, names) ??
          `${names.secondaryExecuteCapabilityKey} Task`,
        taskDescription:
          renderTemplateValue(definition.secondaryExecute.taskDescription, names) ??
          `Durably executes ${names.secondaryExecuteCapabilityKey} and records one artifact.`,
        artifactKey: names.artifactKey,
        artifactTitle:
          renderTemplateValue(definition.secondaryExecute.artifactTitle, names) ??
          names.artifactKey,
        artifactDescription:
          renderTemplateValue(definition.secondaryExecute.artifactDescription, names) ??
          `A generated artifact produced after ${names.secondaryExecuteCapabilityKey} completes.`,
        artifactKind: definition.secondaryExecute.artifactKind,
        approvalPolicyKey: names.approvalPolicyKey,
        approvalTitle:
          renderTemplateValue(definition.secondaryExecute.approvalTitle, names) ??
          `${names.secondaryName} Approval Required`,
        approvalDescription:
          renderTemplateValue(definition.secondaryExecute.approvalDescription, names) ??
          `Requires approval before ${names.secondaryExecuteCapabilityKey} may continue.`
      });

      return {
        resources: [
          {
            key: names.primaryResourceKey,
            title: primaryTitle,
            description: primaryDescription,
            fields: primaryFields
          },
          {
            key: names.secondaryResourceKey,
            title: secondaryTitle,
            description: secondaryDescription,
            fields: secondaryFields
          }
        ],
        capabilities: [
          {
            key: names.primaryListCapabilityKey,
            title:
              renderTemplateValue(definition.primaryList?.title, names) ??
              `List ${names.primaryPlural}`,
            ...(primaryListDescription ? { description: primaryListDescription } : {}),
            mode: "read",
            resources: primaryListResources,
            policy: names.accessPolicyKey
          },
          {
            key: names.primaryWriteCapabilityKey,
            title:
              renderTemplateValue(definition.primaryWrite.title, names) ??
              `Upsert ${names.primaryName}`,
            ...(primaryWriteDescription ? { description: primaryWriteDescription } : {}),
            mode: "write",
            resources: primaryWriteResources,
            policy: names.accessPolicyKey,
            input: primaryWriteInput
          },
          {
            key: names.secondaryListCapabilityKey,
            title:
              renderTemplateValue(definition.secondaryList?.title, names) ??
              `List ${names.secondaryPlural}`,
            ...(secondaryListDescription ? { description: secondaryListDescription } : {}),
            mode: "read",
            resources: secondaryListResources,
            policy: names.accessPolicyKey
          },
          {
            key: names.secondaryExecuteCapabilityKey,
            title:
              renderTemplateValue(definition.secondaryExecute.title, names) ??
              `Execute ${names.secondaryName}`,
            ...(secondaryExecuteDescription ? { description: secondaryExecuteDescription } : {}),
            mode: "external",
            resources: secondaryExecuteResources,
            policy: names.approvalPolicyKey,
            task: names.taskKey,
            input: secondaryExecuteInput
          }
        ],
        tasks: durableRuntime.tasks,
        policies: durableRuntime.policies,
        artifacts: durableRuntime.artifacts,
        views: [
          {
            key: names.primaryListViewKey,
            title:
              renderTemplateValue(definition.primaryList?.viewTitle, names) ??
              names.primaryPlural,
            kind: "list",
            resource: names.primaryResourceKey,
            capability: names.primaryListCapabilityKey
          },
          {
            key: names.primaryFormViewKey,
            title:
              renderTemplateValue(definition.primaryWrite.viewTitle, names) ??
              `Upsert ${names.primaryName}`,
            kind: "form",
            resource: names.primaryResourceKey,
            capability: names.primaryWriteCapabilityKey
          },
          {
            key: names.secondaryListViewKey,
            title:
              renderTemplateValue(definition.secondaryList?.viewTitle, names) ??
              names.secondaryPlural,
            kind: "list",
            resource: names.secondaryResourceKey,
            capability: names.secondaryListCapabilityKey
          },
          {
            key: names.secondaryDetailViewKey,
            title:
              renderTemplateValue(definition.secondaryExecute.viewTitle, names) ??
              `${names.secondaryName} Detail`,
            kind: "detail",
            resource: names.secondaryResourceKey,
            capability: names.secondaryExecuteCapabilityKey
          }
        ]
      };
    }
  });
}

export function listBuiltinGraphPacks(): GraphPackDefinition[] {
  return [...builtinGraphPacks];
}

export function applyBuiltinAppGraphPacks(graph: AppGraph): AppGraph {
  return applyAppGraphPacks(graph, builtinGraphPacks);
}

export function applyAppGraphPacks(
  graph: AppGraph,
  packs: readonly GraphPackDefinition[]
): AppGraph {
  if ((graph as InternalAppGraph)[PACKS_APPLIED]) {
    return graph;
  }

  const registry = new Map(packs.map((pack) => [pack.key, pack] as const));
  const resolvedSelections = resolvePackSelections(graph.packs ?? [], registry);
  const composed = cloneGraph(graph);
  composed.packs = resolvedSelections;

  const appliedPackKeys: string[] = [];

  for (const selection of resolvedSelections) {
    const pack = registry.get(selection.key);

    if (!pack) {
      throw new Error(`Unknown pack "${selection.key}".`);
    }

    const contribution = pack.apply({
      graph: cloneGraph(composed),
      selection,
      appliedPackKeys: [...appliedPackKeys]
    });

    composed.resources = mergeCollection(
      composed.resources,
      contribution.resources ?? [],
      "resource",
      selection.key
    );
    composed.capabilities = mergeCollection(
      composed.capabilities,
      contribution.capabilities ?? [],
      "capability",
      selection.key
    );
    composed.tasks = mergeCollection(composed.tasks ?? [], contribution.tasks ?? [], "task", selection.key);
    composed.policies = mergeCollection(
      composed.policies ?? [],
      contribution.policies ?? [],
      "policy",
      selection.key
    );
    composed.artifacts = mergeCollection(
      composed.artifacts ?? [],
      contribution.artifacts ?? [],
      "artifact",
      selection.key
    );
    composed.views = mergeCollection(composed.views ?? [], contribution.views ?? [], "view", selection.key);

    appliedPackKeys.push(selection.key);
  }

  return markPacksApplied(composed);
}

export function resolvePackSelections(
  selections: readonly GraphPackSpec[],
  registry: ReadonlyMap<string, GraphPackDefinition>
): GraphPackSpec[] {
  const explicitSelections = new Map<string, GraphPackSpec>();

  for (const selection of selections) {
    const key = selection.key.trim();

    if (!key) {
      throw new Error("Pack selections must not be empty.");
    }

    if (explicitSelections.has(key)) {
      throw new Error(`Duplicate pack selection "${key}".`);
    }

    explicitSelections.set(key, {
      key,
      ...(selection.options ? { options: cloneOptions(selection.options) } : {})
    });
  }

  const orderedSelections: GraphPackSpec[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): void => {
    if (visited.has(key)) {
      return;
    }

    if (visiting.has(key)) {
      throw new Error(`Pack dependency cycle detected at "${key}".`);
    }

    const pack = registry.get(key);

    if (!pack) {
      throw new Error(`Unknown pack "${key}".`);
    }

    visiting.add(key);

    for (const dependency of pack.dependsOn ?? []) {
      visit(dependency);
    }

    visiting.delete(key);
    visited.add(key);

    const explicitSelection = explicitSelections.get(key);
    orderedSelections.push(
      explicitSelection
        ? explicitSelection
        : {
            key
          }
    );
  };

  for (const selection of explicitSelections.values()) {
    visit(selection.key);
  }

  return orderedSelections;
}

function mergeCollection<Value extends { key: string }>(
  current: Value[],
  additions: readonly Value[],
  label: string,
  packKey: string
): Value[] {
  const keys = new Set(current.map((entry) => entry.key.trim()));
  const merged = [...current];

  for (const addition of additions) {
    const key = addition.key.trim();

    if (!key) {
      throw new Error(`Pack "${packKey}" tried to contribute an empty ${label} key.`);
    }

    if (keys.has(key)) {
      throw new Error(
        `Pack "${packKey}" cannot contribute ${label} "${key}" because the key already exists.`
      );
    }

    keys.add(key);
    merged.push(addition);
  }

  return merged;
}

function getAccessPolicyKey(context: GraphPackContext): string {
  return context.appliedPackKeys.includes("tenant") ? "tenantScoped" : "authenticated";
}

function resolveDurableEntityPackNames(
  context: GraphPackContext,
  definition: DurableEntityPackBuilder
): DurableEntityPackNames {
  const entityName = readOptionString(context.selection, "entityName") ?? definition.entity.name;
  const entityPlural =
    readOptionString(context.selection, "entityPlural") ??
    definition.entity.plural ??
    pluralize(entityName);
  const entityKeyStem = toPackPascalName(entityName);
  const entityPluralKeyStem = toPackPascalName(entityPlural);
  const resourceKey =
    readOptionString(context.selection, "resourceKey") ??
    definition.entity.resourceKey ??
    toPackKey(entityName);
  const executeCapabilityKey =
    readOptionString(context.selection, "executeCapabilityKey") ??
    definition.execute.capabilityKey ??
    `execute${entityKeyStem}`;

  return {
    entityName,
    entityPlural,
    resourceKey,
    entityKeyStem,
    entityPluralKeyStem,
    accessPolicyKey: getAccessPolicyKey(context),
    listCapabilityKey:
      readOptionString(context.selection, "listCapabilityKey") ??
      definition.list?.capabilityKey ??
      `list${entityPluralKeyStem}`,
    writeCapabilityKey:
      readOptionString(context.selection, "writeCapabilityKey") ??
      definition.write.capabilityKey ??
      `upsert${entityKeyStem}`,
    executeCapabilityKey,
    taskKey:
      readOptionString(context.selection, "taskKey") ??
      definition.execute.taskKey ??
      `${executeCapabilityKey}Task`,
    artifactKey:
      readOptionString(context.selection, "artifactKey") ??
      definition.execute.artifactKey ??
      `${resourceKey}Artifact`,
    approvalPolicyKey:
      readOptionString(context.selection, "approvalPolicyKey") ??
      definition.execute.approvalPolicyKey ??
      `${resourceKey}ApprovalRequired`,
    listViewKey:
      readOptionString(context.selection, "listViewKey") ??
      definition.list?.viewKey ??
      `${resourceKey}List`,
    formViewKey:
      readOptionString(context.selection, "formViewKey") ??
      definition.write.viewKey ??
      `${resourceKey}Form`,
    detailViewKey:
      readOptionString(context.selection, "detailViewKey") ??
      definition.execute.viewKey ??
      `${resourceKey}Detail`
  };
}

function resolveLinkedEntityPackNames(
  context: GraphPackContext,
  definition: LinkedEntityPackBuilder
): LinkedEntityPackNames {
  const optionKeys = definition.optionKeys ?? {};
  const primaryName =
    readOptionString(context.selection, optionKeys.primaryName ?? "primaryName") ??
    definition.primary.name;
  const primaryPlural =
    readOptionString(context.selection, optionKeys.primaryPlural ?? "primaryPlural") ??
    definition.primary.plural ??
    pluralize(primaryName);
  const primaryKeyStem = toPackPascalName(primaryName);
  const primaryPluralKeyStem = toPackPascalName(primaryPlural);
  const primaryResourceKey =
    readOptionString(context.selection, optionKeys.primaryResourceKey ?? "primaryResourceKey") ??
    definition.primary.resourceKey ??
    toPackKey(primaryName);
  const secondaryName =
    readOptionString(context.selection, optionKeys.secondaryName ?? "secondaryName") ??
    definition.secondary.name;
  const secondaryPlural =
    readOptionString(context.selection, optionKeys.secondaryPlural ?? "secondaryPlural") ??
    definition.secondary.plural ??
    pluralize(secondaryName);
  const secondaryKeyStem = toPackPascalName(secondaryName);
  const secondaryPluralKeyStem = toPackPascalName(secondaryPlural);
  const secondaryResourceKey =
    readOptionString(context.selection, optionKeys.secondaryResourceKey ?? "secondaryResourceKey") ??
    definition.secondary.resourceKey ??
    toPackKey(secondaryName);
  const accessPolicyKey = getAccessPolicyKey(context);
  const primaryListCapabilityKey =
    readOptionString(
      context.selection,
      optionKeys.primaryListCapabilityKey ?? "primaryListCapabilityKey"
    ) ??
    renderTemplateValue(definition.primaryList?.capabilityKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey
    } as LinkedEntityPackNames) ??
    `list${primaryPluralKeyStem}`;
  const primaryWriteCapabilityKey =
    readOptionString(
      context.selection,
      optionKeys.primaryWriteCapabilityKey ?? "primaryWriteCapabilityKey"
    ) ??
    renderTemplateValue(definition.primaryWrite.capabilityKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey
    } as LinkedEntityPackNames) ??
    `upsert${primaryKeyStem}`;
  const secondaryListCapabilityKey =
    readOptionString(
      context.selection,
      optionKeys.secondaryListCapabilityKey ?? "secondaryListCapabilityKey"
    ) ??
    renderTemplateValue(definition.secondaryList?.capabilityKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey
    } as LinkedEntityPackNames) ??
    `list${secondaryPluralKeyStem}`;
  const secondaryExecuteCapabilityKey =
    readOptionString(
      context.selection,
      optionKeys.secondaryExecuteCapabilityKey ?? "secondaryExecuteCapabilityKey"
    ) ??
    renderTemplateValue(definition.secondaryExecute.capabilityKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey,
      primaryListCapabilityKey,
      primaryWriteCapabilityKey,
      secondaryListCapabilityKey
    } as LinkedEntityPackNames) ??
    `execute${secondaryKeyStem}`;
  const taskKey =
    readOptionString(context.selection, optionKeys.taskKey ?? "taskKey") ??
    renderTemplateValue(definition.secondaryExecute.taskKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey,
      primaryListCapabilityKey,
      primaryWriteCapabilityKey,
      secondaryListCapabilityKey,
      secondaryExecuteCapabilityKey
    } as LinkedEntityPackNames) ??
    `${secondaryExecuteCapabilityKey}Task`;
  const artifactKey =
    readOptionString(context.selection, optionKeys.artifactKey ?? "artifactKey") ??
    renderTemplateValue(definition.secondaryExecute.artifactKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey,
      primaryListCapabilityKey,
      primaryWriteCapabilityKey,
      secondaryListCapabilityKey,
      secondaryExecuteCapabilityKey,
      taskKey
    } as LinkedEntityPackNames) ??
    `${secondaryResourceKey}Artifact`;
  const approvalPolicyKey =
    readOptionString(context.selection, optionKeys.approvalPolicyKey ?? "approvalPolicyKey") ??
    renderTemplateValue(definition.secondaryExecute.approvalPolicyKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey,
      primaryKeyStem,
      primaryPluralKeyStem,
      secondaryName,
      secondaryPlural,
      secondaryResourceKey,
      secondaryKeyStem,
      secondaryPluralKeyStem,
      accessPolicyKey,
      primaryListCapabilityKey,
      primaryWriteCapabilityKey,
      secondaryListCapabilityKey,
      secondaryExecuteCapabilityKey,
      taskKey,
      artifactKey
    } as LinkedEntityPackNames) ??
    `${secondaryResourceKey}ApprovalRequired`;
  const primaryListViewKey =
    readOptionString(context.selection, optionKeys.primaryListViewKey ?? "primaryListViewKey") ??
    renderTemplateValue(definition.primaryList?.viewKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey
    } as LinkedEntityPackNames) ??
    `${primaryResourceKey}List`;
  const primaryFormViewKey =
    readOptionString(context.selection, optionKeys.primaryFormViewKey ?? "primaryFormViewKey") ??
    renderTemplateValue(definition.primaryWrite.viewKey, {
      primaryName,
      primaryPlural,
      primaryResourceKey
    } as LinkedEntityPackNames) ??
    `${primaryResourceKey}Form`;
  const secondaryListViewKey =
    readOptionString(context.selection, optionKeys.secondaryListViewKey ?? "secondaryListViewKey") ??
    renderTemplateValue(definition.secondaryList?.viewKey, {
      secondaryName,
      secondaryPlural,
      secondaryResourceKey
    } as LinkedEntityPackNames) ??
    `${secondaryResourceKey}List`;
  const secondaryDetailViewKey =
    readOptionString(
      context.selection,
      optionKeys.secondaryDetailViewKey ?? "secondaryDetailViewKey"
    ) ??
    renderTemplateValue(definition.secondaryExecute.viewKey, {
      secondaryName,
      secondaryPlural,
      secondaryResourceKey
    } as LinkedEntityPackNames) ??
    `${secondaryResourceKey}Detail`;

  return {
    primaryName,
    primaryPlural,
    primaryResourceKey,
    primaryKeyStem,
    primaryPluralKeyStem,
    secondaryName,
    secondaryPlural,
    secondaryResourceKey,
    secondaryKeyStem,
    secondaryPluralKeyStem,
    accessPolicyKey,
    primaryListCapabilityKey,
    primaryWriteCapabilityKey,
    secondaryListCapabilityKey,
    secondaryExecuteCapabilityKey,
    taskKey,
    artifactKey,
    approvalPolicyKey,
    primaryListViewKey,
    primaryFormViewKey,
    secondaryListViewKey,
    secondaryDetailViewKey
  };
}

function resolveTemplateRecord<Names, Value>(
  value: TemplateRecord<Names, Value> | undefined,
  names: Names
): Value | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === "function"
    ? (value as (names: Names) => Value)(names)
    : value;
}

function resolveRequiredTemplateRecord<Names, Value>(
  value: TemplateRecord<Names, Value>,
  names: Names
): Value {
  return typeof value === "function"
    ? (value as (names: Names) => Value)(names)
    : value;
}

function renderTemplateValue<Names>(
  value: TemplateValue<Names> | undefined,
  names: Names
): string | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === "function" ? value(names) : value;
}

function defaultExecuteInput(names: DurableEntityPackNames): Record<string, InputFieldSpec> {
  return {
    [`${names.resourceKey}Id`]: {
      type: "string",
      required: true
    }
  };
}

function defaultLinkedExecuteInput(names: LinkedEntityPackNames): Record<string, InputFieldSpec> {
  return {
    [`${names.secondaryResourceKey}Id`]: {
      type: "string",
      required: true
    }
  };
}

function createDurableRuntimeFragments(config: {
  taskKey: string;
  taskTitle: string;
  taskDescription: string;
  artifactKey: string;
  artifactTitle: string;
  artifactDescription: string;
  artifactKind: ArtifactSpec["kind"];
  approvalPolicyKey: string;
  approvalTitle: string;
  approvalDescription: string;
}): {
  tasks: TaskSpec[];
  policies: PolicySpec[];
  artifacts: ArtifactSpec[];
} {
  return {
    tasks: [
      {
        key: config.taskKey,
        title: config.taskTitle,
        description: config.taskDescription,
        kind: "durable",
        artifacts: [config.artifactKey]
      }
    ],
    policies: [
      {
        key: config.approvalPolicyKey,
        title: config.approvalTitle,
        description: config.approvalDescription,
        effect: "approve"
      }
    ],
    artifacts: [
      {
        key: config.artifactKey,
        title: config.artifactTitle,
        description: config.artifactDescription,
        kind: config.artifactKind
      }
    ]
  };
}

function cloneGraph(graph: AppGraph): InternalAppGraph {
  const cloned: InternalAppGraph = {
    ...(typeof graph.version === "number" ? { version: graph.version } : {}),
    domain: cloneValue(graph.domain) as AppGraph["domain"],
    ...(graph.packs ? { packs: cloneValue(graph.packs) as GraphPackSpec[] } : {}),
    resources: cloneValue(graph.resources) as ResourceSpec[],
    capabilities: cloneValue(graph.capabilities) as CapabilitySpec[],
    tasks: cloneValue(graph.tasks ?? []) as TaskSpec[],
    policies: cloneValue(graph.policies ?? []) as PolicySpec[],
    artifacts: cloneValue(graph.artifacts ?? []) as ArtifactSpec[],
    views: cloneValue(graph.views ?? []) as ViewSpec[]
  };

  if ((graph as InternalAppGraph)[PACKS_APPLIED]) {
    cloned[PACKS_APPLIED] = true;
  }

  return cloned;
}

function cloneOptions(options: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(options) as Record<string, unknown>;
}

function cloneValue<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function markPacksApplied(graph: InternalAppGraph): AppGraph {
  graph[PACKS_APPLIED] = true;
  return graph;
}

function readOptionString(selection: GraphPackSpec, key: string): string | undefined {
  const value = selection.options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function toPackKey(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "packResource";
  }

  const [first, ...rest] = parts;
  return [
    first!.toLowerCase(),
    ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  ].join("");
}

function toPackPascalName(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "PackEntity";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
