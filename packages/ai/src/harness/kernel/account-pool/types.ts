export type EngineName = string;

// ─── KernelSession (inline from session/types) ───

export interface KernelSession {
  close(): Promise<void>;
  [key: string]: any;
}

// ─── 账号配置 ───

export interface AccountConfig {
  id: string;
  name: string;
  engine: EngineName;
  proxy?: string;
  priority: number;
  disabled?: boolean;
  platform?: string;
  phone?: string;
  tags?: string[];
}

// ─── 健康状态 ───

export type AccountStatus = 'online' | 'cooldown' | 'banned' | 'offline';

export interface AccountHealth {
  status: AccountStatus;
  captchaCount: number;
  errorCount: number;
  cooldownUntil: number;
  totalRequests: number;
  totalErrors: number;
  lastRequestAt: number;
}

// ─── 调度约束 ───

export interface AcquireOptions {
  /** 按 tag 过滤候选账号 */
  tag?: string;
  /** 强制指定账号 ID */
  accountId?: string;
  /** 外部中断信号，用于在无限等待账号时提前退出 */
  signal?: AbortSignal;
}

// ─── 释放反馈 ───

export interface ReleaseOptions {
  success?: boolean;
  captcha?: boolean;
  error?: boolean;
  sessionExpired?: boolean;
  errorMessage?: string;
}

// ─── 账号选择 ───

export interface ScoredAccount {
  config: AccountConfig;
  health: AccountHealth;
  score: number;
}

export interface SelectionResult {
  account: AccountConfig | null;
  earliestAvailableAt?: number;
}

// ─── 浏览器生命周期 ───

export interface BrowserSlot {
  accountId: string;
  lastUsedAt: number;
  inUse: boolean;
}

// ─── 池化 Session ───

export interface PooledSession {
  session: KernelSession;
  accountId: string;
  release: (options?: ReleaseOptions) => Promise<void>;
}

// ─── 池状态 ───

export interface AccountPoolStatus {
  accounts: Array<{
    id: string;
    name: string;
    status: AccountStatus;
    health: AccountHealth;
    browserActive: boolean;
    pageCount: number;
    resting: boolean;
    restUntil: number;
  }>;
  totalAccounts: number;
  availableAccounts: number;
  activeBrowsers: number;
}
