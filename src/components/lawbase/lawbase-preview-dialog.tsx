import { useEffect, useMemo, useState } from "react"
import { X, Plus, Trash2, FileText, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LawArticle, LawCode } from "@/types/lawbase"

interface LawbasePreviewDialogProps {
  draft: LawCode
  leftover?: string[]
  rawText?: string
  onCancel: () => void
  onConfirm: (final: LawCode) => Promise<void> | void
}

/**
 * 导入前的结构化预览对话框。
 *
 * - 顶部：法律元信息（全称、别名、生效日期、版本、颁布机关），均可改
 * - 中部：条文列表，支持增、删、改条号与内容
 * - 右侧（可折叠）：原始文本，方便对照
 */
export function LawbasePreviewDialog({
  draft,
  leftover,
  rawText,
  onCancel,
  onConfirm,
}: LawbasePreviewDialogProps) {
  const [code, setCode] = useState<LawCode>(() => ({ ...draft }))
  const [aliasesText, setAliasesText] = useState<string>(() => (draft.aliases ?? []).join("、"))
  const [articles, setArticles] = useState<LawArticle[]>(() => [...draft.articles])
  const [saving, setSaving] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    setCode((c) => ({ ...c, articles }))
  }, [articles])

  const totalContentLength = useMemo(
    () => articles.reduce((acc, a) => acc + a.content.length, 0),
    [articles]
  )

  function updateArticle(i: number, patch: Partial<LawArticle>) {
    setArticles((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  function removeArticle(i: number) {
    setArticles((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addArticle() {
    setArticles((prev) => [...prev, { number: `第${prev.length + 1}条`, content: "" }])
  }

  async function handleConfirm() {
    const aliases = aliasesText
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const finalCode: LawCode = {
      ...code,
      aliases: aliases.length ? aliases : undefined,
      articles: articles
        .map((a) => ({
          ...a,
          number: a.number.trim(),
          content: a.content.trim(),
        }))
        .filter((a) => a.number && a.content),
    }
    if (!finalCode.code.trim()) {
      alert("请先填写法律全称")
      return
    }
    if (finalCode.articles.length === 0) {
      alert("至少需要 1 条有效条文")
      return
    }
    try {
      setSaving(true)
      await onConfirm(finalCode)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-wider">法条预览与确认</h3>
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {articles.length} 条 · 共 {totalContentLength.toLocaleString()} 字
            </span>
          </div>
          <div className="flex items-center gap-2">
            {rawText && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs"
              >
                {showRaw ? "隐藏原文" : "对照原文"}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="grid grid-cols-2 gap-3 border-b bg-card/40 px-5 py-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">法律全称（必填）</Label>
                <Input
                  value={code.code}
                  onChange={(e) => setCode({ ...code, code: e.target.value })}
                  placeholder="如：中华人民共和国民法典"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  别名（用于识别引用，顿号或逗号分隔）
                </Label>
                <Input
                  value={aliasesText}
                  onChange={(e) => setAliasesText(e.target.value)}
                  placeholder="如：民法典、民法"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">生效日期</Label>
                <Input
                  value={code.effective ?? ""}
                  onChange={(e) => setCode({ ...code, effective: e.target.value || undefined })}
                  placeholder="YYYY-MM-DD"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">版本 / 修订</Label>
                <Input
                  value={code.version ?? ""}
                  onChange={(e) => setCode({ ...code, version: e.target.value || undefined })}
                  placeholder="如：2020年修订"
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground">颁布 / 立法机关</Label>
                <Input
                  value={code.issuer ?? ""}
                  onChange={(e) => setCode({ ...code, issuer: e.target.value || undefined })}
                  placeholder="如：全国人民代表大会"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto px-5 py-3">
              {leftover && leftover.length > 0 && (
                <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-500">
                  <div className="flex items-center gap-1 font-medium">
                    <Info className="h-3.5 w-3.5" /> 未归入任何条文的段落（{leftover.length} 处）
                  </div>
                  <p className="mt-1 text-muted-foreground/90">
                    这些文字可能是标题、目录、前言或法条之外的说明。请人工确认是否需要保留。
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {articles.map((a, i) => (
                  <div
                    key={i}
                    className="rounded-md border bg-card/60 p-3 text-sm transition-colors hover:border-primary/50"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Input
                        value={a.number}
                        onChange={(e) => updateArticle(i, { number: e.target.value })}
                        className="h-7 w-28 text-xs"
                      />
                      <Input
                        value={a.chapter ?? ""}
                        onChange={(e) => updateArticle(i, { chapter: e.target.value || undefined })}
                        placeholder="章（选填）"
                        className="h-7 w-40 text-xs"
                      />
                      <Input
                        value={a.section ?? ""}
                        onChange={(e) => updateArticle(i, { section: e.target.value || undefined })}
                        placeholder="节（选填）"
                        className="h-7 w-40 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeArticle(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <textarea
                      value={a.content}
                      onChange={(e) => updateArticle(i, { content: e.target.value })}
                      rows={Math.min(10, Math.max(2, Math.ceil(a.content.length / 80)))}
                      className="w-full resize-y rounded border bg-background px-2 py-1.5 text-xs leading-relaxed"
                    />
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addArticle}
                className="mt-3"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                新增一条
              </Button>
            </div>
          </div>

          {showRaw && rawText && (
            <div className="w-[360px] shrink-0 border-l bg-muted/20">
              <div className="border-b bg-card/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                PDF 原始文本
              </div>
              <div className="h-[calc(100%-32px)] overflow-auto p-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {rawText}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-card/40 px-5 py-3">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? "正在写入…" : "确认导入"}
          </Button>
        </div>
      </div>
    </div>
  )
}
