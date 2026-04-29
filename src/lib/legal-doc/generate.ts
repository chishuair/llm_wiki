import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { buildLawbasePromptSection, buildRelevantLawArticlesSection, detectMissingLawbaseSignal, suggestMissingLawNames } from "@/lib/lawbase/prompt"
import { validateCitations } from "@/lib/lawbase/citations"
import { buildSectionWorksheetContext } from "@/lib/legal-doc/worksheet-mapping"
import type {
  CaseContext,
  GeneratedDocument,
  GeneratedSection,
  LegalDocSection,
  LegalDocTemplate,
} from "@/types/legal-doc"

/**
 * 文书生成管线：
 *
 * 每个章节单独调一次 LLM，避免把整份案件丢进单一巨 prompt；
 * 每次调用都带上「法条库硬约束」片段，确保引用不会超出本地法条库；
 * 生成失败时保留空内容，由法官在预览中手动补全。
 */

export interface GenerateOptions {
  template: LegalDocTemplate
  caseContext: CaseContext
  llmConfig: LlmConfig
  onSectionStart?: (sectionId: string) => void
  onSectionToken?: (sectionId: string, token: string) => void
  onSectionDone?: (section: GeneratedSection) => void
  signal?: AbortSignal
}

export async function generateLegalDocument(
  opts: GenerateOptions
): Promise<GeneratedDocument> {
  const { template, caseContext, llmConfig, signal } = opts
  const sections: GeneratedSection[] = []

  for (const section of template.sections) {
    opts.onSectionStart?.(section.id)
    const rawContent = await renderSection(section, caseContext, llmConfig, opts, signal)
    const annotation = section.kind === "llm" ? buildCitationAnnotation(rawContent) : null
    const content = annotation ? annotation.content : rawContent
    const g: GeneratedSection = {
      id: section.id,
      heading: section.heading,
      content,
      source: section.kind,
      citedLawLines: annotation?.citedLawLines,
      contextSummary: annotation?.contextSummary,
    }
    sections.push(g)
    opts.onSectionDone?.(g)
  }

  const title = template.heading ?? template.name

  return {
    template,
    caseContext,
    title,
    sections,
    generatedAt: new Date().toISOString(),
  }
}

async function renderSection(
  section: LegalDocSection,
  ctx: CaseContext,
  llmConfig: LlmConfig,
  opts: GenerateOptions,
  signal?: AbortSignal
): Promise<string> {
  if (section.kind === "static") {
    return interpolate(section.template ?? "", ctx)
  }
  if (section.kind === "case-field") {
    const value = section.source ? (ctx[section.source] as string | undefined) : ""
    return value?.trim() ? value : "（知识库中暂无相应内容）"
  }
  // llm
  return await generateSectionWithLlm(section, ctx, llmConfig, opts, signal)
}

function interpolate(template: string, ctx: CaseContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = (ctx as unknown as Record<string, string>)[key]
    return value ? value : `（请填写 ${key}）`
  })
}

async function generateSectionWithLlm(
  section: LegalDocSection,
  ctx: CaseContext,
  llmConfig: LlmConfig,
  opts: GenerateOptions,
  signal?: AbortSignal
): Promise<string> {
  const lawbaseGuard = buildLawbasePromptSection()
  const caseDump = buildCaseDump(ctx, section)
  const worksheetContext = buildSectionWorksheetContext(section, ctx.hearing_worksheet)
  const relevantLawContext = buildRelevantLawArticlesSection([
    section.heading,
    section.prompt ?? "",
    worksheetContext,
    ctx.disputes,
    ctx.facts,
    ctx.evidence_list,
    ctx.hearing_worksheet,
  ].join("\n"), 30)

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: lawbaseGuard,
    },
    {
      role: "system",
      content: [
        "你是一名协助法官撰写法律文书的助手。在每一次输出前必须做到以下几点：",
        "",
        "## 第一优先：综合全部案件材料",
        "- 如案件已生成“开庭工作单”，必须优先吸收其中的庭审提纲、关键要素状态、发问建议、补证建议与工作清单。",
        "- 对当前待生成章节，应优先使用下方“章节优先参考的开庭工作单内容”，只吸收与本章节相关的部分。",
        "- 必须通读下方「案件材料」下的所有内容，包括 raw/sources/ 中的全部原始文件正文。",
        "- 若案件已有“庭审笔录整理”结果，应优先吸收其中的争议焦点、质证意见、辩论要点与多次庭审脉络。",
        "- 判决、认定、说理所依据的事实 / 证据 / 当事人陈述都必须能在这些材料中找到出处。",
        "- 涉及关键事实或数据时，务必保持与原件一致（金额、日期、条款编号等）。",
        "- 不得使用未出现在这些材料里的当事人姓名、时间、金额、标的物或主张。",
        "",
        "## 第二优先：严格按本地法条库引用",
        "- 所有法律引用必须落在下方「本次检索到的本地法条」中，包括但不限于法律名、条号、条文含义。",
        "- 一旦库里缺少可适用的条款，严格按约束输出库缺标识，并停止输出该段的法律结论。",
        "- 不得凭语言模型记忆引用任何外部法律条文。",
        "",
        "## 文风与格式",
        "- 文风庄重、简练、客观，符合最高人民法院裁判文书书写规范。",
        "- 段落之间用自然换行即可，不要加 Markdown 标记或代码块。",
        "- 不要自行加章节标题（调用方已按模板提供）。",
        "- 直接输出该节的正文即可，不要先重复写作要点。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `## 当前待生成章节：${section.heading}`,
        "",
        "## 写作要点（来自模板）",
        section.prompt ?? "按惯例写作。",
        "",
        "## 章节优先参考的开庭工作单内容",
        worksheetContext || "（当前章节没有单独映射到开庭工作单内容）",
        "",
        relevantLawContext,
        "",
        "## 案件材料",
        caseDump,
      ].join("\n"),
    },
  ]

  let buffer = ""
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (token) => {
        buffer += token
        opts.onSectionToken?.(section.id, token)
      },
      onDone: () => {},
      onError: () => {
        // 保留已生成的部分内容，由调用方决定是否重试
      },
    },
    signal,
    { temperature: 0.2 }
  )

  return buffer.trim()
}

/**
 * 对 LLM 生成的章节做引用校验与附注：
 * - 从正文中抽出所有《X》第N条；
 * - 对命中法条库的引用，统一去重后在段末加一段「引用依据」附注；
 * - 对缺失引用不改动正文（UI 顶部已经横幅提示）。
 *
 * 返回新的文本。若不存在任何引用则原样返回。
 */
function buildCitationAnnotation(text: string): { content: string; citedLawLines: string[]; contextSummary: string; suggestedMissingLawNames?: string[] } | null {
  if (!text) return null
  if (detectMissingLawbaseSignal(text)) {
    return {
      content: text,
      citedLawLines: [],
      contextSummary: "本节未检索到可直接适用的本地法条，模型已返回法规缺失提示。",
      suggestedMissingLawNames: suggestMissingLawNames(text),
    }
  }
  const validations = validateCitations(text)
  if (validations.length === 0) {
    return {
      content: text,
      citedLawLines: [],
      contextSummary: "本节未出现明确法条引用；上下文已按章节预算裁剪并注入。",
    }
  }
  const seen = new Set<string>()
  const validHits = validations.filter((c) => {
    if (!c.valid || !c.article || !c.code) return false
    const key = `${c.code.code}|${c.article.number}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const invalidHits = validations.filter((c) => !c.valid)
  const citedLawLines = validHits.map((hit) => `《${hit.code?.aliases?.[0] ?? hit.code?.code}》${hit.article?.number}`)
  if (validHits.length === 0) {
    return {
      content: text,
      citedLawLines: [],
      contextSummary: `本节出现 ${invalidHits.length} 处未命中本地法规库的引用，请人工复核。`,
      suggestedMissingLawNames: suggestMissingLawNames(text),
    }
  }
  const lines = ["", "——引用依据——"]
  for (const hit of validHits) {
    if (!hit.code || !hit.article) continue
    lines.push(`《${hit.code.aliases?.[0] ?? hit.code.code}》${hit.article.number}：${hit.article.content}`)
  }
  return {
    content: `${text.trimEnd()}\n${lines.join("\n")}`,
    citedLawLines,
    contextSummary: `本节已校验通过 ${validHits.length} 处法条引用；${invalidHits.length} 处未命中引用需人工复核。`,
    suggestedMissingLawNames: invalidHits.length > 0 ? suggestMissingLawNames(text) : [],
  }
}

function buildCaseDump(ctx: CaseContext, section: LegalDocSection): string {
  const STRUCTURED_SECTION_BUDGET = 22000
  const RAW_SECTION_BUDGET = 18000
  const PER_ENTRY_BUDGET = 2800
  const PER_RAW_FILE_BUDGET = 4200

  const sectionQuery = [
    section.heading,
    section.prompt ?? "",
  ].join("\n")

  const entries: Array<[string, string]> = [
    ["案件名称", ctx.projectName],
    ["案号（若为空由法官在预览中补全）", ctx.case_number],
    ["受诉法院", ctx.court_name],
    ["案情概述", ctx.case_overview],
    ["当事人信息", ctx.parties],
    ["审理过程", ctx.procedure_log],
    ["开庭工作单（优先参考）", ctx.hearing_worksheet],
    ["庭审笔录整理", ctx.hearing_transcripts],
    ["证据清单", ctx.evidence_list],
    ["争议焦点", ctx.disputes],
    ["法院认定事实", ctx.facts],
    ["本院认为（法官已有的思路）", ctx.reasoning],
    ["判决结果（法官已有的要点）", ctx.judgment],
  ]

  let structuredUsed = 0
  const structuredBlocks: string[] = []
  for (const [label, value] of entries) {
    const text = (value || "（知识库中暂无）").trim()
    if (!text) continue
    const clipped = text.length > PER_ENTRY_BUDGET ? `${text.slice(0, PER_ENTRY_BUDGET)}\n（本节上下文已裁剪）` : text
    const block = `### ${label}\n${clipped}`
    if (structuredUsed + block.length > STRUCTURED_SECTION_BUDGET) break
    structuredBlocks.push(block)
    structuredUsed += block.length
  }
  const structured = structuredBlocks.join("\n\n")

  if (!ctx.raw_sources || ctx.raw_sources.length === 0) {
    return structured + "\n\n### raw/sources 原始材料\n（案件无原始材料）"
  }

  const rankedRaw = rankRawSourcesForSection(ctx.raw_sources, sectionQuery)
  const rawLines: string[] = [
    "### raw/sources 原始材料（法官上传的原件）",
    `共 ${ctx.raw_sources.length} 份文件。当前仅注入与本章节最相关的部分材料，避免超出模型请求体限制。`,
    "",
  ]

  let rawUsed = 0
  let included = 0
  for (const file of rankedRaw) {
    const useSummary = file.needsSummary && file.summary
    const content = useSummary ? (file.summary as string) : file.text
    const clipped = content.length > PER_RAW_FILE_BUDGET ? `${content.slice(0, PER_RAW_FILE_BUDGET)}\n（该材料在本章节中已裁剪）` : content
    const block = `#### 文件：${file.relativePath}（${useSummary ? "提要" : "全文"}，原文 ${file.size.toLocaleString()} 字）\n${clipped}\n`
    if (rawUsed + block.length > RAW_SECTION_BUDGET) break
    rawLines.push(block)
    rawUsed += block.length
    included += 1
  }
  if (included < rankedRaw.length) {
    rawLines.push(`（其余 ${rankedRaw.length - included} 份材料未纳入本章节上下文，可在其他章节或重新生成时继续参考。）`)
  }
  return `${structured}\n\n${rawLines.join("\n")}`
}

function rankRawSourcesForSection(files: CaseContext["raw_sources"], query: string): CaseContext["raw_sources"] {
  const tokens = extractBudgetTokens(query)
  return [...files].sort((a, b) => scoreRawForSection(b, tokens) - scoreRawForSection(a, tokens))
}

function extractBudgetTokens(text: string): string[] {
  const normalized = text.toLowerCase()
  const zh = normalized.match(/[\u4e00-\u9fff]{2,8}/g) ?? []
  const en = normalized.match(/[a-z]{3,}/g) ?? []
  return [...new Set([...zh, ...en])].slice(0, 24)
}

function scoreRawForSection(file: CaseContext["raw_sources"][number], tokens: string[]): number {
  const haystack = `${file.name}\n${file.summary ?? ""}\n${file.text.slice(0, 6000)}`.toLowerCase()
  let score = file.needsSummary && file.summary ? 20 : 10
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 4 ? 8 : 4
  }
  // 稍微优先更短的材料，便于装入预算
  if (file.size < 6000) score += 5
  return score
}
