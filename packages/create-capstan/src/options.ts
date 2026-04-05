export const templateOptions = [
  {
    value: "agent",
    label: "Agent-first workspace",
    hint: "Capabilities, workflows, policies, memory spaces, and operator views from day one.",
  },
  {
    value: "blank",
    label: "Blank launchpad",
    hint: "One page, one API route, one clean place to start.",
  },
  {
    value: "tickets",
    label: "Tickets example",
    hint: "CRUD routes, auth, database, and a realistic Capstan reference.",
  },
] as const;

export type Template = (typeof templateOptions)[number]["value"];

export const validTemplates = templateOptions.map((option) => option.value) as Template[];

export const deployOptions = [
  {
    value: "none",
    label: "No deploy target yet",
    hint: "Start local and keep the project minimal.",
  },
  {
    value: "docker",
    label: "Docker",
    hint: "Generate a container-friendly path for standalone deploys.",
  },
  {
    value: "vercel-node",
    label: "Vercel (Node)",
    hint: "Serverless Node target with generated Vercel config.",
  },
  {
    value: "vercel-edge",
    label: "Vercel (Edge)",
    hint: "Edge runtime target with portable runtime assets.",
  },
  {
    value: "cloudflare",
    label: "Cloudflare Workers",
    hint: "Worker entrypoint plus wrangler config from day one.",
  },
  {
    value: "fly",
    label: "Fly.io",
    hint: "Docker + Fly metadata for an app-server deployment path.",
  },
] as const;

export type DeployTarget = (typeof deployOptions)[number]["value"];

export const validDeployTargets = deployOptions.map((option) => option.value) as DeployTarget[];
