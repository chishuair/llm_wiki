import { useCallback, useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  FileText, Gavel, ScrollText, ClipboardList, Wand2, Printer,
  FileDown, Loader2, RefreshCw, AlertTriangle, Upload, Trash2, Download, Pencil,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { caseStageLabel, loadCaseStageState, saveCaseStageState } from "@/lib/case-stage/state"
import { loadCaseMeta } from "@/lib/case-meta"
import {
  importTemplate,
  listTemplates,
  removeTemplate,
  subscribe as subscribeTemplates,
  validateTemplate,
} from "@/lib/legal-doc/registry"
import { collectCaseContext } from "@/lib/legal-doc/collect-case"
import { generateLegalDocument } from "@/lib/legal-doc/generate"
import { exportToDocx } from "@/lib/legal-doc/export"
import { summarizeSource } from "@/lib/legal-doc/source-summary"
import { listCodes as listLawCodes, subscribe as subscribeLawbase } from "@/lib/lawbase"
import { TemplateEditor } from "@/components/legal-doc/template-editor"
import type {
  CaseContext,
  GeneratedDocument,
  LegalDocTemplate,
} from "@/types/legal-doc"

type TemplateWithFlag = LegalDocTemplate & { builtin: boolean }

const CATEGORY_ICONS: Record<LegalDocTemplate["category"], typeof FileText> = {
  裁判: Gavel,
  笔录: ScrollText,
  程序: ClipboardList,
  其他: FileText,
}

export function LegalDocView() {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)

  const [stage, setStage] = useState<"pick" | "configure" | "preparing" | "generating" | "preview">("pick")
  const [prepare, setPrepare] = useState<null | { index: number; total: number; current: string }>(null)
  const [selected, setSelected] = useState<LegalDocTemplate | null>(null)
  const [ctx, setCtx] = useState<CaseContext | null>(null)
  const [caseNumber, setCaseNumber] = useState("")
  const [courtName, setCourtName] = useState("")
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [doc, setDoc] = useState<GeneratedDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [templates, setTemplates] = useState<TemplateWithFlag[]>(() => listTemplates())
  const [message, setMessage] = useState<null | { kind: "ok" | "err"; text: string }>(null)
  const [editing, setEditing] = useState<null | { draft: LegalDocTemplate; fork: boolean }>(null)
  const [caseStageText, setCaseStageText] = useState("未设置")
  const [metaRiskText, setMetaRiskText] = useState("")
  const [lawCount, setLawCount] = useState(() => listLawCodes().length)

  useEffect(() => {
    const unsub = subscribeTemplates(() => setTemplates(listTemplates()))
    return unsub
  }, [])

  useEffect(() => {
    const unsub = subscribeLawbase(() => setLawCount(listLawCodes().length))
    setLawCount(listLawCodes().length)
    return unsub
  }, [])

  useEffect(() => {
    if (!project) return
    loadCaseStageState(project.path)
      .then((state) => setCaseStageText(caseStageLabel(state.stage)))
      .catch(() => setCaseStageText("未设置"))
  }, [project])

  useEffect(() => {
    if (!project) return
    loadCaseMeta(project.path, project.name)
      .then((meta) => {
        const pending = Object.values(meta.confirmStates).filter((value) => value === "pending").length
        const conflicts = Object.values(meta.confirmStates).filter((value) => value === "conflict").length
        if (conflicts > 0) {
          setMetaRiskText(`当前有 ${conflicts} 项案件主数据存在冲突，建议先在案件总览中确认后再生成文书。`)
        } else if (pending > 0) {
          setMetaRiskText(`当前有 ${pending} 项案件主数据待确认，建议先复核案号、案由、法院等基础信息。`)
        } else {
          setMetaRiskText("")
        }
      })
      .catch(() => setMetaRiskText(""))
  }, [project])

  const grouped = useMemo(() => {
    const map = new Map<string, TemplateWithFlag[]>()
    for (const t of templates) {
      const list = map.get(t.category) ?? []
      list.push(t)
      map.set(t.category, list)
    }
    return [...map.entries()]
  }, [templates])

  const handleImport = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "文书模板 JSON", extensions: ["json"] }],
      title: "选择要导入的文书模板 JSON",
    })
    if (!picked || typeof picked !== "string") return
    try {
      const raw = await readFile(picked)
      const parsed = JSON.parse(raw) as unknown
      const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      let added = 0, replaced = 0
      for (const entry of entries) {
        const result = validateTemplate(entry)
        if (!result.ok) {
          setMessage({ kind: "err", text: `导入失败：${result.error}` })
          return
        }
        const status = await importTemplate(result.template)
        if (status === "added") added += 1
        else replaced += 1
      }
      setMessage({ kind: "ok", text: `已导入：新增 ${added} 份，更新 ${replaced} 份` })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ kind: "err", text: `解析 JSON 失败：${(err as Error).message}` })
    }
  }, [])

  const handleDeleteTemplate = useCallback(async (tpl: TemplateWithFlag) => {
    if (tpl.builtin) return
    if (!window.confirm(`确定删除模板「${tpl.name}」？`)) return
    await removeTemplate(tpl.id)
  }, [])

  const handleEditTemplate = useCallback((tpl: TemplateWithFlag) => {
    const draft: LegalDocTemplate = {
      id: tpl.id,
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      fontFamily: tpl.fontFamily,
      fontSizePt: tpl.fontSizePt,
      heading: tpl.heading,
      sections: tpl.sections.map((s) => ({ ...s })),
    }
    setEditing({ draft, fork: tpl.builtin })
  }, [])

  const handleSaveTemplate = useCallback(async (next: LegalDocTemplate) => {
    const status = await importTemplate(next)
    setEditing(null)
    setMessage({
      kind: "ok",
      text: status === "added" ? `已保存新模板「${next.name}」` : `已更新模板「${next.name}」`,
    })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleDownloadSample = useCallback(() => {
    const sample: LegalDocTemplate = {
      id: "my-court-sample",
      name: "本院样例：XX类案件判决书",
      category: "裁判",
      description: "法院可自定义的文书模板示例。",
      sections: [
        { id: "header", heading: "案件基本信息", kind: "static", template: "案号：{{case_number}}\n\n{{parties}}" },
        { id: "facts", heading: "经审理查明", kind: "llm", prompt: "写查明事实。" },
        { id: "reason", heading: "本院认为", kind: "llm", prompt: "写说理，仅引用本地法条库。" },
        { id: "tail", heading: "尾部", kind: "static", template: "审判长　　\n\n　　年　　月　　日" },
      ],
    }
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "文书模板-示例.json"
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handlePick = useCallback(
    async (template: LegalDocTemplate) => {
      if (!project) return
      setSelected(template)
      setError(null)
      setStage("configure")
      try {
        const c = await collectCaseContext(project)
        setCtx(c)
        setCaseNumber(c.case_number)
        setCourtName(c.court_name)
      } catch (err) {
        setError(`读取案件资料失败：${(err as Error).message}`)
      }
    },
    [project]
  )

  const handleGenerate = useCallback(async () => {
    if (!ctx || !selected || !project) return
    setError(null)

    // 先把需要摘要的长文件跑一遍；有缓存就秒过。
    const needing = ctx.raw_sources.filter((f) => f.needsSummary && !f.summary)
    let workingCtx = ctx
    if (needing.length > 0) {
      setStage("preparing")
      setPrepare({ index: 0, total: needing.length, current: needing[0].relativePath })
      const nextSources = [...ctx.raw_sources]
      for (let i = 0; i < needing.length; i++) {
        const file = needing[i]
        setPrepare({ index: i, total: needing.length, current: file.relativePath })
        try {
          const summary = await summarizeSource({
            projectPath: project.path,
            relativePath: file.relativePath,
            rawText: file.text,
            llmConfig,
          })
          const idx = nextSources.findIndex((f) => f.relativePath === file.relativePath)
          if (idx >= 0) nextSources[idx] = { ...nextSources[idx], summary: summary.text }
        } catch (err) {
          console.warn("summarize failed", file.relativePath, err)
        }
      }
      workingCtx = { ...ctx, raw_sources: nextSources }
      setCtx(workingCtx)
      setPrepare(null)
    }

    setStage("generating")
    setDoc(null)

    // 预占位：每节内容初始为空，生成时实时更新
    const placeholder: GeneratedDocument = {
      template: selected,
      caseContext: { ...workingCtx, case_number: caseNumber, court_name: courtName },
      title: selected.heading ?? selected.name,
      sections: selected.sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        content: "",
        source: s.kind,
      })),
      generatedAt: new Date().toISOString(),
    }
    setDoc(placeholder)

    try {
      const finalDoc = await generateLegalDocument({
        template: selected,
        caseContext: { ...workingCtx, case_number: caseNumber, court_name: courtName },
        llmConfig,
        onSectionStart: (sid) => setActiveSectionId(sid),
        onSectionToken: (sid, token) => {
          setDoc((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              sections: prev.sections.map((s) =>
                s.id === sid ? { ...s, content: s.content + token } : s
              ),
            }
          })
        },
        onSectionDone: (s) => {
          setDoc((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              sections: prev.sections.map((ss) => (ss.id === s.id ? s : ss)),
            }
          })
        },
      })
      setDoc(finalDoc)
      setActiveSectionId(null)
      await saveCaseStageState(project.path, "pending_review").catch(() => {})
      setCaseStageText(caseStageLabel("pending_review"))
      setStage("preview")
    } catch (err) {
      setError(`生成失败：${(err as Error).message}`)
      setStage("preview")
    }
  }, [ctx, selected, caseNumber, courtName, llmConfig, project])

  const updateSection = useCallback((sectionId: string, content: string) => {
    setDoc((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId ? { ...s, content } : s
        ),
      }
    })
  }, [])

  const handleReset = useCallback(() => {
    setStage("pick")
    setSelected(null)
    setCtx(null)
    setCaseNumber("")
    setCourtName("")
    setDoc(null)
    setActiveSectionId(null)
    setError(null)
  }, [])

  const handleExportDocx = useCallback(async () => {
    if (!doc) return
    try {
      setExporting(true)
      await exportToDocx(doc)
    } finally {
      setExporting(false)
    }
  }, [doc])

  const handlePrint = useCallback(() => {
    // 浏览器打印 → 可存为 PDF
    window.print()
  }, [])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请先打开一个案件项目。
      </div>
    )
  }

  if (stage === "pick") {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-wider">法律文书</h2>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleDownloadSample}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                下载模板示例
              </Button>
              <Button size="sm" onClick={handleImport}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                导入文书模板
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            选择一份模板，应用会自动读取当前案件的知识库内容，结合本地法条库生成文书草稿。
            法官可在预览界面逐节修改后导出为 Word / PDF。
          </p>
          {message && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                message.kind === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {message.text}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="space-y-6 p-6">
            {grouped.map(([category, templates]) => {
              const Icon = CATEGORY_ICONS[category as LegalDocTemplate["category"]] ?? FileText
              return (
                <div key={category} className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className="h-4 w-4 text-primary" />
                    {category}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="group relative flex flex-col gap-2 rounded-xl border bg-card/60 p-4 text-left shadow-sm transition hover:border-primary/60 hover:shadow-md"
                      >
                        <button
                          type="button"
                          onClick={() => handlePick(tpl)}
                          className="flex flex-col gap-2 text-left"
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold text-foreground">
                                  {tpl.name}
                                </div>
                                {!tpl.builtin && (
                                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-500">
                                    自定义
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {tpl.sections.length} 节结构
                              </div>
                            </div>
                          </div>
                          <p className="line-clamp-3 text-[11px] text-muted-foreground">
                            {tpl.description}
                          </p>
                        </button>
                        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => handleEditTemplate(tpl)}
                            className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
                            title={tpl.builtin ? "基于此内置模板创建副本" : "编辑该自定义模板"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {!tpl.builtin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(tpl)}
                              className="rounded p-1 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                              title="删除该自定义模板"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {editing && (
          <TemplateEditor
            draft={editing.draft}
            forkFromBuiltin={editing.fork}
            onCancel={() => setEditing(null)}
            onSave={handleSaveTemplate}
          />
        )}
      </div>
    )
  }

  // configure / generating / preview 都共用生成视图
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Wand2 className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold tracking-wider">
          {selected?.name}
        </h2>
        <Button variant="ghost" size="sm" onClick={handleReset} className="ml-auto">
          返回模板选择
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {stage === "configure" && ctx && (
        <div className="mx-auto w-full max-w-2xl space-y-6 p-8">
          <p className="text-sm text-muted-foreground">
            补全下方基础信息（可选），然后点击「开始生成」。应用将结合「{project.name}」
            的知识库内容与本地法条库生成草稿。
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">案号</Label>
              <Input
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="（2026）鲁XXXX民初XX号"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">受诉法院</Label>
              <Input
                value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
                placeholder="如：青岛市XX区人民法院"
              />
            </div>
          </div>

          <CaseDataHint ctx={ctx} caseStageText={caseStageText} metaRiskText={metaRiskText} lawCount={lawCount} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleReset}>
              取消
            </Button>
            <Button onClick={handleGenerate}>
              <Wand2 className="mr-1.5 h-4 w-4" />
              开始生成
            </Button>
          </div>
        </div>
      )}

      {stage === "preparing" && prepare && (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-8 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在阅读并提炼长原件（{prepare.index + 1} / {prepare.total}）
          </div>
          <div className="rounded-md border bg-card/40 p-3 text-xs text-muted-foreground">
            <div className="mb-2">
              当前文件：<span className="font-medium text-foreground">{prepare.current}</span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-[width]"
                style={{ width: `${((prepare.index + 0.4) / prepare.total) * 100}%` }}
              />
            </div>
            <p className="mt-3 leading-relaxed">
              为保证长原件（如鉴定报告、多页合同、卷宗摘录）不被截断，
              应用先由本地 LLM 把每份文件忠实提炼为结构化事实提要，并缓存到项目的
              <code className="mx-0.5 rounded bg-muted px-1">.llm-wiki/source-summaries/</code> 下。
              下次再生成文书时，若文件未修改会直接复用，不再耗时。
            </p>
          </div>
        </div>
      )}

      {(stage === "generating" || stage === "preview") && doc && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b bg-card/40 px-6 py-2 text-xs text-muted-foreground">
            <Loader2
              className={`h-3.5 w-3.5 ${stage === "generating" ? "animate-spin text-primary" : "hidden"}`}
            />
            {stage === "generating" ? (
              <span>正在生成：{activeSectionId ?? ""}</span>
            ) : (
              <span>生成完成。可在下方逐节修改，然后导出文书。</span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={stage === "generating"}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                重新生成
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={stage === "generating"}
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                打印 / 存为 PDF
              </Button>
              <Button
                size="sm"
                onClick={handleExportDocx}
                disabled={stage === "generating" || exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                )}
                导出 Word
              </Button>
            </div>
          </div>

          <div id="legal-doc-print-root" className="min-h-0 flex-1 overflow-y-auto">
            <DocPreview
              doc={doc}
              onSectionChange={updateSection}
              activeSectionId={stage === "generating" ? activeSectionId : null}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CaseDataHint({
  ctx,
  caseStageText,
  metaRiskText,
  lawCount,
}: {
  ctx: CaseContext
  caseStageText: string
  metaRiskText: string
  lawCount: number
}) {
  const entries: Array<[string, string]> = [
    ["案情概述", ctx.case_overview],
    ["当事人信息", ctx.parties],
    ["证据清单", ctx.evidence_list],
    ["争议焦点", ctx.disputes],
    ["法院认定事实", ctx.facts],
    ["本院认为", ctx.reasoning],
    ["判决结果", ctx.judgment],
    ["审理过程", ctx.procedure_log],
    ["开庭工作单", ctx.hearing_worksheet],
    ["庭审笔录", ctx.hearing_transcripts],
  ]
  const missing = entries.filter(([, v]) => !v.trim()).map(([k]) => k)
  const rawCount = ctx.raw_sources?.length ?? 0
  const hasWorksheet = ctx.hearing_worksheet.trim().length > 0

  const longFiles = ctx.raw_sources.filter((f) => f.needsSummary)
  const longFilesNeedingSummary = longFiles.filter((f) => !f.summary)
  const lines: React.ReactNode[] = []
  if (rawCount > 0) {
    lines.push(
      <div
        key="raw"
        className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
      >
        将参考 <b>{rawCount}</b> 份原件（raw/sources/）生成文书。
        {longFiles.length > 0 && (
          <span className="ml-1">
            其中 <b>{longFiles.length}</b> 份较长会先被 LLM 提炼为事实提要。
            {longFilesNeedingSummary.length > 0
              ? `首次生成需对 ${longFilesNeedingSummary.length} 份做一次提要（约每份 10-60 秒），结果会缓存，之后秒开。`
              : "已有缓存提要，生成时直接复用。"}
          </span>
        )}
      </div>
    )
  } else {
    lines.push(
      <div
        key="raw-empty"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          raw/sources/ 下没有原始材料
        </div>
        <div className="mt-1 text-[11px] text-amber-500/80">
          建议先在「案件材料」中导入合同、笔录、证据扫描件等原件，生成的文书会更准确。
        </div>
      </div>
    )
  }

  if (hasWorksheet) {
    lines.push(
      <div
        key="worksheet"
        className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-500"
      >
        已接入开庭工作单，文书生成时会按章节映射规则优先参考其中的庭审提纲、关键要素状态、发问建议、补证建议和工作清单。
      </div>
    )
  }

  if (lawCount > 0) {
    lines.push(
      <div
        key="lawbase"
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600"
      >
        本地法规库已接入 <b>{lawCount}</b> 部法律法规。文书中的法条引用将以本地法规库为准；库中未收录的法律，应先导入后再生成正式草稿。
      </div>
    )
  } else {
    lines.push(
      <div
        key="lawbase-empty"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        本地法规库为空。为避免 AI 编造法条，请先进入「法律依据」导入相关法律法规后再生成正式文书。
      </div>
    )
  }

  lines.push(
    <div
      key="stage"
      className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-600"
    >
      当前案件阶段：{caseStageText}
    </div>
  )

  lines.push(
    <div
      key="meta"
      className="rounded-md border border-slate-500/30 bg-slate-500/5 px-3 py-2 text-xs text-slate-600"
    >
      当前已接入统一案件主数据：案号 {ctx.case_number || "未填写"}；受诉法院 {ctx.court_name || "未填写"}。
    </div>
  )

  if (metaRiskText) {
    lines.push(
      <div
        key="meta-risk"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600"
      >
        {metaRiskText}
      </div>
    )
  }

  if (missing.length === 0) {
    lines.push(
      <div
        key="ok"
        className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-500"
      >
        结构化知识库齐备，加上法条库与原件，应用会综合生成草稿。
      </div>
    )
  } else {
    lines.push(
      <div
        key="missing"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          以下资料在结构化知识库中尚未填写
        </div>
        <div className="mt-1 text-[11px] text-amber-500/80">
          {missing.join("、")}。缺失部分 LLM 会尝试从上方原件中提取，但生成效果可能下降。
        </div>
      </div>
    )
  }

  return <div className="space-y-2">{lines}</div>
}

function DocPreview({
  doc,
  onSectionChange,
  activeSectionId,
}: {
  doc: GeneratedDocument
  onSectionChange: (id: string, value: string) => void
  activeSectionId: string | null
}) {
  return (
    <div className="mx-auto max-w-[820px] space-y-6 bg-background p-10 print:p-0">
      <h1 className="text-center text-2xl font-bold tracking-[0.4em]">{doc.title}</h1>
      {doc.sections.map((section) => (
        <PreviewSection
          key={section.id}
          section={section}
          active={activeSectionId === section.id}
          onChange={(v) => onSectionChange(section.id, v)}
        />
      ))}
    </div>
  )
}

function PreviewSection({
  section,
  active,
  onChange,
}: {
  section: GeneratedSection
  active: boolean
  onChange: (value: string) => void
}) {
  return (
    <section
      className={`space-y-2 rounded-md border px-4 py-3 transition-colors ${
        active ? "border-primary/70 bg-primary/5" : "border-transparent"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-3.5 w-3.5 text-primary" />
        {section.heading}
        {section.source === "llm" && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
            AI 草稿
          </span>
        )}
      </div>
      {section.contextSummary && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-700">
          {section.contextSummary}
        </div>
      )}
      {section.citedLawLines && section.citedLawLines.length > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700">
          本节已校验法条：{section.citedLawLines.join("、")}
        </div>
      )}
      {section.suggestedMissingLawNames && section.suggestedMissingLawNames.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
          建议补充导入：{section.suggestedMissingLawNames.join("、")}
        </div>
      )}
      <textarea
        value={section.content}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(3, Math.ceil(section.content.length / 60))}
        className="w-full resize-y rounded-md border bg-background px-3 py-2 font-serif text-[15px] leading-loose"
        spellCheck={false}
      />
    </section>
  )
}

export default LegalDocView
