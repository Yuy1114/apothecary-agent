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
