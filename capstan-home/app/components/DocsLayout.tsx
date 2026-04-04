import { createElement } from "react";
import { t, locales, localeNames } from "../i18n/index.js";
import type { Locale } from "../i18n/index.js";

export default function DocsLayout({ children, request }: { children: React.ReactNode; request?: Request }) {
  let locale: Locale = "en";
  if (request) {
    try {
      const url = new URL(request.url);
      const param = url.searchParams.get("lang");
      if (param && locales.includes(param as Locale)) locale = param as Locale;
    } catch {
      // ignore
    }
  }

  const l = t[locale]!;

  return createElement("div", null,

    // Navbar
    createElement("header", { className: "navbar" },
      createElement("a", { href: `/?lang=${locale}`, className: "navbar-brand" },
        createElement("span", { className: "navbar-logo" }, "\u2693"),
        createElement("span", { className: "navbar-title" }, "Capstan"),
        createElement("span", { className: "navbar-badge" }, "beta")
      ),
      createElement("nav", { className: "navbar-links" },
        createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["sidebar.guide"]),
        createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["sidebar.apiRef"]),
        createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"])
      ),
      createElement("div", { className: "lang-switcher" },
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

    // Sidebar
    createElement("aside", { className: "sidebar" },
      createElement("div", { className: "sidebar-section" },
        createElement("div", { className: "sidebar-section-title" }, l["sidebar.overview"]),
        createElement("a", { href: `/?lang=${locale}` }, l["sidebar.introduction"])
      ),
      createElement("div", { className: "sidebar-section" },
        createElement("div", { className: "sidebar-section-title" }, l["sidebar.guide"]),
        createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["sidebar.gettingStarted"]),
        createElement("a", { href: `/docs/core-concepts?lang=${locale}` }, l["sidebar.coreConcepts"]),
        createElement("a", { href: `/docs/database?lang=${locale}` }, l["sidebar.database"]),
        createElement("a", { href: `/docs/authentication?lang=${locale}` }, l["sidebar.auth"]),
        createElement("a", { href: `/docs/deployment?lang=${locale}` }, l["sidebar.deployment"])
      ),
      createElement("div", { className: "sidebar-section" },
        createElement("div", { className: "sidebar-section-title" }, l["sidebar.reference"]),
        createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["sidebar.apiRef"]),
        createElement("a", { href: `/docs/architecture?lang=${locale}` }, "Architecture"),
        createElement("a", { href: `/docs/testing?lang=${locale}` }, l["sidebar.testing"]),
        createElement("a", { href: `/docs/comparison?lang=${locale}` }, l["sidebar.comparison"])
      ),
      createElement("div", { className: "sidebar-section" },
        createElement("div", { className: "sidebar-section-title" }, l["sidebar.resources"]),
        createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"]),
        createElement("a", { href: "/.well-known/capstan.json", target: "_blank" }, l["sidebar.agentManifest"]),
        createElement("a", { href: "/openapi.json", target: "_blank" }, "OpenAPI")
      )
    ),

    // Sidebar overlay for mobile
    createElement("div", { className: "sidebar-overlay" }),

    // Mobile menu script
    createElement("script", { dangerouslySetInnerHTML: { __html: `
      (function(){
        var btn = document.querySelector('.mobile-menu-btn');
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.querySelector('.sidebar-overlay');
        if (!btn || !sidebar || !overlay) return;
        function toggle() {
          var open = sidebar.classList.toggle('open');
          overlay.classList.toggle('active', open);
          document.body.style.overflow = open ? 'hidden' : '';
        }
        function close() {
          sidebar.classList.remove('open');
          overlay.classList.remove('active');
          document.body.style.overflow = '';
        }
        btn.addEventListener('click', toggle);
        overlay.addEventListener('click', close);
        sidebar.addEventListener('click', function(e) {
          if (e.target.tagName === 'A') close();
        });
      })();
    ` } }),

    // Main content
    createElement("div", { className: "main-wrapper" },
      createElement("main", { className: "main-content" },
        children
      ),

      createElement("footer", { className: "footer" },
        createElement("span", null, "MIT License"),
        createElement("span", null, " \u00b7 Built with Capstan")
      )
    )
  );
}
