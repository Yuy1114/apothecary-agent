import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, setLogLevel, startTimer } from "./logger.js";

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => { out.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => { err.push(String(chunk)); return true; });
});

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel("warn"); // reset to default so tests don't leak level state
});

describe("logger", () => {
  it("gates by level: below-threshold is dropped, at/above is emitted", () => {
    setLogLevel("warn");
    logger.info("scope", "hidden");
    logger.warn("scope", "shown");
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("[scope] shown");
  });

  it("routes warn/error to stderr and info/debug to stdout", () => {
    setLogLevel("debug");
    logger.info("s", "an-info");
    logger.error("s", "an-error");
    expect(out.join("")).toContain("INFO  [s] an-info");
    expect(err.join("")).toContain("ERROR [s] an-error");
  });

  it("serializes a data payload and survives unserializable input", () => {
    setLogLevel("info");
    logger.info("s", "with-data", { a: 1 });
    const circular: any = {}; circular.self = circular;
    logger.info("s", "circular", circular);
    expect(out.join("")).toContain('with-data {"a":1}');
    expect(out.join("")).toContain("[s] circular\n"); // payload dropped, message intact
  });

  it("startTimer logs elapsed ms at info", () => {
    setLogLevel("info");
    const done = startTimer("s", "task");
    const ms = done();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(out.join("")).toMatch(/\[s\] task \+\d+ms/);
  });
});
