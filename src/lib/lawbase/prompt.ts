import { listCodes, searchLaws } from "."

/**
 * LLM 引用法条时的硬约束机制。
 *
 * 原则：
 * - 法官不允许 LLM 凭空引用任何法律；
 * - LLM 只能引用本地「法律依据」库中实际存在的条款；
 * - 一旦本地库里没有对应内容，LLM 必须直接输出下方的「库缺标识」，
 *   让应用自动提醒法官导入相关法律，而不是让模型继续编造。
 */

/**
 * 库缺标识语。应用在 LLM 输出中检测到此语时，会向法官展示「请导入相关法律」的提示。
 * 保持简短且具辨识度，避免与普通行文混淆。
 */
export const LAWBASE_MISSING_SENTINEL =
  "【本地法条库未收录相关法律依据，请先在「法律依据」中导入后重试】"

const COMMON_MISSING_LAW_HINTS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: "中华人民共和国民事诉讼法",
    patterns: [/民事诉讼法/, /二审/, /上诉/, /维持原判/, /迟延履行/],
  },
  {
    name: "最高人民法院关于民事诉讼证据的若干规定",
    patterns: [/证据/, /鉴定意见/, /证明力/, /举证/, /质证/],
  },
  {
    name: "最高人民法院关于适用《中华人民共和国民事诉讼法》的解释",
    patterns: [/民诉法解释/, /适用.*民事诉讼法/, /程序瑕疵/, /审判监督/],
  },
  {
    name: "医疗事故处理条例",
    patterns: [/医疗事故/, /赔偿项目/, /赔偿标准/, /医疗损害/, /医方承担/],
  },
  {
    name: "医疗事故分级标准（试行）",
    patterns: [/分级标准/, /四级医疗事故/, /二级甲等医疗事故/, /伤残等级/],
  },
  {
    name: "中华人民共和国民法通则",
    patterns: [/第一百零六条/, /过错责任/, /民法通则/],
  },
  {
    name: "中华人民共和国民法典",
    patterns: [/民法典/, /侵权责任编/, /侵权责任/, /人格权/, /民事责任/],
  },
]

/**
 * 构造法条库约束提示片段，供 LLM system prompt 注入。
 *
 * - 若库为空：输出「库为空」说明 + 规定任何法律问题都必须先回复库缺标识语；
 * - 若库中有条文：只列出条号与简短标题（而非全文），避免把 prompt 撑爆；
 *   要求 LLM 在使用法条前回到本清单确认；
 * - 无论哪种情况，都严格禁止编造法律名或条文号。
 */
export function buildLawbasePromptSection(): string {
  const codes = listCodes()
  const loadedSummary = codes.length > 0
    ? `本地法条库当前已加载 ${codes.length} 部法律法规。应用会在生成后自动校验《法律名称》第N条引用是否真实存在于本地库。`
    : "本地法条库当前为空。"
  const header = [
    "## 法律引用约束（重要）",
    loadedSummary,
    "- 你只能引用本地法条库中真实存在的法律和条款。",
    "- 引用时必须使用标准格式：《法律全称》第N条。",
    "- 严禁编造法律名、条文号或条文内容。",
    "- 如果当前上下文没有明确提供可适用的法条，或你不能确定本地库是否收录该条，不得凭记忆引用。",
    `- 如果本地库中没有可适用的法律或条款，你必须原样输出以下提示，不得继续编造：\n  ${LAWBASE_MISSING_SENTINEL}`,
  ].join("\n")

  if (codes.length === 0) {
    return [
      header,
      "",
      "本地法条库当前为空。如果用户的问题涉及任何法律条款，请直接返回上述「库缺标识」，不要给出具体法律引用。",
    ].join("\n")
  }

  return [
    header,
    "",
    "注意：为避免请求体过大，这里不展开全部法规条文清单。需要精确引用时，应以应用检索到的本地法规库条文、案件上下文中明确给出的条文或生成后的引用校验结果为准。",
    "若没有把握，立即使用「库缺标识」。",
  ].join("\n")
}

export function buildRelevantLawArticlesSection(query: string, limit = 24): string {
  const hits = searchLaws(query, limit)
  if (hits.length === 0) {
    return [
      "## 本次检索到的本地法条",
      "未检索到与当前问题/章节直接相关的条文。",
      `如需进行法律适用论证，应输出：${LAWBASE_MISSING_SENTINEL}`,
    ].join("\n")
  }

  const lines = [
    "## 本次检索到的本地法条（只能引用本节列出的条文）",
    "以下条文来自本地法规库。本次回答/文书如需引用法条，只能引用这些条文；不得引用本节未列出的法律或条号。",
    "",
  ]
  const seen = new Set<string>()
  for (const hit of hits) {
    const key = `${hit.code.code}::${hit.article.number}`
    if (seen.has(key)) continue
    seen.add(key)
    const meta = [
      hit.code.hierarchyLevel || hit.code.officialCategory,
      hit.code.issuer,
      hit.code.sourceEffectiveDate || hit.code.effective ? `施行：${hit.code.sourceEffectiveDate || hit.code.effective}` : "",
    ].filter(Boolean).join("；")
    lines.push(`### 《${hit.code.code}》${hit.article.number}${meta ? `（${meta}）` : ""}`)
    lines.push(hit.article.content)
    lines.push("")
  }
  return lines.join("\n").slice(0, 24000)
}

/** LLM 输出中是否包含库缺标识。 */
export function detectMissingLawbaseSignal(text: string): boolean {
  if (!text) return false
  return text.includes(LAWBASE_MISSING_SENTINEL)
}

export function suggestMissingLawNames(text: string, limit = 6): string[] {
  if (!text.trim()) return []
  const existing = new Set(listCodes().map((code) => code.code))
  const suggestions: Array<{ name: string; score: number }> = []
  for (const item of COMMON_MISSING_LAW_HINTS) {
    if (existing.has(item.name)) continue
    let score = 0
    for (const pattern of item.patterns) {
      if (pattern.test(text)) score += 1
    }
    if (score > 0) suggestions.push({ name: item.name, score })
  }
  suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return suggestions.slice(0, limit).map((item) => item.name)
}
