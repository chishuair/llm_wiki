import { useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, FileText, Files, Gavel, RefreshCw, Scale, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { saveCaseStageState, type CaseStageId } from "@/lib/case-stage/state"
import { loadCaseMeta, saveCaseMeta, type CaseMeta, type CaseMetaConfirmState, type CaseMetaField } from "@/lib/case-meta"
import { extractCaseMetaSuggestion } from "@/lib/case-meta-extract"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import { subscribe as subscribeLawbase } from "@/lib/lawbase"
import { collectDashboardSummary, type DashboardSummary } from "@/lib/dashboard/summary"
import type { CaseMetaSuggestion } from "@/lib/case-meta-extract"

export function CaseDashboardView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingStage, setSavingStage] = useState(false)
  const [metaDraft, setMetaDraft] = useState<CaseMeta | null>(null)
  const [savingMeta, setSavingMeta] = useState(false)
  const [extractingMeta, setExtractingMeta] = useState(false)
  const [sourceHints, setSourceHints] = useState<Record<string, string>>({})
  const [sourceNote, setSourceNote] = useState("")
  const [candidateMap, setCandidateMap] = useState<CaseMetaSuggestion["candidates"]>({})
  const [conflictFields, setConflictFields] = useState<string[]>([])
  const [autoExtractedKey, setAutoExtractedKey] = useState("")

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoading(true)
    collectDashboardSummary(project)
      .then((next) => {
        if (!cancelled) {
          setSummary(next)
          setMetaDraft(next.meta)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project, dataVersion])

  useEffect(() => {
    const unsubscribe = subscribeLawbase(() => {
      if (!project) return
      collectDashboardSummary(project).then(setSummary).catch(() => {})
    })
    return unsubscribe
  }, [project])

  useEffect(() => {
    if (!project || !summary || !metaDraft) return
    const key = `${project.path}:${dataVersion}:${summary.materialCount}`
    if (autoExtractedKey === key) return
    const needAutoFill = summary.materialCount > 0 && shouldAutoExtractMeta(metaDraft)
    if (!needAutoFill || extractingMeta) return
    let cancelled = false
    setAutoExtractedKey(key)
    setExtractingMeta(true)
    extractCaseMetaSuggestion(project.path, llmConfig, summary.caseName)
      .then((suggestion) => {
        if (cancelled) return
        const base = useWikiStore.getState().project?.path === project.path ? metaDraft : null
        const mergedForSave = base
          ? mergeMetaSuggestion(base, suggestion.values, suggestion.conflicts || [])
          : null
        if (mergedForSave) {
          setMetaDraft(mergedForSave)
          saveCaseMeta(project.path, mergedForSave)
            .then(() => collectDashboardSummary(project).then(setSummary).catch(() => {}))
            .catch(() => {})
        }
        setSourceHints(suggestion.sourceHints as Record<string, string>)
        setCandidateMap(suggestion.candidates || {})
        setConflictFields(suggestion.conflicts || [])
        setSourceNote(suggestion.note || "")
      })
      .finally(() => {
        if (!cancelled) setExtractingMeta(false)
      })
    return () => {
      cancelled = true
    }
  }, [project, summary, metaDraft, llmConfig, extractingMeta, dataVersion, autoExtractedKey])

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开案件知识库</div>
  }

  if (loading || !summary) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在汇总案件状态...</div>
  }

  async function handleStageChange(stage: CaseStageId) {
    if (!project) return
    setSavingStage(true)
    try {
      await saveCaseStageState(project.path, stage)
      const next = await collectDashboardSummary(project)
      setSummary(next)
    } finally {
      setSavingStage(false)
    }
  }

  async function handleMetaSave() {
    if (!project || !metaDraft) return
    setSavingMeta(true)
    try {
      await saveCaseMeta(project.path, metaDraft)
      const next = await collectDashboardSummary(project)
      setSummary(next)
      setMetaDraft(next.meta)
      setSourceNote("案件主数据已保存。")
    } finally {
      setSavingMeta(false)
    }
  }

  async function handleRefreshSummary() {
    if (!project) return
    setLoading(true)
    try {
      const next = await collectDashboardSummary(project)
      setSummary(next)
      setMetaDraft(next.meta)
      setAutoExtractedKey("")
      useWikiStore.getState().bumpDataVersion()
    } finally {
      setLoading(false)
    }
  }

  async function handleAutoExtract() {
    if (!project || !summary) return
    setAutoExtractedKey("")
    setSourceNote("正在从原始材料和已生成知识页识别案件主数据...")
    setExtractingMeta(true)
    try {
      const suggestion = await extractCaseMetaSuggestion(project.path, llmConfig, summary.caseName)
      const mergedForSave = metaDraft
        ? mergeMetaSuggestion(metaDraft, suggestion.values, suggestion.conflicts || [], { forceUnconfirmed: true })
        : null
      if (mergedForSave) {
        setMetaDraft(mergedForSave)
        await saveCaseMeta(project.path, mergedForSave)
        const next = await collectDashboardSummary(project)
        setSummary(next)
      }
      setSourceHints(suggestion.sourceHints as Record<string, string>)
      setCandidateMap(suggestion.candidates || {})
      setConflictFields(suggestion.conflicts || [])
      setSourceNote(suggestion.note || "识别完成，请人工确认后保存。")
    } catch (err) {
      setSourceNote(`识别失败：${(err as Error).message}`)
    } finally {
      setExtractingMeta(false)
    }
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-xl border bg-card/50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-2xl font-semibold">{summary.caseName}</div>
              <div className="text-sm text-muted-foreground">案件总览驾驶舱</div>
              <div className="text-sm">
                当前阶段：<span className="font-medium text-primary">{summary.currentStage}</span>
              </div>
              <div className="text-xs text-muted-foreground">{summary.projectPath}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.actions.slice(0, 3).map((action) => (
                <Button key={action.id} variant="outline" onClick={() => setActiveView(action.targetView)}>
                  {action.label}
                </Button>
              ))}
              <Button variant="outline" onClick={handleRefreshSummary} disabled={loading}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                刷新总览
              </Button>
              <Button variant="outline" onClick={handleAutoExtract} disabled={extractingMeta}>
                {extractingMeta ? "识别中..." : "从材料自动识别"}
              </Button>
            </div>
          </div>
          {metaDraft && (
            <div className="mt-5 grid gap-4 rounded-xl border bg-background/50 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetaField
                label="案件名称"
                hint={sourceHints.caseName}
                conflict={conflictFields.includes("caseName")}
                state={metaDraft.confirmStates.caseName}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "caseName"))}
              >
                <Input value={metaDraft.caseName} onChange={(e) => setMetaDraft({ ...metaDraft, caseName: e.target.value })} />
                <CandidateChips
                  items={candidateMap.caseName}
                  currentValue={metaDraft.caseName}
                  onPick={(value) => setMetaDraft({ ...metaDraft, caseName: value })}
                />
              </MetaField>
              <MetaField
                label="案号"
                hint={sourceHints.caseNumber}
                conflict={conflictFields.includes("caseNumber")}
                state={metaDraft.confirmStates.caseNumber}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "caseNumber"))}
              >
                <Input value={metaDraft.caseNumber} onChange={(e) => setMetaDraft({ ...metaDraft, caseNumber: e.target.value })} placeholder="（2026）某法民初XX号" />
                <CandidateChips
                  items={candidateMap.caseNumber}
                  currentValue={metaDraft.caseNumber}
                  onPick={(value) => setMetaDraft({ ...metaDraft, caseNumber: value })}
                />
              </MetaField>
              <MetaField
                label="案由"
                hint={sourceHints.cause}
                conflict={conflictFields.includes("cause")}
                state={metaDraft.confirmStates.cause}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "cause"))}
              >
                <Input value={metaDraft.cause} onChange={(e) => setMetaDraft({ ...metaDraft, cause: e.target.value })} />
                <CandidateChips
                  items={candidateMap.cause}
                  currentValue={metaDraft.cause}
                  onPick={(value) => setMetaDraft({ ...metaDraft, cause: value })}
                />
              </MetaField>
              <MetaField
                label="案件类型"
                hint={sourceHints.caseType}
                conflict={conflictFields.includes("caseType")}
                state={metaDraft.confirmStates.caseType}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "caseType"))}
              >
                <select
                  value={metaDraft.caseType}
                  onChange={(e) => setMetaDraft({ ...metaDraft, caseType: e.target.value as CaseMeta["caseType"] })}
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="民事">民事</option>
                  <option value="刑事">刑事</option>
                  <option value="行政">行政</option>
                  <option value="执行">执行</option>
                  <option value="其他">其他</option>
                </select>
                <CandidateChips
                  items={candidateMap.caseType}
                  currentValue={metaDraft.caseType}
                  onPick={(value) => setMetaDraft({ ...metaDraft, caseType: value as CaseMeta["caseType"] })}
                />
              </MetaField>
              <MetaField
                label="子类型"
                hint={sourceHints.subtype}
                conflict={conflictFields.includes("subtype")}
                state={metaDraft.confirmStates.subtype}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "subtype"))}
              >
                <Input value={metaDraft.subtype} onChange={(e) => setMetaDraft({ ...metaDraft, subtype: e.target.value })} />
                <CandidateChips
                  items={candidateMap.subtype}
                  currentValue={metaDraft.subtype}
                  onPick={(value) => setMetaDraft({ ...metaDraft, subtype: value })}
                />
              </MetaField>
              <MetaField
                label="受诉法院"
                hint={sourceHints.courtName}
                conflict={conflictFields.includes("courtName")}
                state={metaDraft.confirmStates.courtName}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "courtName"))}
              >
                <Input value={metaDraft.courtName} onChange={(e) => setMetaDraft({ ...metaDraft, courtName: e.target.value })} />
                <CandidateChips
                  items={candidateMap.courtName}
                  currentValue={metaDraft.courtName}
                  onPick={(value) => setMetaDraft({ ...metaDraft, courtName: value })}
                />
              </MetaField>
              <MetaField
                label="承办法官"
                hint={sourceHints.presidingJudge}
                conflict={conflictFields.includes("presidingJudge")}
                state={metaDraft.confirmStates.presidingJudge}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "presidingJudge"))}
              >
                <Input value={metaDraft.presidingJudge} onChange={(e) => setMetaDraft({ ...metaDraft, presidingJudge: e.target.value })} />
                <CandidateChips
                  items={candidateMap.presidingJudge}
                  currentValue={metaDraft.presidingJudge}
                  onPick={(value) => setMetaDraft({ ...metaDraft, presidingJudge: value })}
                />
              </MetaField>
              <MetaField
                label="书记员"
                hint={sourceHints.clerk}
                conflict={conflictFields.includes("clerk")}
                state={metaDraft.confirmStates.clerk}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "clerk"))}
              >
                <Input value={metaDraft.clerk} onChange={(e) => setMetaDraft({ ...metaDraft, clerk: e.target.value })} />
                <CandidateChips
                  items={candidateMap.clerk}
                  currentValue={metaDraft.clerk}
                  onPick={(value) => setMetaDraft({ ...metaDraft, clerk: value })}
                />
              </MetaField>
              <MetaField
                label="程序阶段"
                hint={sourceHints.procedureStage}
                conflict={conflictFields.includes("procedureStage")}
                state={metaDraft.confirmStates.procedureStage}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "procedureStage"))}
              >
                <Input value={metaDraft.procedureStage} onChange={(e) => setMetaDraft({ ...metaDraft, procedureStage: e.target.value })} placeholder="如：待开庭 / 已开庭待文书" />
                <CandidateChips
                  items={candidateMap.procedureStage}
                  currentValue={metaDraft.procedureStage}
                  onPick={(value) => setMetaDraft({ ...metaDraft, procedureStage: value })}
                />
              </MetaField>
              <MetaField
                label="下次庭审时间"
                hint={sourceHints.nextHearingAt}
                conflict={conflictFields.includes("nextHearingAt")}
                state={metaDraft.confirmStates.nextHearingAt}
                onConfirm={() => setMetaDraft(confirmField(metaDraft, "nextHearingAt"))}
              >
                <Input type="datetime-local" value={metaDraft.nextHearingAt} onChange={(e) => setMetaDraft({ ...metaDraft, nextHearingAt: e.target.value })} />
                <CandidateChips
                  items={candidateMap.nextHearingAt}
                  currentValue={metaDraft.nextHearingAt}
                  onPick={(value) => setMetaDraft({ ...metaDraft, nextHearingAt: value })}
                />
              </MetaField>
              <div className="md:col-span-2 xl:col-span-4 flex flex-col gap-2">
                {sourceNote && <div className="text-xs text-muted-foreground">{sourceNote}</div>}
                <div className="text-xs text-muted-foreground">
                  主数据状态：待确认 {countByState(metaDraft.confirmStates, "pending")} 项；存在冲突 {countByState(metaDraft.confirmStates, "conflict")} 项；已确认 {countByState(metaDraft.confirmStates, "confirmed")} 项。
                </div>
                <div className="flex justify-end">
                <Button onClick={handleMetaSave} disabled={savingMeta}>
                  {savingMeta ? "保存中..." : "保存案件主数据"}
                </Button>
                </div>
              </div>
            </div>
          )}
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <ProgressCard
            icon={Files}
            title="案件材料"
            value={`${summary.materialCount} 份`}
            hint={summary.materialCount > 0 ? "已导入原始卷宗材料" : "尚未导入材料"}
            onClick={() => setActiveView("sources")}
          />
          <ProgressCard
            icon={FileText}
            title="证据清单"
            value={`${summary.evidencePageCount} 页`}
            hint={summary.evidencePageCount > 0 ? "已形成结构化证据页" : "尚未整理证据"}
            onClick={() => setActiveView("transcript")}
          />
          <ProgressCard
            icon={ScrollText}
            title="庭审笔录"
            value={`${summary.transcriptCount} 份`}
            hint={summary.hasWorksheet ? "已生成工作单内容" : "待整理或待生成工作单"}
            onClick={() => setActiveView("transcript")}
          />
          <ProgressCard
            icon={Scale}
            title="法律依据"
            value={`${summary.lawCount} 部`}
            hint={summary.lawCount > 0 ? "本地法条库可供引用" : "尚未导入法律依据"}
            onClick={() => setActiveView("lawbase")}
          />
          <ProgressCard
            icon={Gavel}
            title="法律文书"
            value={summary.hasWorksheet ? "可起草" : "待补工作单"}
            hint="按工作单与知识页生成文书草稿"
            onClick={() => setActiveView("legal-doc")}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border bg-card/40 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              风险与缺口提醒
            </div>
            <div className="space-y-2 text-sm">
              <RiskRow label="主数据待确认" value={`${summary.metaPendingCount} 项`} />
              <RiskRow label="主数据冲突" value={`${summary.metaConflictCount} 项`} />
              <RiskRow label="有争议要素" value={`${summary.disputedCount} 项`} />
              <RiskRow label="待补证要素" value={`${summary.missingEvidenceCount} 项`} />
              <RiskRow label="法律依据缺口" value={summary.lawCount > 0 ? "已具备" : "待导入"} />
              <RiskRow label="开庭工作单" value={summary.hasWorksheet ? "已具备" : "待生成"} />
            </div>
          </div>

          <div className="rounded-xl border bg-card/40 p-5">
            <div className="mb-3 text-sm font-semibold">当前争议摘要</div>
            {summary.focusSummaries.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {summary.focusSummaries.map((item) => (
                  <li key={item} className="rounded-md bg-background/70 px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground">当前尚无争议摘要，建议先整理庭审笔录或证据与庭审信息。</div>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}

function MetaField({
  label,
  hint,
  conflict,
  state,
  onConfirm,
  children,
}: {
  label: string
  hint?: string
  conflict?: boolean
  state?: CaseMetaConfirmState
  onConfirm?: () => void
  children: React.ReactNode
}) {
  const stateText =
    state === "confirmed" ? "已确认" : state === "conflict" ? "有冲突" : state === "pending" ? "待确认" : ""
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className={`text-xs ${conflict ? "text-amber-600" : "text-muted-foreground"}`}>
          {label}{conflict ? "（存在多个候选值）" : ""}
        </Label>
        {stateText ? (
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              state === "confirmed"
                ? "bg-emerald-500/10 text-emerald-600"
                : state === "conflict"
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-sky-500/10 text-sky-600"
            }`}
          >
            {stateText}
          </button>
        ) : null}
      </div>
      {children}
      {hint ? <div className="text-[11px] text-muted-foreground">识别来源：{hint}</div> : null}
    </div>
  )
}

function CandidateChips({
  items,
  currentValue,
  onPick,
}: {
  items?: Array<{ value: string; source: string }>
  currentValue: string
  onPick: (value: string) => void
}) {
  if (!items || items.length <= 1) return null
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={`${item.value}-${item.source}`}
          type="button"
          onClick={() => onPick(item.value)}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            currentValue === item.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
          title={`来源：${item.source}`}
        >
          {item.value}
        </button>
      ))}
    </div>
  )
}

function buildConfirmStates(
  previous: Partial<Record<CaseMetaField, CaseMetaConfirmState>> = {},
  conflicts: string[],
  values: Partial<CaseMeta>
): Partial<Record<CaseMetaField, CaseMetaConfirmState>> {
  const next = { ...previous }
  const fields: CaseMetaField[] = [
    "caseName",
    "caseNumber",
    "cause",
    "caseType",
    "subtype",
    "courtName",
    "presidingJudge",
    "clerk",
    "procedureStage",
    "nextHearingAt",
  ]
  for (const field of fields) {
    const value = values[field]
    if (!value) continue
    next[field] = conflicts.includes(field) ? "conflict" : previous[field] === "confirmed" ? "confirmed" : "pending"
  }
  return next
}

function isPlaceholderValue(field: CaseMetaField, value: string | undefined): boolean {
  const text = (value || "").trim()
  if (!text) return true
  if (/X{2,}|某|待填|待确认|示例/.test(text)) return true
  if (field === "caseNumber" && /（2026）.*民初.*号/.test(text) && /X|某|英法/.test(text)) return true
  return false
}

function shouldAutoExtractMeta(meta: CaseMeta): boolean {
  const fields: CaseMetaField[] = ["caseNumber", "cause", "courtName", "caseType", "subtype", "presidingJudge", "clerk", "procedureStage"]
  return fields.some((field) => {
    const state = meta.confirmStates[field]
    if (state === "confirmed") return false
    return isPlaceholderValue(field, String(meta[field] ?? ""))
  })
}

function mergeMetaSuggestion(
  prev: CaseMeta,
  values: Partial<CaseMeta>,
  conflicts: string[],
  options: { forceUnconfirmed?: boolean } = {}
): CaseMeta {
  const next: CaseMeta = { ...prev }
  const fields: CaseMetaField[] = [
    "caseName",
    "caseNumber",
    "cause",
    "caseType",
    "subtype",
    "courtName",
    "presidingJudge",
    "clerk",
    "procedureStage",
    "nextHearingAt",
  ]
  for (const field of fields) {
    const incoming = values[field]
    if (typeof incoming !== "string" || !incoming.trim()) continue
    const state = prev.confirmStates[field]
    const current = String(prev[field] ?? "")
    const mayReplace = options.forceUnconfirmed
      ? state !== "confirmed"
      : state !== "confirmed" && isPlaceholderValue(field, current)
    if (mayReplace) {
      ;(next as unknown as Record<string, string>)[field] = incoming.trim()
    }
  }
  next.confirmStates = buildConfirmStates(prev.confirmStates, conflicts, values)
  return next
}

function confirmField(meta: CaseMeta, field: CaseMetaField): CaseMeta {
  return {
    ...meta,
    confirmStates: {
      ...meta.confirmStates,
      [field]: "confirmed",
    },
  }
}

function countByState(
  states: Partial<Record<CaseMetaField, CaseMetaConfirmState>>,
  target: CaseMetaConfirmState
): number {
  return Object.values(states).filter((value) => value === target).length
}

function ProgressCard({
  icon: Icon,
  title,
  value,
  hint,
  onClick,
}: {
  icon: typeof Files
  title: string
  value: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border bg-card/40 p-4 text-left hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="mb-3 flex items-center justify-between">
        <Icon className="h-5 w-5 text-primary" />
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
    </button>
  )
}

function RiskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-background/70 px-3 py-2">
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
