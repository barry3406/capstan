import { describe, it, expect, beforeEach } from "bun:test";
import {
  Counter,
  Histogram,
  counter,
  histogram,
  serializeMetrics,
  resetMetrics,
  createCapstanApp,
} from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

describe("Counter", () => {
  it("increments a label-free counter", () => {
    const c = new Counter();
    c.inc();
    c.inc(undefined, 3);
    const out = c.serialize("my_counter", "A test counter");
    expect(out).toContain("# HELP my_counter A test counter");
    expect(out).toContain("# TYPE my_counter counter");
    expect(out).toContain("my_counter 4");
  });

  it("increments labeled counters", () => {
    const c = new Counter();
    c.inc({ method: "GET", status: "200" });
    c.inc({ method: "GET", status: "200" });
    c.inc({ method: "POST", status: "201" });
    const out = c.serialize("http_requests", "Request count");
    expect(out).toContain('http_requests{method="GET",status="200"} 2');
    expect(out).toContain('http_requests{method="POST",status="201"} 1');
  });

  it("sorts label keys alphabetically", () => {
    const c = new Counter();
    c.inc({ z: "1", a: "2" });
    const out = c.serialize("sorted", "");
    // 'a' should come before 'z'
    expect(out).toContain('sorted{a="2",z="1"} 1');
  });

  it("supports custom increment amounts", () => {
    const c = new Counter();
    c.inc({ op: "batch" }, 10);
    const out = c.serialize("ops", "");
    expect(out).toContain('ops{op="batch"} 10');
  });

  it("defaults to increment by 1 when no amount specified", () => {
    const c = new Counter();
    c.inc();
    c.inc();
    const out = c.serialize("two", "");
    expect(out).toContain("two 2");
  });

  it("handles empty labels object same as no labels", () => {
    const c = new Counter();
    c.inc({});
    const out = c.serialize("empty_labels", "");
    // Should serialize without label brackets
    expect(out).toContain("empty_labels");
  });
});

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

describe("Histogram", () => {
  it("records unlabeled observations and serializes sum/count", () => {
    const h = new Histogram();
    h.observe(undefined, 10);
    h.observe(undefined, 20);
    h.observe(undefined, 30);
    const out = h.serialize("duration", "Request duration");
    expect(out).toContain("# HELP duration Request duration");
    expect(out).toContain("# TYPE duration summary");
    expect(out).toContain("duration_sum 60");
    expect(out).toContain("duration_count 3");
  });

  it("records labeled observations", () => {
    const h = new Histogram();
    h.observe({ method: "GET" }, 5);
    h.observe({ method: "GET" }, 15);
    h.observe({ method: "POST" }, 100);
    const out = h.serialize("latency", "");
    expect(out).toContain('latency_sum{method="GET"} 20');
    expect(out).toContain('latency_count{method="GET"} 2');
    expect(out).toContain('latency_sum{method="POST"} 100');
    expect(out).toContain('latency_count{method="POST"} 1');
  });

  it("records zero-value observation", () => {
    const h = new Histogram();
    h.observe(undefined, 0);
    const out = h.serialize("zero_test", "");
    expect(out).toContain("zero_test_sum 0");
    expect(out).toContain("zero_test_count 1");
  });

  it("accumulates many observations correctly", () => {
    const h = new Histogram();
    for (let i = 1; i <= 100; i++) {
      h.observe(undefined, i);
    }
    const out = h.serialize("sum_test", "");
    // Sum of 1..100 = 5050
    expect(out).toContain("sum_test_sum 5050");
    expect(out).toContain("sum_test_count 100");
  });
});

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

describe("Global registry", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("counter() returns the same instance for the same name", () => {
    const a = counter("test_counter");
    const b = counter("test_counter");
    expect(a).toBe(b);
  });

  it("histogram() returns the same instance for the same name", () => {
    const a = histogram("test_histo");
    const b = histogram("test_histo");
    expect(a).toBe(b);
  });

  it("serializeMetrics() outputs all registered counters and histograms", () => {
    counter("req_total").inc({ method: "GET" });
    histogram("req_duration").observe(undefined, 42);
    const out = serializeMetrics();
    expect(out).toContain("req_total");
    expect(out).toContain("req_duration_sum 42");
    expect(out).toContain("req_duration_count 1");
  });

  it("resetMetrics() clears the global registry", () => {
    counter("stale").inc();
    histogram("stale_h").observe(undefined, 1);
    resetMetrics();
    const out = serializeMetrics();
    expect(out).toBe("");
  });
});

// ---------------------------------------------------------------------------
// /metrics endpoint integration
// ---------------------------------------------------------------------------

describe("GET /metrics endpoint", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("responds with text/plain containing Prometheus metrics", async () => {
    const { app } = await createCapstanApp({
      app: { name: "metrics-test", title: "Metrics Test" },
    });

    // Make a request to generate some metrics
    await app.request("/metrics");

    // Now fetch metrics — should include the previous request's data
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("capstan_http_requests_total");
    expect(body).toContain("capstan_http_request_duration_ms");
  });

  it("records request method and status in counter labels", async () => {
    const { app } = await createCapstanApp({
      app: { name: "label-test", title: "Label Test" },
    });

    // Hit the manifest endpoint to generate a GET 200
    await app.request("/.well-known/capstan.json");

    const res = await app.request("/metrics");
    const body = await res.text();
    expect(body).toContain('method="GET"');
    expect(body).toContain('status="200"');
  });
});
