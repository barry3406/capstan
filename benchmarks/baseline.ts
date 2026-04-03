import type { BenchmarkBaselineMap } from "./harness.js";

export const benchmarkBaseline = {
  "react.render.minimal-ssr": {
    avgMs: 0.055,
    p95Ms: 0.119,
  },
  "react.render.metadata-layouts": {
    avgMs: 0.05,
    p95Ms: 0.063,
  },
  "dev.page-runtime.document": {
    avgMs: 0.127,
    p95Ms: 0.329,
  },
  "dev.page-runtime.navigation-client": {
    avgMs: 0.01,
    p95Ms: 0.015,
  },
  "router.scan.synthetic-app": {
    avgMs: 9.813,
    p95Ms: 11.289,
  },
  "router.scan.super-complex-app": {
    avgMs: 70.452,
    p95Ms: 72.157,
  },
  "router.scan.incremental-super-complex-app": {
    avgMs: 59.67,
    p95Ms: 60.658,
  },
  "router.match.synthetic-app": {
    avgMs: 0.057,
    p95Ms: 0.063,
  },
  "router.match.super-complex-app": {
    avgMs: 0.267,
    p95Ms: 0.277,
  },
  "runtime.request.document": {
    avgMs: 0.149,
    p95Ms: 0.194,
  },
  "runtime.request.deep-document": {
    avgMs: 0.375,
    p95Ms: 0.4,
  },
  "runtime.request.navigation": {
    avgMs: 0.129,
    p95Ms: 0.168,
  },
  "runtime.request.deep-navigation": {
    avgMs: 0.358,
    p95Ms: 0.473,
  },
  "runtime.request.not-found": {
    avgMs: 0.08,
    p95Ms: 0.083,
  },
} satisfies BenchmarkBaselineMap;
