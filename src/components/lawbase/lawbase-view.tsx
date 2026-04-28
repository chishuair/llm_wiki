import { useCallback, useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  BookMarked, Search, Copy, ClipboardCheck, Scale, Trash2, FileText, Loader2,
  ChevronRight, ChevronDown, ListTree,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { readFile } from "@/commands/fs"
import {
  importLawCode,
  importLawPack,
  getPackManifest,
  listCodes,
  removeLawCode,
  searchLaws,
  subscribe,
} from "@/lib/lawbase"
import { parsePdfIntoLawDraft, type ParsedLawPreview } from "@/lib/lawbase/parse-pdf"
import { useWikiStore } from "@/stores/wiki-store"
import { LawbasePreviewDialog } from "@/components/lawbase/lawbase-preview-dialog"
import type { LawArticle, LawCode, LawSearchHit } from "@/types/lawbase"
import type { LawbasePack } from "@/types/lawbase"

function ArticleCard({ code, article }: { code: LawCode; article: LawArticle }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(form: "citation" | "full") {
    const citation = `《${code.aliases?.[0] ?? code.code}》${article.number}`
    const text = form === "citation" ? citation : `${citation}\n${article.content}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded-lg border bg-card/60 p-3 text-sm leading-relaxed shadow-sm transition-colors hover:border-primary/50">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Scale className="h-3 w-3" />
          {code.aliases?.[0] ?? code.code}
        </span>
        <span className="font-medium text-foreground">{article.number}</span>
        {article.chapter && (
          <span className="text-[11px] text-muted-foreground/80">
            {article.chapter}
            {article.section ? ` · ${article.section}` : ""}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="复制引用"
            onClick={() => handleCopy("citation")}
          >
            {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="复制引用 + 原文"
            onClick={() => handleCopy("full")}
          >
            <BookMarked className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-foreground/90">{article.content}</p>
      {article.keywords && article.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {article.keywords.map((kw) => (
            <span
              key={kw}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              #{kw}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function LawbaseView() {
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [query, setQuery] = useState("")
  const [codes, setCodes] = useState<LawCode[]>(() => listCodes())
  const [message, setMessage] = useState<
    | { kind: "ok"; text: string }
    | { kind: "err"; text: string }
    | null
  >(null)
  const [parsing, setParsing] = useState<null | { path: string }>(null)
  const [preview, setPreview] = useState<ParsedLawPreview | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [packInfo, setPackInfo] = useState(() => getPackManifest())

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setCodes(listCodes())
      setPackInfo(getPackManifest())
    })
    return unsubscribe
  }, [])

  // 默认只展开第一部法律，其余收起。新增法律时只展开新增的。
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size > 0) {
        // 保留已有展开状态，但清理已删除的 code
        const next = new Set<string>()
        for (const code of codes) {
          if (prev.has(code.code)) next.add(code.code)
        }
        // 如果没有任何展开，默认展开第一部
        if (next.size === 0 && codes.length > 0) next.add(codes[0].code)
        return next
      }
      return codes.length > 0 ? new Set([codes[0].code]) : new Set()
    })
  }, [codes])

  function toggleCode(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(codes.map((c) => c.code)))
  }
  function collapseAll() {
    setExpanded(new Set())
  }

  const hits = useMemo<LawSearchHit[]>(() => {
    if (!query.trim()) return []
    return searchLaws(query, 50)
  }, [query, codes])

  const totalArticles = useMemo(
    () => codes.reduce((acc, c) => acc + c.articles.length, 0),
    [codes]
  )

  const handleImportPdf = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "法律 PDF / Word", extensions: ["pdf", "docx", "doc"] }],
      title: "选择要导入的法律原件",
    })
    if (!selected || typeof selected !== "string") return
    setParsing({ path: selected })
    setMessage(null)
    try {
      const previewResult = await parsePdfIntoLawDraft(selected, llmConfig)
      setPreview(previewResult)
    } catch (err) {
      setMessage({ kind: "err", text: `解析失败：${(err as Error).message}` })
    } finally {
      setParsing(null)
    }
  }, [llmConfig])

  const handleConfirmPreview = useCallback(async (finalCode: LawCode) => {
    const status = await importLawCode(finalCode)
    setPreview(null)
    setMessage({
      kind: "ok",
      text: status === "added" ? `已导入「${finalCode.code}」` : `已更新「${finalCode.code}」`,
    })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleImportPack = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "法规包 JSON", extensions: ["json"] }],
      title: "选择离线法规包 JSON",
    })
    if (!selected || typeof selected !== "string") return
    try {
      const raw = await readFile(selected)
      const parsed = JSON.parse(raw) as LawbasePack
      if (!parsed.manifest || !Array.isArray(parsed.codes)) {
        throw new Error("法规包格式错误：缺少 manifest 或 codes")
      }
      const result = await importLawPack(parsed.manifest, parsed.codes)
      setMessage({ kind: "ok", text: `法规包导入完成：新增 ${result.added} 部，更新 ${result.replaced} 部` })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ kind: "err", text: `法规包导入失败：${(err as Error).message}` })
    }
  }, [])

  const handleRemove = useCallback(async (codeName: string) => {
    if (!window.confirm(`确定删除「${codeName}」？此操作不会影响已写入的案件文书。`)) return
    await removeLawCode(codeName)
    setMessage({ kind: "ok", text: `已删除「${codeName}」` })
    setTimeout(() => setMessage(null), 2000)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-wider">法律依据</h2>
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {codes.length} 部法律 · {totalArticles} 条
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleImportPack}>
              <ListTree className="mr-1.5 h-3.5 w-3.5" />
              导入法规包
            </Button>
            <Button size="sm" onClick={handleImportPdf} disabled={parsing !== null}>
              {parsing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="mr-1.5 h-3.5 w-3.5" />
              )}
              {parsing ? "解析中…" : "导入法律法规"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          完全离线的法条库。从官方渠道下载法律原件（PDF 或 Word），点击「导入法律法规」，应用会自动抽取条文并由您确认后入库。
        </p>
        {packInfo && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            预置/离线法规包：{packInfo.dataset_name}；来源：{packInfo.source}；版本：{packInfo.version}；
            生成时间：{packInfo.generated_at}；法规数量：{packInfo.laws_count ?? codes.length} 部
            {packInfo.latest_effective ? `；最新生效/修订时间：${packInfo.latest_effective}` : ""}
          </div>
        )}
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
        {codes.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="例如：违约金、第577条、诚信原则、民诉法 举证责任…"
                className="pl-8"
              />
            </div>
            {query && (
              <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                清空
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-4 p-6">
          {codes.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <Scale className="h-10 w-10 text-primary/60" />
              <div className="text-sm font-semibold">暂未导入任何法律</div>
              <p className="text-xs text-muted-foreground">
                推荐从官方渠道下载法律原件（PDF 或 Word），<br />
                点击下方按钮，应用会自动抽取条文并由您确认后入库。
              </p>
              <Button size="sm" onClick={handleImportPdf} disabled={parsing !== null}>
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                导入法律法规
              </Button>
            </div>
          )}

          {codes.length > 0 && query.trim() && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>检索结果：{hits.length} 条</span>
              {hits.length === 0 && <span className="text-destructive/80">未命中条文</span>}
            </div>
          )}

          {codes.length > 0 && query.trim() && (
            <div className="space-y-2">
              {hits.map(({ code, article }) => (
                <ArticleCard
                  key={`${code.code}-${article.number}`}
                  code={code}
                  article={article}
                />
              ))}
            </div>
          )}

          {codes.length > 0 && !query.trim() && (
            <>
              {codes.length > 1 && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ListTree className="h-3.5 w-3.5" />
                  <span>按法律折叠显示</span>
                  <button
                    onClick={expandAll}
                    className="ml-2 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                  >
                    全部展开
                  </button>
                  <button
                    onClick={collapseAll}
                    className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                  >
                    全部收起
                  </button>
                </div>
              )}
              <div className="space-y-3">
                {codes.map((code) => {
                  const isOpen = expanded.has(code.code)
                  return (
                    <div key={code.code} className="rounded-lg border bg-card/40">
                      <div className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent/30">
                        <button
                          type="button"
                          onClick={() => toggleCode(code.code)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Scale className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">{code.code}</span>
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {code.articles.length} 条
                          </span>
                          <span className="truncate text-[11px] font-normal text-muted-foreground">
                            {code.version ? `· ${code.version}` : ""}
                            {code.effective ? ` · ${code.effective} 起施行` : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(code.code)}
                          className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="删除这部法律"
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </button>
                      </div>
                      {isOpen && (
                        <div className="space-y-2 border-t p-3">
                          {code.articles.map((article) => (
                            <ArticleCard
                              key={`${code.code}-${article.number}`}
                              code={code}
                              article={article}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {preview && (
        <LawbasePreviewDialog
          draft={preview.draft}
          leftover={preview.leftover}
          rawText={preview.rawText}
          onCancel={() => setPreview(null)}
          onConfirm={handleConfirmPreview}
        />
      )}
    </div>
  )
}
