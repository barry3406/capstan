import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function ArchitecturePage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Architecture"),

    createElement("p", null,
      "Capstan's architecture is organized around five kernels and a shared source of truth. ",
      "This page describes the conceptual model, the current package boundaries, and the golden loop that ties them together."
    ),

    // TypeScript-First Design
    createElement("h2", null, "TypeScript-First Design"),
    createElement("p", null,
      "Capstan's implementation is TypeScript-first. This is an execution choice, not long-term dogma. ",
      "The goal is to maximize agent legibility, shared tooling, and iteration speed while the application contract is still converging."
    ),
    createElement("ul", null,
      createElement("li", null, "Coding agents are highly effective in TypeScript-first repositories"),
      createElement("li", null, "One language keeps runtime, scaffolding, verification, and docs close"),
      createElement("li", null, "The current web and tooling stack is fastest to evolve in TypeScript"),
      createElement("li", null, "Early package boundaries stay easier to change while the kernel model settles")
    ),

    // Source of Truth
    createElement("h2", null, "Source of Truth"),
    createElement("p", null, "Capstan's working application vocabulary is:"),
    createElement("pre", null,
      createElement("code", null, "Domain + Resource + Capability + Task + Policy + Artifact + View")
    ),
    createElement("p", null, "Each element has a distinct role:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Element"),
          createElement("th", null, "Role")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Domain")),
          createElement("td", null, "The bounded business space and its language")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Resource")),
          createElement("td", null, "Stable entities and their relations")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Capability")),
          createElement("td", null, "Executable business actions with semantics")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Task")),
          createElement("td", null, "Long-running or stateful executions")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Policy")),
          createElement("td", null, "Rules for access, approval, redaction, and budget")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Artifact")),
          createElement("td", null, "Durable outputs produced by the system")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "View")),
          createElement("td", null, "Human-facing projections of the graph")
        )
      )
    ),
    createElement("p", null,
      "Today this vocabulary is materialized through framework definitions, generated contracts, manifests, and scaffolded application output."
    ),

    // Five-Kernel Architecture
    createElement("h2", null, "Five-Kernel Architecture"),

    // Kernel 1: Graph
    createElement("h3", null, "Kernel 1: Graph"),
    createElement("p", null, "The Graph kernel defines and materializes the shared application contract."),
    createElement("ul", null,
      createElement("li", null, "Application schema"),
      createElement("li", null, "Resource and capability registry"),
      createElement("li", null, "Dependency graph"),
      createElement("li", null, "Machine-readable project index"),
      createElement("li", null, "Projection inputs for human and machine surfaces")
    ),

    // Kernel 2: Harness
    createElement("h3", null, "Kernel 2: Harness"),
    createElement("p", null, "The Harness kernel runs agent work against the application."),
    createElement("ul", null,
      createElement("li", null, "Task lifecycle"),
      createElement("li", null, "Tool execution"),
      createElement("li", null, "Shell, browser, and runtime coordination"),
      createElement("li", null, "Memory and compaction"),
      createElement("li", null, "Approvals and interventions"),
      createElement("li", null, "Event streaming")
    ),

    // Kernel 3: Surface
    createElement("h3", null, "Kernel 3: Surface"),
    createElement("p", null, "The Surface kernel exposes the application to humans and other agents through shared runtime contracts."),
    createElement("ul", null,
      createElement("li", null, "Machine-facing execution and discovery surfaces (HTTP, MCP, A2A, OpenAPI)"),
      createElement("li", null, "Generated agent-operating contracts (AGENTS.md, starter prompts)"),
      createElement("li", null, "Operator-facing projections for inspection, approval, input handoff, retry, and supervision"),
      createElement("li", null, "Search and execution entry points over the same underlying runtime state")
    ),

    // Kernel 4: Feedback
    createElement("h3", null, "Kernel 4: Feedback"),
    createElement("p", null, "The Feedback kernel closes the repair loop."),
    createElement("ul", null,
      createElement("li", null, "Type and schema validation"),
      createElement("li", null, "Tests and assertions"),
      createElement("li", null, "Runtime diagnostics"),
      createElement("li", null, "Evals and regression checks"),
      createElement("li", null, "Structured error reporting")
    ),

    // Kernel 5: Release
    createElement("h3", null, "Kernel 5: Release"),
    createElement("p", null, "The Release kernel turns application state into operable software."),
    createElement("ul", null,
      createElement("li", null, "Environment schema"),
      createElement("li", null, "Secret requirements"),
      createElement("li", null, "Migrations"),
      createElement("li", null, "Preview environments"),
      createElement("li", null, "Health checks"),
      createElement("li", null, "Rollout and rollback")
    ),

    // Golden Loop
    createElement("h2", null, "Golden Loop"),
    createElement("p", null, "The five kernels are connected by a golden loop that Capstan makes native:"),
    createElement("ol", null,
      createElement("li", null, createElement("strong", null, "Read"), " the contract (Graph)"),
      createElement("li", null, createElement("strong", null, "Plan"), " a change"),
      createElement("li", null, createElement("strong", null, "Execute"), " through the harness (Harness)"),
      createElement("li", null, createElement("strong", null, "Verify"), " through feedback (Feedback)"),
      createElement("li", null, createElement("strong", null, "Release"), " through structured workflows (Release)"),
      createElement("li", null, createElement("strong", null, "Expose"), " updated surfaces to humans and agents (Surface)")
    ),
    createElement("p", null,
      "This loop applies to both human developers and AI agents operating on the application. ",
      "The contract is the shared coordination point."
    ),

    // Package Boundaries
    createElement("h2", null, "Package Boundaries"),
    createElement("p", null,
      "The five kernels do not map one-to-one to package names. The current packages are organized by layer:"
    ),

    createElement("h3", null, "Contract Layer"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Package"),
          createElement("th", null, "Responsibilities")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-core")),
          createElement("td", null, "Capabilities, policies, routes, and runtime contracts")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-router")),
          createElement("td", null, "File-based routing and manifest generation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-db")),
          createElement("td", null, "Model definitions, migrations, and CRUD generation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-auth")),
          createElement("td", null, "Authentication, API keys, OAuth, and permissions")
        )
      )
    ),

    createElement("h3", null, "Harness Layer"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Package"),
          createElement("th", null, "Responsibilities")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-ai")),
          createElement("td", null, "Agent work, durable/recurring execution")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-cron")),
          createElement("td", null, "Scheduled tasks and background jobs")
        )
      )
    ),

    createElement("h3", null, "Surface Layer"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Package"),
          createElement("th", null, "Responsibilities")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-agent")),
          createElement("td", null, "Machine surfaces (MCP, A2A, OpenAPI, agent manifest)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-react")),
          createElement("td", null, "Human application shell (React SSR, client router)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-dev")),
          createElement("td", null, "Local development server, runtime inspection")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "@zauso-ai/capstan-cli")),
          createElement("td", null, "Operational commands and scaffolding")
        )
      )
    ),

    createElement("h3", null, "Feedback and Release"),
    createElement("p", null,
      "Feedback and release responsibilities are currently distributed across ",
      createElement("code", null, "@zauso-ai/capstan-core"), ", ",
      createElement("code", null, "@zauso-ai/capstan-cli"),
      ", and generated app assertions. These packages handle verification, structured diagnostics, build output, and deployment contracts."
    ),

    createElement("h3", null, "Scaffolding"),
    createElement("p", null,
      createElement("code", null, "create-capstan-app"),
      " establishes the default project structure, generates agent-readable guides and starter workflows, and keeps new applications aligned with the framework's current contract."
    ),

    // Long-Term Boundary
    createElement("h2", null, "Long-Term Boundary"),
    createElement("p", null, "Capstan distinguishes between two future layers:"),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "Framework layer"),
        ": contract definition, projections, verification, release contracts, and developer tooling. Stays TypeScript-friendly."
      ),
      createElement("li", null,
        createElement("strong", null, "Host layer"),
        ": durable execution, process control, sandboxing, and system integrations. May move to a lower-level runtime (e.g. Rust) if needed for stability or portability."
      )
    ),

    createElement("div", { className: "callout callout-info" },
      createElement("strong", null, "Working rule: "),
      "When a new package or boundary is proposed, it must answer: Does it tighten the shared application contract? ",
      "Does it reduce entropy in execution, verification, recovery, or supervision? ",
      "Could it remain a module inside an existing package? ",
      "Can a coding agent discover and operate it with minimal ambiguity? ",
      "Package proliferation is not a strategy -- clearer contracts are."
    )
  );
}
