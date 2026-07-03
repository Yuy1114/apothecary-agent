import { describe, expect, it } from "vitest";
import {
  ARCHIVE_DIR,
  isArchivedPath,
  archiveTargetPath,
  withCollisionSuffix,
} from "./archive.js";

describe("isArchivedPath", () => {
  it("recognizes paths under the archive root", () => {
    expect(isArchivedPath(`${ARCHIVE_DIR}/notes/a.md`)).toBe(true);
    expect(isArchivedPath(ARCHIVE_DIR)).toBe(true);
  });

  it("does not match active notes or a lookalike prefix", () => {
    expect(isArchivedPath("notes/a.md")).toBe(false);
    expect(isArchivedPath("archived-notes/a.md")).toBe(false);
  });
});

describe("archiveTargetPath", () => {
  it("mirrors the original nested structure under the archive root", () => {
    expect(archiveTargetPath("notes/db/redis.md")).toBe("archive/notes/db/redis.md");
  });

  it("handles a top-level file", () => {
    expect(archiveTargetPath("readme.md")).toBe("archive/readme.md");
  });
});

describe("withCollisionSuffix", () => {
  it("inserts the counter before the extension", () => {
    expect(withCollisionSuffix("archive/notes/a.md", 1)).toBe("archive/notes/a (1).md");
    expect(withCollisionSuffix("archive/notes/a.md", 2)).toBe("archive/notes/a (2).md");
  });

  it("handles a file with no directory", () => {
    expect(withCollisionSuffix("a.md", 3)).toBe("a (3).md");
  });

  it("handles a file with no extension", () => {
    expect(withCollisionSuffix("archive/notes/LICENSE", 1)).toBe("archive/notes/LICENSE (1)");
  });
});
