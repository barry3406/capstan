import type { KernelSession } from '../session/types.js';

export interface SimpleLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

export interface GuardContext {
  url: string;
  session: KernelSession;
  platform: string;
  logger: SimpleLogger;
}

export type GuardFn = (ctx: GuardContext) => Promise<void>;
