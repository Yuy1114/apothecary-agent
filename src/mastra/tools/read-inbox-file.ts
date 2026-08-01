import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { extractDocumentText } from "../../vault/extractText.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const EXCERPT_LIMIT = 4000;

export const readInboxFileTool = createTool({
  id: "readInboxFile",
  description:
    "Read a bounded text excerpt (~4000 chars) of ONE _inbox file to decide where it belongs when the name is not " +
    "enough. Handles .md/.markdown/.txt and — this is what makes 原件 vs 思考 decidable — .pdf, .docx, .pptx, " +
    ".xlsx and .html/.htm, by pulling their text out. A bank statement and a research paper are both .pdf: read " +
    "before choosing between records/ and resources/. Images, video and audio hold no text and are already placed " +
    "by rule; asking for one returns an error field. Read only the entries you cannot settle from the survey.",
  inputSchema: z.object({
    filePath: z.string().describe("Vault-relative path under _inbox/, e.g. _inbox/foo.pdf"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    /** How the text was recovered, so an odd-looking excerpt can be judged in context. */
    via: z.string(),
    excerpt: z.string(),
    lineCount: z.number(),
    truncated: z.boolean(),
    units: z.number().optional().describe("Pages / slides, when the format has them"),
    error: z.string().optional().describe("Set when nothing could be read; decide from the name instead"),
  }),
  execute: async ({ filePath }) => {
    if (!filePath.replaceAll("\\", "/").startsWith("_inbox/")) {
      throw new Error("not_an_inbox_file");
    }
    try {
      const extracted = await extractDocumentText(VAULT_PATH, filePath, EXCERPT_LIMIT);
      return {
        filePath,
        via: extracted.via,
        excerpt: extracted.content,
        lineCount: extracted.lineCount,
        truncated: extracted.truncated,
        units: extracted.units,
      };
    } catch (error) {
      // A damaged, encrypted or unreadable document must not abort the whole
      // intake pass — the organizer can still place it from its name.
      const reason = error instanceof Error ? error.message : String(error);
      return { filePath, via: "none", excerpt: "", lineCount: 0, truncated: false, error: reason };
    }
  },
});
