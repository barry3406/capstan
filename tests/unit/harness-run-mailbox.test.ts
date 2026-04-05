import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRunMailbox,
  buildHarnessRuntimePaths,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-mailbox-"));
  tempDirs.push(dir);
  return dir;
}

describe("file-backed harness mailbox", () => {
  it("persists published messages across mailbox instances and preserves FIFO order", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const mailboxA = new FileHarnessRunMailbox(paths);

    await mailboxA.publish({
      id: "trigger_1",
      runId: "run_mailbox_fifo",
      createdAt: new Date().toISOString(),
      kind: "trigger",
      trigger: {
        type: "manual",
        source: "test",
      },
    });
    await mailboxA.publish({
      id: "context_1",
      runId: "run_mailbox_fifo",
      createdAt: new Date().toISOString(),
      kind: "context_message",
      source: "operator",
      message: {
        role: "user",
        content: "resume from mailbox",
      },
    });

    const mailboxB = new FileHarnessRunMailbox(paths);
    expect(await mailboxB.next("run_mailbox_fifo")).toMatchObject({
      kind: "trigger",
      trigger: { type: "manual", source: "test" },
    });
    expect(await mailboxB.next("run_mailbox_fifo")).toMatchObject({
      kind: "context_message",
      source: "operator",
      message: { role: "user", content: "resume from mailbox" },
    });
    expect(await mailboxB.next("run_mailbox_fifo", { timeoutMs: 5 })).toBeUndefined();
  });

  it("rejects invalid run ids instead of allowing traversal-like mailbox paths", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const mailbox = new FileHarnessRunMailbox(paths);

    await expect(
      mailbox.publish({
        id: "bad_1",
        runId: "../escape",
        createdAt: new Date().toISOString(),
        kind: "system",
        event: "bad",
      }),
    ).rejects.toThrow("Invalid harness mailbox run id");

    await expect(mailbox.list("../escape")).rejects.toThrow("Invalid harness mailbox run id");
    await expect(mailbox.next("../escape", { timeoutMs: 5 })).rejects.toThrow(
      "Invalid harness mailbox run id",
    );
    await expect(
      mailbox.publish({
        id: "bad_2",
        runId: "..\\escape",
        createdAt: new Date().toISOString(),
        kind: "system",
        event: "bad",
      }),
    ).rejects.toThrow("Invalid harness mailbox run id");
  });

  it("preserves persisted mailbox ordering even when the state file has advanced reads", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_state";
    const mailbox = new FileHarnessRunMailbox(paths);

    await mailbox.publish({
      id: "system_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "first",
    });
    await mailbox.publish({
      id: "system_2",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "second",
    });

    const runDir = join(paths.mailboxDir, runId);
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({ nextWriteSequence: 2, nextReadSequence: 99 }, null, 2),
      "utf8",
    );

    const reopened = new FileHarnessRunMailbox(paths);
    expect(await reopened.next(runId, { timeoutMs: 0 })).toBeUndefined();

    await reopened.publish({
      id: "system_3",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "third",
    });

    expect(await reopened.next(runId)).toMatchObject({
      kind: "system",
      event: "third",
    });
  });

  it("observes messages published by another mailbox instance after local state was already initialized", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_cross_instance_refresh";
    const mailboxA = new FileHarnessRunMailbox(paths);
    const mailboxB = new FileHarnessRunMailbox(paths);

    await mailboxA.publish({
      id: "trigger_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "trigger",
      trigger: { type: "manual", source: "test" },
    });

    expect(await mailboxA.next(runId, { timeoutMs: 0 })).toMatchObject({
      id: "trigger_1",
      kind: "trigger",
    });

    await mailboxB.publish({
      id: "control_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "control_signal",
      action: "pause",
      reason: "pause from separate control plane",
    });

    expect(await mailboxA.next(runId, { timeoutMs: 0 })).toMatchObject({
      id: "control_1",
      kind: "control_signal",
      action: "pause",
    });
  });

  it("excludes state.json from list output and only returns actual mailbox messages", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_list";
    const mailbox = new FileHarnessRunMailbox(paths);

    await mailbox.publish({
      id: "system_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "first",
    });
    await mailbox.publish({
      id: "trigger_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "trigger",
      trigger: { type: "manual", source: "test" },
    });

    const messages = await mailbox.list(runId);
    expect(messages).toHaveLength(2);
    expect(messages).toEqual([
      expect.objectContaining({ id: "system_1", kind: "system" }),
      expect.objectContaining({ id: "trigger_1", kind: "trigger" }),
    ]);
    expect(messages.some((entry) => "nextWriteSequence" in (entry as object))).toBe(false);
  });

  it("fails closed on corrupted mailbox state instead of silently accepting poisoned counters", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_bad_state";
    const runDir = join(paths.mailboxDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({ nextWriteSequence: "oops", nextReadSequence: 1 }, null, 2),
      "utf8",
    );

    const mailbox = new FileHarnessRunMailbox(paths);
    await expect(mailbox.list(runId)).rejects.toThrow(
      `Harness mailbox state corrupted for run ${runId}`,
    );
    await expect(mailbox.next(runId, { timeoutMs: 0 })).rejects.toThrow(
      `Harness mailbox state corrupted for run ${runId}`,
    );
  });

  it("does not advance the read cursor when the next persisted message is malformed", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_bad_message";
    const mailbox = new FileHarnessRunMailbox(paths);

    await mailbox.publish({
      id: "system_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "first",
    });

    const runDir = join(paths.mailboxDir, runId);
    await writeFile(join(runDir, "000000000000.json"), "{ not-valid-json", "utf8");

    await expect(mailbox.next(runId, { timeoutMs: 0 })).rejects.toThrow(
      `Harness mailbox message corrupted for run ${runId}`,
    );

    const stateAfterFailure = JSON.parse(
      await Bun.file(join(runDir, "state.json")).text(),
    ) as { nextWriteSequence: number; nextReadSequence: number };
    expect(stateAfterFailure).toMatchObject({
      nextWriteSequence: 1,
      nextReadSequence: 0,
    });

    await writeFile(
      join(runDir, "000000000000.json"),
      JSON.stringify(
        {
          id: "system_1",
          runId,
          createdAt: new Date().toISOString(),
          kind: "system",
          event: "repaired",
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(await mailbox.next(runId, { timeoutMs: 0 })).toMatchObject({
      id: "system_1",
      kind: "system",
      event: "repaired",
    });
  });

  it("fails closed when the next persisted message is valid JSON but missing mailbox fields", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_wrong_shape";
    const runDir = join(paths.mailboxDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({ nextWriteSequence: 1, nextReadSequence: 0 }, null, 2),
      "utf8",
    );
    await writeFile(
      join(runDir, "000000000000.json"),
      JSON.stringify({
        id: "broken_1",
        runId,
        createdAt: new Date().toISOString(),
        event: "missing kind",
      }),
      "utf8",
    );

    const mailbox = new FileHarnessRunMailbox(paths);
    await expect(mailbox.next(runId, { timeoutMs: 0 })).rejects.toThrow(
      `Harness mailbox message corrupted for run ${runId}`,
    );

    const stateAfterFailure = JSON.parse(
      await Bun.file(join(runDir, "state.json")).text(),
    ) as { nextWriteSequence: number; nextReadSequence: number };
    expect(stateAfterFailure).toEqual({
      nextWriteSequence: 1,
      nextReadSequence: 0,
    });
  });

  it("reclaims a stale run lock instead of timing out forever on abandoned mailbox state", async () => {
    const rootDir = await createTempDir();
    const paths = buildHarnessRuntimePaths(rootDir);
    const runId = "run_mailbox_stale_lock";
    const runDir = join(paths.mailboxDir, runId);
    const lockDir = join(runDir, ".lock");
    await mkdir(lockDir, { recursive: true });
    const staleTime = new Date(Date.now() - 31_000);
    await utimes(lockDir, staleTime, staleTime);

    const mailbox = new FileHarnessRunMailbox(paths);
    await mailbox.publish({
      id: "system_after_lock",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "lock-reclaimed",
    });

    expect(await mailbox.next(runId, { timeoutMs: 0 })).toMatchObject({
      id: "system_after_lock",
      kind: "system",
      event: "lock-reclaimed",
    });
  });
});
