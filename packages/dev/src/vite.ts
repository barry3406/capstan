// Vite-based build pipeline for Capstan client-side code.
// Vite is an optional peer dependency — all functions gracefully degrade
// when it is not installed.

import type { InlineConfig } from "vite";

export interface CapstanViteConfig {
  rootDir: string;
  isDev: boolean;
  /** Client entry point (default: app/client.tsx or auto-generated) */
  clientEntry?: string;
}

/**
 * Create Vite config for Capstan client-side bundling.
 * Handles: React Fast Refresh, code splitting, tree shaking, CSS modules.
 */
export function createViteConfig(config: CapstanViteConfig): InlineConfig {
  return {
    root: config.rootDir,
    mode: config.isDev ? "development" : "production",
    build: {
      outDir: "dist/client",
      manifest: true,
      rollupOptions: {
        input: config.clientEntry ?? "app/client.tsx",
      },
      sourcemap: config.isDev,
      minify: !config.isDev,
    },
    plugins: [
      // React plugin will be dynamically loaded
    ],
    server: {
      middlewareMode: true,
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  };
}

/**
 * Create a Vite dev middleware for HMR.
 * Returns a connect-compatible middleware, or null if Vite is not installed.
 */
export async function createViteDevMiddleware(config: CapstanViteConfig): Promise<{
  middleware: unknown;
  close: () => Promise<void>;
} | null> {
  try {
    const vite = await import("vite");
    const viteConfig = createViteConfig(config);
    const server = await vite.createServer({
      ...viteConfig,
      server: { middlewareMode: true },
    });
    return {
      middleware: server.middlewares,
      close: () => server.close(),
    };
  } catch {
    // Vite not installed — return null (optional integration)
    return null;
  }
}

/**
 * Run Vite production build.
 */
export async function buildClient(config: CapstanViteConfig): Promise<void> {
  try {
    const vite = await import("vite");
    const viteConfig = createViteConfig(config);
    await vite.build(viteConfig);
  } catch (err) {
    if ((err as Error).message?.includes("Cannot find module")) {
      // Vite not installed — skip client build
      return;
    }
    throw err;
  }
}
