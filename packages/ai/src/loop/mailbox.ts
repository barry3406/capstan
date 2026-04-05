import { randomUUID } from "node:crypto";

import type {
  AgentLoopControlDecision,
  AgentLoopMailbox,
  AgentLoopMailboxMessage,
  LLMMessage,
} from "../types.js";

interface NotificationWaiter {
  resolve(message: AgentLoopMailboxMessage | undefined): void;
  reject(error: Error): void;
  clearTimer(): void;
}

export class InMemoryAgentLoopMailbox implements AgentLoopMailbox {
  private readonly queues = new Map<string, AgentLoopMailboxMessage[]>();
  private readonly waiters = new Map<string, NotificationWaiter[]>();

  async publish(message: AgentLoopMailboxMessage): Promise<void> {
    const waiters = this.waiters.get(message.runId);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter.resolve(cloneMailboxMessage(message));
      return;
    }
    const queue = this.queues.get(message.runId) ?? [];
    queue.push(cloneMailboxMessage(message));
    this.queues.set(message.runId, queue);
  }

  async next(
    runId: string,
    options?: {
      timeoutMs?: number;
    },
  ): Promise<AgentLoopMailboxMessage | undefined> {
    const queue = this.queues.get(runId);
    if (queue && queue.length > 0) {
      return cloneMailboxMessage(queue.shift()!);
    }
    if (options?.timeoutMs === 0) {
      return undefined;
    }
    return new Promise<AgentLoopMailboxMessage | undefined>((resolve, reject) => {
      const waiters = this.waiters.get(runId) ?? [];
      this.waiters.set(runId, waiters);
      const waiter = createNotificationWaiter({
        resolve: (message) =>
          resolve(message ? cloneMailboxMessage(message) : undefined),
        reject,
        ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
        onTimeout: () => {
          this.removeWaiter(runId, waiter);
          resolve(undefined);
        },
      });
      waiters.push(waiter);
    });
  }

  async list(runId: string): Promise<AgentLoopMailboxMessage[]> {
    return (this.queues.get(runId) ?? []).map(cloneMailboxMessage);
  }

  private removeWaiter(runId: string, target: NotificationWaiter): void {
    const current = this.waiters.get(runId);
    if (!current) {
      return;
    }
    const next = current.filter((entry) => entry !== target);
    if (next.length === 0) {
      this.waiters.delete(runId);
      return;
    }
    this.waiters.set(runId, next);
  }
}

export function createMailboxMessageId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export async function drainMailboxContextMessages(
  mailbox: AgentLoopMailbox | undefined,
  runId: string | undefined,
  onMessage: ((message: AgentLoopMailboxMessage) => Promise<void>) | undefined,
  isCurrentControlSignal?: (
    message: Extract<AgentLoopMailboxMessage, { kind: "control_signal" }>,
  ) => Promise<boolean>,
): Promise<{
  messages: LLMMessage[];
  control?: AgentLoopControlDecision | undefined;
}> {
  if (!mailbox || !runId) {
    return { messages: [] };
  }

  const messages: LLMMessage[] = [];
  while (true) {
    const next = await mailbox.next(runId, { timeoutMs: 0 });
    if (!next) {
      break;
    }
    await onMessage?.(cloneMailboxMessage(next));

    if (next.kind === "control_signal") {
      if (isCurrentControlSignal && !(await isCurrentControlSignal(next))) {
        continue;
      }
      return {
        messages,
        control: {
          action: next.action,
          ...(next.requestedAt ? { requestedAt: next.requestedAt } : {}),
          ...(next.reason ? { reason: next.reason } : {}),
        },
      };
    }
    const contextMessage = mailboxMessageToContextMessage(next);
    if (contextMessage) {
      messages.push(contextMessage);
    }
  }

  return { messages };
}

export function cloneMailboxMessage(
  message: AgentLoopMailboxMessage,
): AgentLoopMailboxMessage {
  return structuredClone(message);
}

export function mailboxMessageToContextMessage(
  message: AgentLoopMailboxMessage,
): LLMMessage | undefined {
  switch (message.kind) {
    case "context_message":
      return { ...message.message };
    case "trigger":
      return {
        role: "user",
        content: [
          `Runtime trigger: ${message.trigger.type}`,
          `source=${message.trigger.source}`,
          message.trigger.metadata
            ? `metadata=${JSON.stringify(message.trigger.metadata)}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "system":
      return {
        role: "user",
        content: [
          `Runtime system event: ${message.event}`,
          message.detail ? JSON.stringify(message.detail) : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "tool_progress":
      return {
        role: "user",
        content: [
          `Tool progress for ${message.tool}: ${message.message}`,
          message.detail ? JSON.stringify(message.detail) : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "task_notification":
      return {
        role: "user",
        content:
          message.notification.status === "completed"
            ? `Background task "${message.notification.name}" completed:\n${JSON.stringify(message.notification.result, null, 2)}`
            : `Background task "${message.notification.name}" ${message.notification.status}:\n${message.notification.error ?? message.notification.status}`,
      };
    case "control_signal":
      return undefined;
    default:
      return undefined;
  }
}

function createNotificationWaiter(input: {
  resolve(message: AgentLoopMailboxMessage | undefined): void;
  reject(error: Error): void;
  timeoutMs?: number;
  onTimeout(): void;
}): NotificationWaiter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (input.timeoutMs != null && input.timeoutMs > 0) {
    timer = setTimeout(() => {
      timer = undefined;
      input.onTimeout();
    }, input.timeoutMs);
  }
  return {
    resolve(message) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      input.resolve(message);
    },
    reject(error) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      input.reject(error);
    },
    clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
