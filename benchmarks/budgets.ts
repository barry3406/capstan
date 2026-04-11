import type { BenchmarkBudgetMap } from "./harness.js";

export const benchmarkBudgets = {
  "react.render.minimal-ssr": {
    maxAvgMs: 2.0,
    maxP95Ms: 4.0,
  },
  "react.render.metadata-layouts": {
    maxAvgMs: 2.5,
    maxP95Ms: 5.0,
  },
  "dev.page-runtime.document": {
    maxAvgMs: 2.5,
    maxP95Ms: 5.0,
  },
  "dev.page-runtime.navigation-client": {
    maxAvgMs: 1.5,
    maxP95Ms: 3.0,
  },
  "router.scan.synthetic-app": {
    maxAvgMs: 20.0,
    maxP95Ms: 30.0,
  },
  "router.scan.super-complex-app": {
    maxAvgMs: 160.0,
    maxP95Ms: 240.0,
  },
  "router.scan.incremental-super-complex-app": {
    maxAvgMs: 100.0,
    maxP95Ms: 130.0,
  },
  "router.match.synthetic-app": {
    maxAvgMs: 0.75,
    maxP95Ms: 1.5,
  },
  "router.match.super-complex-app": {
    maxAvgMs: 1.25,
    maxP95Ms: 2.5,
  },
  "runtime.request.document": {
    maxAvgMs: 2.5,
    maxP95Ms: 5.0,
  },
  "runtime.request.deep-document": {
    maxAvgMs: 2.0,
    maxP95Ms: 3.0,
    overrides: [
      {
        when: {
          platform: "linux",
          arch: "x64",
          maxCpuCount: 4,
        },
        maxAvgMs: 2.5,
        maxP95Ms: 3.5,
      },
    ],
  },
  "runtime.request.navigation": {
    maxAvgMs: 2.0,
    maxP95Ms: 4.0,
  },
  "runtime.request.deep-navigation": {
    maxAvgMs: 1.5,
    maxP95Ms: 2.5,
    overrides: [
      {
        when: {
          platform: "linux",
          arch: "x64",
          maxCpuCount: 4,
        },
        maxAvgMs: 2.5,
        maxP95Ms: 3.5,
      },
    ],
  },
  "runtime.request.not-found": {
    maxAvgMs: 2.0,
    maxP95Ms: 4.0,
  },
} satisfies BenchmarkBudgetMap;
