import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Download, Printer, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { loadTranscriptRecord } from "@/lib/transcript/storage"
import {
  buildTranscriptWorksheet,
  exportTranscriptWorksheetToDocxWithMeta,
  exportTranscriptWorksheetToPrintWithMeta,
} from "@/lib/transcript/worksheet"
import { useHearingWorkspaceStore } from "@/stores/hearing-workspace-store"
import { useWikiStore } from "@/stores/wiki-store"
import { caseStageLabel, loadCaseStageState, saveCaseStageState } from "@/lib/case-stage/state"
import { loadWorksheetState, saveWorksheetState } from "@/lib/worksheet/state"
import type { FileNode } from "@/types/wiki"

function flatten(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flatten(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

interface WorksheetCandidate {
  path: string
  title: string
  updated: string
  merged: boolean
}

export function WorksheetView() {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const jumpToHearing = useHearingWorkspaceStore((s) => s.jumpTo)
  const [records, setRecords] = useState<WorksheetCandidate[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [activeWorksheetPath, setActiveWorksheetPath] = useState<string | null>(null)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof loadTranscriptRecord>> | null>(null)
  const [message, setMessage] = useState("")
  const [stageLabel, setStageLabel] = useState("未设置")

  const refresh = useCallback(async () => {
    if (!project) return
    const root = normalizePath(project.path)
    const savedState = await loadWorksheetState(root)
    const caseStage = await loadCaseStageState(root)
    const tree = await listDirectory(`${root}/wiki/庭审笔录`).catch(() => [] as FileNode[])
    const files = flatten(tree).filter((file) => file.name.endsWith(".md")).sort((a, b) => b.name.localeCompare(a.name))
    const next = await Promise.all(
      files.map(async (file) => {
        try {
          const loaded = await loadTranscriptRecord(file.path)
          return {
            path: file.path,
            title: loaded.frontmatter.title,
            updated: loaded.frontmatter.updated,
            merged: Boolean(loaded.data.mergeMeta?.merged),
          }
        } catch {
          return {
            path: file.path,
            title: file.name.replace(/\.md$/, ""),
            updated: "",
            merged: false,
          }
        }
      })
    )
    setRecords(next)
    const preferred = savedState.activeRecordPath && next.some((item) => item.path === savedState.activeRecordPath)
      ? savedState.activeRecordPath
      : next[0]?.path ?? null
    setActiveWorksheetPath(preferred)
    setSelectedPath((current) => current ?? preferred)
    setStageLabel(caseStageLabel(caseStage.stage))
  }, [project])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  useEffect(() => {
    if (!selectedPath) {
      setRecord(null)
      return
    }
    loadTranscriptRecord(selectedPath).then(setRecord).catch(() => setRecord(null))
  }, [selectedPath])

  const worksheet = useMemo(() => (record ? buildTranscriptWorksheet(record) : null), [record])

  async function handleExportDocx() {
    if (!record) return
    try {
      await exportTranscriptWorksheetToDocxWithMeta(project.path, record)
      setMessage("已导出开庭工作单 Word")
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`导出失败：${String(error)}`)
    }
  }

  async function handlePrint() {
    if (!record) return
    try {
      await exportTranscriptWorksheetToPrintWithMeta(project.path, record)
      setMessage("已打开打印版开庭工作单")
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`打印失败：${String(error)}`)
    }
  }

  async function handleSetActiveWorksheet() {
    if (!project || !selectedPath) return
    try {
      await saveWorksheetState(project.path, { activeRecordPath: selectedPath })
      await saveCaseStageState(project.path, "pending_doc").catch(() => {})
      setActiveWorksheetPath(selectedPath)
      setStageLabel(caseStageLabel("pending_doc"))
      setMessage("已设为当前生效工作单")
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`设置失败：${String(error)}`)
    }
  }

  function handleOpenSourceRecord() {
    if (!record) return
    setSelectedFile(record.markdownPath)
    jumpToHearing("transcript", record.markdownPath, null, null, null)
    setActiveView("transcript")
  }

  function handleWorksheetItemClick(target?: {
    tab: "transcript" | "elements" | "disputes" | "evidence"
    transcriptPath?: string
    elementId?: string
    focusText?: string
  }) {
    if (!target) return
    if (target.transcriptPath) {
      setSelectedFile(target.transcriptPath)
    }
    jumpToHearing(
      target.tab,
      target.transcriptPath ?? null,
      target.elementId ?? null,
      target.focusText ?? null,
      target.evidenceId ?? null
    )
    setActiveView("transcript")
  }

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开案件知识库</div>
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_1fr]">
      <div className="flex min-h-0 flex-col border-r">
        <div className="border-b px-4 py-4">
          <div className="text-lg font-semibold">开庭工作单</div>
          <div className="mt-1 text-sm text-muted-foreground">
            以庭审整理稿为基础，集中查看、导出和打印当前生效的开庭工作单。
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {records.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              尚未生成庭审整理稿，请先到“证据与庭审”中整理庭审笔录。
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((item) => {
                const active = item.path === selectedPath
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => setSelectedPath(item.path)}
                    className={`w-full rounded-lg border px-3 py-3 text-left ${
                      active ? "border-primary bg-primary/5" : "hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ScrollText className="h-4 w-4 text-primary" />
                      <div className="truncate font-medium">{item.title}</div>
                      {item.merged && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px]">合并稿</span>}
                      {item.path === activeWorksheetPath && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
                          当前生效
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {item.updated ? `更新于 ${item.updated}` : "未记录更新时间"}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden">
        {record && worksheet ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{worksheet.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {worksheet.subtitle.join(" ｜ ")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    当前状态：{selectedPath === activeWorksheetPath ? "当前生效工作单" : "未设为当前生效工作单"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">案件阶段：{stageLabel}</div>
                </div>
                <div className="flex items-center gap-2">
                  {message && <span className="text-xs text-muted-foreground">{message}</span>}
                  <Button variant="outline" onClick={handleOpenSourceRecord}>
                    <ScrollText className="mr-1.5 h-4 w-4" />
                    打开来源整理稿
                  </Button>
                  <Button variant="outline" onClick={() => setActiveView("transcript")}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    返回证据与庭审
                  </Button>
                  <Button variant="outline" onClick={handleSetActiveWorksheet}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    设为当前生效
                  </Button>
                  <Button variant="outline" onClick={handleExportDocx}>
                    <Download className="mr-1.5 h-4 w-4" />
                    导出 Word
                  </Button>
                  <Button variant="outline" onClick={handlePrint}>
                    <Printer className="mr-1.5 h-4 w-4" />
                    打印
                  </Button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto max-w-5xl space-y-5">
                {worksheet.sections.map((section) => (
                  <div key={section.heading} className="rounded-xl border bg-card/40 p-5">
                    <div className="mb-3 text-base font-semibold">{section.heading}</div>
                    {section.lines.length > 0 ? (
                      <ul className="space-y-2 text-sm">
                        {section.items.map((item) => (
                          <li key={item.text} className="rounded-md bg-background/70 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleWorksheetItemClick(item.target)}
                              className="w-full text-left hover:text-primary"
                            >
                              {item.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-sm text-muted-foreground">（暂无）</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            请选择一份庭审整理稿以查看对应的开庭工作单。
          </div>
        )}
      </div>
    </div>
  )
}
