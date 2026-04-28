import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface WorksheetState {
  activeRecordPath?: string
  updatedAt?: string
}

function statePath(projectPath: string): string {
  const root = normalizePath(projectPath)
  return `${root}/.llm-wiki/worksheet-state.json`
}

export async function loadWorksheetState(projectPath: string): Promise<WorksheetState> {
  try {
    const raw = await readFile(statePath(projectPath))
    const parsed = JSON.parse(raw) as WorksheetState
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export async function saveWorksheetState(projectPath: string, state: WorksheetState): Promise<void> {
  const root = normalizePath(projectPath)
  await createDirectory(`${root}/.llm-wiki`).catch(() => {})
  await writeFile(
    statePath(projectPath),
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}
