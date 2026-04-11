import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";
import { scaffoldProject } from "../../packages/create-capstan/src/scaffold.ts";

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");

export interface BrowserFixtureApp {
  baseUrl: string;
  projectDir: string;
  cleanup(): Promise<void>;
}

export async function createBrowserFixtureApp(): Promise<BrowserFixtureApp> {
  const tempDir = await mkdtemp(join(tmpdir(), "capstan-browser-e2e-"));
  const projectDir = join(tempDir, "browser-e2e-app");
  const port = 38000 + Math.floor(Math.random() * 10000);
  let server: DevServerInstance | undefined;

  async function cleanup(): Promise<void> {
    if (server) {
      await server.stop();
    }
    await rm(tempDir, { recursive: true, force: true });
  }

  try {
    await scaffoldProject({
      projectName: "browser-e2e-app",
      template: "blank",
      outputDir: projectDir,
    });

    await writeFile(
      join(projectDir, "app/routes/_layout.tsx"),
      `import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Capstan Browser E2E</title>
        <link rel="stylesheet" href="/styles.css" precedence="default" />
      </head>
      <body>
        <div className="browser-shell">
          <header className="hero">
            <p className="eyebrow">Capstan</p>
            <h1>Browser SSR Flow</h1>
            <p className="lede">
              Real SSR pages, hydrated client state, and SPA navigation running against a generated fixture.
            </p>
          </header>
          <Outlet />
        </div>
      </body>
    </html>
  );
}
`,
      "utf-8",
    );

    await writeFile(
      join(projectDir, "app/routes/index.page.tsx"),
      `export const metadata = {
  title: "Capstan Browser E2E",
  description: "SSR entry page for browser integration coverage",
};

export default function HomePage() {
  return (
    <main className="panel" data-testid="home-panel">
      <p className="section-label">Home</p>
      <h2 data-testid="title">Capstan Browser E2E</h2>
      <p className="copy">
        This page is server-rendered first, then hydrated so the browser can keep state and follow SPA navigations.
      </p>
      <div className="actions">
        <button data-testid="counter" id="counter" type="button">Clicks: 0</button>
        <button data-testid="load-health" id="load-health" type="button">Load health</button>
      </div>
      <div className="links">
        <a data-testid="about-link" href="/about">Open about</a>
        <a data-testid="manifest-link" data-capstan-external href="/.well-known/capstan.json">Agent manifest</a>
        <a data-testid="openapi-link" data-capstan-external href="/openapi.json">OpenAPI spec</a>
      </div>
      <p className="status" data-testid="health">idle</p>
      <script
        dangerouslySetInnerHTML={{
          __html: [
            "(() => {",
            "  const counter = document.getElementById('counter');",
            "  const loadHealth = document.getElementById('load-health');",
            "  const health = document.querySelector(\\\"[data-testid='health']\\\");",
            "  let clicks = 0;",
            "  counter?.addEventListener('click', () => {",
            "    clicks += 1;",
            "    counter.textContent = 'Clicks: ' + clicks;",
            "  });",
            "  loadHealth?.addEventListener('click', async () => {",
            "    loadHealth.setAttribute('disabled', 'true');",
            "    loadHealth.textContent = 'Loading...';",
            "    try {",
            "      const response = await fetch('/api/health');",
            "      const data = await response.json();",
            "      if (health) health.textContent = data.status ?? 'unknown';",
            "    } finally {",
            "      loadHealth.removeAttribute('disabled');",
            "      loadHealth.textContent = 'Load health';",
            "    }",
            "  });",
            "})();",
          ].join("\\n"),
        }}
      />
    </main>
  );
}
`,
      "utf-8",
    );

    await writeFile(
      join(projectDir, "app/routes/about.page.tsx"),
      `export const metadata = {
  title: "Capstan Browser E2E About",
  description: "Client navigation target for browser integration coverage",
};

export default function AboutPage() {
  return (
    <main className="panel about-panel" data-testid="about-panel">
      <p className="section-label">About</p>
      <h2 data-testid="about-title">Client navigation kept the page alive</h2>
      <p className="copy">
        The router fetched a navigation payload, updated the DOM, and preserved window state instead of doing a full reload.
      </p>
      <div className="links">
        <a data-testid="home-link" href="/">Back home</a>
      </div>
    </main>
  );
}
`,
      "utf-8",
    );

    await mkdir(join(projectDir, "app/styles"), { recursive: true });
    await writeFile(
      join(projectDir, "app/styles/main.css"),
      `:root {
  color-scheme: dark;
  --page-bg: #09111f;
  --page-accent: #f97316;
  --page-accent-soft: rgba(249, 115, 22, 0.16);
  --panel-bg: rgba(8, 15, 29, 0.78);
  --panel-border: rgba(148, 163, 184, 0.22);
  --text-main: #e5eefc;
  --text-muted: #9db0cb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
  background:
    radial-gradient(circle at top, rgba(249, 115, 22, 0.2), transparent 34%),
    linear-gradient(160deg, #08101c 0%, #0f1b31 48%, #172033 100%);
  color: var(--text-main);
}

.browser-shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 20px 72px;
}

.hero {
  margin-bottom: 24px;
}

.hero h1 {
  margin: 0 0 10px;
  font-size: clamp(2.6rem, 5vw, 4rem);
  line-height: 0.92;
}

.eyebrow,
.section-label {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  font-size: 0.76rem;
  color: var(--page-accent);
}

.lede,
.copy {
  margin: 0;
  max-width: 62ch;
  color: var(--text-muted);
  line-height: 1.6;
}

.panel {
  margin-top: 28px;
  padding: 28px;
  border: 1px solid var(--panel-border);
  border-radius: 28px;
  background: var(--panel-bg);
  backdrop-filter: blur(18px);
  box-shadow: 0 30px 90px rgba(3, 7, 18, 0.38);
}

.panel h2 {
  margin: 0 0 14px;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1;
}

.actions,
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}

button,
a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: inherit;
  text-decoration: none;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
}

button {
  cursor: pointer;
  background: linear-gradient(135deg, #fb923c, #f97316);
  color: #2b1203;
}

a {
  color: var(--text-main);
  background: rgba(15, 23, 42, 0.8);
  border-color: var(--panel-border);
}

button:hover,
a:hover {
  transform: translateY(-1px);
}

.status {
  min-height: 1.5rem;
  margin-top: 18px;
  font-weight: 600;
  color: #ffd7b2;
}

.about-panel {
  border-color: rgba(251, 191, 36, 0.2);
  background:
    linear-gradient(180deg, rgba(249, 115, 22, 0.08), transparent 38%),
    rgba(8, 15, 29, 0.82);
}

@media (max-width: 640px) {
  .browser-shell {
    padding-top: 32px;
  }

  .panel {
    padding: 22px;
    border-radius: 22px;
  }

  .actions,
  .links {
    flex-direction: column;
  }

  button,
  a {
    width: 100%;
  }
}
`,
      "utf-8",
    );

    await symlink(rootNodeModules, join(projectDir, "node_modules"), "dir");

    server = await createDevServer({
      rootDir: projectDir,
      port,
      host: "127.0.0.1",
      appName: "browser-e2e-app",
      appDescription: "Browser end-to-end fixture app",
    });

    await server.start();
    return {
      baseUrl: `http://127.0.0.1:${server.port}`,
      projectDir,
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}
