import { copyFile, createDirectory, deleteFile, listDirectory, preprocessFile, readFile, writeFile } from "@/commands/fs"
import { parseFrontmatter, writeFrontmatter } from "@/lib/frontmatter"
import { classifyMaterial, extractEvidenceDraftFromSources, type MaterialKind } from "@/lib/hearing/material-intelligence"
import { analyzeTranscriptSource } from "@/lib/transcript/parse"
import { buildTranscriptTitle, saveTranscriptRecord } from "@/lib/transcript/storage"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { emptyEvidence, type EvidenceListFrontmatter } from "@/types/evidence"
import type { TranscriptCaseType } from "@/types/transcript"

export type RoutedMaterialBucket = "证据" | "笔录" | "其他"

export interface RoutedMaterial {
  originalPath: string
  path: string
  bucket: RoutedMaterialBucket
  kind: MaterialKind
  reason: string
}

function hasLlm(llmConfig: LlmConfig): boolean {
  return Boolean(llmConfig.apiKey || llmConfig.provider === "ollama" || llmConfig.provider === "custom")
}

function bucketForKind(kind: MaterialKind): RoutedMaterialBucket {
  if (kind === "evidence") return "证据"
  if (kind === "transcript") return "笔录"
  return "其他"
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flattenFiles(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

async function getUniqueDestPath(dir: string, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf(".")
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName
  const ext = dot >= 0 ? fileName.slice(dot) : ""
  let index = 0
  while (true) {
    const candidate = `${dir}/${index === 0 ? fileName : `${stem}-${index}${ext}`}`
    try {
      await readFile(candidate)
      index += 1
    } catch {
      return candidate
    }
  }
}

async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  if (normalizePath(sourcePath) === normalizePath(destPath)) return
  await copyFile(sourcePath, destPath)
  await deleteFile(sourcePath)
}

function buildEmptyEvidencePage(): string {
  const initial: EvidenceListFrontmatter = {
    type: "evidence-list",
    title: "证据清单",
    case_number: "",
    updated: new Date().toISOString().slice(0, 10),
    evidences: [],
  }
  return writeFrontmatter("\n# 证据清单\n\n（上传材料已自动提炼证据草稿，请人工核对。）\n", initial)
}

async function ensureEvidencePage(root: string): Promise<string> {
  await createDirectory(`${root}/wiki/证据清单`).catch(() => {})
  const tree = await listDirectory(`${root}/wiki/证据清单`).catch(() => [] as FileNode[])
  const existing = flattenFiles(tree)
    .filter((file) => file.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name))[0]
  if (existing) return existing.path

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const path = `${root}/wiki/证据清单/证据清单-${stamp}-${Date.now().toString().slice(-4)}.md`
  await writeFile(path, buildEmptyEvidencePage())
  return path
}

async function appendEvidenceDraft(root: string, evidencePaths: string[], llmConfig: LlmConfig): Promise<number> {
  if (evidencePaths.length === 0 || !hasLlm(llmConfig)) return 0

  const draft = await extractEvidenceDraftFromSources({
    projectPath: root,
    sourcePaths: evidencePaths,
    llmConfig,
  })
  if (draft.items.length === 0) return 0

  const targetPath = await ensureEvidencePage(root)
  const raw = await readFile(targetPath).catch(() => buildEmptyEvidencePage())
  const parsed = parseFrontmatter<Partial<EvidenceListFrontmatter>>(raw)
  const existing = parsed.data.evidences ?? []
  const existingCount = existing.length
  const items = draft.items.map((item, index) => ({
    ...item,
    id: emptyEvidence(`证据${existingCount + index + 1}`).id,
    sourcePath: item.sourcePath,
  }))
  const next = writeFrontmatter(raw, {
    type: "evidence-list",
    title: parsed.data.title ?? "证据清单",
    case_number: parsed.data.case_number ?? "",
    updated: new Date().toISOString().slice(0, 10),
    evidences: [...existing, ...items],
  } satisfies EvidenceListFrontmatter)
  await writeFile(targetPath, next)
  return items.length
}

async function processTranscripts(root: string, transcriptPaths: string[], llmConfig: LlmConfig): Promise<number> {
  if (transcriptPaths.length === 0 || !hasLlm(llmConfig)) return 0

  await createDirectory(`${root}/wiki/庭审笔录`).catch(() => {})
  const caseType: TranscriptCaseType = "民事"
  for (const sourcePath of transcriptPaths) {
    const analyzed = await analyzeTranscriptSource({
      sourcePath,
      caseType,
      caseSubtypeId: "loan-dispute",
      llmConfig,
    })
    await saveTranscriptRecord({
      projectPath: root,
      title: buildTranscriptTitle(sourcePath),
      caseType,
      caseSubtypeId: "loan-dispute",
      caseSubtypeLabel: "民间借贷纠纷",
      sourcePath: sourcePath.replace(`${root}/`, ""),
      data: analyzed,
    })
  }
  return transcriptPaths.length
}

export async function routeImportedMaterials(args: {
  projectPath: string
  sourcePaths: string[]
  llmConfig: LlmConfig
  onRouted?: (routed: RoutedMaterial[]) => void | Promise<void>
}): Promise<RoutedMaterial[]> {
  const root = normalizePath(args.projectPath)
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "ingest",
    title: `自动分流 ${args.sourcePaths.length} 份材料`,
    status: "running",
    detail: "正在识别材料类型...",
    filesWritten: [],
  })

  const routed: RoutedMaterial[] = []
  try {
    for (let index = 0; index < args.sourcePaths.length; index++) {
      const sourcePath = normalizePath(args.sourcePaths[index])
      const fileName = getFileName(sourcePath) || `material-${index + 1}`
      activity.updateItem(activityId, { detail: `正在识别 ${index + 1}/${args.sourcePaths.length}：${fileName}` })
      const classification = await classifyMaterial(sourcePath, args.llmConfig)
      const bucket = bucketForKind(classification.kind)
      const targetDir = `${root}/raw/sources/${bucket}`
      await createDirectory(targetDir).catch(() => {})
      const targetPath = await getUniqueDestPath(targetDir, fileName)
      await moveFile(sourcePath, targetPath)
      preprocessFile(targetPath).catch(() => {})
      routed.push({
        originalPath: sourcePath,
        path: targetPath,
        bucket,
        kind: classification.kind,
        reason: classification.reason,
      })
    }

    await args.onRouted?.(routed)

    const evidencePaths = routed.filter((item) => item.kind === "evidence").map((item) => item.path)
    const transcriptPaths = routed.filter((item) => item.kind === "transcript").map((item) => item.path)
    let detail = `已分流：证据 ${evidencePaths.length}，笔录 ${transcriptPaths.length}，其他 ${routed.length - evidencePaths.length - transcriptPaths.length}`

    const evidenceCount = await appendEvidenceDraft(root, evidencePaths, args.llmConfig)
    if (evidenceCount > 0) detail += `；已提炼 ${evidenceCount} 条证据`

    const transcriptCount = await processTranscripts(root, transcriptPaths, args.llmConfig)
    if (transcriptCount > 0) detail += `；已整理 ${transcriptCount} 份笔录`

    const tree = await listDirectory(root).catch(() => [] as FileNode[])
    if (tree.length > 0) useWikiStore.getState().setFileTree(tree)
    useWikiStore.getState().bumpDataVersion()

    activity.updateItem(activityId, {
      status: "done",
      detail,
      filesWritten: routed.map((item) => item.path.replace(`${root}/`, "")),
    })
    return routed
  } catch (error) {
    activity.updateItem(activityId, {
      status: "error",
      detail: `自动分流失败：${error instanceof Error ? error.message : String(error)}`,
      filesWritten: routed.map((item) => item.path.replace(`${root}/`, "")),
    })
    throw error
  }
}
