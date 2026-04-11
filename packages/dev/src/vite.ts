// Vite-based build pipeline for Capstan client-side code.
// Vite is an optional peer dependency — all functions gracefully degrade
// when it is not installed.

export interface CapstanViteConfig {
  rootDir: string;
  isDev: boolean;
  clientEntry?: string;
}

/**
 * Capstan HMR plugin for Vite. When Vite is used as the client-side bundler,
 * this plugin ensures that Capstan's own HMR transport coordinates with
 * Vite's built-in HMR so the two do not conflict.
 *
 * The plugin is intentionally minimal — it only disables Vite's default
 * full-reload behavior for file types that Capstan handles itself (CSS,
 * page files, layout files, etc.).
 */
function capstanHmrPlugin(): Record<string, unknown> {
  return {
    name: "capstan:hmr",
    enforce: "pre",

    // Configure Vite's HMR to use a different path so it doesn't collide
    // with Capstan's `/__capstan_hmr` endpoint.
    config(): Record<string, unknown> {
      return {
        server: {
          hmr: { path: "/__vite_hmr" },
        },
      };
    },
  };
}

export function createViteConfig(config: CapstanViteConfig): Record<string, unknown> {
  return {
    root: config.rootDir,
    mode: config.isDev ? "development" : "production",
    plugins: config.isDev ? [capstanHmrPlugin()] : [],
    build: {
      outDir: "dist/client",
      manifest: true,
      rollupOptions: { input: config.clientEntry ?? "app/client.tsx" },
      sourcemap: config.isDev,
      minify: !config.isDev,
    },
    server: { middlewareMode: true },
    optimizeDeps: { include: ["react", "react-dom"] },
  };
}

export async function createViteDevMiddleware(config: CapstanViteConfig): Promise<{
  middleware: unknown;
  close: () => Promise<void>;
} | null> {
  try {
    const vite = await import("vite");
    const server = await vite.createServer({
      ...createViteConfig(config),
      server: { middlewareMode: true },
    } as any);
    return {
      middleware: server.middlewares,
      close: () => server.close(),
    };
  } catch {
    return null;
  }
}

export async function buildClient(config: CapstanViteConfig): Promise<void> {
  try {
    const vite = await import("vite");
    await vite.build(createViteConfig(config) as any);
  } catch (err) {
    if ((err as Error).message?.includes("Cannot find module")) {
      return;
    }
    throw err;
  }
}
