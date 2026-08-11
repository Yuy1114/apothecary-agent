import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("collects the command and its subcommand as positionals", () => {
    expect(parseArgs(["proposals", "show", "prop-1"]).positionals).toEqual([
      "proposals",
      "show",
      "prop-1",
    ]);
  });

  it("defaults to human output with no overrides", () => {
    const parsed = parseArgs(["status"]);
    expect(parsed).toMatchObject({ json: false, help: false, modes: [] });
    expect(parsed.vault).toBeUndefined();
  });

  it("accepts value flags in both spellings", () => {
    expect(parseArgs(["status", "--vault", "/tmp/v"]).vault).toBe("/tmp/v");
    expect(parseArgs(["status", "--vault=/tmp/v"]).vault).toBe("/tmp/v");
  });

  it("keeps a quoted question as a single positional", () => {
    expect(parseArgs(["ask", "Redis 的过期策略是什么", "--json"])).toMatchObject({
      positionals: ["ask", "Redis 的过期策略是什么"],
      json: true,
    });
  });

  it("collects repeated --mode flags", () => {
    expect(parseArgs(["polish", "notes/a.md", "--mode", "expand", "--mode", "tags"]).modes).toEqual([
      "expand",
      "tags",
    ]);
  });

  it("parses numeric flags and rejects non-positive values", () => {
    expect(parseArgs(["ask", "q", "--top-k", "8"]).topK).toBe(8);
    expect(parseArgs(["findings", "--limit", "3"]).limit).toBe(3);
    expect(() => parseArgs(["findings", "--limit", "0"])).toThrow(/正整数/);
    expect(() => parseArgs(["findings", "--limit", "abc"])).toThrow(/正整数/);
  });

  it("rejects a mistyped flag rather than silently ignoring it", () => {
    // The failure this guards: `--jsonn` quietly yielding human-formatted text
    // to an agent that expected JSON.
    expect(() => parseArgs(["status", "--jsonn"])).toThrow(/未知选项/);
    expect(() => parseArgs(["status", "--topicc=x"])).toThrow(/未知选项/);
  });

  it("rejects a value flag whose value is missing or is another flag", () => {
    expect(() => parseArgs(["capture", "x", "--topic"])).toThrow(/需要一个值/);
    expect(() => parseArgs(["capture", "x", "--topic", "--json"])).toThrow(/需要一个值/);
    expect(() => parseArgs(["capture", "x", "--topic="])).toThrow(/需要一个值/);
  });

  it("parses speech ingest's value flags", () => {
    expect(
      parseArgs([
        "speech",
        "ingest",
        "--raw",
        "Have you think about it?",
        "--corrected",
        "Have you thought about it?",
        "--note",
        "完成时用过去分词",
      ]),
    ).toMatchObject({
      positionals: ["speech", "ingest"],
      raw: "Have you think about it?",
      corrected: "Have you thought about it?",
      note: "完成时用过去分词",
    });
    // 等号拼写同样支持；--note 可省略。
    expect(parseArgs(["speech", "ingest", "--raw=a", "--corrected=b"]).note).toBeUndefined();
    expect(() => parseArgs(["speech", "ingest", "--corrected"]).note).toThrow(/需要一个值/);
  });

  it("treats -h/--help as a request for help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});
