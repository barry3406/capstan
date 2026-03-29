export interface DevServerConfig {
  /** Root directory of the Capstan app (contains app/ directory) */
  rootDir: string;
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** App name for manifests */
  appName?: string;
  /** App description */
  appDescription?: string;
  /** Auth configuration — when set, session cookie / API key auth is enabled */
  auth?: {
    session: {
      secret: string;
      maxAge?: string;
    };
    apiKeys?: {
      prefix?: string;
      headerName?: string;
    };
  };
}

export interface DevServerInstance {
  /** Start the dev server */
  start(): Promise<void>;
  /** Stop the dev server */
  stop(): Promise<void>;
  /** Current port */
  port: number;
  /** Current host */
  host: string;
}
