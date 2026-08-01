import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readInboxDocument } from "../../application/intake/readInboxDocument.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const EXCERPT_LIMIT = 4000;

export const readInboxFileTool = createTool({
  id: "readInboxFile",
  description:
    "Look at ONE _inbox item to decide where it belongs when its name is not enough. Reads text out of " +
    ".md/.markdown/.txt, .pdf, .docx, .pptx, .xlsx and .html — and, when a vision model is configured, reads " +
    "IMAGES too, reporting what they show, any text in them, and a cleaner filename to use. This is what makes " +
    "原件 vs 思考 decidable: a bank statement and a research paper are both .pdf, and a photographed receipt and " +
    "a whiteboard sketch are both .jpg. On failure an `error` field comes back instead of an excerpt — decide " +
    "from the name in that case. Read only the entries you cannot settle from the survey.",
  inputSchema: z.object({
    filePath: z.string().describe("Vault-relative path under _inbox/, e.g. _inbox/IMG_4821.jpeg"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    /** How the content was recovered, so an odd-looking excerpt can be judged in context. */
    via: z.string(),
    excerpt: z.string(),
    lineCount: z.number(),
    truncated: z.boolean(),
    units: z.number().optional().describe("Pages / slides, when the format has them"),
    suggestedName: z
      .string()
      .optional()
      .describe("From a vision read: a clean filename stem worth adopting in `rename` (no extension)"),
    error: z.string().optional().describe("Set when nothing could be read; decide from the name instead"),
  }),
  execute: async ({ filePath }) => {
    if (!filePath.replaceAll("\\", "/").startsWith("_inbox/")) {
      throw new Error("not_an_inbox_file");
    }
    return readInboxDocument(VAULT_PATH, filePath, EXCERPT_LIMIT);
  },
});
