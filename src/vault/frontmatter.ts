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
