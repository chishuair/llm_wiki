import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type {
  HearingTranscriptData,
  TranscriptCaseType,
  TranscriptInsight,
  TranscriptRecord,
  TranscriptSubtypeId,
} from "@/types/transcript"
import { buildTranscriptMergePrompt } from "./prompts"

interface MergePromptResult {
  overview?: string
  issues?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  evidenceOpinions?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  argumentPoints?: Array<{ title?: string; summary?: string; supportSegmentIds?: string[] }>
  proceduralNotes?: string[]
  mergeMeta?: {
    note?: string
    conflictNotes?: string[]
  }
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

function normalizeInsights(
  prefix: string,
  items: MergePromptResult["issues"],
  fallback: TranscriptInsight[]
): TranscriptInsight[] {
  const normalized = (items || [])
    .map((item, index) => ({
      id: `${prefix}-${index + 1}`,
      title: item.title?.trim() || `${prefix}-${index + 1}`,
      summary: item.summary?.trim() || "",
      supportSegmentIds: Array.isArray(item.supportSegmentIds) ? item.supportSegmentIds.filter(Boolean) : [],
    }))
    .filter((item) => item.summary)
  return normalized.length > 0 ? normalized : fallback
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

function fallbackMergedData(records: TranscriptRecord[]): HearingTranscriptData {
  const allSegments = records.flatMap((record) => record.data.segments)
  const overview = records
    .map((record, index) => `第 ${index + 1} 份：${record.frontmatter.title}\n${record.data.overview}`)
    .join("\n\n")
  const subtypeId = records[0]?.frontmatter.caseSubtypeId
  const subtypeLabel = records[0]?.frontmatter.caseSubtypeLabel

  return {
    version: 1,
    sourceHash: records.map((record) => record.data.sourceHash).join("|"),
    overview,
    caseSubtypeId: subtypeId,
    caseSubtypeLabel: subtypeLabel,
    segments: allSegments,
    keyElements: records.flatMap((record) => record.data.keyElements).slice(0, 8),
    issues: records.flatMap((record) => record.data.issues).slice(0, 8),
    evidenceOpinions: records.flatMap((record) => record.data.evidenceOpinions).slice(0, 8),
    argumentPoints: records.flatMap((record) => record.data.argumentPoints).slice(0, 8),
    proceduralNotes: records.flatMap((record) => record.data.proceduralNotes).slice(0, 8),
    mergeMeta: {
      merged: true,
      sourcePaths: records.map((record) => record.markdownPath),
      note: `已合并 ${records.length} 份庭审笔录整理稿`,
      conflictNotes: [],
    },
  }
}

export async function mergeTranscriptRecords(args: {
  records: TranscriptRecord[]
  caseType: TranscriptCaseType
  caseSubtypeId?: TranscriptSubtypeId
  caseSubtypeLabel?: string
  llmConfig: LlmConfig
  signal?: AbortSignal
}): Promise<HearingTranscriptData> {
  const { records, caseType, llmConfig, signal } = args
  const fallback = fallbackMergedData(records)
  try {
    const raw = await runBufferedChat(
      llmConfig,
      [
        { role: "system", content: buildTranscriptMergePrompt(caseType, args.caseSubtypeId, records.length) },
        {
          role: "user",
          content: JSON.stringify(
            records.map((record) => ({
              title: record.frontmatter.title,
              sourcePath: record.frontmatter.sourcePath || record.markdownPath,
              overview: record.data.overview,
              keyElements: record.data.keyElements,
              issues: record.data.issues,
              evidenceOpinions: record.data.evidenceOpinions,
              argumentPoints: record.data.argumentPoints,
              proceduralNotes: record.data.proceduralNotes,
            })),
            null,
            2
          ),
        },
      ],
      signal
    )
    const parsed = JSON.parse(extractJsonObject(raw)) as MergePromptResult
    return {
      version: 1,
      sourceHash: fallback.sourceHash,
      overview: parsed.overview?.trim() || fallback.overview,
      caseSubtypeId: args.caseSubtypeId ?? fallback.caseSubtypeId,
      caseSubtypeLabel: args.caseSubtypeLabel ?? fallback.caseSubtypeLabel,
      segments: fallback.segments,
      keyElements: fallback.keyElements,
      issues: normalizeInsights("merge-issue", parsed.issues, fallback.issues),
      evidenceOpinions: normalizeInsights("merge-evidence", parsed.evidenceOpinions, fallback.evidenceOpinions),
      argumentPoints: normalizeInsights("merge-argument", parsed.argumentPoints, fallback.argumentPoints),
      proceduralNotes: (parsed.proceduralNotes || []).map((item) => item.trim()).filter(Boolean),
      mergeMeta: {
        merged: true,
        sourcePaths: records.map((record) => record.markdownPath),
        note: parsed.mergeMeta?.note?.trim() || fallback.mergeMeta?.note,
        conflictNotes: (parsed.mergeMeta?.conflictNotes || []).map((item) => item.trim()).filter(Boolean),
      },
    }
  } catch {
    return fallback
  }
}
