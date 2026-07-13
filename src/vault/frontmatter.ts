import matter from "gray-matter";

/**
 * Set (or overwrite) a single YAML frontmatter key on a markdown note, leaving
 * the body untouched and scaffolding a frontmatter block if the note has none.
 * Used to stamp `superseded_by` on notes a canonical note replaces — a directed,
 * human-visible link that survives semantic refreshes.
 */
export function setFrontmatterKey(content: string, key: string, value: string): string {
  const parsed = matter(content);
  return matter.stringify(parsed.content, { ...parsed.data, [key]: value });
}

/** Read a single frontmatter key from a note's content (undefined if absent). */
export function getFrontmatterKey(content: string, key: string): unknown {
  return matter(content).data[key];
}

/**
 * Merge tags into a note's frontmatter `tags` array (deduped, body untouched).
 * Returns the content unchanged when there is nothing new to add. Used by intake
 * to stamp a flattened note's lost path hierarchy back on as tags.
 */
export function addFrontmatterTags(content: string, tags: string[]): string {
  if (tags.length === 0) return content;
  const parsed = matter(content);
  const existing = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
  const merged = [...existing];
  for (const tag of tags) if (tag && !merged.includes(tag)) merged.push(tag);
  if (merged.length === existing.length) return content;
  return matter.stringify(parsed.content, { ...parsed.data, tags: merged });
}

/**
 * Merge tags like addFrontmatterTags, but keep every frontmatter byte the user
 * wrote untouched except the inserted tag lines. The gray-matter round-trip
 * re-serializes scalars (an unquoted `created: 2026-07-01` becomes an ISO
 * timestamp), which churns keys the caller never meant to touch. Falls back to
 * the round-trip when there is no frontmatter block or `tags` uses an inline
 * form this splice does not understand.
 */
export function addFrontmatterTagsPreserving(content: string, tags: string[]): string {
  if (tags.length === 0) return content;
  const block = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
  if (!block) return addFrontmatterTags(content, tags);
  const [whole, open, yaml, close] = block;

  const data = matter(content).data;
  const existing = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const fresh = tags.filter((tag) => tag && !existing.includes(tag));
  if (fresh.length === 0) return content;
  if (/^tags:/m.test(yaml) && !/^tags:[ \t]*$/m.test(yaml)) {
    // A tags key exists but not as a block list (inline array, `tags: []`, …) —
    // splicing would duplicate the key, so take the round-trip instead.
    return addFrontmatterTags(content, tags);
  }

  const lines = yaml.split(/\r?\n/);
  const tagsIdx = lines.findIndex((line) => /^tags:[ \t]*$/.test(line));
  if (tagsIdx === -1) {
    lines.push("tags:", ...fresh.map((tag) => `  - ${tag}`));
  } else {
    let end = tagsIdx + 1;
    while (end < lines.length && /^[ \t]+- /.test(lines[end])) end += 1;
    const indent = /^([ \t]+)- /.exec(lines[tagsIdx + 1] ?? "")?.[1] ?? "  ";
    lines.splice(end, 0, ...fresh.map((tag) => `${indent}- ${tag}`));
  }
  return open + lines.join("\n") + close + content.slice(whole.length);
}
