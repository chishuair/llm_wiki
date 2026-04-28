import { useMemo, useState } from "react"
import {
  X, Plus, Trash2, ArrowUp, ArrowDown, Save, Copy, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  CaseField,
  LegalDocCategory,
  LegalDocSection,
  LegalDocSectionKind,
  LegalDocTemplate,
} from "@/types/legal-doc"

interface TemplateEditorProps {
  /** 打开编辑器时的初始模板 */
  draft: LegalDocTemplate
  /** 是否基于内置模板编辑（会在保存时自动转为自定义副本） */
  forkFromBuiltin: boolean
  onCancel: () => void
  onSave: (template: LegalDocTemplate) => Promise<void> | void
}

const CATEGORY_OPTIONS: LegalDocCategory[] = ["裁判", "笔录", "程序", "其他"]
const KIND_OPTIONS: Array<{ value: LegalDocSectionKind; label: string; hint: string }> = [
  { value: "static", label: "静态文本", hint: "直接使用下方模板文本，可引用 {{case_number}} 等变量" },
  { value: "case-field", label: "案件字段", hint: "从案件知识库拷贝对应字段的完整内容" },
  { value: "llm", label: "LLM 生成", hint: "交给本地大模型按写作要点生成正文" },
]
const CASE_FIELDS: Array<{ value: CaseField; label: string }> = [
  { value: "case_number", label: "案号" },
  { value: "court_name", label: "受诉法院" },
  { value: "parties", label: "当事人信息" },
  { value: "case_overview", label: "案情概述" },
  { value: "procedure_log", label: "审理过程" },
  { value: "evidence_list", label: "证据清单" },
  { value: "disputes", label: "争议焦点" },
  { value: "facts", label: "法院认定事实" },
  { value: "reasoning", label: "本院认为" },
  { value: "judgment", label: "判决结果" },
]

function generateSectionId(existing: LegalDocSection[]): string {
  let i = existing.length + 1
  while (existing.some((s) => s.id === `section-${i}`)) i += 1
  return `section-${i}`
}

export function TemplateEditor({ draft, forkFromBuiltin, onCancel, onSave }: TemplateEditorProps) {
  const [id, setId] = useState(draft.id)
  const [name, setName] = useState(forkFromBuiltin ? `${draft.name}（自定义）` : draft.name)
  const [category, setCategory] = useState<LegalDocCategory>(draft.category)
  const [description, setDescription] = useState(draft.description ?? "")
  const [heading, setHeading] = useState(draft.heading ?? "")
  const [sections, setSections] = useState<LegalDocSection[]>(() =>
    draft.sections.map((s) => ({ ...s }))
  )
  const [saving, setSaving] = useState(false)

  const canSave = useMemo(() => {
    if (!name.trim()) return false
    if (sections.length === 0) return false
    for (const s of sections) {
      if (!s.id.trim() || !s.heading.trim()) return false
    }
    return true
  }, [name, sections])

  function updateSection(i: number, patch: Partial<LegalDocSection>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function removeSection(i: number) {
    setSections((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addSection() {
    setSections((prev) => [
      ...prev,
      {
        id: generateSectionId(prev),
        heading: "新章节",
        kind: "llm",
        prompt: "",
      },
    ])
  }
  function moveSection(i: number, direction: -1 | 1) {
    setSections((prev) => {
      const j = i + direction
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(i, 1)
      next.splice(j, 0, item)
      return next
    })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const tpl: LegalDocTemplate = {
        id: id.trim(),
        name: name.trim(),
        category,
        description: description.trim(),
        heading: heading.trim() || undefined,
        sections: sections.map((s) => ({
          ...s,
          id: s.id.trim(),
          heading: s.heading.trim(),
          template: s.template?.trim() ? s.template : undefined,
          prompt: s.prompt?.trim() ? s.prompt : undefined,
        })),
      }
      await onSave(tpl)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            {forkFromBuiltin ? (
              <Copy className="h-4 w-4 text-primary" />
            ) : (
              <Save className="h-4 w-4 text-primary" />
            )}
            <h3 className="text-sm font-semibold tracking-wider">
              {forkFromBuiltin ? "编辑内置模板（另存为自定义）" : "编辑自定义模板"}
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {sections.length} 节
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {forkFromBuiltin && (
          <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-[11px] text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              你正在编辑内置模板。保存后会创建一份「自定义副本」，原始内置模板保持不变。
              建议修改下方「模板 ID / 名称」让它更好识别。
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 border-b bg-card/30 px-5 py-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">模板 ID（唯一）</Label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="如：civil-judgment-custom"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">名称（必填）</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：本院民事判决书（一审）"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">分类</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as LegalDocCategory)}
              className="h-8 w-full rounded border bg-transparent px-2 text-sm"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">正标题（可选，默认使用名称）</Label>
            <Input
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              placeholder="如：民 事 判 决 书"
              className="h-8 text-sm"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-[11px] text-muted-foreground">模板说明</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话描述适用场景"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>章节序列（文书从上到下生成）</span>
          </div>
          <div className="space-y-3">
            {sections.map((section, i) => (
              <div
                key={i}
                className="rounded-md border bg-card/60 p-3 text-xs shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {i + 1}
                  </span>
                  <Input
                    value={section.heading}
                    onChange={(e) => updateSection(i, { heading: e.target.value })}
                    placeholder="章节标题"
                    className="h-8 flex-1 min-w-[180px] text-sm"
                  />
                  <select
                    value={section.kind}
                    onChange={(e) => updateSection(i, { kind: e.target.value as LegalDocSectionKind })}
                    className="h-8 rounded border bg-transparent px-2 text-xs"
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  {section.kind === "case-field" && (
                    <select
                      value={section.source ?? ""}
                      onChange={(e) => updateSection(i, { source: (e.target.value || undefined) as CaseField })}
                      className="h-8 rounded border bg-transparent px-2 text-xs"
                    >
                      <option value="">选择字段…</option>
                      {CASE_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  )}
                  <label className="ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={section.optional ?? false}
                      onChange={(e) => updateSection(i, { optional: e.target.checked })}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    可选章节
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={i === 0}
                      onClick={() => moveSection(i, -1)}
                      title="上移"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={i === sections.length - 1}
                      onClick={() => moveSection(i, 1)}
                      title="下移"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSection(i)}
                      title="删除该节"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">节 ID</span>
                  <Input
                    value={section.id}
                    onChange={(e) => updateSection(i, { id: e.target.value })}
                    className="h-7 w-48 text-[11px]"
                  />
                  <span>
                    {KIND_OPTIONS.find((k) => k.value === section.kind)?.hint}
                  </span>
                </div>

                {section.kind === "static" && (
                  <textarea
                    value={section.template ?? ""}
                    onChange={(e) => updateSection(i, { template: e.target.value })}
                    placeholder="支持 {{case_number}} {{court_name}} {{parties}} 等变量。"
                    rows={4}
                    className="w-full resize-y rounded border bg-background px-2 py-1.5 text-[12px] leading-relaxed"
                    spellCheck={false}
                  />
                )}
                {section.kind === "llm" && (
                  <textarea
                    value={section.prompt ?? ""}
                    onChange={(e) => updateSection(i, { prompt: e.target.value })}
                    placeholder="写作要点：告诉 LLM 这一节需要写什么、顺序、风格。条文引用会自动受法条库约束。"
                    rows={4}
                    className="w-full resize-y rounded border bg-background px-2 py-1.5 text-[12px] leading-relaxed"
                    spellCheck={false}
                  />
                )}
                {section.kind === "case-field" && !section.source && (
                  <div className="rounded border border-dashed border-amber-500/50 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-500">
                    请在上方选择要拷贝的案件字段。
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addSection} className="mt-3">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新增章节
          </Button>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-card/40 px-5 py-3">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "保存中…" : forkFromBuiltin ? "保存为自定义副本" : "保存更改"}
          </Button>
        </div>
      </div>
    </div>
  )
}
