import { useMemo, useState } from "react"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { buildTranscriptElementAlerts, buildTranscriptWorkPlan } from "@/lib/transcript/alerts"
import { saveTranscriptRecord } from "@/lib/transcript/storage"
import { exportTranscriptWorksheetToDocx, exportTranscriptWorksheetToPrint } from "@/lib/transcript/worksheet"
import type {
  TranscriptElementValue,
  TranscriptRecord,
  TranscriptInsight,
  TranscriptCaseType,
  TranscriptSegment,
} from "@/types/transcript"
import { getTranscriptSubtypeOptions } from "@/lib/transcript/rules"

interface TranscriptEditorProps {
  projectPath: string
  record: TranscriptRecord
  onSaved?: (record: TranscriptRecord) => void
}

function cloneRecord(record: TranscriptRecord): TranscriptRecord {
  return {
    ...record,
    frontmatter: { ...record.frontmatter },
    data: {
      ...record.data,
      segments: record.data.segments.map((segment) => ({ ...segment })),
      keyElements: record.data.keyElements.map((item) => ({ ...item, supportSegmentIds: [...item.supportSegmentIds] })),
      issues: record.data.issues.map((item) => ({ ...item, supportSegmentIds: [...item.supportSegmentIds] })),
      evidenceOpinions: record.data.evidenceOpinions.map((item) => ({ ...item, supportSegmentIds: [...item.supportSegmentIds] })),
      argumentPoints: record.data.argumentPoints.map((item) => ({ ...item, supportSegmentIds: [...item.supportSegmentIds] })),
      proceduralNotes: [...record.data.proceduralNotes],
      mergeMeta: record.data.mergeMeta
        ? {
            ...record.data.mergeMeta,
            sourcePaths: [...record.data.mergeMeta.sourcePaths],
            conflictNotes: record.data.mergeMeta.conflictNotes ? [...record.data.mergeMeta.conflictNotes] : [],
          }
        : undefined,
    },
  }
}

function ItemEditor({
  title,
  items,
  onChange,
}: {
  title: string
  items: TranscriptInsight[]
  onChange: (items: TranscriptInsight[]) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...items,
              {
                id: `${title}-${Date.now()}`,
                title: "",
                summary: "",
                supportSegmentIds: [],
              },
            ])
          }
        >
          新增
        </Button>
      </div>
      {items.length === 0 && (
        <div className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground">
          暂无内容，可点击右上角新增。
        </div>
      )}
      {items.map((item, index) => (
        <div key={item.id} className="space-y-2 rounded-md border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <Input
              value={item.title}
              onChange={(e) => {
                const next = [...items]
                next[index] = { ...next[index], title: e.target.value }
                onChange(next)
              }}
              placeholder="标题"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(items.filter((_, current) => current !== index))}
            >
              删除
            </Button>
          </div>
          <textarea
            value={item.summary}
            onChange={(e) => {
              const next = [...items]
              next[index] = { ...next[index], summary: e.target.value }
              onChange(next)
            }}
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="请填写该要点的整理结果"
          />
          <div className="text-[11px] text-muted-foreground">
            支持片段：{item.supportSegmentIds.length > 0 ? item.supportSegmentIds.join("、") : "暂无"}
          </div>
        </div>
      ))}
    </div>
  )
}

function ElementEditor({
  items,
  emptyMessage,
  onChange,
}: {
  items: TranscriptElementValue[]
  emptyMessage: string
  onChange: (items: TranscriptElementValue[]) => void
}) {
  return (
    <div className="rounded-lg border bg-card/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">关键要素</h3>
        <span className="text-xs text-muted-foreground">按案件子类型提取</span>
      </div>
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        )}
        {items.map((item, index) => (
          <div key={item.id} className="rounded-md border bg-background/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">{item.label}</div>
              <select
                value={item.status}
                onChange={(e) => {
                  const next = [...items]
                  next[index] = { ...next[index], status: e.target.value as TranscriptElementValue["status"] }
                  onChange(next)
                }}
                className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="已明确">已明确</option>
                <option value="有争议">有争议</option>
                <option value="待补证">待补证</option>
              </select>
            </div>
            <div className="mb-2 text-xs text-muted-foreground">{item.description || "无说明"}</div>
            <textarea
              value={item.summary}
              onChange={(e) => {
                const next = [...items]
                next[index] = { ...next[index], summary: e.target.value }
                onChange(next)
              }}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="填写该要素的整理结果"
            />
            <div className="mt-2 text-[11px] text-muted-foreground">
              状态：{item.status}；支持片段：{item.supportSegmentIds.length > 0 ? item.supportSegmentIds.join("、") : "暂无"}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TranscriptEditor({ projectPath, record, onSaved }: TranscriptEditorProps) {
  const [draft, setDraft] = useState(() => cloneRecord(record))
  const [saving, setSaving] = useState(false)
  const [exportingDocx, setExportingDocx] = useState(false)
  const [message, setMessage] = useState<string>("")
  const subtypeOptions = useMemo(() => getTranscriptSubtypeOptions(draft.frontmatter.caseType), [draft.frontmatter.caseType])

  const proceduralNotesText = useMemo(() => draft.data.proceduralNotes.join("\n"), [draft.data.proceduralNotes])
  const elementAlerts = useMemo(() => buildTranscriptElementAlerts(draft.data.keyElements), [draft.data.keyElements])
  const workPlan = useMemo(
    () => buildTranscriptWorkPlan(draft.data.keyElements, draft.data.proceduralNotes),
    [draft.data.keyElements, draft.data.proceduralNotes]
  )
  const conflictNotesText = useMemo(
    () => draft.data.mergeMeta?.conflictNotes?.join("\n") || "",
    [draft.data.mergeMeta?.conflictNotes]
  )

  async function handleSave() {
    setSaving(true)
    setMessage("")
    try {
      const saved = await saveTranscriptRecord({
        projectPath,
        title: draft.frontmatter.title,
        caseType: draft.frontmatter.caseType as TranscriptCaseType,
        caseSubtypeId: draft.frontmatter.caseSubtypeId,
        caseSubtypeLabel: draft.frontmatter.caseSubtypeLabel,
        sessionDate: draft.frontmatter.sessionDate,
        sessionIndex: draft.frontmatter.sessionIndex,
        sourcePath: draft.frontmatter.sourcePath,
        markdownPath: draft.markdownPath,
        relativeDataPath: draft.frontmatter.dataPath,
        body: draft.body,
        data: draft.data,
      })
      setDraft(cloneRecord(saved))
      setMessage("已保存")
      onSaved?.(saved)
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`保存失败：${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleExportDocx() {
    setExportingDocx(true)
    setMessage("")
    try {
      await exportTranscriptWorksheetToDocx(draft)
      setMessage("已导出开庭工作单 Word")
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`导出失败：${String(error)}`)
    } finally {
      setExportingDocx(false)
    }
  }

  function handlePrintWorksheet() {
    setMessage("")
    try {
      exportTranscriptWorksheetToPrint(draft)
      setMessage("已打开打印版开庭工作单")
      setTimeout(() => setMessage(""), 2000)
    } catch (error) {
      setMessage(`打印失败：${String(error)}`)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">庭审笔录整理结果</div>
            <div className="text-xs text-muted-foreground">
              数据文件：{draft.frontmatter.dataPath}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {message && <span className="text-xs text-muted-foreground">{message}</span>}
            <Button type="button" variant="outline" onClick={handleExportDocx} disabled={exportingDocx}>
              <Download className="mr-1.5 h-4 w-4" />
              {exportingDocx ? "导出中..." : "导出开庭工作单"}
            </Button>
            <Button type="button" variant="outline" onClick={handlePrintWorksheet}>
              <Printer className="mr-1.5 h-4 w-4" />
              打印开庭工作单
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存整理结果"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label>标题</Label>
              <Input
                value={draft.frontmatter.title}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    frontmatter: { ...prev.frontmatter, title: e.target.value },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>案件类型</Label>
              <select
                value={draft.frontmatter.caseType}
                onChange={(e) => {
                  const nextCaseType = e.target.value as TranscriptCaseType
                  const defaultSubtype = getTranscriptSubtypeOptions(nextCaseType)[0]
                  setDraft((prev) => ({
                    ...prev,
                    frontmatter: {
                      ...prev.frontmatter,
                      caseType: nextCaseType,
                      caseSubtypeId: defaultSubtype?.id,
                      caseSubtypeLabel: defaultSubtype?.label,
                    },
                    data: {
                      ...prev.data,
                      caseSubtypeId: defaultSubtype?.id,
                      caseSubtypeLabel: defaultSubtype?.label,
                    },
                  }))
                }}
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="刑事">刑事</option>
                <option value="民事">民事</option>
                <option value="行政">行政</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>案件子类型</Label>
              <select
                value={draft.frontmatter.caseSubtypeId || ""}
                onChange={(e) => {
                  const selected = subtypeOptions.find((item) => item.id === e.target.value)
                  setDraft((prev) => ({
                    ...prev,
                    frontmatter: {
                      ...prev.frontmatter,
                      caseSubtypeId: selected?.id,
                      caseSubtypeLabel: selected?.label,
                    },
                    data: {
                      ...prev.data,
                      caseSubtypeId: selected?.id,
                      caseSubtypeLabel: selected?.label,
                    },
                  }))
                }}
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">未指定</option>
                {subtypeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>庭审日期</Label>
              <Input
                type="date"
                value={draft.frontmatter.sessionDate || ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    frontmatter: { ...prev.frontmatter, sessionDate: e.target.value || undefined },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>庭次</Label>
              <Input
                type="number"
                min={1}
                value={draft.frontmatter.sessionIndex ?? ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    frontmatter: {
                      ...prev.frontmatter,
                      sessionIndex: e.target.value ? Number(e.target.value) : undefined,
                    },
                  }))
                }
              />
            </div>
          </div>

          <div className="rounded-lg border bg-card/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">庭审综述</h3>
              {draft.frontmatter.sourcePath && (
                <span className="text-xs text-muted-foreground">{draft.frontmatter.sourcePath}</span>
              )}
            </div>
            <textarea
              value={draft.data.overview}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  data: { ...prev.data, overview: e.target.value },
                }))
              }
              rows={6}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="请概括本次庭审的争议、证据和程序进展"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AlertCard
              title={`争议要素提醒（${elementAlerts.disputed.length}）`}
              emptyText="当前没有标记为“有争议”的关键要素。"
              items={elementAlerts.disputedMessages}
              tone="warning"
            />
            <AlertCard
              title={`待补证提示（${elementAlerts.missingEvidence.length}）`}
              emptyText="当前没有标记为“待补证”的关键要素。"
              items={elementAlerts.missingEvidenceMessages}
              tone="danger"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AlertCard
              title={`下一步发问建议（${elementAlerts.questionSuggestions.length}）`}
              emptyText="当前没有需要追加发问的争议要素。"
              items={elementAlerts.questionSuggestions}
              tone="warning"
            />
            <AlertCard
              title={`补证建议（${elementAlerts.evidenceSuggestions.length}）`}
              emptyText="当前没有需要补充材料的关键要素。"
              items={elementAlerts.evidenceSuggestions}
              tone="danger"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <AlertCard
              title={`庭审提纲（${workPlan.hearingOutline.length}）`}
              emptyText="当前没有自动生成的庭审提纲。"
              items={workPlan.hearingOutline}
              tone="warning"
            />
            <AlertCard
              title={`法官工作清单（${workPlan.judgeChecklist.length}）`}
              emptyText="当前没有自动生成的法官工作清单。"
              items={workPlan.judgeChecklist}
              tone="warning"
            />
            <AlertCard
              title={`书记员工作清单（${workPlan.clerkChecklist.length}）`}
              emptyText="当前没有自动生成的书记员工作清单。"
              items={workPlan.clerkChecklist}
              tone="danger"
            />
          </div>

          <ElementEditor
            items={draft.data.keyElements}
            emptyMessage={
              draft.frontmatter.caseType === "民事"
                ? "当前民事子类型还没有提取到关键要素。"
                : "当前案件类型未启用最高法公开要素清单，仅保留通用笔录整理结果。"
            }
            onChange={(items) => setDraft((prev) => ({ ...prev, data: { ...prev.data, keyElements: items } }))}
          />

          <div className="grid gap-4 xl:grid-cols-3">
            <ItemEditor
              title="争议焦点"
              items={draft.data.issues}
              onChange={(items) => setDraft((prev) => ({ ...prev, data: { ...prev.data, issues: items } }))}
            />
            <ItemEditor
              title="质证意见"
              items={draft.data.evidenceOpinions}
              onChange={(items) => setDraft((prev) => ({ ...prev, data: { ...prev.data, evidenceOpinions: items } }))}
            />
            <ItemEditor
              title="辩论要点"
              items={draft.data.argumentPoints}
              onChange={(items) => setDraft((prev) => ({ ...prev, data: { ...prev.data, argumentPoints: items } }))}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border bg-card/30 p-4">
              <h3 className="mb-2 text-sm font-semibold">程序提示</h3>
              <textarea
                value={proceduralNotesText}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    data: {
                      ...prev.data,
                      proceduralNotes: e.target.value.split("\n").map((item) => item.trim()).filter(Boolean),
                    },
                  }))
                }
                rows={5}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="每行一条，例如：要求补充提交证据原件"
              />
            </div>
            <div className="rounded-lg border bg-card/30 p-4">
              <h3 className="mb-2 text-sm font-semibold">正文补充说明</h3>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
                rows={5}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="可补充对外显示的 Markdown 正文"
              />
            </div>
          </div>

          {draft.data.mergeMeta?.merged && (
            <div className="rounded-lg border bg-card/30 p-4">
              <div className="mb-2 text-sm font-semibold">合并信息</div>
              <div className="mb-2 text-xs text-muted-foreground">
                来源文件：{draft.data.mergeMeta.sourcePaths.join("、")}
              </div>
              <textarea
                value={draft.data.mergeMeta.note || ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    data: {
                      ...prev.data,
                      mergeMeta: {
                        merged: true,
                        sourcePaths: prev.data.mergeMeta?.sourcePaths || [],
                        note: e.target.value,
                        conflictNotes: prev.data.mergeMeta?.conflictNotes || [],
                      },
                    },
                  }))
                }
                rows={3}
                className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="合并说明"
              />
              <textarea
                value={conflictNotesText}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    data: {
                      ...prev.data,
                      mergeMeta: {
                        merged: true,
                        sourcePaths: prev.data.mergeMeta?.sourcePaths || [],
                        note: prev.data.mergeMeta?.note,
                        conflictNotes: e.target.value.split("\n").map((item) => item.trim()).filter(Boolean),
                      },
                    },
                  }))
                }
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="每行一条冲突或待核说明"
              />
            </div>
          )}

          <div className="rounded-lg border bg-card/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">结构化段落</h3>
              <span className="text-xs text-muted-foreground">共 {draft.data.segments.length} 段</span>
            </div>
            <div className="space-y-3">
              {draft.data.segments.map((segment, index) => (
                <SegmentCard
                  key={segment.id}
                  segment={segment}
                  index={index}
                  onChange={(next) =>
                    setDraft((prev) => {
                      const segments = [...prev.data.segments]
                      segments[index] = next
                      return { ...prev, data: { ...prev.data, segments } }
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertCard({
  title,
  items,
  emptyText,
  tone,
}: {
  title: string
  items: string[]
  emptyText: string
  tone: "warning" | "danger"
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-500/40 bg-amber-500/10"
      : "border-rose-500/40 bg-rose-500/10"

  return (
    <div className={cn("rounded-lg border p-4", toneClass)}>
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item} className="rounded-md bg-background/60 px-3 py-2 text-sm">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SegmentCard({
  segment,
  index,
  onChange,
}: {
  segment: TranscriptSegment
  index: number
  onChange: (segment: TranscriptSegment) => void
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">#{index + 1}</span>
        <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{segment.phase}</span>
        <span className="rounded bg-accent px-2 py-0.5">{segment.speakerRole}</span>
        <span
          className={cn(
            "rounded px-2 py-0.5",
            segment.procedural ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"
          )}
        >
          {segment.procedural ? "程序性内容" : "实体性内容"}
        </span>
        <span className="text-muted-foreground">置信度 {segment.confidence.toFixed(2)}</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <Label>阶段</Label>
          <select
            value={segment.phase}
            onChange={(e) => onChange({ ...segment, phase: e.target.value as TranscriptSegment["phase"] })}
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {["身份查明", "权利义务告知", "诉辩意见", "举证质证", "法庭辩论", "争议焦点", "最后陈述", "程序事项", "其他"].map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
          <Label>发言角色</Label>
          <Input
            value={segment.speakerRole}
            onChange={(e) => onChange({ ...segment, speakerRole: e.target.value as TranscriptSegment["speakerRole"] })}
          />
        </div>
        <div className="space-y-2">
          <Label>整理摘要</Label>
          <textarea
            value={segment.summary}
            onChange={(e) => onChange({ ...segment, summary: e.target.value })}
            rows={4}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Label>原文摘录</Label>
          <textarea
            value={segment.sourceExcerpt}
            onChange={(e) => onChange({ ...segment, sourceExcerpt: e.target.value })}
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
    </div>
  )
}
