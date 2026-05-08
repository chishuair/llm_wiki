import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

/**
 * 原件摘要系统。
 *
 * 目标：解决「长原件被截断、LLM 漏读关键事实」的问题。
 *
 * 核心思路（两阶段）：
 * 1. 分块：把长原件正文切成 ~4000 字符一块，每块独立送 LLM；
 * 2. 提要：要求 LLM 忠实提取与审判可能相关的具体事实（姓名、时间、金额、
 *    合同条款原文、证据编号、鉴定结论等），不要抽象总结；
 * 3. 合并：把每块的提要拼成该文件的结构化小档案；
 * 4. 缓存：按「文件路径 + 修改时间 + 文本 hash」做缓存键，避免重复消耗 LLM；
 * 5. 最终喂给文书生成器的是这些摘要而非原文，节省上下文并保证关键细节不丢。
 */

const DEFAULT_CHUNK_SIZE = 2400
const MIN_CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 200 // 避免条款跨块被切断
const SUMMARY_CHAR_CAP = 3500 // 单文件摘要上限，回落到生成主阶段用
const CHUNK_MAX_TOKENS = 700
const MAX_CHUNK_ATTEMPTS = 2

export interface SourceSummary {
  relativePath: string
  /** 基于文件路径 + mtime（若拿不到则空）+ 原文长度的缓存标识 */
  cacheKey: string
  /** 摘要正文，Markdown 格式 */
  text: string
  /** 源文件字符数 */
  sourceSize: number
  /** 摘要字符数 */
  summarySize: number
  /** 生成时间（ISO） */
  generatedAt: string
}

export interface SummarizeOptions {
  projectPath: string
  relativePath: string
  rawText: string
  llmConfig: LlmConfig
  signal?: AbortSignal
  onChunkStart?: (chunkIndex: number, totalChunks: number) => void
  onChunkToken?: (chunkIndex: number, token: string) => void
}

function hashString(input: string): string {
  // FNV-1a 32-bit，足以用作摘要缓存键（非安全哈希场景）
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

function chunkSizeForConfig(config: LlmConfig): number {
  const configuredContext = Number(config.maxContextSize || 0)
  if (!Number.isFinite(configuredContext) || configuredContext <= 0) return DEFAULT_CHUNK_SIZE

  // Keep per-request payloads conservative for slower LAN model gateways.
  // The user-facing maxContextSize still matters, but one chunk should only
  // consume a small slice of it so nginx/model-server timeouts are less likely.
  return Math.max(MIN_CHUNK_SIZE, Math.min(DEFAULT_CHUNK_SIZE, Math.floor(configuredContext * 0.12)))
}

function chunk(text: string, size = DEFAULT_CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(text.length, i + size)
    chunks.push(text.slice(i, end))
    if (end === text.length) break
    i = end - overlap
  }
  return chunks
}

function isTransientLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /HTTP\s*(408|429|500|502|503|504)|Gateway Timeout|timeout|timed out|Failed to fetch|Load failed|NetworkError/i.test(message)
}

function fallbackChunkSummary(chunkText: string, chunkIndex: number, totalChunks: number): string {
  const compact = chunkText.replace(/\s+/g, " ").trim()
  const excerpt = compact.length > 900 ? `${compact.slice(0, 900)}……` : compact
  return [
    `### 提要（${chunkIndex + 1}/${totalChunks}，模型提炼失败回退）`,
    "",
    `- 本片段模型请求超时或网关失败，已保留原文摘录供后续处理。`,
    excerpt ? `- 原文摘录：${excerpt}` : "- 原文摘录为空。",
  ].join("\n")
}

export function cacheKeyFor(relativePath: string, rawText: string): string {
  // 不访问文件系统 mtime，改用「路径 + 文本 hash」，更简单且与内容强相关
  return `${relativePath}::${rawText.length}::${hashString(rawText)}`
}

function cacheDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/source-summaries`
}

function cacheFilename(relativePath: string): string {
  // 把斜杠替换成安全字符，保留文件名可辨识
  return relativePath.replace(/[\\/]/g, "__") + ".json"
}

export async function readCachedSummary(
  projectPath: string,
  relativePath: string,
  expectedKey: string
): Promise<SourceSummary | null> {
  const filename = `${cacheDir(projectPath)}/${cacheFilename(relativePath)}`
  try {
    const raw = await readFile(filename)
    const parsed = JSON.parse(raw) as SourceSummary
    if (parsed.cacheKey !== expectedKey) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCachedSummary(projectPath: string, summary: SourceSummary): Promise<void> {
  const dir = cacheDir(projectPath)
  try {
    await createDirectory(dir)
  } catch {
    // 目录已存在 / 其他错误不阻塞写入
  }
  const filename = `${dir}/${cacheFilename(summary.relativePath)}`
  try {
    await writeFile(filename, JSON.stringify(summary, null, 2))
  } catch {
    // 忽略写入失败，本次生成仍可继续
  }
}

const SYSTEM_PROMPT = [
  "你是一名协助法官处理案件原件的文书助手。",
  "任务：阅读下方给出的「原件片段」，**忠实提取**所有与未来审判、说理可能相关的具体信息，整理为结构化提要。",
  "",
  "硬性规则：",
  "- 只能依据原件片段内容提取，严禁编造任何信息。",
  "- 必须保留**具体细节**而不是抽象总结：",
  "  · 当事人姓名、身份证号/统一社会信用代码、地址等；",
  "  · 重要日期（签订、履行、违约、送达、损害发生等）；",
  "  · 具体金额、数量、比例；",
  "  · 合同/协议关键条款，**整句引用**（标注「条款第X条原文：……」）；",
  "  · 证据编号、来源、证明目的；",
  "  · 证人关键陈述、鉴定意见结论、批复/复函意见；",
  "  · 程序性事项（立案、送达、保全、开庭节点等）。",
  "- 无法识别 / 格式乱码的段落用『（此处文字混乱或缺失）』标注，不要脑补。",
  "- 输出使用 Markdown 结构：`### 提要` 开头，下分若干要点或分小节；每条 1-3 句。",
  "- 严禁输出任何法律评价、结论、建议，只做事实提取。",
].join("\n")

async function summarizeChunk(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  llmConfig: LlmConfig,
  onToken: ((token: string) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `## 原件片段（${chunkIndex + 1} / ${totalChunks}）`,
        "",
        chunkText,
      ].join("\n"),
    },
  ]
  let buffer = ""
  let capturedError: Error | null = null
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (t) => {
        buffer += t
        onToken?.(t)
      },
      onDone: () => {},
      onError: (err) => {
        capturedError = err
      },
    },
    signal,
    { temperature: 0.1, max_tokens: CHUNK_MAX_TOKENS }
  )
  if (capturedError) throw capturedError
  return buffer.trim()
}

async function summarizeChunkWithRetry(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  llmConfig: LlmConfig,
  onToken: ((token: string) => void) | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
    if (signal?.aborted) return ""
    try {
      return await summarizeChunk(chunkText, chunkIndex, totalChunks, llmConfig, onToken, signal)
    } catch (error) {
      lastError = error
      if (!isTransientLlmError(error) || attempt >= MAX_CHUNK_ATTEMPTS) break
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt))
    }
  }
  console.warn("source summary chunk failed, using excerpt fallback", {
    chunkIndex,
    totalChunks,
    error: lastError,
  })
  return fallbackChunkSummary(chunkText, chunkIndex, totalChunks)
}

export async function summarizeSource(opts: SummarizeOptions): Promise<SourceSummary> {
  const { projectPath, relativePath, rawText, llmConfig, signal } = opts
  const key = cacheKeyFor(relativePath, rawText)
  const cached = await readCachedSummary(projectPath, relativePath, key)
  if (cached) return cached

  const chunks = chunk(rawText, chunkSizeForConfig(llmConfig))
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    opts.onChunkStart?.(i, chunks.length)
    const piece = await summarizeChunkWithRetry(
      chunks[i],
      i,
      chunks.length,
      llmConfig,
      opts.onChunkToken ? (t) => opts.onChunkToken?.(i, t) : undefined,
      signal
    )
    if (piece) parts.push(piece)
  }

  let summary = parts.join("\n\n").trim()
  if (summary.length > SUMMARY_CHAR_CAP) {
    summary = summary.slice(0, SUMMARY_CHAR_CAP) + "\n\n（提要过长已截断）"
  }

  const result: SourceSummary = {
    relativePath,
    cacheKey: key,
    text: summary,
    sourceSize: rawText.length,
    summarySize: summary.length,
    generatedAt: new Date().toISOString(),
  }
  await writeCachedSummary(projectPath, result)
  return result
}

/** 为文书生成决定单个文件是否需要做摘要（超过此阈值才做）。 */
export const SUMMARIZE_THRESHOLD = 6000
