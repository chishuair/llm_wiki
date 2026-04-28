import { preprocessFile } from "@/commands/fs"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage } from "@/lib/llm-client"
import { streamChat } from "@/lib/llm-client"
import type { LawArticle, LawCode } from "@/types/lawbase"

/**
 * PDF → 结构化法条。
 *
 * 思路：
 * 1. 通过 Tauri 的 `preprocess_file` 命令提取 PDF 文本（复用项目已有
 *    的 pdfium 集成）；
 * 2. 用启发式正则提取「第N条」正文；
 * 3. 用本地 LLM 识别法律元信息（全称、别名、颁布机关、生效时间）并
 *    给每条估计所属章节；
 *
 * LLM 仅做「元信息」与「章节归属」的辅助识别，不负责条文正文本身——
 * 条文正文直接用原始 PDF 文本，避免 LLM 改写事故。
 */

export interface ParsedLawPreview {
  source: string
  rawText: string
  draft: LawCode
  /** 未能识别出条号的段落，便于法官人工处理 */
  leftover: string[]
}

export async function parsePdfIntoLawDraft(
  absolutePath: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<ParsedLawPreview> {
  const rawText = await preprocessFile(absolutePath)
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("PDF 文本提取结果为空，可能是扫描件，请先做 OCR 或改用 Word 原件。")
  }

  const { articles, leftover } = extractArticles(rawText)
  if (articles.length === 0) {
    throw new Error("未能在 PDF 中识别出「第N条」结构，请确认是否为法律法规原文。")
  }

  const meta = await inferLawMetadata(rawText, config, signal).catch(() => null)
  const filenameMeta = inferMetaFromFilename(absolutePath)
  // 生效日期只从 PDF 正文推断（文件名里的日期多半是颁布/整理日期，不可靠）
  const effectiveFromText = extractEffectiveDate(rawText)

  const draft: LawCode = {
    code: meta?.code ?? filenameMeta.code ?? "（请补全法律名称）",
    aliases: meta?.aliases ?? filenameMeta.aliases,
    effective: meta?.effective ?? effectiveFromText ?? undefined,
    version: meta?.version ?? filenameMeta.version,
    issuer: meta?.issuer,
    articles,
  }

  return { source: absolutePath, rawText, draft, leftover }
}

/**
 * 从正文中识别「本法自XXXX年XX月XX日起施行」这类表述，抽出生效日期。
 *
 * 常见措辞：
 *   本法自 2017 年 6 月 1 日起施行
 *   本法自 2021 年 1 月 1 日起施行
 *   自公布之日起施行
 *   自二〇二五年十月二十八日起施行
 *
 * 规则：
 * - 优先匹配「施行/实施/生效/起效」相关措辞
 * - 同时支持阿拉伯数字与中文数字
 * - 若只写了「自公布之日起施行」之类无确切日期则返回 null
 */
export function extractEffectiveDate(text: string): string | null {
  const candidates = text
    .split(/\n+/)
    .filter((line) => /(施行|实施|生效|起效)/.test(line))
  for (const line of candidates) {
    const parsed = parseDateInSentence(line)
    if (parsed) return parsed
  }
  // 兜底：在最后 2000 字范围内全局扫（尾部附则常带）
  return parseDateInSentence(text.slice(-2000))
}

function parseDateInSentence(text: string): string | null {
  // 阿拉伯数字：2025 年 10 月 28 日
  const arabic = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (arabic) {
    return `${arabic[1]}-${arabic[2].padStart(2, "0")}-${arabic[3].padStart(2, "0")}`
  }
  // 中文数字：二〇二五年十月二十八日
  const cn = text.match(/([零〇一二三四五六七八九十百千两]+)年([零〇一二三四五六七八九十]+)月([零〇一二三四五六七八九十]+)日/)
  if (cn) {
    const y = chineseNumeralToInt(cn[1])
    const mo = chineseNumeralToInt(cn[2])
    const d = chineseNumeralToInt(cn[3])
    if (y && mo && d) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }
  }
  return null
}

function chineseNumeralToInt(raw: string): number {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)
  const digit: Record<string, number> = {
    零: 0, 〇: 0,
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  // 若完全由个位数字 + 零组成（如「二〇二五」「一九九九」），按逐位拼接处理（用于年份）
  if ([...raw].every((ch) => ch in digit)) {
    let n = 0
    for (const ch of raw) n = n * 10 + digit[ch]
    return n
  }
  // 否则按十百千组合解析（用于月份、日期，如「二十八」「三十」）
  let total = 0
  let current = 0
  for (const ch of raw) {
    if (ch === "十") {
      current = current === 0 ? 10 : current * 10
    } else if (ch === "百") {
      current = (current || 1) * 100
    } else if (ch === "千") {
      current = (current || 1) * 1000
    } else if (ch in digit) {
      if (current >= 10) {
        total += current
        current = digit[ch]
      } else {
        current = digit[ch]
      }
    }
  }
  return total + current
}

/**
 * 把大段文本按「第N条」切分。
 * - 支持阿拉伯数字和中文数字
 * - 条文正文可以跨行、跨页
 * - 带「第N条之一」、「第N条（修订）」等变体也能粗略识别
 */
export function extractArticles(text: string): { articles: LawArticle[]; leftover: string[] } {
  const normalized = text
    .replace(/\r\n/g, "\n")
    // 去除页眉页脚里常见的「第 N 页 共 M 页」
    .replace(/第\s*\d+\s*页\s*[共/]\s*\d+\s*页/g, "")
    // 合并软换行：条文里的单次换行视为段落内
    .replace(/([^\n])\n(?!第[零〇一二三四五六七八九十百千两0-9])/g, "$1")
    .replace(/\n{2,}/g, "\n\n")
    .trim()

  const articleHeadPattern = /^第([零〇一二三四五六七八九十百千两0-9]+)条(之[一二三四五六])?/

  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const articles: LawArticle[] = []
  const leftover: string[] = []

  let current: LawArticle | null = null
  for (const line of lines) {
    const m = line.match(articleHeadPattern)
    if (m) {
      if (current) articles.push(current)
      const numberLabel = `第${m[1]}条${m[2] ?? ""}`
      // 条号后面可能直接跟条文，也可能被标题段隔断
      const rest = line.replace(articleHeadPattern, "").trim()
      current = {
        number: numberLabel,
        content: rest,
      }
    } else if (current) {
      current.content = current.content ? `${current.content}\n${line}` : line
    } else {
      // 尚未见到第一条时的内容算作前言/说明
      leftover.push(line)
    }
  }
  if (current) articles.push(current)

  // 去掉空条文，修剪
  const cleaned = articles
    .map((a) => ({ ...a, content: a.content.trim() }))
    .filter((a) => a.content.length > 0)

  return { articles: cleaned, leftover }
}

interface InferredMeta {
  code?: string
  aliases?: string[]
  effective?: string
  version?: string
  issuer?: string
}

async function inferLawMetadata(
  rawText: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<InferredMeta | null> {
  // 只把开头 2000 字符给 LLM，标题和生效信息一般在这里
  const head = rawText.slice(0, 2000)

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是一名法律文本结构化助手。只返回严格的 JSON，不要包含任何解释或代码块标记。" +
        "字段：code（法律全称，如「中华人民共和国民法典」）、aliases（常用别名数组，如 [\"民法典\",\"民法\"]）、" +
        "effective（生效日期 YYYY-MM-DD，必须来自正文里类似「本法自 XXXX 年 XX 月 XX 日起施行 / 实施 / 生效」的措辞；" +
        "如果正文没有明确写出生效日期，必须省略该字段，不要编造或从通过日期推断）、" +
        "version（版本说明，如「2020年修订」「2023年修正」）、" +
        "issuer（颁布机关）。若任何字段信息缺失就省略该字段。",
    },
    {
      role: "user",
      content: `以下是一部中国法律/法规原文开头（可能包含颁布机关、通过日期、主席令、施行日期等信息）。请按规则返回 JSON：\n\n${head}`,
    },
  ]

  let buffer = ""
  await streamChat(
    config,
    messages,
    {
      onToken: (t) => {
        buffer += t
      },
      onDone: () => {},
      onError: (err) => {
        throw err
      },
    },
    signal,
    { temperature: 0.1 },
  )

  const jsonText = extractJsonObject(buffer)
  if (!jsonText) return null
  try {
    return JSON.parse(jsonText) as InferredMeta
  } catch {
    return null
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim()
  // 移除 ```json ... ``` 包裹
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1].trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return body.slice(start, end + 1)
}

interface FilenameMeta {
  code?: string
  aliases?: string[]
  version?: string
}

/**
 * 从文件名里推断元信息（不负责生效日期，那个字段只看正文）：
 *   中华人民共和国网络安全法_20251028.pdf
 *     → code: "中华人民共和国网络安全法"
 *     → aliases: ["网络安全法"]
 *   民法典（2020年修订）.docx
 *     → code: "民法典"
 *     → version: "2020年修订"
 *
 * 尽量保守：只剥离明显是后缀的片段，其他一概不猜。
 */
export function inferMetaFromFilename(absolutePath: string): FilenameMeta {
  const fileName = absolutePath.split(/[\\/]/).pop() ?? ""
  let stem = fileName.replace(/\.(pdf|docx?|txt|md)$/i, "").trim()
  if (!stem) return {}

  const result: FilenameMeta = {}

  // 1. 剥掉日期后缀（_20251028、-2025-10-28、（2025年10月28日通过） 等）
  //    这些通常是整理/公布日期，不作为生效日期使用。
  const dateSuffixRegexes: RegExp[] = [
    /[-_（(]\s*\d{4}[-\.年]?\s*\d{1,2}[-\.月]?\s*\d{1,2}\s*(?:日)?(?:通过|实施|生效|修订|公布)?\s*[）)]?\s*$/,
    /[-_]\s*\d{8}\s*$/,
  ]
  for (const rx of dateSuffixRegexes) {
    if (rx.test(stem)) {
      stem = stem.replace(rx, "").trim()
      break
    }
  }

  // 2. 剥掉版本后缀
  const versionRegexes: RegExp[] = [
    /[-_（(]\s*(\d{4}年(?:修订|修正|修正案).*?)\s*[）)]?\s*$/,
    /[-_（(]\s*(第\S+次.*?修订)\s*[）)]?\s*$/,
  ]
  for (const rx of versionRegexes) {
    const m = stem.match(rx)
    if (m) {
      result.version = m[1].trim()
      stem = stem.replace(rx, "").trim()
      break
    }
  }

  // 3. 清理剩余连接符
  stem = stem
    .replace(/^[\s\-_·]+|[\s\-_·]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (stem) {
    result.code = stem
    // 4. 顺手给一个常用别名：去掉「中华人民共和国」前缀
    const alias = stem.replace(/^中华人民共和国/, "").trim()
    if (alias && alias !== stem) {
      result.aliases = [alias]
    }
  }

  return result
}
