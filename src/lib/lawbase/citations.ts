import type { CitationMatch, CitationValidation } from "@/types/lawbase"
import { findArticle } from "."

/**
 * 从任意文本中识别法律引用。支持的常见模式：
 *   《民法典》第577条
 *   《中华人民共和国民法典》第 577 条
 *   依照《民事诉讼法》第六十七条之规定
 *   《民法典》第577条第一款第（一）项
 *
 * 目前仅识别「《法名》+ 第N条（可带款/项）」形式。非书名号的变体暂不识别，
 * 鼓励法官在书写时规范引用。
 */
const CITATION_PATTERN =
  /《([^》]+?)》\s*第\s*([零〇一二三四五六七八九十百千两0-9]+)\s*条(?:\s*第[零〇一二三四五六七八九十百千两0-9]+款)?(?:\s*第[零〇一二三四五六七八九十百千两0-9]+项)?/g

/** 中文数字 → 阿拉伯数字（只覆盖 1–999 常用范围，够用于条号场景）。 */
function chineseToArabic(raw: string): string {
  if (/^\d+$/.test(raw)) return raw
  const map: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let section = 0
  let last = 0
  for (const ch of raw) {
    if (ch === "十") {
      section += last === 0 ? 10 : last * 10
      last = 0
    } else if (ch === "百") {
      section += (last || 1) * 100
      last = 0
    } else if (ch === "千") {
      section += (last || 1) * 1000
      last = 0
    } else if (ch in map) {
      last = map[ch]
    }
  }
  section += last
  total += section
  return String(total)
}

export function extractCitations(text: string): CitationMatch[] {
  const out: CitationMatch[] = []
  CITATION_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITATION_PATTERN.exec(text)) !== null) {
    const rawName = m[1].trim()
    const numeric = chineseToArabic(m[2])
    out.push({
      raw: m[0],
      codeName: rawName,
      number: `第${numeric}条`,
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return out
}

/** 对每个识别出的引用在内置法条库中做存在性校验。 */
export function validateCitations(text: string): CitationValidation[] {
  return extractCitations(text).map((match) => {
    const hit = findArticle(match.codeName, match.number)
    if (hit) {
      return { ...match, valid: true, code: hit.code, article: hit.article }
    }
    return { ...match, valid: false }
  })
}
