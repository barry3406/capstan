import { createElement } from "react";
import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return createElement("html", { lang: "en" },
    createElement("head", null,
      createElement("meta", { charSet: "utf-8" }),
      createElement("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      createElement("title", null, "Capstan \u2014 The AI Agent Native Full-Stack Framework"),
      createElement("meta", { name: "description", content: "Capstan is a Bun-native full-stack TypeScript framework where every API is automatically accessible to both humans and AI agents via HTTP, MCP, A2A, and OpenAPI." }),
      createElement("meta", { name: "keywords", content: "capstan, typescript, framework, ai agent, mcp, a2a, openapi, bun, full-stack" }),
      createElement("meta", { property: "og:title", content: "Capstan \u2014 The AI Agent Native Full-Stack Framework" }),
      createElement("meta", { property: "og:description", content: "Capstan is a Bun-native full-stack TypeScript framework where every API is automatically accessible to both humans and AI agents via HTTP, MCP, A2A, and OpenAPI." }),
      createElement("meta", { property: "og:type", content: "website" }),
      createElement("link", { rel: "stylesheet", href: "/styles.css" }),
      createElement("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }),
      createElement("link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" }),
      createElement("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap", media: "print", onLoad: "this.media='all'" }),
      createElement("noscript", null,
        createElement("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" })
      )
    ),
    createElement("body", null,
      createElement(Outlet, null)
    )
  );
}
