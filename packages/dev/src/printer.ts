/**
 * Print a nicely formatted startup banner to stdout showing key server
 * information: URLs, route counts, and the application name.
 */
export function printStartupBanner(config: {
  appName: string;
  port: number;
  host: string;
  routeCount: number;
  apiRouteCount: number;
  pageRouteCount: number;
}): void {
  const { appName, port, host, routeCount, apiRouteCount, pageRouteCount } =
    config;

  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const base = `http://${displayHost}:${port}`;

  const webUrl = base;
  const agentUrl = `${base}/api`;
  const manifestUrl = `${base}/.well-known/capstan.json`;
  const openApiUrl = `${base}/openapi.json`;

  // Build content lines, then measure the longest to size the box.
  const lines = [
    "Capstan Dev Server",
    "",
    `App:       ${appName}`,
    `Web UI:    ${webUrl}`,
    `Agent API: ${agentUrl}`,
    `Manifest:  ${manifestUrl}`,
    `OpenAPI:   ${openApiUrl}`,
    "",
    `Routes:    ${routeCount} (${apiRouteCount} API, ${pageRouteCount} pages)`,
  ];

  const maxLen = Math.max(...lines.map((l) => l.length));
  // Pad each line to the maximum width so the right border aligns.
  const padded = lines.map((l) => l.padEnd(maxLen));

  const horizontal = "\u2500".repeat(maxLen + 2); // ─
  const top = `  \u250C${horizontal}\u2510`; // ┌─...─┐
  const bottom = `  \u2514${horizontal}\u2518`; // └─...─┘

  const body = padded
    .map((l) => `  \u2502 ${l} \u2502`) // │ content │
    .join("\n");

  const banner = `\n${top}\n${body}\n${bottom}\n`;

  // eslint-disable-next-line no-console
  console.log(banner);
}
