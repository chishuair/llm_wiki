import { preprocessFile, readFile } from "@/commands/fs"
import { getFileCategory } from "@/lib/file-types"
import { normalizePath } from "@/lib/path-utils"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { EvidenceItem, EvidenceParty, EvidenceReviewStatus } from "@/types/evidence"

export type MaterialKind = "transcript" | "evidence" | "other"

export interface MaterialClassification {
  kind: MaterialKind
  reason: string
}

export interface ExtractedEvidenceDraft {
  items: EvidenceItem[]
  note: string
}

function normalizeLegalText(text: string): string {
  return text
    .replace(/[ \t]+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[\r\n]+/g, "\n")
}

async function readSourceText(path: string): Promise<string> {
  const category = getFileCategory(path)
  if (category === "pdf" || category === "document" || category === "image") {
    return preprocessFile(path)
  }
  return readFile(path)
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

function extractJsonObject(raw: string): string {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型未返回有效 JSON")
  }
  return cleaned.slice(start, end + 1)
}

function heuristicClassify(name: string, text: string): MaterialClassification {
  const n = name.toLowerCase()
  const compact = normalizeLegalText(text)
  if (/笔录|庭审|询问|讯问|谈话|调查/.test(name) || /开庭审理|本案现已审理终结|经审理查明|法庭辩论|举证质证/.test(compact)) {
    return { kind: "transcript", reason: "命中庭审/笔录特征词" }
  }
  if (/证据|鉴定|病理|报告|发票|病历|合同|收据|聊天记录|转账|照片|截图/.test(name) || /证明|鉴定意见|病理诊断|检查报告|病历资料/.test(compact)) {
    return { kind: "evidence", reason: "命中证据/鉴定特征词" }
  }
  if (/\.(png|jpe?g|webp|bmp|tiff?|heic|heif)$/i.test(n)) {
    return { kind: "evidence", reason: "图片类材料默认归为证据原件" }
  }
  return { kind: "other", reason: "未命中明显特征词" }
}

export async function classifyMaterial(
  path: string,
  llmConfig: LlmConfig
): Promise<MaterialClassification> {
  const name = path.split("/").pop() || path
  let text = ""
  try {
    text = (await readSourceText(path)).slice(0, 6000)
  } catch {
    text = ""
  }
  const heuristic = heuristicClassify(name, text)
  if (heuristic.kind !== "other") return heuristic

  if (!(llmConfig.provider === "ollama" || llmConfig.provider === "custom" || llmConfig.apiKey)) {
    return heuristic
  }

  try {
    const prompt = [
      "你是一名法院材料分类助手。",
      "请把下列材料识别为：transcript（庭审/询问/讯问笔录类）、evidence（证据/鉴定/病历/票据/照片等）、other（其他）。",
      '只输出 JSON：{"kind":"transcript|evidence|other","reason":""}',
    ].join("\n")
    const raw = await runBufferedChat(llmConfig, [
      { role: "system", content: prompt },
      { role: "user", content: `文件名：${name}\n\n材料片段：\n${text || "（无可读文本）"}` },
    ])
    const parsed = JSON.parse(extractJsonObject(raw)) as { kind?: MaterialKind; reason?: string }
    const kind = parsed.kind === "transcript" || parsed.kind === "evidence" || parsed.kind === "other" ? parsed.kind : "other"
    return { kind, reason: parsed.reason?.trim() || "LLM 分类" }
  } catch {
    return heuristic
  }
}

interface RawEvidenceItem {
  name?: string
  submitter?: EvidenceParty
  kind?: string
  purpose?: string
  note?: string
}

export async function extractEvidenceDraftFromSources(args: {
  projectPath: string
  sourcePaths: string[]
  llmConfig: LlmConfig
}): Promise<ExtractedEvidenceDraft> {
  const snippets: Array<{ path: string; text: string }> = []
  for (const path of args.sourcePaths) {
    try {
      const text = await readSourceText(path)
      if (text.trim()) snippets.push({ path, text: text.slice(0, 10000) })
    } catch {
      // ignore
    }
  }

  if (snippets.length === 0) {
    return { items: [], note: "未从原始材料中提取到可分析文本。" }
  }

  const prompt = [
    "你是一名法院证据整理助手。",
    "请根据原始材料，提炼出适合录入证据清单的证据条目。",
    "每条证据应尽量对应一个可独立审查的证据或证据组。",
    '只输出 JSON：{"items":[{"name":"","submitter":"原告|被告|第三人|法院调取|其他","kind":"","purpose":"","note":""}],"note":""}',
    "不要编造不存在的证据编号、证明目的或主体；无法确定时可留空或填“其他”。",
  ].join("\n")

  try {
    const raw = await runBufferedChat(args.llmConfig, [
      { role: "system", content: prompt },
      {
        role: "user",
        content: snippets.map((item) => `### 文件：${item.path.replace(`${normalizePath(args.projectPath)}/`, "")}\n${item.text}`).join("\n\n"),
      },
    ])
    const parsed = JSON.parse(extractJsonObject(raw)) as { items?: RawEvidenceItem[]; note?: string }
    const items = (parsed.items || []).map((item, index) => {
      const submitter: EvidenceParty =
        item.submitter === "原告" || item.submitter === "被告" || item.submitter === "第三人" || item.submitter === "法院调取"
          ? item.submitter
          : "其他"
      const pending: EvidenceReviewStatus = "待定"
      return {
        id: `自动证据${index + 1}`,
        name: item.name?.trim() || `自动提炼证据${index + 1}`,
        submitter,
        kind: item.kind?.trim() || "",
        purpose: item.purpose?.trim() || "",
        authenticity: pending,
        legality: pending,
        relevance: pending,
        admitted: false,
        note: item.note?.trim() || "由大模型根据原始材料自动提炼，需人工核对。",
        sourcePath: snippets[index]?.path.replace(`${normalizePath(args.projectPath)}/`, "") || undefined,
      } satisfies EvidenceItem
    })
    return {
      items,
      note: parsed.note?.trim() || `已从 ${snippets.length} 份材料中自动提炼证据草稿。`,
    }
  } catch (error) {
    return {
      items: [],
      note: `自动提炼证据失败：${String(error)}`,
    }
  }
}
