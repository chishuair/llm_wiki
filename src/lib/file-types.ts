export type FileCategory =
  | "markdown"
  | "text"
  | "code"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "data"
  | "unknown"

const EXT_MAP: Record<string, FileCategory> = {
  // Markdown
  md: "markdown",
  mdx: "markdown",

  // Text
  txt: "text",
  rtf: "text",
  log: "text",

  // Code
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  rs: "code",
  go: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  scala: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  sql: "code",
  r: "code",
  lua: "code",
  css: "code",
  scss: "code",
  less: "code",
  html: "code",
  htm: "code",
  xml: "code",
  svg: "code",
  vue: "code",
  svelte: "code",
  toml: "code",
  ini: "code",
  cfg: "code",
  conf: "code",
  dockerfile: "code",
  makefile: "code",

  // Images
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  tiff: "image",
  tif: "image",
  avif: "image",
  heic: "image",
  heif: "image",

  // Video
  mp4: "video",
  webm: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  flv: "video",
  wmv: "video",
  m4v: "video",

  // Audio
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  wma: "audio",

  // PDF
  pdf: "pdf",

  // Documents (binary, not directly previewable)
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  odt: "document",
  ods: "document",
  odp: "document",
  pages: "document",
  numbers: "document",
  key: "document",
  epub: "document",

  // Data
  json: "data",
  jsonl: "data",
  csv: "data",
  tsv: "data",
  yaml: "data",
  yml: "data",
  ndjson: "data",
}

export function getFileCategory(filePath: string): FileCategory {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MAP[ext] ?? "unknown"
}

export function isTextReadable(category: FileCategory): boolean {
  return ["markdown", "text", "code", "data"].includes(category)
}

export function isBinary(category: FileCategory): boolean {
  // document 虽然是二进制格式，但应用侧会调用 Tauri preprocess_file 将其转为纯文本，
  // 因此 UI 层不应把它当作不可预览的二进制；isBinary 用于“前端完全不处理”的那类文件。
  return ["image", "video", "audio", "unknown"].includes(category)
}

export function getCodeLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    php: "php",
    swift: "swift",
    sql: "sql",
    html: "html",
    htm: "html",
    css: "css",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    sh: "bash",
    bash: "bash",
    toml: "toml",
  }
  return langMap[ext] ?? ext
}
