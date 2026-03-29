import type { ArtifactDefinition } from "../types.js";

export const workRequestReportArtifact = {
  "key": "workRequestReport",
  "title": "Work Request Report",
  "description": "A generated report artifact produced when one work request finishes processing.",
  "kind": "report"
} satisfies ArtifactDefinition;
