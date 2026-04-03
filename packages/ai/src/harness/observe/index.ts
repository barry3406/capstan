/**
 * Harness observability layer — structured event logging, metrics, and traces.
 */

import type { HarnessEvent, HarnessLogger } from "../types.js";

export class HarnessObserver implements HarnessLogger {
  private events: HarnessEvent[] = [];
  private listeners: Array<(e: HarnessEvent) => void> = [];
  private startTime = 0;

  /** Log an event and notify all subscribers */
  log(event: HarnessEvent): void {
    this.events.push(event);
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // Don't let observer errors break the agent loop
      }
    }
  }

  /** Subscribe to real-time events. Returns an unsubscribe function. */
  subscribe(fn: (e: HarnessEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Get all recorded events */
  getEvents(): HarnessEvent[] {
    return [...this.events];
  }

  /** Compute summary metrics from recorded events */
  getMetrics(): HarnessMetrics {
    let totalActions = 0;
    let verifyPasses = 0;
    let verifyFails = 0;
    let screenshots = 0;
    let errors = 0;

    for (const e of this.events) {
      switch (e.type) {
        case "tool_call":
          totalActions++;
          break;
        case "verify_pass":
          verifyPasses++;
          break;
        case "verify_fail":
          verifyFails++;
          break;
        case "screenshot":
          screenshots++;
          break;
        case "error":
          errors++;
          break;
      }
    }

    const endTime =
      this.events.length > 0
        ? this.events[this.events.length - 1]!.timestamp
        : this.startTime;

    return {
      totalActions,
      verifyPasses,
      verifyFails,
      screenshots,
      errors,
      durationMs: endTime - (this.startTime || endTime),
    };
  }

  /** Mark the start of a run (for duration tracking) */
  markStart(): void {
    this.startTime = Date.now();
  }

  /** Export all events as JSON string (for trace persistence) */
  toJSON(): string {
    return JSON.stringify(
      {
        events: this.events,
        metrics: this.getMetrics(),
      },
      null,
      2,
    );
  }

  /** Clear all recorded events */
  clear(): void {
    this.events = [];
    this.startTime = 0;
  }
}

export interface HarnessMetrics {
  totalActions: number;
  verifyPasses: number;
  verifyFails: number;
  screenshots: number;
  errors: number;
  durationMs: number;
}
