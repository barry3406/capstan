import type { ZodType } from "zod";

export interface EventDefinition<T = unknown> {
  name: string;
  schema?: ZodType<T>;
}

export function defineEvent<T>(name: string, schema?: ZodType<T>): EventDefinition<T> {
  const def: EventDefinition<T> = { name };
  if (schema !== undefined) def.schema = schema;
  return def;
}

type EventHandler<T> = (payload: T) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler<unknown>[]>();

  on<T>(event: EventDefinition<T>, handler: EventHandler<T>): () => void {
    const name = event.name;
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name)!.push(handler as EventHandler<unknown>);
    // Return unsubscribe function
    return () => {
      const list = this.handlers.get(name);
      if (list) {
        const idx = list.indexOf(handler as EventHandler<unknown>);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  async emit<T>(event: EventDefinition<T>, payload: T): Promise<void> {
    if (event.schema) event.schema.parse(payload);
    const list = this.handlers.get(event.name) ?? [];
    await Promise.all(list.map(h => h(payload)));
  }

  clear(): void { this.handlers.clear(); }
}

// Global event bus instance
let bus = new EventBus();
export function getEventBus(): EventBus { return bus; }
export function resetEventBus(): void { bus = new EventBus(); }

// Convenience
export function onEvent<T>(event: EventDefinition<T>, handler: EventHandler<T>) {
  return getEventBus().on(event, handler);
}
export function emitEvent<T>(event: EventDefinition<T>, payload: T) {
  return getEventBus().emit(event, payload);
}
