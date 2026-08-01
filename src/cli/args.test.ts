import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("defaults to human output with no vault override", () => {
    expect(parseArgs(["status"])).toEqual({ command: "status", json: false, help: false });
  });

  it("accepts --json and both --vault spellings", () => {
    expect(parseArgs(["status", "--json", "--vault", "/tmp/v"])).toMatchObject({
      command: "status",
      json: true,
      vault: "/tmp/v",
    });
    expect(parseArgs(["status", "--vault=/tmp/v"])).toMatchObject({ vault: "/tmp/v" });
  });

  it("treats -h/--help as a request for help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("rejects a mistyped flag rather than silently ignoring it", () => {
    // The failure this guards: `--jsonn` quietly yielding human-formatted text
    // to an agent that expected JSON.
    expect(() => parseArgs(["status", "--jsonn"])).toThrow(/未知选项/);
  });

  it("rejects a --vault without a value", () => {
    expect(() => parseArgs(["status", "--vault"])).toThrow(/需要一个路径/);
    expect(() => parseArgs(["status", "--vault", "--json"])).toThrow(/需要一个路径/);
  });

  it("rejects a second bare argument", () => {
    expect(() => parseArgs(["status", "extra"])).toThrow(/多余的参数/);
  });
});
