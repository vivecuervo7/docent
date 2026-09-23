// The text without its markdown, for places that show a single line.
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
