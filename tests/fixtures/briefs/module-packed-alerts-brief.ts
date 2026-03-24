import type { CapstanBrief } from "../../../packages/brief/src/index.ts";
import { externalGraphPacks } from "../packs/external-pack-registry.ts";

export const brief = {
  version: 1,
  domain: {
    key: "alerts-ops",
    title: "Alerts Operations Console",
    description: "A brief module that carries its own custom alerts pack registry."
  },
  packs: [
    {
      key: "alerts"
    }
  ],
  entities: []
} satisfies CapstanBrief;

export const packRegistry = externalGraphPacks;
export default brief;
