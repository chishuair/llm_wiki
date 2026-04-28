import { listDirectory, readFile } from "@/commands/fs"
import { caseStageLabel, loadCaseStageState, type CaseStageId } from "@/lib/case-stage/state"
import { loadCaseMeta, type CaseMeta } from "@/lib/case-meta"
import { parseFrontmatter } from "@/lib/frontmatter"
import { listCodes } from "@/lib/lawbase"
import { loadTranscriptRecord } from "@/lib/transcript/storage"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode, WikiProject } from "@/types/wiki"

export interface DashboardAction {
  id: string
  label: string
  hint: string
  targetView: "dashboard" | "sources" | "transcript" | "worksheet" | "legal-doc" | "lawbase"
}

export interface DashboardTodo {
  id: string
  label: string
  detail: string
  targetView: DashboardAction["targetView"]
  priority: "high" | "medium" | "low"
}

export interface DashboardSummary {
  caseName: string
  projectPath: string
  meta: CaseMeta
  metaPendingCount: number
  metaConflictCount: number
  metaConfirmedCount: number
  currentStageId?: CaseStageId
  currentStage: string
  materialCount: number
  evidencePageCount: number
  transcriptCount: number
  hasWorksheet: boolean
  lawCount: number
  disputedCount: number
  missingEvidenceCount: number
  focusSummaries: string[]
  latestTranscriptTitle?: string
  latestTranscriptSummary?: string
  actions: DashboardAction[]
  todos: DashboardTodo[]
}

function flatten(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flatten(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

function topSummaryLines(body: string, heading: string, limit = 3): string[] {
  const match = body.match(new RegExp(`##\\s+${heading}\\n([\\s\\S]*?)(?=\\n##\\s+|$)`))
  if (!match) return []
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, limit)
    .map((line) => line.replace(/^- /, ""))
}

function deriveStage(summary: {
  materialCount: number
  transcriptCount: number
  hasWorksheet: boolean
  lawCount: number
}): CaseStageId {
  if (summary.materialCount === 0) return "pending_materials"
  if (summary.transcriptCount === 0) return "pending_hearing"
  if (!summary.hasWorksheet) return "pending_worksheet"
  if (summary.lawCount === 0) return "pending_doc"
  return "pending_doc"
}

function buildActions(summary: {
  materialCount: number
  transcriptCount: number
  hasWorksheet: boolean
  lawCount: number
  disputedCount: number
  missingEvidenceCount: number
  metaPendingCount: number
  metaConflictCount: number
}): DashboardAction[] {
  const actions: DashboardAction[] = []
  if (summary.metaConflictCount > 0) {
    actions.push({ id: "resolve-meta-conflicts", label: "确认主数据冲突", hint: "先确认案号、案由、法院等基础信息", targetView: "dashboard" })
    return actions
  }
  if (summary.metaPendingCount > 0) {
    actions.push({ id: "confirm-meta", label: "确认案件主数据", hint: "先确认待复核的基础信息字段", targetView: "dashboard" })
  }
  if (summary.materialCount === 0) {
    actions.push({ id: "import-materials", label: "导入案件材料", hint: "先导入本案原始卷宗材料", targetView: "sources" })
  }
  if (summary.transcriptCount === 0) {
    actions.push({ id: "organize-transcript", label: "整理庭审笔录", hint: "将庭审笔录整理为结构化结果", targetView: "transcript" })
  }
  if (!summary.hasWorksheet && summary.transcriptCount > 0) {
    actions.push({ id: "build-worksheet", label: "生成开庭工作单", hint: "查看和导出当前案件的开庭工作单", targetView: "worksheet" })
  }
  if (summary.missingEvidenceCount > 0 || summary.disputedCount > 0) {
    actions.push({ id: "review-hearing", label: "打开证据与庭审", hint: "查看争议要素与待补证事项", targetView: "transcript" })
  }
  if (summary.lawCount === 0) {
    actions.push({ id: "import-laws", label: "补充法律依据", hint: "导入本案需要引用的法律法规", targetView: "lawbase" })
  }
  if (summary.metaPendingCount === 0 && summary.metaConflictCount === 0) {
    actions.push({ id: "generate-doc", label: "生成法律文书", hint: "基于当前材料与工作单起草文书", targetView: "legal-doc" })
  }
  return actions.slice(0, 6)
}

function countConfirmState(meta: CaseMeta, target: "pending" | "conflict" | "confirmed"): number {
  return Object.values(meta.confirmStates ?? {}).filter((value) => value === target).length
}

function buildTodos(summary: {
  meta: CaseMeta
  materialCount: number
  transcriptCount: number
  hasWorksheet: boolean
  lawCount: number
  disputedCount: number
  missingEvidenceCount: number
  currentStageId?: CaseStageId
}): DashboardTodo[] {
  const todos: DashboardTodo[] = []
  const pendingMeta = countConfirmState(summary.meta, "pending")
  const conflictMeta = countConfirmState(summary.meta, "conflict")

  if (conflictMeta > 0) {
    todos.push({
      id: "meta-conflict",
      label: "确认案件主数据冲突",
      detail: `当前有 ${conflictMeta} 项主数据存在多个候选值，建议先确认案号、案由、法院等基础信息。`,
      targetView: "dashboard",
      priority: "high",
    })
  } else if (pendingMeta > 0) {
    todos.push({
      id: "meta-pending",
      label: "确认案件主数据",
      detail: `当前有 ${pendingMeta} 项主数据仍待确认，建议先确认后再继续后续办案步骤。`,
      targetView: "dashboard",
      priority: "medium",
    })
  }

  if (summary.materialCount === 0) {
    todos.push({
      id: "materials",
      label: "导入案件材料",
      detail: "尚未导入原始卷宗材料，请先导入起诉状、证据、笔录、传票等文件。",
      targetView: "sources",
      priority: "high",
    })
  }

  if (summary.materialCount > 0 && summary.transcriptCount === 0) {
    todos.push({
      id: "transcript",
      label: "整理庭审笔录",
      detail: "材料已具备，但尚未形成庭审整理稿，建议先进入证据与庭审完成整理。",
      targetView: "transcript",
      priority: "high",
    })
  }

  if (summary.missingEvidenceCount > 0) {
    todos.push({
      id: "missing-evidence",
      label: "处理待补证事项",
      detail: `当前有 ${summary.missingEvidenceCount} 项待补证要素，建议先补足材料或释明举证责任。`,
      targetView: "transcript",
      priority: "high",
    })
  }

  if (summary.disputedCount > 0) {
    todos.push({
      id: "disputed-elements",
      label: "核对争议要素",
      detail: `当前有 ${summary.disputedCount} 项争议要素，建议查看发问建议并整理下一轮庭审重点。`,
      targetView: "transcript",
      priority: "medium",
    })
  }

  if (summary.transcriptCount > 0 && !summary.hasWorksheet) {
    todos.push({
      id: "worksheet",
      label: "生成开庭工作单",
      detail: "已有庭审整理稿，但尚未设定或生成当前生效工作单。",
      targetView: "worksheet",
      priority: "high",
    })
  }

  if (summary.hasWorksheet && summary.lawCount === 0) {
    todos.push({
      id: "lawbase",
      label: "补充法律依据",
      detail: "已具备工作单，但本地法条库尚未导入，生成文书前应先补齐法律依据。",
      targetView: "lawbase",
      priority: "high",
    })
  }

  if (summary.hasWorksheet && summary.lawCount > 0 && summary.currentStageId !== "pending_review") {
    todos.push({
      id: "generate-doc",
      label: "生成法律文书草稿",
      detail: "当前已具备工作单和法律依据，可以进入法律文书模块起草草稿。",
      targetView: "legal-doc",
      priority: "medium",
    })
  }

  if (summary.currentStageId === "pending_review") {
    todos.push({
      id: "review-doc",
      label: "复核法律文书草稿",
      detail: "案件已进入待复核文书阶段，请检查事实、法条引用和主文表述。",
      targetView: "legal-doc",
      priority: "high",
    })
  }

  return todos
}

export async function collectDashboardSummary(project: WikiProject): Promise<DashboardSummary> {
  const root = normalizePath(project.path)
  const meta = await loadCaseMeta(root, project.name)
  const savedStage = await loadCaseStageState(root)
  const [sourceTree, evidenceTree, transcriptTree] = await Promise.all([
    listDirectory(`${root}/raw/sources`).catch(() => [] as FileNode[]),
    listDirectory(`${root}/wiki/证据清单`).catch(() => [] as FileNode[]),
    listDirectory(`${root}/wiki/庭审笔录`).catch(() => [] as FileNode[]),
  ])

  const materialCount = flatten(sourceTree).filter((file) => !file.path.includes("/.cache/") && !file.name.startsWith(".")).length
  const evidencePageCount = flatten(evidenceTree).filter((file) => file.name.endsWith(".md")).length
  const transcriptFiles = flatten(transcriptTree).filter((file) => file.name.endsWith(".md"))

  let hasWorksheet = false
  let disputedCount = 0
  let missingEvidenceCount = 0
  let latestTranscriptTitle: string | undefined
  let latestTranscriptSummary: string | undefined
  let focusSummaries: string[] = []

  if (transcriptFiles.length > 0) {
    const latest = [...transcriptFiles].sort((a, b) => b.name.localeCompare(a.name))[0]
    try {
      const record = await loadTranscriptRecord(latest.path)
      latestTranscriptTitle = record.frontmatter.title
      latestTranscriptSummary = record.data.overview
      hasWorksheet = record.body.includes("## 庭审提纲")
      disputedCount = record.data.keyElements.filter((item) => item.status === "有争议").length
      missingEvidenceCount = record.data.keyElements.filter((item) => item.status === "待补证").length
      focusSummaries = [
        ...topSummaryLines(record.body, "争议要素提醒", 2),
        ...topSummaryLines(record.body, "待补证提示", 2),
      ].slice(0, 4)
    } catch {
      try {
        const raw = parseFrontmatter(await readFile(latest.path))
        hasWorksheet = raw.body.includes("## 庭审提纲")
      } catch {
        // ignore
      }
    }
  }

  const lawCount = listCodes().length
  const derivedStage = deriveStage({ materialCount, transcriptCount: transcriptFiles.length, hasWorksheet, lawCount })
  const currentStageId = savedStage.stage ?? derivedStage
  const actions = buildActions({
    materialCount,
    transcriptCount: transcriptFiles.length,
    hasWorksheet,
    lawCount,
    disputedCount,
    missingEvidenceCount,
    metaPendingCount: countConfirmState(meta, "pending"),
    metaConflictCount: countConfirmState(meta, "conflict"),
  })
  const todos = buildTodos({
    meta,
    materialCount,
    transcriptCount: transcriptFiles.length,
    hasWorksheet,
    lawCount,
    disputedCount,
    missingEvidenceCount,
    currentStageId,
  })

  return {
    caseName: meta.caseName || project.name,
    projectPath: root,
    meta,
    metaPendingCount: countConfirmState(meta, "pending"),
    metaConflictCount: countConfirmState(meta, "conflict"),
    metaConfirmedCount: countConfirmState(meta, "confirmed"),
    currentStageId,
    currentStage: caseStageLabel(currentStageId),
    materialCount,
    evidencePageCount,
    transcriptCount: transcriptFiles.length,
    hasWorksheet,
    lawCount,
    disputedCount,
    missingEvidenceCount,
    focusSummaries,
    latestTranscriptTitle,
    latestTranscriptSummary,
    actions,
    todos,
  }
}
