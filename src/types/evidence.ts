/**
 * Structured evidence entry stored inside a "type: evidence-list" page's
 * YAML frontmatter. Kept intentionally flat so the markdown body stays
 * editable in other tools (Obsidian, VSCode, etc.).
 */
export type EvidenceParty = "原告" | "被告" | "第三人" | "法院调取" | "其他"

export type EvidenceReviewStatus = "采信" | "部分采信" | "不采信" | "待定"

/**
 * 质证意见。
 * - plaintiff: 原告意见（对证据的举证/质证主张）
 * - defendant: 被告意见
 * - court: 本院意见（合议庭 / 审判员的认定）
 */
export interface EvidenceOpinions {
  plaintiff?: string
  defendant?: string
  court?: string
}

export interface EvidenceItem {
  /** 证据编号，如 "证据1"、"原1" */
  id: string
  /** 证据名称 */
  name: string
  /** 提交主体 */
  submitter: EvidenceParty
  /** 证据类型（书证、物证、电子数据、证人证言…） */
  kind?: string
  /** 证明目的 */
  purpose: string
  /** 真实性审查 */
  authenticity: EvidenceReviewStatus
  /** 合法性审查 */
  legality: EvidenceReviewStatus
  /** 关联性审查 */
  relevance: EvidenceReviewStatus
  /** 最终是否采信 */
  admitted: boolean
  /** 原件路径（相对工程根），可选 "raw/sources/xxx.pdf#page=3" */
  sourcePath?: string
  /** 多原件路径；一条证据可关联多张照片 / 多份文件 */
  sourcePaths?: string[]
  /** 备注 */
  note?: string
  /** 原件哈希，用于防篡改校验（未来校验用） */
  sha256?: string
  /** 质证意见（原/被/院） */
  opinions?: EvidenceOpinions
}

/**
 * 统计一条证据已经录入了多少条意见（原/被/院）。
 */
export function countOpinions(item: EvidenceItem): number {
  const o = item.opinions
  if (!o) return 0
  return (o.plaintiff?.trim() ? 1 : 0)
    + (o.defendant?.trim() ? 1 : 0)
    + (o.court?.trim() ? 1 : 0)
}

export interface EvidenceListFrontmatter {
  type: "evidence-list"
  title?: string
  case_number?: string
  updated?: string
  evidences: EvidenceItem[]
}

export const EVIDENCE_PARTY_OPTIONS: EvidenceParty[] = [
  "原告",
  "被告",
  "第三人",
  "法院调取",
  "其他",
]

export const EVIDENCE_REVIEW_OPTIONS: EvidenceReviewStatus[] = [
  "采信",
  "部分采信",
  "不采信",
  "待定",
]

export function emptyEvidence(id: string): EvidenceItem {
  return {
    id,
    name: "",
    submitter: "原告",
    purpose: "",
    authenticity: "待定",
    legality: "待定",
    relevance: "待定",
    admitted: false,
  }
}
