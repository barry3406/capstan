import type { AppAssertion, AppAssertionContext, AppAssertionResult } from "../types.js";

const CORE_RESOURCES = [
  "workspace", "member", "customerAccount", "customerContact",
  "productCatalogItem", "pricingPlan", "commercialContract",
  "salesOrder", "salesOrderLine", "serviceSubscription",
  "billingInvoice", "paymentRecord", "refundRequest", "disputeCase",
  "renewalCampaign", "renewalOpportunity", "reconciliationCase",
  "exceptionCase", "integrationConnection", "syncJob",
  "approvalRequest", "auditNote",
] as const;

const CUSTOMER_ACCOUNT_EXPECTED_RELATIONS: Record<string, string> = {
  contacts: "customerContact",
  contracts: "commercialContract",
  orders: "salesOrder",
  subscriptions: "serviceSubscription",
  invoices: "billingInvoice",
  renewalOpportunities: "renewalOpportunity",
};

const APPROVAL_POLICIES = [
  { label: "discount (salesOrder)", resourceHint: "salesOrder", keyword: "sales-order" },
  { label: "invoice (billingInvoice)", resourceHint: "billingInvoice", keyword: "billing-invoice" },
  { label: "refund (refundRequest)", resourceHint: "refundRequest", keyword: "refund-request" },
  { label: "exception case", resourceHint: "exceptionCase", keyword: "exception-case" },
  { label: "dispute case", resourceHint: "disputeCase", keyword: "dispute-case" },
];

const ATTENTION_ARTIFACTS = [
  "renewalRiskDigest",
  "syncHealthReport",
  "exceptionResolutionSummary",
  "customerHealthSnapshot",
];

function findResource(ctx: AppAssertionContext, key: string) {
  return ctx.resources.find((r) => r.key === key);
}

export const customAssertions: readonly AppAssertion[] = [
  // 1. Core resources exist
  {
    key: "orbitops-core-resources-exist",
    title: "All 22 core resources exist",
    source: "custom",
    run(ctx): AppAssertionResult {
      const existing = new Set(ctx.resources.map((r) => r.key));
      const missing = CORE_RESOURCES.filter((k) => !existing.has(k));
      if (missing.length === 0) {
        return { status: "passed", summary: `All ${CORE_RESOURCES.length} core resources are defined.` };
      }
      return {
        status: "failed",
        summary: `${missing.length} core resource(s) missing.`,
        detail: `Missing: ${missing.join(", ")}`,
        hint: "Add the missing resource definitions to the resources directory.",
      };
    },
  },

  // 2. customerAccount relations complete
  {
    key: "customer-account-relations-complete",
    title: "customerAccount has all required relations",
    source: "custom",
    run(ctx): AppAssertionResult {
      const account = findResource(ctx, "customerAccount");
      if (!account) {
        return { status: "failed", summary: "customerAccount resource not found." };
      }
      const relations = account.relations ?? {};
      const missing: string[] = [];
      for (const [relKey, targetResource] of Object.entries(CUSTOMER_ACCOUNT_EXPECTED_RELATIONS)) {
        const rel = relations[relKey];
        if (!rel || rel.resource !== targetResource) {
          missing.push(`${relKey} -> ${targetResource}`);
        }
      }
      if (missing.length === 0) {
        return { status: "passed", summary: "customerAccount has all required relations." };
      }
      return {
        status: "failed",
        summary: `customerAccount is missing ${missing.length} relation(s).`,
        detail: `Missing or incorrect: ${missing.join(", ")}`,
        hint: "Update the customerAccount resource to include the missing relations.",
      };
    },
  },

  // 3. Durable tasks have artifacts
  {
    key: "durable-tasks-have-artifacts",
    title: "Every durable task has at least one artifact",
    source: "custom",
    run(ctx): AppAssertionResult {
      const durableTasks = ctx.tasks.filter((t) => t.kind === "durable");
      if (durableTasks.length === 0) {
        return { status: "passed", summary: "No durable tasks found; nothing to check." };
      }
      const missing = durableTasks.filter(
        (t) => !t.artifacts || t.artifacts.length === 0,
      );
      if (missing.length === 0) {
        return {
          status: "passed",
          summary: `All ${durableTasks.length} durable task(s) have at least one artifact.`,
        };
      }
      return {
        status: "failed",
        summary: `${missing.length} durable task(s) lack artifacts.`,
        detail: `Tasks without artifacts: ${missing.map((t) => t.key).join(", ")}`,
        hint: "Add at least one artifact key to every durable task definition.",
      };
    },
  },

  // 4. Approval policies present
  {
    key: "approval-policies-present",
    title: "Required approval policies exist",
    source: "custom",
    run(ctx): AppAssertionResult {
      const approvalPolicies = ctx.policies.filter((p) => p.effect === "approve");
      const missing: string[] = [];
      for (const expected of APPROVAL_POLICIES) {
        const found = approvalPolicies.some(
          (p) =>
            p.key.includes(expected.keyword) ||
            p.key.includes(expected.resourceHint),
        );
        if (!found) {
          missing.push(expected.label);
        }
      }
      if (missing.length === 0) {
        return { status: "passed", summary: "All required approval policies are present." };
      }
      return {
        status: "failed",
        summary: `${missing.length} approval policy/policies missing.`,
        detail: `Missing approval policies for: ${missing.join(", ")}`,
        hint: "Add approval policies with effect 'approve' for the missing areas.",
      };
    },
  },

  // 5. Agent surface coverage
  {
    key: "agent-surface-coverage",
    title: "Agent surface exposes at least 60 capabilities and 10 tasks",
    source: "custom",
    run(ctx): AppAssertionResult {
      const capCount = ctx.agentSurface.summary?.capabilityCount ??
        ctx.agentSurface.capabilities?.length ?? 0;
      const taskCount = ctx.agentSurface.summary?.taskCount ??
        ctx.agentSurface.tasks?.length ?? 0;
      const issues: string[] = [];
      if (capCount < 60) issues.push(`capabilities: ${capCount}/60`);
      if (taskCount < 10) issues.push(`tasks: ${taskCount}/10`);
      if (issues.length === 0) {
        return {
          status: "passed",
          summary: `Agent surface has ${capCount} capabilities and ${taskCount} tasks.`,
        };
      }
      return {
        status: "failed",
        summary: `Agent surface coverage insufficient: ${issues.join(", ")}.`,
        hint: "Expose more capabilities and tasks on the agent surface.",
      };
    },
  },

  // 6. Human surface route coverage
  {
    key: "human-surface-route-coverage",
    title: "Human surface has at least 50 routes",
    source: "custom",
    run(ctx): AppAssertionResult {
      const routeCount = ctx.humanSurface.summary?.routeCount ??
        ctx.humanSurface.routes?.length ?? 0;
      if (routeCount >= 50) {
        return { status: "passed", summary: `Human surface has ${routeCount} routes.` };
      }
      return {
        status: "failed",
        summary: `Human surface has only ${routeCount} route(s); at least 50 required.`,
        hint: "Add more routes to the human surface definition.",
      };
    },
  },

  // 7. Subscription lifecycle capability
  {
    key: "subscription-lifecycle-capability",
    title: "manageServiceSubscription capability exists with mode external and linked task",
    source: "custom",
    run(ctx): AppAssertionResult {
      const cap = ctx.capabilities.find((c) => c.key === "manageServiceSubscription");
      if (!cap) {
        return {
          status: "failed",
          summary: "manageServiceSubscription capability not found.",
          hint: "Define a manageServiceSubscription capability.",
        };
      }
      const issues: string[] = [];
      if (cap.mode !== "external") issues.push(`mode is '${cap.mode}', expected 'external'`);
      if (!cap.task) issues.push("no linked task");
      if (issues.length === 0) {
        return {
          status: "passed",
          summary: "manageServiceSubscription capability is correctly configured.",
        };
      }
      return {
        status: "failed",
        summary: `manageServiceSubscription issues: ${issues.join("; ")}.`,
        hint: "Set mode to 'external' and link a task to the capability.",
      };
    },
  },

  // 8. Connector providers covered
  {
    key: "connector-providers-covered",
    title: "integrationConnection has provider field with required enum values",
    source: "custom",
    run(ctx): AppAssertionResult {
      const resource = findResource(ctx, "integrationConnection");
      if (!resource) {
        return { status: "failed", summary: "integrationConnection resource not found." };
      }
      const providerField = resource.fields["provider"];
      if (!providerField) {
        return {
          status: "failed",
          summary: "integrationConnection is missing a 'provider' field.",
          hint: "Add a provider field to the integrationConnection resource.",
        };
      }
      const enumValues = providerField.constraints?.enum ?? [];
      const required = ["salesforce", "stripe", "netsuite", "hubspot"];
      const missing = required.filter((v) => !enumValues.includes(v));
      if (missing.length === 0) {
        return { status: "passed", summary: "provider field contains all required enum values." };
      }
      return {
        status: "failed",
        summary: `provider enum is missing: ${missing.join(", ")}.`,
        hint: "Add the missing provider values to the enum constraint.",
      };
    },
  },

  // 9. Cross-resource navigation
  {
    key: "cross-resource-navigation",
    title: "customerAccount -> serviceSubscription -> billingInvoice relation chain exists",
    source: "custom",
    run(ctx): AppAssertionResult {
      const issues: string[] = [];

      const account = findResource(ctx, "customerAccount");
      if (!account) {
        issues.push("customerAccount resource not found");
      } else {
        const subRel = account.relations?.["subscriptions"];
        if (!subRel || subRel.resource !== "serviceSubscription") {
          issues.push("customerAccount missing subscriptions -> serviceSubscription relation");
        }
      }

      const subscription = findResource(ctx, "serviceSubscription");
      if (!subscription) {
        issues.push("serviceSubscription resource not found");
      } else {
        const invRel = subscription.relations?.["invoices"];
        if (!invRel || invRel.resource !== "billingInvoice") {
          issues.push("serviceSubscription missing invoices -> billingInvoice relation");
        }
      }

      if (issues.length === 0) {
        return {
          status: "passed",
          summary: "Cross-resource navigation chain customerAccount -> serviceSubscription -> billingInvoice is intact.",
        };
      }
      return {
        status: "failed",
        summary: `Broken navigation chain: ${issues.join("; ")}.`,
        hint: "Ensure each resource in the chain defines the expected relation.",
      };
    },
  },

  // 10. Workflow attention artifacts
  {
    key: "workflow-attention-artifacts",
    title: "Required workflow attention artifacts exist",
    source: "custom",
    run(ctx): AppAssertionResult {
      const existing = new Set(ctx.artifacts.map((a) => a.key));
      const missing = ATTENTION_ARTIFACTS.filter((k) => !existing.has(k));
      if (missing.length === 0) {
        return {
          status: "passed",
          summary: `All ${ATTENTION_ARTIFACTS.length} attention artifacts are defined.`,
        };
      }
      return {
        status: "failed",
        summary: `${missing.length} attention artifact(s) missing.`,
        detail: `Missing: ${missing.join(", ")}`,
        hint: "Add the missing artifact definitions.",
      };
    },
  },
];
