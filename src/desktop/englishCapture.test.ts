import { describe, expect, it, vi } from "vitest";
import { startCaptureWatcher } from "./englishCapture.js";

type Captured = { kind: string; text: string; lookup: string; sourceLabel?: string };

function harness(options: { clipboard?: string; autoOffMinutes?: number } = {}) {
  let clipboard = options.clipboard ?? "";
  let clock = new Date("2026-07-26T08:00:00.000Z");
  const captures: Captured[] = [];
  const readClipboard = vi.fn(() => clipboard);

  const watcher = startCaptureWatcher({
    readClipboard,
    onCapture: async (capture) => {
      captures.push(capture);
    },
    autoOffMinutes: options.autoOffMinutes,
    // Never install a real timer in tests; tick() is driven by hand.
    pollMs: 3_600_000,
    now: () => clock,
  });

  return {
    watcher,
    captures,
    readClipboard,
    copy: (text: string) => {
      clipboard = text;
    },
    advanceMinutes: (minutes: number) => {
      clock = new Date(clock.getTime() + minutes * 60_000);
    },
  };
}

describe("reading-mode capture watcher", () => {
  it("does not read the clipboard at all while off", async () => {
    const h = harness({ clipboard: "some private thing" });

    await h.watcher.tick();

    expect(h.readClipboard).not.toHaveBeenCalled();
    expect(h.captures).toEqual([]);
    expect(h.watcher.session().active).toBe(false);
    h.watcher.stop();
  });

  it("ignores whatever was already on the clipboard when the session starts", async () => {
    const h = harness({ clipboard: "password-from-before" });

    h.watcher.start();
    await h.watcher.tick();

    expect(h.captures).toEqual([]);
    h.watcher.stop();
  });

  it("captures a newly copied word once, not on every poll", async () => {
    const h = harness({ clipboard: "" });
    h.watcher.start("MDN · Promise");

    h.copy("idempotent");
    await h.watcher.tick();
    await h.watcher.tick();
    await h.watcher.tick();

    expect(h.captures).toEqual([
      { kind: "word", text: "idempotent", lookup: "idempotent", sourceLabel: "MDN · Promise" },
    ]);
    expect(h.watcher.session().captured).toBe(1);
    h.watcher.stop();
  });

  it("routes a long copy to the sentence kind", async () => {
    const h = harness();
    h.watcher.start();

    h.copy("The value that the function returns when the promise it awaits rejects.");
    await h.watcher.tick();

    expect(h.captures[0]?.kind).toBe("sentence");
    h.watcher.stop();
  });

  it("drops credential-shaped copies without queueing them", async () => {
    const h = harness();
    h.watcher.start();

    h.copy("sk-a8Kd93jXm2QpLzR4tYuI");
    await h.watcher.tick();

    expect(h.captures).toEqual([]);
    expect(h.watcher.session().captured).toBe(0);
    h.watcher.stop();
  });

  it("auto-expires the session so a forgotten toggle stops on its own", async () => {
    const h = harness({ autoOffMinutes: 30 });
    h.watcher.start();

    h.advanceMinutes(31);
    h.copy("resilient");
    await h.watcher.tick();

    expect(h.watcher.session().active).toBe(false);
    expect(h.captures).toEqual([]);
    h.watcher.stop();
  });

  it("survives a clipboard read that throws", async () => {
    let clipboard = "";
    const watcher = startCaptureWatcher({
      readClipboard: () => {
        if (clipboard === "boom") throw new Error("pasteboard busy");
        return clipboard;
      },
      onCapture: async () => {},
      pollMs: 3_600_000,
    });
    watcher.start();
    clipboard = "boom";

    await expect(watcher.tick()).resolves.toBeUndefined();
    expect(watcher.session().active).toBe(true);
    watcher.stop();
  });

  it("toggle reports the resulting state", () => {
    const h = harness();
    expect(h.watcher.toggle()).toBe(true);
    expect(h.watcher.toggle()).toBe(false);
    h.watcher.stop();
  });
});
