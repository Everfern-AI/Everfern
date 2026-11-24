import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropRun, patchRun, pickLive, saveRun, savedRuns, type SavedRun } from "../live-run";
import { activeRunOf, attachRun, endError, runWorker, stopWorker } from "@/lib/worker-engine";
import type { Worker } from "@/lib/workers";

const worker = (id: string): Worker => ({ id, name: id, hue: 0, tier: "balanced", status: "running", apps: [], prompt: "Do it", createdAt: "" });
const rec = (workerId: string, conversationId: string): SavedRun => ({ workerId, conversationId, steps: ["a", "b"], startTime: 1, key: "run-1" });

describe("saved runs", () => {
  beforeEach(() => sessionStorage.clear());

  it("saves, patches and drops a run per worker", () => {
    saveRun(rec("w1", "worker-w1-run-5"));
    saveRun(rec("w2", "worker-w2-run-6"));
    patchRun("w1", { completed: 2 });
    patchRun("nobody", { completed: 9 });
    expect(savedRuns().w1.completed).toBe(2);
    expect(savedRuns().nobody).toBeUndefined();
    dropRun("w1");
    expect(Object.keys(savedRuns())).toEqual(["w2"]);
  });

  it("finds the saved run's conversation, finished or not", () => {
    const runs = [{ conversationId: "worker-w1-run-5", text: "hi", done: true }];
    expect(pickLive("w1", rec("w1", "worker-w1-run-5"), runs)?.text).toBe("hi");
    expect(pickLive("w1", rec("w1", "worker-w1-run-4"), runs)).toBeUndefined();
  });

  it("without a saved run, takes the newest run still going under the worker's id", () => {
    const runs = [
      { conversationId: "worker-w1-run-5", text: "", done: false },
      { conversationId: "worker-w1-run-9", text: "", done: false },
      { conversationId: "worker-w1-run-12", text: "", done: true },
      { conversationId: "worker-w10-run-20", text: "", done: false },
    ];
    expect(pickLive("w1", undefined, runs)?.conversationId).toBe("worker-w1-run-9");
  });
});

describe("attaching to a run after a reload", () => {
  afterEach(() => { delete (window as any).electronAPI; });

  function bridge(active: any[]) {
    const chunk: Array<(d: any) => void> = [];
    const stop = vi.fn(async () => undefined);
    (window as any).electronAPI = {
      acp: {
        chat: vi.fn(), stream: vi.fn(() => new Promise(() => undefined)), stop,
        active: vi.fn(async () => active),
        onStreamChunk: (cb: any) => { chunk.push(cb); return () => { chunk.splice(chunk.indexOf(cb), 1); }; },
        onToolStart: () => () => undefined,
      },
    };
    return { send: (d: any) => chunk.slice().forEach((cb) => cb(d)), stop, listeners: () => chunk.length };
  }

  it("keeps the text so far, follows new text, and ends on the run's last chunk", async () => {
    const b = bridge([{ conversationId: "worker-r1-run-1", text: "Searching", done: false }]);
    const onText = vi.fn();
    const p = attachRun(worker("r1"), { conversationId: "worker-r1-run-1", text: "Searching", done: false }, { onText, onTool: vi.fn() });
    expect(onText).toHaveBeenLastCalledWith("Searching");
    expect(activeRunOf("r1")).toBe("worker-r1-run-1");
    b.send({ conversationId: "other", delta: " nope" });
    b.send({ conversationId: "worker-r1-run-1", delta: " flights" });
    expect(onText).toHaveBeenLastCalledWith("Searching flights");
    // Pause still reaches the right run.
    await stopWorker("r1");
    expect(b.stop).toHaveBeenCalledWith("worker-r1-run-1");
    b.send({ conversationId: "worker-r1-run-1", delta: "", done: true });
    await expect(p).resolves.toEqual({ live: true, text: "Searching flights" });
    expect(activeRunOf("r1")).toBeUndefined();
    expect(b.listeners()).toBe(0);
  });

  it("returns the result of a run that ended while the page was away", async () => {
    bridge([]);
    const r = await attachRun(worker("r2"), { conversationId: "worker-r2-run-1", text: "Report", done: true, end: "" }, { onText: vi.fn(), onTool: vi.fn() });
    expect(r).toEqual({ live: true, text: "Report" });
    const failed = await attachRun(worker("r2"), { conversationId: "worker-r2-run-1", text: "", done: true, end: "\n\n[Error: quota]" }, { onText: vi.fn(), onTool: vi.fn() });
    expect(failed.error).toBe("quota");
  });

  it("ends when main no longer has the run, using main's full text", async () => {
    const b = bridge([{ conversationId: "worker-r3-run-1", text: "All of it", done: true, end: "" }]);
    const r = await attachRun(worker("r3"), { conversationId: "worker-r3-run-1", text: "All", done: false }, { onText: vi.fn(), onTool: vi.fn() });
    expect(r.text).toBe("All of it");
    expect(b.listeners()).toBe(0);
  });

  it("tells runWorker's caller the conversation id, so the page can save it", async () => {
    bridge([]);
    const onStart = vi.fn();
    void runWorker(worker("r4"), ["one"], { onText: vi.fn(), onTool: vi.fn() }, { onStart });
    expect(onStart).toHaveBeenCalledWith(activeRunOf("r4"));
  });

  it("reads the error out of the last chunk", () => {
    expect(endError("\n\n[Error: Error: boom]")).toBe("Error: boom");
    expect(endError("")).toBeUndefined();
    expect(endError(undefined)).toBeUndefined();
  });
});
