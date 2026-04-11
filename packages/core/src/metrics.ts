/**
 * Lightweight, zero-dependency Prometheus-compatible metrics collector.
 *
 * Provides Counter and Histogram (emitted as summary) primitives with a
 * global registry and text serialization in Prometheus exposition format.
 */

export class Counter {
  private value = 0;
  private labels = new Map<string, number>();

  inc(labelSet?: Record<string, string>, amount = 1): void {
    if (!labelSet) {
      this.value += amount;
      return;
    }
    const key = Object.entries(labelSet)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    this.labels.set(key, (this.labels.get(key) ?? 0) + amount);
  }

  serialize(name: string, help: string): string {
    let out = `# HELP ${name} ${help}\n# TYPE ${name} counter\n`;
    if (this.labels.size === 0) {
      out += `${name} ${this.value}\n`;
    } else {
      for (const [labels, val] of this.labels) {
        out += `${name}{${labels}} ${val}\n`;
      }
    }
    return out;
  }
}

export class Histogram {
  private values: number[] = [];
  private labeledValues = new Map<string, number[]>();

  observe(labelSet: Record<string, string> | undefined, value: number): void {
    if (!labelSet) {
      this.values.push(value);
      return;
    }
    const key = Object.entries(labelSet)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    const existing = this.labeledValues.get(key);
    if (!existing) {
      this.labeledValues.set(key, [value]);
    } else {
      existing.push(value);
    }
  }

  serialize(name: string, help: string): string {
    let out = `# HELP ${name} ${help}\n# TYPE ${name} summary\n`;
    const emit = (labels: string, vals: number[]) => {
      const sum = vals.reduce((a, b) => a + b, 0);
      if (labels) {
        out += `${name}_sum{${labels}} ${sum}\n`;
        out += `${name}_count{${labels}} ${vals.length}\n`;
      } else {
        out += `${name}_sum ${sum}\n`;
        out += `${name}_count ${vals.length}\n`;
      }
    };
    if (this.labeledValues.size === 0) {
      emit("", this.values);
    } else {
      for (const [l, v] of this.labeledValues) {
        emit(l, v);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

export function counter(name: string): Counter {
  let c = counters.get(name);
  if (!c) {
    c = new Counter();
    counters.set(name, c);
  }
  return c;
}

export function histogram(name: string): Histogram {
  let h = histograms.get(name);
  if (!h) {
    h = new Histogram();
    histograms.set(name, h);
  }
  return h;
}

export function serializeMetrics(): string {
  let out = "";
  for (const [name, c] of counters) {
    out += c.serialize(name, "") + "\n";
  }
  for (const [name, h] of histograms) {
    out += h.serialize(name, "") + "\n";
  }
  return out;
}

export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
}
