import { describe, expect, it } from "vitest";
import {
  compileCapstanBrief,
  planCapstanBriefPacks,
  summarizeCapstanBrief,
  validateCapstanBrief
} from "../../packages/brief/src/index.ts";
import { inferredRevenueOpsSaasBrief } from "../fixtures/briefs/inferred-revenue-ops-saas-brief.fixture.ts";
import { revenueOpsSaasBrief } from "../fixtures/briefs/revenue-ops-saas-brief.fixture.ts";
import { starterRevenueOpsSaasBrief } from "../fixtures/briefs/starter-revenue-ops-saas-brief.fixture.ts";

describe("brief", () => {
  it("summarizes and compiles a revenue-ops brief into an app graph", () => {
    const summary = summarizeCapstanBrief(revenueOpsSaasBrief);
    const graph = compileCapstanBrief(revenueOpsSaasBrief);

    expect(summary.counts).toEqual({
      packs: 1,
      entities: 2
    });
    expect(graph.packs?.map((pack) => pack.key)).toEqual(["revenueOps"]);
    expect(graph.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["customerAccount", "renewalCampaign"])
    );
    expect(graph.resources.find((resource) => resource.key === "customerAccount")?.relations).toEqual(
      expect.objectContaining({
        primaryRenewalCampaign: {
          resource: "renewalCampaign",
          kind: "one"
        },
        renewalCampaigns: {
          resource: "renewalCampaign",
          kind: "many",
          description: "Renewal campaigns linked to the account."
        }
      })
    );
    expect(
      graph.capabilities.find((capability) => capability.key === "listCustomerAccounts")?.output
    ).toEqual(
      expect.objectContaining({
        id: {
          type: "string",
          required: true,
          description: "Stable identifier for one customerAccount record."
        },
        primaryRenewalCampaignId: {
          type: "string",
          description: "Reference to one related renewalCampaign record."
        },
        renewalCampaignIds: {
          type: "json",
          description: "Renewal campaigns linked to the account."
        },
        subscriptionIds: {
          type: "json",
          description: "Subscriptions linked to the account."
        },
        orderIds: {
          type: "json",
          description: "Orders linked to the account."
        }
      })
    );
    expect(
      graph.capabilities.find((capability) => capability.key === "reviewCustomerAccount")?.output
    ).toEqual(
      expect.objectContaining({
        status: {
          type: "string",
          required: true,
          description: "Execution status for this capability run."
        },
        customerAccountId: {
          type: "string",
          description: "Stable identifier for the customerAccount record associated with this execution."
        },
        taskRunId: {
          type: "string",
          description: 'Durable run identifier for task "reviewCustomerAccountTask".'
        },
        artifact: {
          type: "json",
          description:
            'Produced report payload or reference for artifact "customerAccountReview".'
        }
      })
    );
    expect(
      graph.capabilities.find((capability) => capability.key === "upsertCustomerAccount")?.input
    ).toEqual(
      expect.objectContaining({
        name: {
          type: "string",
          required: true
        },
        ownerEmail: {
          type: "string",
          required: true
        },
        status: {
          type: "string",
          required: true,
          constraints: {
            enum: ["prospect", "active", "churn_risk"]
          }
        },
        primaryRenewalCampaignId: {
          type: "string",
          description: "Reference to one related renewalCampaign record."
        },
        renewalCampaignIds: {
          type: "json",
          description: "Renewal campaigns linked to the account."
        },
        subscriptionIds: {
          type: "json",
          description: "Subscriptions linked to the account."
        },
        orderIds: {
          type: "json",
          description: "Orders linked to the account."
        }
      })
    );
    expect(graph.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listCustomerAccounts",
        "upsertCustomerAccount",
        "reviewCustomerAccount",
        "listRenewalCampaigns",
        "planRenewalCampaign"
      ])
    );
    expect(
      graph.capabilities.find((capability) => capability.key === "listCustomerAccounts")?.policy
    ).toBe("tenantScoped");
    expect(graph.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["reviewCustomerAccountTask"])
    );
    expect(graph.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["customerAccountReview"])
    );
    expect(graph.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining([
        "customerAccountList",
        "customerAccountForm",
        "customerAccountDetail",
        "renewalCampaignList",
        "renewalCampaignForm"
      ])
    );
  });

  it("rejects invalid briefs before compilation", () => {
    const invalid = {
      ...revenueOpsSaasBrief,
      entities: [
        ...revenueOpsSaasBrief.entities,
        {
          name: "Customer Account",
          resourceKey: "customerAccount",
          fields: {
            name: "string"
          }
        }
      ]
    };

    const validation = validateCapstanBrief(invalid);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "entities.customerAccount",
          message: 'Duplicate key "customerAccount".'
        })
      ])
    );
    expect(() => compileCapstanBrief(invalid)).toThrowError("Capstan brief validation failed");
  });

  it("rejects relation shorthand that points at an unknown brief entity", () => {
    const invalid = {
      ...revenueOpsSaasBrief,
      entities: revenueOpsSaasBrief.entities.map((entity) =>
        entity.resourceKey === "customerAccount"
          ? {
              ...entity,
              relations: {
                ...entity.relations,
                unknownLink: "Missing Entity"
              }
            }
          : entity
      )
    };

    const validation = validateCapstanBrief(invalid);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "entities.customerAccount.relations.unknownLink",
          message:
            "Brief relation must declare a resource or reference another declared brief entity."
        })
      ])
    );
  });

  it("infers pack selections from application profile and modules", () => {
    const packPlan = planCapstanBriefPacks(inferredRevenueOpsSaasBrief);
    const summary = summarizeCapstanBrief(inferredRevenueOpsSaasBrief);
    const graph = compileCapstanBrief(inferredRevenueOpsSaasBrief);

    expect(packPlan.explicit.map((pack) => pack.key)).toEqual([]);
    expect(packPlan.inferred.map((pack) => pack.key)).toEqual(
      expect.arrayContaining(["auth", "tenant", "revenueOps"])
    );
    expect(
      packPlan.inferred.find((pack) => pack.key === "revenueOps")?.options
    ).toEqual({
      artifactKey: "inferredRevenueOpsDigest"
    });
    expect(packPlan.resolved.map((pack) => pack.key)).toEqual([
      "auth",
      "tenant",
      "commerce",
      "billing",
      "connector",
      "revenueOps"
    ]);
    expect(summary.packPlan.resolved).toEqual([
      "auth",
      "tenant",
      "commerce",
      "billing",
      "connector",
      "revenueOps"
    ]);
    expect(graph.packs?.map((pack) => pack.key)).toEqual(
      expect.arrayContaining(["auth", "tenant", "revenueOps"])
    );
    expect(graph.packs?.find((pack) => pack.key === "revenueOps")?.options).toEqual({
      artifactKey: "inferredRevenueOpsDigest"
    });
    expect(
      graph.capabilities.find((capability) => capability.key === "listAccountPlans")?.policy
    ).toBe("tenantScoped");
  });

  it("accepts a starter brief that relies entirely on inferred packs", () => {
    const validation = validateCapstanBrief(starterRevenueOpsSaasBrief);
    const summary = summarizeCapstanBrief(starterRevenueOpsSaasBrief);
    const packPlan = planCapstanBriefPacks(starterRevenueOpsSaasBrief);
    const graph = compileCapstanBrief(starterRevenueOpsSaasBrief);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(summary.counts).toEqual({
      packs: 3,
      entities: 0
    });
    expect(summary.application).toEqual({
      profile: "saas",
      modules: [
        {
          key: "revenueOps",
          options: {
            artifactKey: "starterRevenueOpsDigest"
          }
        }
      ]
    });
    expect(packPlan.inferred.map((pack) => pack.key)).toEqual(
      expect.arrayContaining(["auth", "tenant", "revenueOps"])
    );
    expect(packPlan.resolved.map((pack) => pack.key)).toEqual([
      "auth",
      "tenant",
      "commerce",
      "billing",
      "connector",
      "revenueOps"
    ]);
    expect(graph.resources).toEqual([]);
    expect(graph.capabilities).toEqual([]);
    expect(graph.packs).toHaveLength(3);
    expect(graph.packs).toEqual(
      expect.arrayContaining([
        {
          key: "auth"
        },
        {
          key: "tenant"
        },
        {
          key: "revenueOps",
          options: {
            artifactKey: "starterRevenueOpsDigest"
          }
        }
      ])
    );
  });
});
