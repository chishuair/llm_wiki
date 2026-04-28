import { preprocessFile, readFile } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { getFileCategory } from "@/lib/file-types"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  HearingTranscriptData,
  TranscriptCaseType,
  TranscriptElementValue,
  TranscriptInsight,
  TranscriptSegment,
  TranscriptSpeakerRole,
  TranscriptPhase,
  TranscriptSubtypeId,
} from "@/types/transcript"
import { buildTranscriptAggregatePrompt, buildTranscriptChunkPrompt } from "./prompts"
import { getTranscriptSubtypeRule } from "./rules"
import { sourceHash } from "./storage"

const CHUNK_SIZE = 3600
const CHUNK_OVERLAP = 160

interface RawChunkResult {
  segments: Array<{
    phase?: string
    speakerRole?: string
    summary?: string
    sourceExcerpt?: string
    procedural?: boolean
    confidence?: number
  }>
}

interface AggregateResult {
  overview?: string
  keyElements?: Array<{ id?: string; label?: string; description?: string; status?: string; summary?: string; supportSegmentIds?: string[] }>
  issues?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  evidenceOpinions?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  argumentPoints?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  proceduralNotes?: string[]
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let index = 0
  while (index < text.length) {
    const end = Math.min(text.length, index + CHUNK_SIZE)
    chunks.push(text.slice(index, end))
    if (end === text.length) break
    index = end - CHUNK_OVERLAP
  }
  return chunks
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

function parseJson<T>(raw: string): T {
  return JSON.parse(extractJsonObject(raw)) as T
}

function normalizePhase(phase?: string): TranscriptPhase {
  const normalized = (phase || "").trim()
  const valid: TranscriptPhase[] = [
    "身份查明",
    "权利义务告知",
    "诉辩意见",
    "举证质证",
    "法庭辩论",
    "争议焦点",
    "最后陈述",
    "程序事项",
    "其他",
  ]
  return valid.includes(normalized as TranscriptPhase) ? (normalized as TranscriptPhase) : "其他"
}

function normalizeSpeakerRole(role?: string): TranscriptSpeakerRole {
  const normalized = (role || "").trim()
  const valid: TranscriptSpeakerRole[] = [
    "审判长", "审判员", "书记员", "公诉人", "辩护人", "原告", "被告", "第三人",
    "被告人", "上诉人", "被上诉人", "原审原告", "原审被告", "行政机关", "代理人",
    "证人", "鉴定人", "其他",
  ]
  return valid.includes(normalized as TranscriptSpeakerRole) ? (normalized as TranscriptSpeakerRole) : "其他"
}

function normalizeInsights(items: AggregateResult["issues"]): TranscriptInsight[] {
  return (items || [])
    .map((item, index) => ({
      id: `insight-${index + 1}`,
      title: item.title?.trim() || `要点 ${index + 1}`,
      summary: item.summary?.trim() || "",
      supportSegmentIds: Array.isArray(item.supportSegmentIds) ? item.supportSegmentIds.filter(Boolean) : [],
    }))
    .filter((item) => item.summary)
}

function normalizeElements(items: AggregateResult["keyElements"]): TranscriptElementValue[] {
  return (items || [])
    .map((item, index) => ({
      id: item.id?.trim() || `element-${index + 1}`,
      label: item.label?.trim() || `要素 ${index + 1}`,
      description: item.description?.trim() || "",
      status: item.status === "已明确" || item.status === "有争议" || item.status === "待补证" ? item.status : "待补证",
      summary: item.summary?.trim() || "",
      supportSegmentIds: Array.isArray(item.supportSegmentIds) ? item.supportSegmentIds.filter(Boolean) : [],
    }))
    .filter((item) => item.summary)
}

async function runBufferedChat(
  llmConfig: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
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
    signal,
    { temperature: 0.1 }
  )
  return buffer.trim()
}

function fallbackSegment(chunk: string, chunkIndex: number): TranscriptSegment[] {
  const summary = chunk.replace(/\s+/g, " ").slice(0, 180).trim()
  if (!summary) return []
  return [
    {
      id: `seg-${chunkIndex + 1}-1`,
      phase: "其他",
      speakerRole: "其他",
      summary,
      sourceExcerpt: summary.slice(0, 120),
      procedural: false,
      confidence: 0.2,
      sourceChunk: chunkIndex,
    },
  ]
}

async function analyzeChunk(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  caseType: TranscriptCaseType,
  subtypeId: TranscriptSubtypeId | undefined,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<TranscriptSegment[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildTranscriptChunkPrompt(caseType, subtypeId, chunkIndex, totalChunks) },
    {
      role: "user",
      content: [`## 庭审笔录原文`, "", chunk].join("\n"),
    },
  ]

  try {
    const raw = await runBufferedChat(llmConfig, messages, signal)
    const parsed = parseJson<RawChunkResult>(raw)
    const segments = (parsed.segments || [])
      .map((segment, index) => ({
        id: `seg-${chunkIndex + 1}-${index + 1}`,
        phase: normalizePhase(segment.phase),
        speakerRole: normalizeSpeakerRole(segment.speakerRole),
        summary: segment.summary?.trim() || "",
        sourceExcerpt: segment.sourceExcerpt?.trim() || "",
        procedural: Boolean(segment.procedural),
        confidence: Math.max(0, Math.min(1, Number(segment.confidence ?? 0.5))),
        sourceChunk: chunkIndex,
      }))
      .filter((segment) => segment.summary)

    return segments.length > 0 ? segments : fallbackSegment(chunk, chunkIndex)
  } catch {
    return fallbackSegment(chunk, chunkIndex)
  }
}

function fallbackAggregate(segments: TranscriptSegment[]): HearingTranscriptData {
  const issues = segments
    .filter((segment) => segment.phase === "争议焦点" || segment.phase === "诉辩意见")
    .slice(0, 5)
    .map((segment, index) => ({
      id: `issue-${index + 1}`,
      title: `${segment.phase}要点 ${index + 1}`,
      summary: segment.summary,
      supportSegmentIds: [segment.id],
    }))

  const evidenceOpinions = segments
    .filter((segment) => segment.phase === "举证质证")
    .slice(0, 5)
    .map((segment, index) => ({
      id: `evidence-${index + 1}`,
      title: `质证意见 ${index + 1}`,
      summary: segment.summary,
      supportSegmentIds: [segment.id],
    }))

  const argumentPoints = segments
    .filter((segment) => segment.phase === "法庭辩论")
    .slice(0, 5)
    .map((segment, index) => ({
      id: `argument-${index + 1}`,
      title: `辩论要点 ${index + 1}`,
      summary: segment.summary,
      supportSegmentIds: [segment.id],
    }))

  return {
    version: 1,
    sourceHash: "",
    overview: segments.slice(0, 6).map((segment) => `- [${segment.phase}] ${segment.summary}`).join("\n"),
    segments,
    keyElements: [],
    issues,
    evidenceOpinions,
    argumentPoints,
    proceduralNotes: segments.filter((segment) => segment.procedural).slice(0, 5).map((segment) => segment.summary),
  }
}

export async function readTranscriptSource(sourcePath: string): Promise<string> {
  const category = getFileCategory(sourcePath)
  if (category === "pdf" || category === "document") {
    return preprocessFile(sourcePath)
  }
  return readFile(sourcePath)
}

export async function analyzeTranscriptSource(args: {
  sourcePath: string
  caseType: TranscriptCaseType
  caseSubtypeId?: TranscriptSubtypeId
  llmConfig: LlmConfig
  signal?: AbortSignal
  onProgress?: (current: number, total: number) => void
}): Promise<HearingTranscriptData> {
  const rawText = (await readTranscriptSource(args.sourcePath)).trim()
  const subtype = getTranscriptSubtypeRule(args.caseType, args.caseSubtypeId)
  if (!rawText) {
    throw new Error("未能从笔录文件中提取到文本")
  }

  const chunks = chunkText(rawText)
  const segments: TranscriptSegment[] = []
  for (let index = 0; index < chunks.length; index++) {
    args.onProgress?.(index + 1, chunks.length)
    const chunkSegments = await analyzeChunk(
      chunks[index],
      index,
      chunks.length,
      args.caseType,
        args.caseSubtypeId,
      args.llmConfig,
      args.signal
    )
    segments.push(...chunkSegments)
  }

  let aggregate = fallbackAggregate(segments)
  aggregate.caseSubtypeId = args.caseSubtypeId
  aggregate.caseSubtypeLabel = subtype?.label
  try {
    const compactSegments = segments.map((segment) => ({
      id: segment.id,
      phase: segment.phase,
      speakerRole: segment.speakerRole,
      procedural: segment.procedural,
      summary: segment.summary,
      sourceExcerpt: segment.sourceExcerpt,
    }))
    const raw = await runBufferedChat(
      args.llmConfig,
      [
        {
          role: "system",
          content: buildTranscriptAggregatePrompt(
            args.caseType,
            args.caseSubtypeId,
            args.sourcePath.split("/").pop() || "庭审笔录"
          ),
        },
        {
          role: "user",
          content: JSON.stringify({ segments: compactSegments }, null, 2),
        },
      ],
      args.signal
    )
    const parsed = parseJson<AggregateResult>(raw)
    aggregate = {
      version: 1,
      sourceHash: "",
      overview: parsed.overview?.trim() || aggregate.overview,
      caseSubtypeId: args.caseSubtypeId,
      caseSubtypeLabel: subtype?.label,
      segments,
      keyElements: normalizeElements(parsed.keyElements),
      issues: normalizeInsights(parsed.issues).map((item, index) => ({ ...item, id: `issue-${index + 1}` })),
      evidenceOpinions: normalizeInsights(parsed.evidenceOpinions).map((item, index) => ({ ...item, id: `evidence-${index + 1}` })),
      argumentPoints: normalizeInsights(parsed.argumentPoints).map((item, index) => ({ ...item, id: `argument-${index + 1}` })),
      proceduralNotes: (parsed.proceduralNotes || []).map((item) => item.trim()).filter(Boolean),
    }
  } catch {
    // 使用规则回退结果
  }

  aggregate.sourceHash = sourceHash(rawText)
  aggregate.caseSubtypeId = args.caseSubtypeId
  aggregate.caseSubtypeLabel = subtype?.label
  return aggregate
}
