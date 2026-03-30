import type { EventDefinition } from "./events.js";
import { onEvent } from "./events.js";

export interface WorkerDefinition<T = unknown> {
  event: EventDefinition<T>;
  handler: (payload: T) => Promise<void>;
}

export function defineWorker<T>(event: EventDefinition<T>, handler: (payload: T) => Promise<void>): WorkerDefinition<T> {
  // Auto-subscribe
  onEvent(event, handler);
  return { event, handler };
}
