import { parse, stringify } from "yaml"

/**
 * Split a markdown document into its YAML frontmatter (if any) and body.
 * The frontmatter string does NOT include the surrounding `---` fences.
 */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: "", body: raw }
  return {
    frontmatter: match[1] ?? "",
    body: raw.slice(match[0].length),
  }
}

export function parseFrontmatter<T = Record<string, unknown>>(raw: string): {
  data: T
  body: string
} {
  const { frontmatter, body } = splitFrontmatter(raw)
  if (!frontmatter) return { data: {} as T, body }
  try {
    return { data: (parse(frontmatter) ?? {}) as T, body }
  } catch {
    return { data: {} as T, body }
  }
}

/**
 * Merge structured data back into a markdown document as YAML frontmatter.
 * Existing body text is preserved verbatim so this is safe to call on every save.
 */
export function writeFrontmatter<T extends Record<string, unknown>>(
  raw: string,
  data: T
): string {
  const { body } = splitFrontmatter(raw)
  const yaml = stringify(data, { lineWidth: 0 })
  return `---\n${yaml.trimEnd()}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`
}
