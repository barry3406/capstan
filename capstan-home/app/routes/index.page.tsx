import { createElement } from "react";
import { useLoaderData } from "@zauso-ai/capstan-react";
import { t, locales, localeNames } from "../i18n/index.js";
import type { Locale } from "../i18n/index.js";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const param = url.searchParams.get("lang");
  const locale = (param && locales.includes(param as Locale)) ? param : "en";
  return { locale };
}

export default function HomePage() {
  const { locale: rawLocale } = useLoaderData<typeof loader>();
  const locale = (rawLocale as Locale) || "en";
  const l = t[locale]!;

  return createElement("div", null,

    // 1. Navbar
    createElement("header", { className: "navbar" },
      createElement("a", { href: `/?lang=${locale}`, className: "navbar-brand" },
        createElement("img", { src: "/logo-icon.jpeg", alt: "Capstan", className: "navbar-logo-img" }),
        createElement("span", { className: "navbar-title" }, "Capstan"),
        createElement("span", { className: "navbar-badge" }, "beta")
      ),
      createElement("nav", { className: "navbar-links" },
        createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["nav.docs"]),
        createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["nav.api"]),
        createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"])
      ),
      createElement("div", { className: "lang-switcher desktop-only" },
        ...locales.map(loc => createElement("a", {
          key: loc,
          href: `?lang=${loc}`,
          className: locale === loc ? "active" : "",
        }, localeNames[loc]))
      ),
      createElement("button", { className: "mobile-menu-btn", "aria-label": "Toggle menu" },
        createElement("span", null),
        createElement("span", null),
        createElement("span", null)
      )
    ),

    // Mobile nav dropdown
    createElement("nav", { className: "mobile-nav" },
      createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["nav.docs"]),
      createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["nav.api"]),
      createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"]),
      createElement("div", { className: "lang-switcher mobile-nav-langs" },
        ...locales.map(loc => createElement("a", {
          key: loc,
          href: `?lang=${loc}`,
          className: locale === loc ? "active" : "",
        }, localeNames[loc]))
      )
    ),

    // Mobile nav script
    createElement("script", { dangerouslySetInnerHTML: { __html: `
      (function(){
        var btn = document.querySelector('.mobile-menu-btn');
        var nav = document.querySelector('.mobile-nav');
        if (!btn || !nav) return;
        btn.addEventListener('click', function() {
          nav.classList.toggle('open');
        });
        nav.addEventListener('click', function(e) {
          if (e.target.tagName === 'A') nav.classList.remove('open');
        });
      })();
    ` } }),

    // Page content
    createElement("div", { className: "page" },

      // 2. Hero
      createElement("div", { className: "hero" },
        createElement("img", { src: "/logo-banner-1200.jpeg", alt: "Capstan", className: "hero-banner" }),
        createElement("h1", { className: "hero-title" },
          createElement("code", null, "defineAPI()"), " ", l["hero.title.once"],
          createElement("br", null),
          l["hero.title.protocols"], " ",
          createElement("code", null, "think()"), " ", l["hero.title.and"], " ",
          createElement("code", null, "remember()"), " ", l["hero.title.builtin"]
        ),
        createElement("p", { className: "hero-tagline" },
          l["hero.subtitle"]
        ),
        createElement("div", { className: "hero-actions" },
          createElement("div", { className: "terminal" },
            createElement("span", { className: "prompt" }, "$ "),
            "bunx create-capstan-app my-app"
          ),
          createElement("div", { className: "hero-buttons" },
            createElement("a", { href: `/docs/getting-started?lang=${locale}`, className: "btn btn-primary" }, l["btn.getStarted"]),
            createElement("a", { href: "https://github.com/barry3406/capstan", className: "btn btn-secondary", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"])
          )
        )
      ),

      // 3. Callout
      createElement("div", { className: "callout callout-info" },
        createElement("p", null,
          l["callout"], " ",
          createElement("strong", null, l["callout.http"]), ", ",
          createElement("strong", null, l["callout.mcp"]), ", ",
          createElement("strong", null, l["callout.a2a"]), ", ",
          createElement("strong", null, l["callout.openapi"]), "."
        )
      ),

      // 4. Code example
      createElement("span", { className: "code-label" }, "app/routes/tickets/index.api.ts"),
      createElement("pre", null,
        createElement("code", null,
          'import { defineAPI } from "@zauso-ai/capstan-core";\n' +
          'import { z } from "zod";\n' +
          "\n" +
          "export const GET = defineAPI({\n" +
          "  input: z.object({\n" +
          '    status: z.enum(["open", "closed"]).optional(),\n' +
          "  }),\n" +
          "  output: z.object({\n" +
          "    tickets: z.array(z.object({\n" +
          "      id: z.string(),\n" +
          "      title: z.string(),\n" +
          "      status: z.string(),\n" +
          "    })),\n" +
          "  }),\n" +
          '  description: "List support tickets",\n' +
          '  capability: "read",\n' +
          '  resource: "ticket",\n' +
          "  async handler({ input }) {\n" +
          "    return { tickets: await db.tickets.list(input) };\n" +
          "  },\n" +
          "});"
        )
      ),

      // 5. Feature grid
      createElement("h2", null, l["section.whyCapstan"]),
      createElement("div", { className: "feature-grid" },
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.multiProtocol.title"]),
          createElement("p", null, l["feature.multiProtocol.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.aiToolkit.title"]),
          createElement("p", null, l["feature.aiToolkit.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.memory.title"]),
          createElement("p", null, l["feature.memory.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.ssr.title"]),
          createElement("p", null, l["feature.ssr.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.security.title"]),
          createElement("p", null, l["feature.security.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.database.title"]),
          createElement("p", null, l["feature.database.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.cache.title"]),
          createElement("p", null, l["feature.cache.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.compliance.title"]),
          createElement("p", null, l["feature.compliance.desc"])
        )
      ),

      // 6. Comparison table
      createElement("h2", null, l["section.comparison"]),
      createElement("table", null,
        createElement("thead", null,
          createElement("tr", null,
            createElement("th", null, l["compare.feature"]),
            createElement("th", null, "Capstan"),
            createElement("th", null, "Next.js"),
            createElement("th", null, "FastAPI")
          )
        ),
        createElement("tbody", null,
          createElement("tr", null,
            createElement("td", null, "Multi-protocol (HTTP + MCP + A2A)"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "OpenAPI auto-generation"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "File-based routing"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "React SSR"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "Built-in auth (JWT + API keys)"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "partial" }, "~")
          ),
          createElement("tr", null,
            createElement("td", null, "Policy engine + approval workflow"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "AI TDD verifier"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "Built-in database layer"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "AI Agent Toolkit"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "Long-term Memory"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013")
          ),
          createElement("tr", null,
            createElement("td", null, "LLM Integration"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "partial" }, "~"),
            createElement("td", { className: "partial" }, "~")
          ),
          createElement("tr", null,
            createElement("td", null, "Cache / ISR"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013")
          )
        )
      ),
      createElement("p", { className: "table-legend" },
        createElement("span", { className: "check" }, "+"),
        ` ${l["compare.legend.builtin"]}  `,
        createElement("span", { className: "partial" }, "~"),
        ` ${l["compare.legend.partial"]}  `,
        createElement("span", { className: "cross" }, "\u2013"),
        ` ${l["compare.legend.none"]}  |  `,
        createElement("a", { href: `/docs/comparison?lang=${locale}` }, l["compare.fullLink"])
      ),

      // 7. Quick Start
      createElement("h2", null, l["section.quickStart"]),
      createElement("ol", { className: "steps" },
        createElement("li", null,
          createElement("strong", null, l["step.create"]),
          createElement("pre", null,
            createElement("code", null, "bunx create-capstan-app my-app")
          )
        ),
        createElement("li", null,
          createElement("strong", null, l["step.develop"]),
          createElement("pre", null,
            createElement("code", null, "cd my-app && bunx capstan dev")
          )
        ),
        createElement("li", null,
          createElement("strong", null, l["step.connect"]),
          createElement("p", null, l["step.connect.desc"]),
          createElement("pre", null,
            createElement("code", null,
              "# Agent manifest\n" +
              "curl http://localhost:3000/.well-known/capstan.json\n" +
              "\n" +
              "# OpenAPI spec\n" +
              "curl http://localhost:3000/openapi.json\n" +
              "\n" +
              "# MCP server (for Claude Desktop / Cursor)\n" +
              "bunx capstan mcp"
            )
          )
        )
      ),

      // 8. Standalone AI Toolkit
      createElement("h2", null, l["section.aiToolkit"]),
      createElement("p", null,
        createElement("code", null, "@zauso-ai/capstan-ai"),
        " ",
        l["standalone.desc"]
      ),
      createElement("pre", null,
        createElement("code", null,
          'import { createAI } from "@zauso-ai/capstan-ai";\n' +
          "\n" +
          'const ai = createAI({ llm: openaiProvider({ apiKey: "..." }) });\n' +
          'await ai.think("Analyze this data");\n' +
          'await ai.remember("User prefers dark mode");\n' +
          'const context = await ai.memory.about("customer", "c-42").recall("preferences");'
        )
      ),

      // 9. Explore the Docs
      createElement("h2", null, l["section.explore"]),
      createElement("div", { className: "explore-grid" },
        createElement("a", { href: `/docs/getting-started?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.gettingStarted.title"]),
          createElement("p", null, l["explore.gettingStarted.desc"])
        ),
        createElement("a", { href: `/docs/core-concepts?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.coreConcepts.title"]),
          createElement("p", null, l["explore.coreConcepts.desc"])
        ),
        createElement("a", { href: `/docs/database?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.database.title"]),
          createElement("p", null, l["explore.database.desc"])
        ),
        createElement("a", { href: `/docs/api-reference?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.apiRef.title"]),
          createElement("p", null, l["explore.apiRef.desc"])
        )
      ),

      // 10. Footer
      createElement("footer", { className: "footer" },
        l["footer"]
      )
    )
  );
}
