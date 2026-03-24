import type { CapstanBrief } from "../../../packages/brief/src/index.ts";

export const inferredRevenueOpsSaasBrief = {
  version: 1,
  domain: {
    key: "revenue-ops-inferred",
    title: "Inferred Revenue Operations Hub",
    description: "A Capstan brief that relies on profile and module inference."
  },
  application: {
    profile: "saas",
    modules: [
      {
        key: "revenueOps",
        options: {
          artifactKey: "inferredRevenueOpsDigest"
        }
      }
    ]
  },
  entities: [
    {
      name: "Account Plan",
      plural: "Account Plans",
      resourceKey: "accountPlan",
      fields: {
        name: "string",
        ownerEmail: "string",
        status: {
          type: "string",
          required: true,
          constraints: {
            enum: ["draft", "active", "at_risk"]
          }
        }
      },
      actions: {
        execute: {
          verb: "Review",
          artifactKind: "report"
        }
      }
    }
  ]
} satisfies CapstanBrief;
