type BrowserContext = any;

export interface BrowserEngineOptions {
  headless?: boolean;
  proxy?: string | { server: string; username?: string; password?: string };
  userDataDir?: string;
  viewport?: { width: number; height: number };
  humanize?: number | boolean;
  /** 使用 mobile viewport（从指纹的 mobile 字段取值） */
  mobile?: boolean;
}

export interface BrowserEngine {
  readonly name: string;
  launch(options: BrowserEngineOptions): Promise<BrowserContext>;
  close(): Promise<void>;
  /** 检查 userDataDir 中是否存在有效的会话数据 */
  hasSession(userDataDir: string): boolean;
}
