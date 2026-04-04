import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function ComparisonPage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Framework Comparison"),

    createElement("p", null,
      "Capstan sits at the intersection of full-stack web development and AI agent operability. ",
      "This page compares it with Next.js, Mastra, and LangGraph to help you decide which framework fits your use case."
    ),

    // Capstan vs Next.js
    createElement("h2", null, "Capstan vs Next.js"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Feature"),
          createElement("th", null, "Capstan"),
          createElement("th", null, "Next.js")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "Primary audience"),
          createElement("td", null, "Human users + AI agents"),
          createElement("td", null, "Human users")
        ),
        createElement("tr", null,
          createElement("td", null, "API definition"),
          createElement("td", null, createElement("code", null, "defineAPI()"), " with Zod schemas"),
          createElement("td", null, "Route handlers or API routes")
        ),
        createElement("tr", null,
          createElement("td", null, "Multi-protocol"),
          createElement("td", null, "HTTP + MCP + A2A + OpenAPI from one definition"),
          createElement("td", null, "HTTP only (manual OpenAPI)")
        ),
        createElement("tr", null,
          createElement("td", null, "Agent manifest"),
          createElement("td", null, "Auto-generated at ", createElement("code", null, "/.well-known/capstan.json")),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "MCP server"),
          createElement("td", null, "Built-in (", createElement("code", null, "capstan mcp"), ")"),
          createElement("td", null, "Requires separate implementation")
        ),
        createElement("tr", null,
          createElement("td", null, "A2A protocol"),
          createElement("td", null, "Built-in"),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "OpenAPI spec"),
          createElement("td", null, "Auto-generated from Zod schemas"),
          createElement("td", null, "Requires third-party tools")
        ),
        createElement("tr", null,
          createElement("td", null, "Server runtime"),
          createElement("td", null, "Hono (lightweight, Web Standards)"),
          createElement("td", null, "Custom (Turbopack/Webpack)")
        ),
        createElement("tr", null,
          createElement("td", null, "Database"),
          createElement("td", null, "Drizzle ORM with ", createElement("code", null, "defineModel()")),
          createElement("td", null, "BYO (Prisma, Drizzle, etc.)")
        ),
        createElement("tr", null,
          createElement("td", null, "Auth"),
          createElement("td", null, "Built-in JWT + API key for agents"),
          createElement("td", null, "NextAuth.js (community package)")
        ),
        createElement("tr", null,
          createElement("td", null, "Policy engine"),
          createElement("td", null, createElement("code", null, "definePolicy()"), " with allow/deny/approve/redact"),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "Approval workflow"),
          createElement("td", null, "Built-in human-in-the-loop"),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "Verification"),
          createElement("td", null, createElement("code", null, "capstan verify"), " (AI TDD loop)"),
          createElement("td", null, createElement("code", null, "tsc"), " + linting")
        ),
        createElement("tr", null,
          createElement("td", null, "SSR"),
          createElement("td", null, "React SSR with loaders"),
          createElement("td", null, "React Server Components")
        ),
        createElement("tr", null,
          createElement("td", null, "ISR"),
          createElement("td", null, "Built-in ", createElement("code", null, 'renderMode: "isr"')),
          createElement("td", null, "Built-in (page-level revalidate)")
        ),
        createElement("tr", null,
          createElement("td", null, "RAG / vector search"),
          createElement("td", null, "Built-in ", createElement("code", null, "field.vector()"), ", ", createElement("code", null, "defineEmbedding()")),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "Rate limiting"),
          createElement("td", null, "Built-in per auth type"),
          createElement("td", null, "Requires middleware / third-party")
        ),
        createElement("tr", null,
          createElement("td", null, "Ecosystem maturity"),
          createElement("td", null, "Early stage"),
          createElement("td", null, "Mature, large ecosystem")
        )
      )
    ),

    // Capstan vs Mastra
    createElement("h2", null, "Capstan vs Mastra"),
    createElement("p", null, "Mastra is a TypeScript framework for building AI agents and workflows."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Feature"),
          createElement("th", null, "Capstan"),
          createElement("th", null, "Mastra")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "Focus"),
          createElement("td", null, "Full-stack apps consumed by agents + humans"),
          createElement("td", null, "AI agent orchestration and workflows")
        ),
        createElement("tr", null,
          createElement("td", null, "Approach"),
          createElement("td", null, '"App that agents can use"'),
          createElement("td", null, '"Agent that uses apps"')
        ),
        createElement("tr", null,
          createElement("td", null, "API layer"),
          createElement("td", null, createElement("code", null, "defineAPI()"), " with automatic multi-protocol"),
          createElement("td", null, "Agent tools with function calling")
        ),
        createElement("tr", null,
          createElement("td", null, "Web UI"),
          createElement("td", null, "File-based routing, React SSR"),
          createElement("td", null, "Optional playground UI")
        ),
        createElement("tr", null,
          createElement("td", null, "Auth"),
          createElement("td", null, "JWT sessions + API keys"),
          createElement("td", null, "BYO authentication")
        ),
        createElement("tr", null,
          createElement("td", null, "Policy engine"),
          createElement("td", null, "Built-in with approval workflow"),
          createElement("td", null, "Not available")
        ),
        createElement("tr", null,
          createElement("td", null, "LLM integration"),
          createElement("td", null, "Framework-agnostic (agents call your APIs)"),
          createElement("td", null, "Built-in LLM orchestration")
        )
      )
    ),

    // Capstan vs LangGraph
    createElement("h2", null, "Capstan vs LangGraph"),
    createElement("p", null, "LangGraph is a framework for building stateful, multi-actor AI applications using graph-based workflows."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Feature"),
          createElement("th", null, "Capstan"),
          createElement("th", null, "LangGraph")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "Language"),
          createElement("td", null, "TypeScript"),
          createElement("td", null, "Python (primary), TypeScript")
        ),
        createElement("tr", null,
          createElement("td", null, "Focus"),
          createElement("td", null, "Full-stack apps with agent interfaces"),
          createElement("td", null, "Stateful agent workflow graphs")
        ),
        createElement("tr", null,
          createElement("td", null, "Architecture"),
          createElement("td", null, "Request/response API framework"),
          createElement("td", null, "Graph-based state machines")
        ),
        createElement("tr", null,
          createElement("td", null, "Web UI"),
          createElement("td", null, "Built-in file-based routing + React SSR"),
          createElement("td", null, "LangGraph Studio (separate tool)")
        ),
        createElement("tr", null,
          createElement("td", null, "Human-in-the-loop"),
          createElement("td", null, "Policy-based approval workflow"),
          createElement("td", null, "Graph interrupt nodes")
        ),
        createElement("tr", null,
          createElement("td", null, "Multi-agent"),
          createElement("td", null, "Agents call your APIs independently"),
          createElement("td", null, "Multi-actor graphs with shared state")
        )
      )
    ),

    // Feature Comparison Table
    createElement("h2", null, "Feature Comparison Table"),
    createElement("p", { className: "table-legend" },
      createElement("span", { className: "check" }, "+"),
      " Built-in  ",
      createElement("span", { className: "partial" }, "~"),
      " Partial / Plugin  ",
      createElement("span", { className: "cross" }, "-"),
      " Not available"
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Feature"),
          createElement("th", null, "Capstan"),
          createElement("th", null, "Next.js"),
          createElement("th", null, "Mastra"),
          createElement("th", null, "LangGraph")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "HTTP API framework"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "MCP server (auto-generated)"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "A2A protocol"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "OpenAPI auto-generation"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "File-based routing"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "React SSR"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "ISR (stale-while-revalidate)"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "Built-in database layer"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "partial" }, "~"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "Built-in auth (JWT + API key)"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "Policy engine"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "Approval workflow"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "partial" }, "~")
        ),
        createElement("tr", null,
          createElement("td", null, "RAG / vector search"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "partial" }, "~")
        ),
        createElement("tr", null,
          createElement("td", null, "Rate limiting (per auth type)"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "Workload identity (SPIFFE)"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-")
        ),
        createElement("tr", null,
          createElement("td", null, "LLM orchestration"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+")
        ),
        createElement("tr", null,
          createElement("td", null, "Multi-agent workflows"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+")
        ),
        createElement("tr", null,
          createElement("td", null, "Graph-based state machines"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "cross" }, "-"),
          createElement("td", { className: "check" }, "+")
        ),
        createElement("tr", null,
          createElement("td", null, "TypeScript-first"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "check" }, "+"),
          createElement("td", { className: "partial" }, "~")
        ),
        createElement("tr", null,
          createElement("td", null, "Production maturity"),
          createElement("td", null, "beta"),
          createElement("td", null, "mature"),
          createElement("td", null, "early"),
          createElement("td", null, "early")
        )
      )
    ),

    // Key Differentiators
    createElement("h2", null, "Key Differentiators"),

    createElement("h3", null, "Shared Contract"),
    createElement("p", null,
      "One ", createElement("code", null, "defineAPI()"),
      " call produces four surfaces: an HTTP endpoint, an MCP tool, an A2A skill, and an OpenAPI operation. ",
      "The Zod schema is the single source of truth. You never write glue code to keep them in sync."
    ),

    createElement("h3", null, "Agent-Native"),
    createElement("p", null,
      "Agent support is not an afterthought or a plugin. Every route is automatically discoverable via MCP and A2A. ",
      "The ", createElement("code", null, "/.well-known/capstan.json"),
      " manifest tells agents exactly what your app can do, what inputs are required, and what policies govern access."
    ),

    createElement("h3", null, "Policy-First"),
    createElement("p", null,
      "Policies are declarative rules evaluated before handlers, with built-in support for approval workflows. ",
      "An agent requesting a destructive action can be paused until a human approves."
    ),

    createElement("h3", null, "Verification Loop"),
    createElement("p", null,
      createElement("code", null, "capstan verify"),
      " runs a multi-step cascade that catches issues across types, routes, schemas, policies, agent manifests, ",
      "OpenAPI specs, and runtime health. When paired with AI code generation, it forms a \"generate, verify, repair\" loop."
    ),

    // When to Use
    createElement("h2", null, "When to Use Capstan"),
    createElement("ul", null,
      createElement("li", null, "You are building an application that AI agents will interact with programmatically"),
      createElement("li", null, "You want a single ", createElement("code", null, "defineAPI()"), " call to generate HTTP, MCP, A2A, and OpenAPI endpoints"),
      createElement("li", null, "You need human-in-the-loop approval workflows for agent actions"),
      createElement("li", null, "You want built-in agent authentication (API keys) alongside human auth (JWT)"),
      createElement("li", null, "You prefer full-stack TypeScript with a lightweight Hono-based server")
    ),

    createElement("h2", null, "When NOT to Use Capstan"),
    createElement("ul", null,
      createElement("li", null, "You are building a primarily human-facing web application with no agent requirements"),
      createElement("li", null, "You need React Server Components or the Next.js app router"),
      createElement("li", null, "You rely on a mature ecosystem with extensive third-party plugins"),
      createElement("li", null, "Your team is Python-only and does not want to adopt TypeScript"),
      createElement("li", null, "You are building complex multi-step agent workflows with LLM orchestration (consider Mastra or LangGraph)")
    ),

    // Summary
    createElement("h2", null, "Summary"),
    createElement("div", { className: "callout callout-info" },
      createElement("p", null,
        createElement("strong", null, "Choose Capstan"), " when you are building a full-stack application -- with web pages, a database, authentication -- that should also be natively accessible to AI agents via MCP, A2A, and OpenAPI, all generated from a single ",
        createElement("code", null, "defineAPI()"), " call."
      ),
      createElement("p", null,
        createElement("strong", null, "Choose Next.js"), " when you are building a primarily human-facing web application and need the mature React ecosystem and Vercel integration."
      ),
      createElement("p", null,
        createElement("strong", null, "Choose Mastra"), " when you are building AI agents that orchestrate LLM calls and workflows -- your agent is the primary actor, not a consumer of your app."
      ),
      createElement("p", null,
        createElement("strong", null, "Choose LangGraph"), " when you are building complex, stateful multi-agent systems with graph-based workflow logic and persistent state checkpointing."
      )
    )
  );
}
