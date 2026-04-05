import type {
  AgentLoopCheckpoint,
  AgentLoopCheckpointStage,
  AgentLoopTransitionReason,
} from "../types.js";
import type { RunAgentLoopOptions, TurnEngineState } from "./state.js";
import { applyCheckpoint, updatePhase } from "./state.js";

export async function flushPendingSidecars(input: {
  state: TurnEngineState;
  stage: AgentLoopCheckpointStage;
  transitionReason: AgentLoopTransitionReason;
  opts: RunAgentLoopOptions | undefined;
  persistCheckpoint(stage: AgentLoopCheckpointStage): Promise<AgentLoopCheckpoint>;
}): Promise<void> {
  const { state, stage, transitionReason, opts, persistCheckpoint } = input;
  if (!opts?.runSidecars) {
    return;
  }
  if (opts.hasPendingSidecars && !opts.hasPendingSidecars()) {
    return;
  }

  const phaseBeforeSidecars = state.orchestration.phase;
  updatePhase(state, "running_sidecars", transitionReason);
  const sidecarCheckpoint = await persistCheckpoint(stage);
  const result = await opts.runSidecars({
    runId: opts.runId,
    checkpoint: sidecarCheckpoint,
    stage,
    phaseBeforeSidecars,
    transitionReason,
  });

  if (result?.checkpoint) {
    applyCheckpoint(state, result.checkpoint);
  }

  if (state.orchestration.phase === "running_sidecars") {
    updatePhase(state, phaseBeforeSidecars, transitionReason);
  }
}
