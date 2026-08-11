import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { extractDocumentText, htmlText, ooxmlText, tidyExtracted } from "./extractText.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "extract-vault-"));
  dirs.push(dir);
  return dir;
}

/** A minimal but structurally real OOXML package. */
function ooxmlPackage(parts: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(parts)) entries[name] = strToU8(xml);
  return zipSync(entries);
}

describe("tidyExtracted", () => {
  it("restores Kangxi radicals a PDF text layer emits instead of ideographs", () => {
    // U+2F45 ⽅ / U+2F8A ⾊ are what pdf.js hands back; a model reading them is
    // reading the wrong characters.
    expect(tidyExtracted("⽅案设计")).toBe("方案设计");
    expect(tidyExtracted("⾊彩")).toBe("色彩");
  });

  it("collapses the per-glyph spacing PDFs insert between CJK characters", () => {
    expect(tidyExtracted("方 案 设 计 文 档")).toBe("方案设计文档");
  });

  it("keeps paragraph breaks — they are structure, not noise", () => {
    expect(tidyExtracted("第 一 段\n第 二 段")).toBe("第一段\n第二段");
  });

  it("does not glue words in space-delimited scripts", () => {
    expect(tidyExtracted("hybrid teaching considerations")).toBe("hybrid teaching considerations");
  });

  it("squeezes runs of blank lines", () => {
    expect(tidyExtracted("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("ooxmlText", () => {
  it("returns runs in order with a newline per paragraph", () => {
    const xml =
      "<w:body><w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:t>续写</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body>";
    expect(ooxmlText(xml, "w:t", "w:p")).toBe("第一段续写\n第二段\n");
  });

  it("decodes XML entities rather than leaking them into the excerpt", () => {
    const xml = '<w:p><w:r><w:t>A &amp; B &lt;tag&gt; &#65; &#x42;</w:t></w:r></w:p>';
    expect(ooxmlText(xml, "w:t", "w:p")).toBe("A & B <tag> A B\n");
  });

  it("honours xml:space attributes on the run tag", () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">带 空格</w:t></w:r></w:p>';
    expect(ooxmlText(xml, "w:t", "w:p")).toBe("带 空格\n");
  });
});

describe("htmlText", () => {
  it("drops scripts and styles instead of dumping code into the excerpt", () => {
    const html = "<html><head><style>.a{color:red}</style></head><body><p>正文</p><script>x=1</script></body></html>";
    expect(htmlText(html).replace(/\s+/g, " ").trim()).toBe("正文");
  });

  it("turns block ends into line breaks", () => {
    expect(htmlText("<p>一</p><p>二</p>").trim()).toBe("一\n二");
  });
});

describe("extractDocumentText", () => {
  it("reads a .docx", async () => {
    const root = await vault();
    await writeFile(
      path.join(root, "report.docx"),
      ooxmlPackage({
        "word/document.xml":
          "<w:document><w:body><w:p><w:r><w:t>季度总结</w:t></w:r></w:p>" +
          "<w:p><w:r><w:t>收入增长 12%</w:t></w:r></w:p></w:body></w:document>",
      }),
    );

    const result = await extractDocumentText(root, "report.docx");

    expect(result.via).toBe("docx");
    expect(result.content).toContain("季度总结");
    expect(result.content).toContain("收入增长 12%");
  });

  it("reads a .pptx slide by slide, in numeric order", async () => {
    const root = await vault();
    const slide = (text: string) => `<p:sld><p:cSld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:cSld></p:sld>`;
    await writeFile(
      path.join(root, "deck.pptx"),
      ooxmlPackage({
        // Deliberately out of lexicographic order: slide10 must not sort before slide2.
        "ppt/slides/slide10.xml": slide("第十页"),
        "ppt/slides/slide2.xml": slide("第二页"),
        "ppt/slides/slide1.xml": slide("封面"),
      }),
    );

    const result = await extractDocumentText(root, "deck.pptx");

    expect(result.via).toBe("pptx");
    expect(result.units).toBe(3);
    const order = ["封面", "第二页", "第十页"].map((t) => result.content.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThanOrEqual(0);
  });

  it("reads .xlsx shared strings", async () => {
    const root = await vault();
    await writeFile(
      path.join(root, "book.xlsx"),
      ooxmlPackage({
        "xl/sharedStrings.xml": "<sst><si><t>应聘调查表</t></si><si><t>姓名</t></si></sst>",
      }),
    );

    const result = await extractDocumentText(root, "book.xlsx");

    expect(result.via).toBe("xlsx");
    expect(result.content).toContain("应聘调查表");
    expect(result.content).toContain("姓名");
  });

  it("returns markdown untouched — normalising would rewrite the author's bytes", async () => {
    const root = await vault();
    const original = "# 标题\n\n正文  带尾空格  \n\n\n\n多空行";
    await writeFile(path.join(root, "note.md"), original, "utf8");

    const result = await extractDocumentText(root, "note.md");

    expect(result.via).toBe("plain");
    expect(result.content).toBe(original);
  });

  it("clips to the limit and says so", async () => {
    const root = await vault();
    await writeFile(path.join(root, "long.md"), "x".repeat(500), "utf8");

    const result = await extractDocumentText(root, "long.md", 100);

    expect(result.content).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("refuses a format with no recoverable text rather than guessing", async () => {
    const root = await vault();
    await writeFile(path.join(root, "photo.jpg"), "binary");
    await expect(extractDocumentText(root, "photo.jpg")).rejects.toThrow("unsupported_type");
  });

  it("refuses to escape the vault", async () => {
    const root = await vault();
    await expect(extractDocumentText(root, "../../etc/passwd")).rejects.toThrow("unsafe_path");
  });

  it("reports a missing file distinctly", async () => {
    const root = await vault();
    await expect(extractDocumentText(root, "gone.md")).rejects.toThrow("file_not_found");
  });
});
