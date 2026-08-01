import { describe, expect, it } from "vitest";
import { renderImageDescription, sanitizeSuggestedName } from "./imageDescription.js";

describe("sanitizeSuggestedName", () => {
  it("strips path separators so a model cannot steer where a file lands", () => {
    expect(sanitizeSuggestedName("../../etc/passwd")).toBe("etc passwd");
    expect(sanitizeSuggestedName("a/b\\c")).toBe("a b c");
  });

  it("keeps a normal Chinese name intact", () => {
    // The hyphen must survive: these suggestions usually carry a date.
    expect(sanitizeSuggestedName("电费账单 2026-07")).toBe("电费账单 2026-07");
  });

  it("refuses a name that would hide the file or break the filesystem", () => {
    expect(sanitizeSuggestedName(".hidden")).toBe("hidden");
    expect(sanitizeSuggestedName("   ")).toBeNull();
    expect(sanitizeSuggestedName("...")).toBeNull();
  });

  it("strips control characters a model can emit into a path", () => {
    expect(sanitizeSuggestedName("\u0000bad\u001fname\nnext")).toBe("bad name next");
  });

  it("bounds the length", () => {
    expect(sanitizeSuggestedName("字".repeat(200))?.length).toBe(60);
  });
});

describe("renderImageDescription", () => {
  it("leads with the kind, then the transcription when there is one", () => {
    const rendered = renderImageDescription({
      kind: "whiteboard_or_handwriting",
      description: "A hand-drawn service architecture.",
      text: "网关 → 订单服务",
      suggestedName: "",
    });
    expect(rendered.startsWith("[whiteboard_or_handwriting]")).toBe(true);
    expect(rendered).toContain("文字内容：");
    expect(rendered).toContain("网关 → 订单服务");
  });

  it("omits the transcription block for an image with no text", () => {
    const rendered = renderImageDescription({
      kind: "photo",
      description: "A cat asleep on a keyboard.",
      text: "",
      suggestedName: "",
    });
    expect(rendered).not.toContain("文字内容");
  });
});
