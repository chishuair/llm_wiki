export type TranscriptCaseType = "刑事" | "民事" | "行政"
export type TranscriptSubtypeId = string

export type TranscriptSpeakerRole =
  | "审判长"
  | "审判员"
  | "书记员"
  | "公诉人"
  | "辩护人"
  | "原告"
  | "被告"
  | "第三人"
  | "被告人"
  | "上诉人"
  | "被上诉人"
  | "原审原告"
  | "原审被告"
  | "行政机关"
  | "代理人"
  | "证人"
  | "鉴定人"
  | "其他"

export type TranscriptPhase =
  | "身份查明"
  | "权利义务告知"
  | "诉辩意见"
  | "举证质证"
  | "法庭辩论"
  | "争议焦点"
  | "最后陈述"
  | "程序事项"
  | "其他"

export interface TranscriptSegment {
  id: string
  phase: TranscriptPhase
  speakerRole: TranscriptSpeakerRole
  summary: string
  sourceExcerpt: string
  procedural: boolean
  confidence: number
  sourceChunk: number
}

export interface TranscriptInsight {
  id: string
  title: string
  summary: string
  supportSegmentIds: string[]
}

export interface TranscriptElementValue {
  id: string
  label: string
  description: string
  status: "已明确" | "有争议" | "待补证"
  summary: string
  supportSegmentIds: string[]
}

export interface TranscriptMergeMeta {
  merged: boolean
  sourcePaths: string[]
  note?: string
  conflictNotes?: string[]
}

export interface HearingTranscriptData {
  version: 1
  sourceHash: string
  overview: string
  caseSubtypeId?: TranscriptSubtypeId
  caseSubtypeLabel?: string
  segments: TranscriptSegment[]
  keyElements: TranscriptElementValue[]
  issues: TranscriptInsight[]
  evidenceOpinions: TranscriptInsight[]
  argumentPoints: TranscriptInsight[]
  proceduralNotes: string[]
  mergeMeta?: TranscriptMergeMeta
}

export interface HearingTranscriptFrontmatter {
  type: "hearing-transcript"
  title: string
  caseType: TranscriptCaseType
  caseSubtypeId?: TranscriptSubtypeId
  caseSubtypeLabel?: string
  sessionDate?: string
  sessionIndex?: number
  sourcePath?: string
  dataPath: string
  updated: string
}

export interface TranscriptRecord {
  frontmatter: HearingTranscriptFrontmatter
  body: string
  data: HearingTranscriptData
  markdownPath: string
}

export const TRANSCRIPT_PHASES: TranscriptPhase[] = [
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

export const TRANSCRIPT_CASE_TYPES: TranscriptCaseType[] = ["刑事", "民事", "行政"]

export const TRANSCRIPT_SPEAKER_ROLES: TranscriptSpeakerRole[] = [
  "审判长",
  "审判员",
  "书记员",
  "公诉人",
  "辩护人",
  "原告",
  "被告",
  "第三人",
  "被告人",
  "上诉人",
  "被上诉人",
  "原审原告",
  "原审被告",
  "行政机关",
  "代理人",
  "证人",
  "鉴定人",
  "其他",
]
