import type { HarnessControlPlane } from "../types.js";
import { HarnessContextKernel } from "../context/kernel.js";
import { FileHarnessRuntimeStore } from "./store.js";

export async function openHarnessRuntime(rootDir = process.cwd()): Promise<HarnessControlPlane> {
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();
  const contextKernel = new HarnessContextKernel(store);
  await contextKernel.initialize();

  return {
    pauseRun(runId) {
      return store.requestPause(runId);
    },

    cancelRun(runId) {
      return store.requestCancel(runId);
    },

    getRun(runId) {
      return store.getRun(runId);
    },

    async getCheckpoint(runId) {
      return (await store.getCheckpoint(runId))?.checkpoint;
    },

    getSessionMemory(runId) {
      return contextKernel.getSessionMemory(runId);
    },

    getLatestSummary(runId) {
      return contextKernel.getLatestSummary(runId);
    },

    listSummaries(runId) {
      return contextKernel.listSummaries(runId);
    },

    recallMemory(query) {
      return contextKernel.recallMemory(query);
    },

    assembleContext(runId, options) {
      return contextKernel.assembleContext(runId, options);
    },

    listRuns() {
      return store.listRuns();
    },

    getEvents(runId) {
      return store.getEvents(runId);
    },

    getArtifacts(runId) {
      return store.getArtifacts(runId);
    },

    replayRun(runId) {
      return store.replayRun(runId);
    },

    getPaths() {
      return store.paths;
    },
  };
}
