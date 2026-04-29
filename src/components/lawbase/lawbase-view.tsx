import { useCallback, useEffect, useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  BookMarked, Search, Copy, ClipboardCheck, Scale, Trash2, FileText, Loader2,
  ChevronRight, ChevronDown, ListTree, Building2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { readFile } from "@/commands/fs"
import {
  importLawCode,
  importLawPack,
  getPackManifest,
  getInstalledPacks,
  listCodes,
  removeLawCode,
  searchLaws,
  subscribe,
} from "@/lib/lawbase"
import { parsePdfIntoLawDraft, type ParsedLawPreview } from "@/lib/lawbase/parse-pdf"
import { useWikiStore } from "@/stores/wiki-store"
import { LawbasePreviewDialog } from "@/components/lawbase/lawbase-preview-dialog"
import type { InstalledLawPack, LawArticle, LawCode, LawSearchHit } from "@/types/lawbase"
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

function classifyLawCode(code: LawCode): string {
  if (code.hierarchyLevel) return code.hierarchyLevel
  const name = code.code
  const text = `${code.code} ${code.source ?? ""} ${code.version ?? ""} ${code.issuer ?? ""} ${code.officialCategory ?? ""}`
  const localPattern =
    /(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|自治州|自治县|自治旗|地区|盟|市)/

  if (
    text.includes("最高人民法院")
    || text.includes("最高人民检察院")
    || text.includes("司法解释")
    || name.includes("关于审理")
    || name.includes("适用法律")
  ) {
    return "司法解释与两高规范性文件"
  }

  if (/^中华人民共和国.+法$/.test(name) || /^中华人民共和国.+法实施/.test(name)) {
    return "法律"
  }

  if (text.includes("国务院") || (name.endsWith("条例") && !localPattern.test(text.slice(0, 160)))) {
    return "行政法规"
  }

  if (localPattern.test(text.slice(0, 180))) {
    return "地方性法规、自治条例和单行条例"
  }

  if (/(决定|规定|办法|规则|条例)$/.test(name)) {
    return "其他规范性文件"
  }

  return "其他"
}

function lawMetaText(code: LawCode): string {
  const parts = [
    code.officialCategory,
    code.issuer,
    code.promulgationDate ? `公布：${code.promulgationDate}` : "",
    (code.sourceEffectiveDate || code.effective) ? `施行：${code.sourceEffectiveDate || code.effective}` : "",
    code.sourceId ? `来源ID：${code.sourceId}` : "",
  ].filter(Boolean)
  return parts.join(" · ")
}

function packTierLabel(packInfo: ReturnType<typeof getPackManifest>): string {
  if (!packInfo?.pack_tier) return "未标注"
  if (packInfo.pack_tier === "core") return "核心法包"
  if (packInfo.pack_tier === "topic") return "专题包"
  if (packInfo.pack_tier === "full") return "全量包"
  return packInfo.pack_tier
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [packInfo, setPackInfo] = useState(() => getPackManifest())
  const [installedPacks, setInstalledPacks] = useState<InstalledLawPack[]>(() => getInstalledPacks())

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setCodes(listCodes())
      setPackInfo(getPackManifest())
      setInstalledPacks(getInstalledPacks())
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
    setExpandedGroups(new Set(groupedCodes.map((g) => g.group)))
  }
  function collapseAll() {
    setExpanded(new Set())
    setExpandedGroups(new Set())
  }

  // 按效力层级/法规性质分组。法规包中的 issuer 目前有大量空值，
  // 因此这里优先依据法规名称、来源文件名和版本说明判断。
  const groupedCodes = useMemo(() => {
    const ORDER = [
      "法律",
      "行政法规",
      "司法解释与两高规范性文件",
      "地方性法规、自治条例和单行条例",
      "其他规范性文件",
      "其他",
    ]
    const map = new Map<string, LawCode[]>()
    for (const code of codes) {
      const group = classifyLawCode(code)
      const list = map.get(group) ?? []
      list.push(code)
      map.set(group, list)
    }
    // 按预设顺序排列，其余按字母排
    const result: { group: string; items: LawCode[] }[] = []
    for (const g of ORDER) {
      if (map.has(g)) {
        result.push({ group: g, items: map.get(g)! })
        map.delete(g)
      }
    }
    for (const [g, items] of map) {
      result.push({ group: g, items })
    }
    return result
  }, [codes])

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
            预置/离线法规包：{packInfo.dataset_name}；层级：{packTierLabel(packInfo)}
            {packInfo.topic ? `；专题：${packInfo.topic}` : ""}
            {packInfo.pack_profile ? `；配置：${packInfo.pack_profile}` : ""}
            ；来源：{packInfo.source}；版本：{packInfo.version}；
            生成时间：{packInfo.generated_at}；法规数量：{packInfo.laws_count ?? codes.length} 部
            {packInfo.latest_effective ? `；最新生效/修订时间：${packInfo.latest_effective}` : ""}
          </div>
        )}
        {packInfo?.pack_tier !== "full" && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            当前安装的是{packTierLabel(packInfo)}。如需覆盖更多案由或地方性法规，建议继续导入专题包或全量法规包。
          </div>
        )}
        {installedPacks.length > 0 && (
          <div className="mt-3 rounded-md border bg-background/40 px-3 py-3 text-xs">
            <div className="mb-2 font-medium text-foreground">已安装法规包</div>
            <div className="space-y-2">
              {installedPacks.map((pack) => (
                <div key={`${pack.dataset_name}-${pack.version}-${pack.pack_profile ?? ""}`} className="rounded-md border px-3 py-2">
                  <div className="font-medium text-foreground">
                    {pack.dataset_name} · {packTierLabel(pack)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {pack.topic ? `专题：${pack.topic} · ` : ""}
                    {pack.pack_profile ? `配置：${pack.pack_profile} · ` : ""}
                    版本：{pack.version} · 法规数量：{pack.laws_count ?? "未知"} ·
                    安装时间：{pack.installed_at}
                  </div>
                </div>
              ))}
            </div>
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
                  <span>按效力层级分类</span>
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
              <div className="space-y-2">
                {groupedCodes.map(({ group, items }) => {
                  const groupOpen = expandedGroups.has(group)
                  return (
                    <div key={group} className="rounded-lg border bg-card/30">
                      {/* 分组标题 */}
                      <button
                        type="button"
                        onClick={() => setExpandedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(group)) next.delete(group)
                          else next.add(group)
                          return next
                        })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-foreground hover:bg-accent/30 rounded-lg"
                      >
                        {groupOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="flex-1">{group}</span>
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                          {items.length} 部
                        </span>
                      </button>
                      {/* 分组内法律列表 */}
                      {groupOpen && (
                        <div className="space-y-1.5 border-t p-2">
                          {items.map((code) => {
                            const isOpen = expanded.has(code.code)
                            return (
                              <div key={code.code} className="rounded-md border bg-card/50">
                                <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/20">
                                  <button
                                    type="button"
                                    onClick={() => toggleCode(code.code)}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                  >
                                    {isOpen ? (
                                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    )}
                                    <Scale className="h-3 w-3 shrink-0 text-primary" />
                                    <span className="truncate">{code.code}</span>
                                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                      {code.articles.length} 条
                                    </span>
                                    <span className="min-w-0 truncate text-[10px] font-normal text-muted-foreground">
                                      {lawMetaText(code)}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemove(code.code)}
                                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    title="删除这部法律"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
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
