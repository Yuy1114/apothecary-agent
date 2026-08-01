import { describe, expect, it } from "vitest";
import { quickFileEntry } from "./quickFiling.js";
import type { InboxEntry } from "./inboxSurvey.js";

const file = (name: string, kind: InboxEntry["kind"]): InboxEntry => ({
  name,
  path: `_inbox/${name}`,
  kind,
  sizeBytes: 1024,
  ext: name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : undefined,
});

describe("quickFileEntry — screenshots", () => {
  it.each([
    "Screenshot 2026-05-20 at 22.29.12.png",
    "Screen Shot 2026-01-02 at 10.00.00.png",
    "CleanShot 2026-07-01 at 12.00.00@2x.png",
    "SCR-20260801-abcd.png",
    "Snipaste_2026-08-01_10-00-00.png",
    "Xnip2026-08-01_10-00-00.jpg",
    "屏幕快照 2026-08-01 上午10.00.00.png",
    "企业微信截图_17224.png",
    "截图 2026-08-01.png",
  ])("routes %s to media/screenshots", (name) => {
    expect(quickFileEntry(file(name, "image"))?.dest).toBe("media/screenshots");
  });
});

describe("quickFileEntry — photos", () => {
  it.each(["IMG_4821.jpeg", "IMG-20260801.jpg", "DSC_0001.JPG", "PXL_20260801_120000.jpg"])(
    "routes %s to media/photos",
    (name) => {
      expect(quickFileEntry(file(name, "image"))?.dest).toBe("media/photos");
    },
  );
});

describe("quickFileEntry — the honest fallback", () => {
  it("sends an image it cannot characterise to attachments, with low confidence", () => {
    const filing = quickFileEntry(file("41186B4F3C6AAB264ACA8BCB8230CA37.jpg", "image"));
    expect(filing?.dest).toBe("media/attachments");
    // The point of the low score: the human reviewing the plan should see that
    // the rule is guessing, not classifying.
    expect(filing?.confidence).toBeLessThan(0.7);
  });

  it("routes video and audio to media attachments", () => {
    expect(quickFileEntry(file("20260714-面试录像.mp4", "video"))?.dest).toBe("media/attachments");
    expect(quickFileEntry(file("recording.m4a", "audio"))?.dest).toBe("media/attachments");
  });
});

describe("quickFileEntry — extension-determined", () => {
  it.each(["1984 (George Orwell).epub", "动物庄园.azw3", "book.mobi"])(
    "routes %s to resources/books",
    (name) => {
      const filing = quickFileEntry(file(name, "other"));
      expect(filing?.dest).toBe("resources/books");
      expect(filing?.confidence).toBe(1);
    },
  );

  it.each(["solve.py", "server.ts", "Main.java", "query.sql"])(
    "routes %s to resources/code",
    (name) => {
      expect(quickFileEntry(file(name, "other"))?.dest).toBe("resources/code");
    },
  );
});

describe("quickFileEntry — what it deliberately refuses to decide", () => {
  it("leaves PDFs to judgement: a statement and a paper share an extension", () => {
    expect(quickFileEntry(file("PPT 总结 — 方案设计文档.pdf", "pdf"))).toBeNull();
    expect(quickFileEntry(file("2026年3月账单.pdf", "pdf"))).toBeNull();
  });

  it("leaves readable text to the organizer", () => {
    expect(quickFileEntry(file("prompt 编写规范.md", "markdown"))).toBeNull();
    expect(quickFileEntry(file("notes.txt", "text"))).toBeNull();
  });

  it("leaves .html alone — a loose one is usually a saved page, not source", () => {
    expect(quickFileEntry(file("信息图生成方案评测总结-完整版.html", "other"))).toBeNull();
  });

  it("leaves directories and packages alone", () => {
    expect(quickFileEntry({ name: "books", path: "_inbox/books", kind: "directory" })).toBeNull();
    expect(quickFileEntry({ name: "x.app", path: "_inbox/x.app", kind: "package" })).toBeNull();
  });

  it("leaves an unknown binary alone rather than inventing a home", () => {
    expect(quickFileEntry(file("installer.dmg", "other"))).toBeNull();
    expect(quickFileEntry(file("bundle.zip", "other"))).toBeNull();
  });
});
