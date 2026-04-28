import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export type CaseType = "民事" | "刑事" | "行政" | "执行" | "其他"
export type CaseMetaField =
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

export type CaseMetaConfirmState = "confirmed" | "pending" | "conflict"

export interface CaseMeta {
  caseName: string
  caseNumber: string
  cause: string
  caseType: CaseType
  subtype: string
  courtName: string
  presidingJudge: string
  clerk: string
  procedureStage: string
  nextHearingAt: string
  confirmStates: Partial<Record<CaseMetaField, CaseMetaConfirmState>>
  updatedAt: string
}

function metaPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/case.meta.json`
}

export function defaultCaseMeta(caseName: string, caseType: CaseType = "民事"): CaseMeta {
  return {
    caseName,
    caseNumber: "",
    cause: "",
    caseType,
    subtype: "",
    courtName: "",
    presidingJudge: "",
    clerk: "",
    procedureStage: "",
    nextHearingAt: "",
    confirmStates: {},
    updatedAt: new Date().toISOString(),
  }
}

export async function loadCaseMeta(projectPath: string, fallbackCaseName = "未命名案件"): Promise<CaseMeta> {
  try {
    const raw = await readFile(metaPath(projectPath))
    const parsed = JSON.parse(raw) as Partial<CaseMeta>
    return {
      ...defaultCaseMeta(fallbackCaseName),
      ...parsed,
      caseName: parsed.caseName?.trim() || fallbackCaseName,
    }
  } catch {
    return defaultCaseMeta(fallbackCaseName)
  }
}

export async function saveCaseMeta(projectPath: string, meta: CaseMeta): Promise<void> {
  await writeFile(
    metaPath(projectPath),
    JSON.stringify(
      {
        ...meta,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}
