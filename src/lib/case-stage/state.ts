import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export type CaseStageId =
  | "pending_materials"
  | "pending_hearing"
  | "pending_worksheet"
  | "pending_doc"
  | "pending_review"
  | "completed"

export interface CaseStageState {
  stage?: CaseStageId
  updatedAt?: string
}

export const CASE_STAGE_OPTIONS: Array<{ id: CaseStageId; label: string }> = [
  { id: "pending_materials", label: "待导入材料" },
  { id: "pending_hearing", label: "待整理庭审" },
  { id: "pending_worksheet", label: "待生成开庭工作单" },
  { id: "pending_doc", label: "待起草文书" },
  { id: "pending_review", label: "待复核文书" },
  { id: "completed", label: "已形成办案闭环" },
]

function statePath(projectPath: string): string {
  const root = normalizePath(projectPath)
  return `${root}/.llm-wiki/case-stage.json`
}

export function caseStageLabel(stage?: CaseStageId): string {
  return CASE_STAGE_OPTIONS.find((item) => item.id === stage)?.label || "未设置"
}

export async function loadCaseStageState(projectPath: string): Promise<CaseStageState> {
  try {
    const raw = await readFile(statePath(projectPath))
    const parsed = JSON.parse(raw) as CaseStageState
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export async function saveCaseStageState(projectPath: string, stage: CaseStageId): Promise<void> {
  const root = normalizePath(projectPath)
  await createDirectory(`${root}/.llm-wiki`).catch(() => {})
  await writeFile(
    statePath(projectPath),
    JSON.stringify(
      {
        stage,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}
