import type { CapstanBrief } from "../../../packages/brief/src/index.ts";

export const brief = {
  version: 1,
  domain: {
    key: "revenue-ops-hub",
    title: "Revenue Operations Hub",
    description: "A compact Capstan brief for a revenue operations SaaS."
  },
  packs: [
    {
      key: "revenueOps",
      options: {
        entityName: "Revenue Ops Exception",
        entityPlural: "Revenue Ops Exceptions",
        resourceKey: "revenueOpsException",
        artifactKey: "revenueOpsDigest"
      }
    }
  ],
  entities: [
    {
      name: "Customer Account",
      plural: "Customer Accounts",
      resourceKey: "customerAccount",
      description: "A managed customer account inside revenue operations.",
      fields: {
        name: "string",
        ownerEmail: "string",
        status: {
          type: "string",
          required: true,
          constraints: {
            enum: ["prospect", "active", "churn_risk"]
          }
        }
      },
      relations: {
        primaryRenewalCampaign: "Renewal Campaign",
        renewalCampaigns: {
          target: "Renewal Campaign",
          kind: "many",
          description: "Renewal campaigns linked to the account."
        },
        subscriptions: {
          resource: "subscription",
          kind: "many",
          description: "Subscriptions linked to the account."
        },
        orders: {
          resource: "order",
          kind: "many",
          description: "Orders linked to the account."
        }
      },
      actions: {
        execute: {
          verb: "Review",
          artifactKind: "report",
          artifactKey: "customerAccountReview",
          artifactTitle: "Customer Account Review",
          input: {
            customerAccountId: "string",
            workspaceId: "string"
          },
          viewTitle: "Customer Account Detail"
        }
      }
    },
    {
      name: "Renewal Campaign",
      plural: "Renewal Campaigns",
      resourceKey: "renewalCampaign",
      description: "A planned campaign for upcoming renewals.",
      fields: {
        name: "string",
        windowStart: {
          type: "date",
          required: true
        },
        windowEnd: {
          type: "date",
          required: true
        },
        status: {
          type: "string",
          required: true,
          constraints: {
            enum: ["draft", "running", "closed"]
          }
        }
      },
      actions: {
        write: {
          verb: "Plan",
          viewTitle: "Plan Renewal Campaign"
        },
        execute: false
      }
    }
  ]
} satisfies CapstanBrief;

export default brief;
