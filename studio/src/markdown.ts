/** Strips a leading `---\nkey: value\n---` block.
 *
 *  A skill's frontmatter is metadata, not prose: handed to the markdown
 *  renderer it comes out as a setext heading, so the preview used to open with
 *  "id: x description: y" as its title. The editor keeps the whole file,
 *  because the frontmatter is editable too. */
export function withoutFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1] : content;
}
