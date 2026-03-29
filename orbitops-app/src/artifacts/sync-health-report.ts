import type { ArtifactDefinition } from "../types.js";

export const syncHealthReportArtifact = {
  "key": "syncHealthReport",
  "title": "同步健康报告",
  "description": "A generated report artifact produced after sync completes.",
  "kind": "report"
} satisfies ArtifactDefinition;
