import { listDirectory, preprocessFile, readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import type { CaseMeta } from "@/lib/case-meta"

type CaseMetaField =
  | "caseName"
  | "caseNumber"
  | "cause"
  | "caseType"
  | "subtype"
  | "courtName"
  | "presidingJudge"
  | "clerk"
  | "procedureStage"
  | "nextHearingAt"

export interface CaseMetaSuggestion {
  values: Partial<CaseMeta>
  sourceHints: Partial<Record<CaseMetaField, string>>
  candidates: Partial<Record<CaseMetaField, Array<{ value: string; source: string }>>>
  conflicts: CaseMetaField[]
  note?: string
}

function uniqueCandidates(items: Array<{ value: string; source: string }>): Array<{ value: string; source: string }> {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function flatten(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flatten(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

function scoreFile(name: string): number {
  const n = name.toLowerCase()
  if (/[起诉状|答辩状|立案|受理|传票|开庭|判决|裁定|笔录]/.test(name)) return 100
  if (n.endsWith(".pdf") || n.endsWith(".doc") || n.endsWith(".docx")) return 60
  return 20
}

function detectCaseType(text: string): CaseMeta["caseType"] | "" {
  if (/刑事|公诉机关|被告人|罪/.test(text)) return "刑事"
  if (/行政机关|行政行为|行政处罚|行政诉讼/.test(text)) return "行政"
  if (/执行|申请执行人|被执行人/.test(text)) return "执行"
  if (/原告|被告|第三人|民事/.test(text)) return "民事"
  return ""
}

function detectSubtype(text: string): string {
  const candidates = [
    "民间借贷纠纷",
    "买卖合同纠纷",
    "离婚纠纷",
    "医疗损害责任纠纷",
    "劳动争议",
    "机动车交通事故责任纠纷",
    "物业服务合同纠纷",
    "保证保险合同纠纷",
  ]
  return candidates.find((item) => text.includes(item)) || ""
}

function detectCause(text: string): string {
  const subtype = detectSubtype(text)
  if (subtype) return subtype
  const match = text.match(/案由[：:\s]*([^\n，。；]{2,40})/)
  return match?.[1]?.trim() || ""
}

function extractCaseNumber(text: string): string {
  const patterns = [
    /（\d{4}）[^ \n]{0,20}(?:民初|民终|刑初|刑终|行初|行终|执)[^ \n，。；]{0,20}号/,
    /\(\d{4}\)[^ \n]{0,20}(?:民初|民终|刑初|刑终|行初|行终|执)[^ \n，。；]{0,20}号/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[0]) return match[0]
  }
  return ""
}

function extractCourtName(text: string): string {
  const match = text.match(/[^\s，。；]{2,30}人民法院/)
  return match?.[0]?.trim() || ""
}

function clip(text: string, max = 5000): string {
  return text.length > max ? text.slice(0, max) : text
}

function extractJsonObject(raw: string): string {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) throw new Error("模型未返回有效 JSON")
  return cleaned.slice(start, end + 1)
}

async function runBufferedChat(llmConfig: LlmConfig, messages: ChatMessage[]): Promise<string> {
  let buffer = ""
  await streamChat(
    llmConfig,
    messages,
    {
      onToken: (token) => {
        buffer += token
      },
      onDone: () => {},
      onError: () => {},
    },
    undefined,
    { temperature: 0.1 }
  )
  return buffer.trim()
}

function hasUsableLlm(llmConfig: LlmConfig): boolean {
  return llmConfig.provider === "ollama" || llmConfig.provider === "custom" || Boolean(llmConfig.apiKey)
}

export async function extractCaseMetaSuggestion(
  projectPath: string,
  llmConfig: LlmConfig,
  fallbackCaseName: string
): Promise<CaseMetaSuggestion> {
  const root = normalizePath(projectPath)
  const tree = await listDirectory(`${root}/raw/sources`).catch(() => [] as FileNode[])
  const files = flatten(tree)
    .filter((file) => !file.name.startsWith(".") && !file.path.includes("/.cache/"))
    .sort((a, b) => scoreFile(b.name) - scoreFile(a.name))
    .slice(0, 5)

  const snippets: Array<{ name: string; text: string }> = []
  for (const file of files) {
    try {
      const text = file.name.endsWith(".pdf") || file.name.endsWith(".doc") || file.name.endsWith(".docx")
        ? await preprocessFile(file.path)
        : await readFile(file.path)
      const normalized = (text || "").trim()
      if (normalized) snippets.push({ name: file.name, text: clip(normalized) })
    } catch {
      // ignore
    }
  }

  const combined = snippets.map((item) => `### 来源文件：${item.name}\n${item.text}`).join("\n\n")
  const seedText = combined || fallbackCaseName

  const values: Partial<CaseMeta> = {
    caseName: fallbackCaseName,
    caseNumber: extractCaseNumber(seedText),
    courtName: extractCourtName(seedText),
    cause: detectCause(seedText),
    caseType: detectCaseType(seedText) || undefined,
    subtype: detectSubtype(seedText),
  }

  const firstSource = snippets[0]?.name
  const sourceHints: Partial<Record<CaseMetaField, string>> = {}
  const candidates: Partial<Record<CaseMetaField, Array<{ value: string; source: string }>>> = {}
  if (values.caseNumber && firstSource) sourceHints.caseNumber = firstSource
  if (values.courtName && firstSource) sourceHints.courtName = firstSource
  if (values.cause && firstSource) sourceHints.cause = firstSource
  if (values.caseType && firstSource) sourceHints.caseType = firstSource
  if (values.subtype && firstSource) sourceHints.subtype = firstSource
  if (values.caseNumber && firstSource) candidates.caseNumber = [{ value: values.caseNumber, source: firstSource }]
  if (values.courtName && firstSource) candidates.courtName = [{ value: values.courtName, source: firstSource }]
  if (values.cause && firstSource) candidates.cause = [{ value: values.cause, source: firstSource }]
  if (values.caseType && firstSource) candidates.caseType = [{ value: values.caseType, source: firstSource }]
  if (values.subtype && firstSource) candidates.subtype = [{ value: values.subtype, source: firstSource }]

  if (!hasUsableLlm(llmConfig) || !combined) {
    const conflicts = (Object.entries(candidates) as Array<[CaseMetaField, Array<{ value: string; source: string }>]>)
      .filter(([, items]) => uniqueCandidates(items).length > 1)
      .map(([field]) => field)
    return {
      values,
      sourceHints,
      candidates,
      conflicts,
      note: combined ? "已根据原始材料关键词进行基础识别，请人工确认。" : "当前没有可识别的原始材料，请先导入案件材料。",
    }
  }

  try {
    const prompt = [
      "你是一名法院案件材料整理助手。",
      "请从下列材料片段中识别案件主数据，并输出 JSON 对象。",
      "只可依据材料原文，不可编造。",
      'JSON 结构固定为：{"caseName":"","caseNumber":"","cause":"","caseType":"","subtype":"","courtName":"","presidingJudge":"","clerk":"","procedureStage":"","nextHearingAt":"","sourceHints":{}}。',
      "sourceHints 中每个字段填写最主要的来源文件名。",
      "caseType 只能填写：民事、刑事、行政、执行、其他。",
      "如果某字段无法确定，保留空字符串。",
    ].join("\n")
    const raw = await runBufferedChat(llmConfig, [
      { role: "system", content: prompt },
      { role: "user", content: combined },
    ])
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<CaseMeta> & {
      sourceHints?: Partial<Record<CaseMetaField, string>>
    }
    const mergedCandidates = { ...candidates }
    const maybePush = (field: CaseMetaField, value: string | undefined, source = "LLM 综合识别") => {
      const v = value?.trim()
      if (!v) return
      mergedCandidates[field] = uniqueCandidates([...(mergedCandidates[field] || []), { value: v, source }])
    }
    maybePush("caseName", parsed.caseName)
    maybePush("caseNumber", parsed.caseNumber)
    maybePush("cause", parsed.cause)
    maybePush("caseType", parsed.caseType)
    maybePush("subtype", parsed.subtype)
    maybePush("courtName", parsed.courtName)
    maybePush("presidingJudge", parsed.presidingJudge)
    maybePush("clerk", parsed.clerk)
    maybePush("procedureStage", parsed.procedureStage)
    maybePush("nextHearingAt", parsed.nextHearingAt)
    const merged: Partial<CaseMeta> = {
      ...values,
      caseName: parsed.caseName?.trim() || values.caseName,
      caseNumber: parsed.caseNumber?.trim() || values.caseNumber,
      cause: parsed.cause?.trim() || values.cause,
      caseType: (parsed.caseType?.trim() as CaseMeta["caseType"]) || values.caseType,
      subtype: parsed.subtype?.trim() || values.subtype,
      courtName: parsed.courtName?.trim() || values.courtName,
      presidingJudge: parsed.presidingJudge?.trim() || "",
      clerk: parsed.clerk?.trim() || "",
      procedureStage: parsed.procedureStage?.trim() || "",
      nextHearingAt: parsed.nextHearingAt?.trim() || "",
    }
    const conflicts = (Object.entries(mergedCandidates) as Array<[CaseMetaField, Array<{ value: string; source: string }>]>)
      .filter(([, items]) => uniqueCandidates(items).length > 1)
      .map(([field]) => field)
    return {
      values: merged,
      sourceHints: { ...sourceHints, ...(parsed.sourceHints || {}) },
      candidates: mergedCandidates,
      conflicts,
      note: conflicts.length > 0 ? "已识别到多个候选值，请逐项确认后保存。" : "已结合原始材料内容自动识别，请人工确认后保存。",
    }
  } catch {
    const conflicts = (Object.entries(candidates) as Array<[CaseMetaField, Array<{ value: string; source: string }>]>)
      .filter(([, items]) => uniqueCandidates(items).length > 1)
      .map(([field]) => field)
    return {
      values,
      sourceHints,
      candidates,
      conflicts,
      note: "已根据原始材料关键词进行基础识别，请人工确认。",
    }
  }
}
