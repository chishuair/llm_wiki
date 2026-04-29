import { useCallback, useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { FilePlus2, Loader2, RefreshCw, ScrollText, Sparkles, Layers3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyFile, createDirectory, listDirectory, preprocessFile, readFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { analyzeTranscriptSource } from "@/lib/transcript/parse"
import { saveCaseStageState } from "@/lib/case-stage/state"
import { mergeTranscriptRecords } from "@/lib/transcript/merge"
import { getTranscriptSubtypeOptions, resolveTranscriptRuleSet } from "@/lib/transcript/rules"
import { buildTranscriptTitle, loadTranscriptRecord, saveTranscriptRecord } from "@/lib/transcript/storage"
import { TranscriptEditor } from "./transcript-editor"
import type { FileNode } from "@/types/wiki"
import { classifyMaterial } from "@/lib/hearing/material-intelligence"
import type {
  HearingTranscriptFrontmatter,
  TranscriptCaseType,
  TranscriptRecord,
} from "@/types/transcript"

interface TranscriptListItem {
  path: string
  title: string
  updated: string
  sourcePath?: string
  merged: boolean
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flattenFiles(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

function isTranscriptCandidate(path: string) {
  const lower = path.toLowerCase()
  return [".txt", ".md", ".doc", ".docx", ".pdf", ".rtf"].some((ext) => lower.endsWith(ext))
}

async function getUniqueDestPath(dir: string, fileName: string) {
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

export function TranscriptView() {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedFile = useWikiStore((s) => s.selectedFile)

  const [caseType, setCaseType] = useState<TranscriptCaseType>("民事")
  const [caseSubtypeId, setCaseSubtypeId] = useState<string>("loan-dispute")
  const sessionDate = ""
  const sessionIndex = ""
  const [sources, setSources] = useState<FileNode[]>([])
  const [records, setRecords] = useState<TranscriptListItem[]>([])
  const [selectedSourcePaths, setSelectedSourcePaths] = useState<string[]>([])
  const [selectedRecordPaths, setSelectedRecordPaths] = useState<string[]>([])
  const [activeRecord, setActiveRecord] = useState<TranscriptRecord | null>(null)
  const [busyText, setBusyText] = useState("")
  const [message, setMessage] = useState("")

  const projectPath = project ? normalizePath(project.path) : ""
  const subtypeOptions = useMemo(() => getTranscriptSubtypeOptions(caseType), [caseType])
  const ruleSet = useMemo(() => resolveTranscriptRuleSet(caseType, caseSubtypeId || undefined), [caseType, caseSubtypeId])

  useEffect(() => {
    if (!subtypeOptions.some((item) => item.id === caseSubtypeId)) {
      setCaseSubtypeId(subtypeOptions[0]?.id || "")
    }
  }, [caseSubtypeId, subtypeOptions])

  const refreshWorkspace = useCallback(async () => {
    if (!project) return
    const root = normalizePath(project.path)
    await createDirectory(`${root}/wiki/庭审笔录`).catch(() => {})

    const [sourceTree, transcriptTree, wholeTree] = await Promise.all([
      listDirectory(`${root}/raw/sources`).catch(() => [] as FileNode[]),
      listDirectory(`${root}/wiki/庭审笔录`).catch(() => [] as FileNode[]),
      listDirectory(root).catch(() => [] as FileNode[]),
    ])

    const sourceFiles = flattenFiles(sourceTree).filter((node) => isTranscriptCandidate(node.path))
    setSources(sourceFiles)
    setFileTree(wholeTree)

    const transcriptFiles = flattenFiles(transcriptTree).filter((node) => node.name.endsWith(".md"))
    const nextRecords = await Promise.all(
      transcriptFiles.map(async (node) => {
        try {
          const raw = await readFile(node.path)
          const { data } = parseFrontmatter<HearingTranscriptFrontmatter>(raw)
          const dataPath = data.dataPath ? `${root}/${data.dataPath}` : ""
          let merged = false
          if (dataPath) {
            try {
              const parsed = JSON.parse(await readFile(dataPath)) as { mergeMeta?: { merged?: boolean } }
              merged = Boolean(parsed.mergeMeta?.merged)
            } catch {
              merged = false
            }
          }
          return {
            path: node.path,
            title: data.title || node.name.replace(/\.md$/, ""),
            updated: data.updated || "",
            sourcePath: data.sourcePath,
            merged,
          }
        } catch {
          return {
            path: node.path,
            title: node.name.replace(/\.md$/, ""),
            updated: "",
            merged: false,
          }
        }
      })
    )
    setRecords(nextRecords.sort((a, b) => b.path.localeCompare(a.path)))
  }, [project, setFileTree])

  useEffect(() => {
    refreshWorkspace().catch(() => {})
  }, [refreshWorkspace])

  useEffect(() => {
    if (!selectedFile || !selectedFile.includes("/wiki/庭审笔录/") || !selectedFile.endsWith(".md")) return
    if (records.some((item) => item.path === selectedFile)) {
      handleOpenRecord(selectedFile).catch(() => {})
    }
  }, [selectedFile, records])

  async function handleImport() {
    if (!project) return
    const picked = await open({
      multiple: true,
      title: "导入庭审笔录原文",
      filters: [
        { name: "笔录文本", extensions: ["txt", "md", "pdf", "doc", "docx", "rtf"] },
      ],
    })
    if (!picked) return
    const items = Array.isArray(picked) ? picked : [picked]
    setBusyText("正在导入笔录原文...")
    for (const sourcePath of items) {
      const fileName = getFileName(sourcePath) || "庭审笔录.txt"
      const destPath = await getUniqueDestPath(`${projectPath}/raw/sources`, fileName)
      try {
        await copyFile(sourcePath, destPath)
        preprocessFile(destPath).catch(() => {})
      } catch (error) {
        console.error("导入庭审笔录失败", error)
      }
    }
    setBusyText("")
    await refreshWorkspace()
    bumpDataVersion()
    await saveCaseStageState(project.path, "pending_hearing").catch(() => {})
    setMessage("已导入庭审笔录原文")
  }

  async function handleOpenRecord(path: string) {
    try {
      const record = await loadTranscriptRecord(path)
      setActiveRecord(record)
      setCaseType(record.frontmatter.caseType)
      setCaseSubtypeId(record.frontmatter.caseSubtypeId || "")
      setMessage("")
    } catch (error) {
      setMessage(`打开失败：${String(error)}`)
    }
  }

  async function handleProcessSelected() {
    if (!project || selectedSourcePaths.length === 0) return
    setMessage("")
    const created: TranscriptRecord[] = []
    try {
      for (let index = 0; index < selectedSourcePaths.length; index++) {
        const sourcePath = selectedSourcePaths[index]
        setBusyText(`正在整理第 ${index + 1} / ${selectedSourcePaths.length} 份笔录：${getFileName(sourcePath)}`)
        const analyzed = await analyzeTranscriptSource({
          sourcePath,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          llmConfig,
          onProgress: (current, total) => {
            setBusyText(`正在整理 ${getFileName(sourcePath)}：片段 ${current}/${total}`)
          },
        })
        const sessionNumber = sessionIndex ? Number(sessionIndex) + index : undefined
        const title = buildTranscriptTitle(sourcePath, sessionNumber)
        const saved = await saveTranscriptRecord({
          projectPath: project.path,
          title,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          caseSubtypeLabel: ruleSet.subtype?.label,
          sessionDate: sessionDate || undefined,
          sessionIndex: sessionNumber,
          sourcePath: sourcePath.replace(`${projectPath}/`, ""),
          data: analyzed,
        })
        created.push(saved)
      }

      let finalRecord = created[created.length - 1]
      if (created.length > 1) {
        setBusyText("正在合并多份庭审笔录整理结果...")
        const merged = await mergeTranscriptRecords({
          records: created,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          caseSubtypeLabel: ruleSet.subtype?.label,
          llmConfig,
        })
        finalRecord = await saveTranscriptRecord({
          projectPath: project.path,
          title: `合并庭审笔录-${new Date().toISOString().slice(0, 10)}`,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          caseSubtypeLabel: ruleSet.subtype?.label,
          sessionDate: sessionDate || undefined,
          data: merged,
        })
      }

      setSelectedSourcePaths([])
      setSelectedRecordPaths([])
      setActiveRecord(finalRecord)
      await saveCaseStageState(project.path, "pending_worksheet").catch(() => {})
      setMessage(created.length > 1 ? "已完成单份整理并生成合并稿" : "已完成庭审笔录整理")
      await refreshWorkspace()
      bumpDataVersion()
    } catch (error) {
      setMessage(`整理失败：${String(error)}`)
    } finally {
      setBusyText("")
    }
  }

  async function handleAutoDetectAndProcess() {
    if (!project || sources.length === 0) return
    setMessage("")
    setBusyText("正在识别哪些原始材料属于庭审笔录...")
    try {
      const transcriptCandidates: string[] = []
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i]
        setBusyText(`正在识别材料 ${i + 1}/${sources.length}：${source.name}`)
        const result = await classifyMaterial(source.path, llmConfig)
        if (result.kind === "transcript") transcriptCandidates.push(source.path)
      }
      setSelectedSourcePaths(transcriptCandidates)
      if (transcriptCandidates.length === 0) {
        setMessage("未识别到可自动整理的笔录类材料。")
        return
      }
      setBusyText(`已识别到 ${transcriptCandidates.length} 份笔录材料，正在自动整理...`)
      for (let index = 0; index < transcriptCandidates.length; index++) {
        const sourcePath = transcriptCandidates[index]
        setBusyText(`正在整理第 ${index + 1} / ${transcriptCandidates.length} 份笔录：${getFileName(sourcePath)}`)
        const analyzed = await analyzeTranscriptSource({
          sourcePath,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          llmConfig,
          onProgress: (current, total) => {
            setBusyText(`正在整理 ${getFileName(sourcePath)}：片段 ${current}/${total}`)
          },
        })
        const title = buildTranscriptTitle(sourcePath)
        await saveTranscriptRecord({
          projectPath: project.path,
          title,
          caseType,
          caseSubtypeId: caseSubtypeId || undefined,
          caseSubtypeLabel: ruleSet.subtype?.label,
          sessionDate: sessionDate || undefined,
          sourcePath: sourcePath.replace(`${projectPath}/`, ""),
          data: analyzed,
        })
      }
      await refreshWorkspace()
      bumpDataVersion()
      setMessage(`已自动识别并整理 ${transcriptCandidates.length} 份笔录材料。`)
      await saveCaseStageState(project.path, "pending_worksheet").catch(() => {})
    } catch (error) {
      setMessage(`自动识别笔录失败：${String(error)}`)
    } finally {
      setBusyText("")
    }
  }

  async function handleMergeSelectedRecords() {
    if (!project || selectedRecordPaths.length < 2) return
    try {
      setBusyText("正在读取并合并已整理笔录...")
      const loaded = await Promise.all(selectedRecordPaths.map((path) => loadTranscriptRecord(path)))
      const merged = await mergeTranscriptRecords({
        records: loaded,
        caseType,
        caseSubtypeId: caseSubtypeId || undefined,
        caseSubtypeLabel: ruleSet.subtype?.label,
        llmConfig,
      })
      const saved = await saveTranscriptRecord({
        projectPath: project.path,
        title: `合并庭审笔录-${new Date().toISOString().slice(0, 10)}`,
        caseType,
        caseSubtypeId: caseSubtypeId || undefined,
        caseSubtypeLabel: ruleSet.subtype?.label,
        sessionDate: sessionDate || undefined,
        data: merged,
      })
      setActiveRecord(saved)
      setSelectedRecordPaths([])
      setMessage("已生成合并庭审笔录")
      await refreshWorkspace()
      bumpDataVersion()
    } catch (error) {
      setMessage(`合并失败：${String(error)}`)
    } finally {
      setBusyText("")
    }
  }

  const sourceCountLabel = useMemo(() => `${selectedSourcePaths.length}/${sources.length}`, [selectedSourcePaths.length, sources.length])
  const recordCountLabel = useMemo(() => `${selectedRecordPaths.length}/${records.length}`, [selectedRecordPaths.length, records.length])

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开案件知识库</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">庭审笔录智能整理</h2>
            <p className="text-sm text-muted-foreground">
              面向内网环境，先整理已成文笔录，再进行多次庭审合并与人工校对。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleImport}>
              <FilePlus2 className="mr-1.5 h-4 w-4" />
              导入笔录原文
            </Button>
            <Button variant="outline" onClick={handleAutoDetectAndProcess} disabled={Boolean(busyText)}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              自动识别并整理
            </Button>
            <Button variant="outline" onClick={() => refreshWorkspace()}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              刷新
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-[520px] flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 grid-cols-[340px_1fr]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="border-b px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">原始笔录</div>
                <span className="text-xs text-muted-foreground">{sourceCountLabel}</span>
              </div>
              <Button className="w-full" onClick={handleProcessSelected} disabled={selectedSourcePaths.length === 0 || Boolean(busyText)}>
                {busyText ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                整理选中笔录
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-2">
                {sources.length === 0 && (
                  <div className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                    `raw/sources/` 中还没有可整理的笔录文件。
                  </div>
                )}
                {sources.map((source) => {
                  const checked = selectedSourcePaths.includes(source.path)
                  return (
                    <label key={source.path} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 hover:bg-accent/40">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedSourcePaths((prev) =>
                            checked ? prev.filter((item) => item !== source.path) : [...prev, source.path]
                          )
                        }
                        className="mt-1 h-3.5 w-3.5 accent-primary"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{source.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{source.path.replace(`${projectPath}/`, "")}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="border-t px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">已整理笔录</div>
                <span className="text-xs text-muted-foreground">{recordCountLabel}</span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleMergeSelectedRecords}
                disabled={selectedRecordPaths.length < 2 || Boolean(busyText)}
              >
                <Layers3 className="mr-1.5 h-4 w-4" />
                合并选中的整理稿
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-2">
                {records.length === 0 && (
                  <div className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                    还没有整理结果。
                  </div>
                )}
                {records.map((record) => {
                  const checked = selectedRecordPaths.includes(record.path)
                  const active = activeRecord?.markdownPath === record.path
                  return (
                    <div
                      key={record.path}
                      className={`rounded-md border px-3 py-2 ${active ? "border-primary bg-primary/5" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRecordPaths((prev) =>
                              checked ? prev.filter((item) => item !== record.path) : [...prev, record.path]
                            )
                          }
                          className="mt-1 h-3.5 w-3.5 accent-primary"
                        />
                        <button
                          type="button"
                          onClick={() => handleOpenRecord(record.path)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <ScrollText className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate text-sm font-medium">{record.title}</span>
                            {record.merged && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px]">合并稿</span>}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {record.sourcePath || "来自多份整理稿"}{record.updated ? ` · 更新于 ${record.updated}` : ""}
                          </div>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-hidden">
            {busyText || message ? (
              <div className="border-b px-4 py-2 text-sm">
                {busyText ? (
                  <div className="flex items-center gap-2 text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{busyText}</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground">{message}</div>
                )}
              </div>
            ) : null}
            {activeRecord ? (
              <TranscriptEditor
                key={activeRecord.markdownPath}
                projectPath={project.path}
                record={activeRecord}
                onSaved={(record) => {
                  setActiveRecord(record)
                  refreshWorkspace().catch(() => {})
                  bumpDataVersion()
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6">
                <div className="max-w-xl rounded-lg border border-dashed bg-card/20 p-6 text-sm text-muted-foreground">
                  <div className="mb-2 text-base font-semibold text-foreground">开始整理庭审笔录</div>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>先把 Word、PDF、TXT 等已成文笔录导入到 `raw/sources/`。</li>
                    <li>勾选左侧原始笔录，点击“整理选中笔录”。</li>
                    <li>若有多次开庭，可继续勾选多份原文或已整理稿生成合并稿。</li>
                    <li>整理结果会保存到 `wiki/庭审笔录/`，并可参与后续文书生成。</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
