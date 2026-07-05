import { describe, expect, it } from "vitest";
import { classifyFileKind, isJunkName, isPackageDir, summarizeExtensions } from "./inboxSurvey.js";

describe("inboxSurvey classifiers", () => {
  it("classifies files by extension, case-insensitively", () => {
    expect(classifyFileKind("notes__Java__Spring.md")).toBe("markdown");
    expect(classifyFileKind("Grokking Algorithms.pdf")).toBe("pdf");
    expect(classifyFileKind("report.PDF")).toBe("pdf");
    expect(classifyFileKind("scratch.txt")).toBe("text");
    expect(classifyFileKind("Screenshot 2026-07-03.png")).toBe("image");
    expect(classifyFileKind("clip.webp")).toBe("image");
    expect(classifyFileKind("art.png@1052w_!web-dynamic.avif")).toBe("image");
    expect(classifyFileKind("demo.mp4")).toBe("video");
    expect(classifyFileKind("song.m4a")).toBe("audio");
    expect(classifyFileKind("data.sqlite")).toBe("other");
  });

  it("detects OS/tooling junk, including flattened .DS_Store", () => {
    expect(isJunkName(".DS_Store")).toBe(true);
    expect(isJunkName("archive__notes__.DS_Store")).toBe(true);
    expect(isJunkName("._resume.pdf")).toBe(true);
    expect(isJunkName("Thumbs.db")).toBe(true);
    expect(isJunkName("real-note.md")).toBe(false);
    expect(classifyFileKind(".DS_Store")).toBe("junk");
  });

  it("detects macOS/iWork package dirs by extension", () => {
    expect(isPackageDir("Photos Library.photoslibrary")).toBe(true);
    expect(isPackageDir("Keynote.key")).toBe(true);
    expect(isPackageDir("books")).toBe(false);
  });

  it("summarizes the dominant extensions, highest first", () => {
    const top = summarizeExtensions(["a.md", "b.md", "c.md", "d.pdf", "e.PNG", "f"]);
    expect(top[0]).toEqual({ ext: ".md", count: 3 });
    expect(top).toContainEqual({ ext: ".pdf", count: 1 });
    expect(top).toContainEqual({ ext: "«none»", count: 1 });
  });
});
