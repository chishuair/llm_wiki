import { useMemo, useState } from "react"
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core"
import { commonmark } from "@milkdown/kit/preset/commonmark"
import { gfm } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import { math } from "@milkdown/plugin-math"
import { nord } from "@milkdown/theme-nord"
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react"
import "@milkdown/theme-nord/style.css"
import "katex/dist/katex.min.css"
import { convertLatexToUnicode } from "@/lib/latex-to-unicode"
import { Scale, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Upload } from "lucide-react"
import { validateCitations } from "@/lib/lawbase/citations"
import { detectMissingLawbaseSignal, LAWBASE_MISSING_SENTINEL } from "@/lib/lawbase/prompt"
import { useWikiStore } from "@/stores/wiki-store"
import type { CitationValidation } from "@/types/lawbase"

interface WikiEditorInnerProps {
  content: string
  onSave: (markdown: string) => void
}

function WikiEditorInner({ content, onSave }: WikiEditorInnerProps) {
  useEditor(
    (root) =>
      Editor.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onSave(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(math)
        .use(history)
        .use(listener),
    [content],
  )

  return <Milkdown />
}

interface WikiEditorProps {
  content: string
  onSave: (markdown: string) => void
}

function wrapBareMathBlocks(text: string): string {
  return text.replace(
    /(?<!\$\$\s*)(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})(?!\s*\$\$)/g,
    (_match, block: string) => `$$\n${block}\n$$`,
  )
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function stripFrontmatter(text: string): { frontmatter: string; body: string } {
  const match = text.match(FRONTMATTER_PATTERN)
  if (!match) return { frontmatter: "", body: text }
  return {
    frontmatter: match[0],
    body: text.slice(match[0].length),
  }
}

export function WikiEditor({ content, onSave }: WikiEditorProps) {
  const { frontmatter, body } = useMemo(() => stripFrontmatter(content), [content])
  const processedContent = useMemo(() => wrapBareMathBlocks(body), [body])

  const citations = useMemo(() => validateCitations(body), [body])
  const missingLawbase = useMemo(() => detectMissingLawbaseSignal(body), [body])

  const handleSave = useMemo(() => {
    return (markdown: string) => {
      const nextBody = markdown.startsWith("\n") ? markdown : `\n${markdown}`
      onSave(frontmatter ? `${frontmatter}${nextBody.replace(/^\n+/, "")}` : markdown)
    }
  }, [frontmatter, onSave])

  return (
    <MilkdownProvider>
      <div className="flex h-full flex-col">
        {missingLawbase && <LawbaseMissingBanner />}
        {citations.length > 0 && <CitationBar citations={citations} />}
        <div className="prose prose-invert min-w-0 max-w-none flex-1 overflow-auto p-6">
          <WikiEditorInner content={processedContent} onSave={handleSave} />
        </div>
      </div>
    </MilkdownProvider>
  )
}

function LawbaseMissingBanner() {
  const setActiveView = useWikiStore((s) => s.setActiveView)
  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-500">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">本地法条库缺少相关法律依据</span>
        <span className="text-amber-500/80">
          AI 已按要求停止引用；请导入相关法律后再重新生成。
        </span>
        <button
          type="button"
          onClick={() => setActiveView("lawbase")}
          className="ml-auto flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 font-medium text-amber-500 hover:bg-amber-500/30"
        >
          <Upload className="h-3 w-3" />
          立即导入
        </button>
      </div>
      <div className="mt-1 truncate text-[10px] text-amber-500/70">
        标识语：{LAWBASE_MISSING_SENTINEL}
      </div>
    </div>
  )
}

function CitationBar({ citations }: { citations: CitationValidation[] }) {
  const [expanded, setExpanded] = useState(false)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const valid = citations.filter((c) => c.valid).length
  const invalid = citations.length - valid
  const missingCodeNames = useMemo(() => {
    const names = new Set<string>()
    for (const c of citations) {
      if (!c.valid) names.add(c.codeName)
    }
    return [...names]
  }, [citations])

  return (
    <div className="border-b bg-card/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Scale className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium">法条引用校验</span>
        {valid > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            已校验 {valid}
          </span>
        )}
        {invalid > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">
            <AlertTriangle className="h-3 w-3" />
            待核对 {invalid}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          共 {citations.length} 处引用 · 点击展开
        </span>
      </button>

      {expanded && (
        <div className="max-h-64 overflow-auto border-t px-4 py-2">
          {missingCodeNames.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>本地法条库缺少：{missingCodeNames.join("、")}</span>
              <button
                type="button"
                onClick={() => setActiveView("lawbase")}
                className="ml-auto flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 font-medium hover:bg-amber-500/30"
              >
                <Upload className="h-3 w-3" />
                立即导入
              </button>
            </div>
          )}
          <ul className="space-y-1.5">
            {citations.map((c, i) => (
              <li
                key={`${c.raw}-${i}`}
                className={`rounded-md border px-3 py-2 text-xs ${
                  c.valid
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-destructive/40 bg-destructive/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  {c.valid ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="font-medium">{c.raw}</span>
                  {c.valid && c.code && (
                    <span className="text-[11px] text-muted-foreground">
                      · 命中「{c.code.aliases?.[0] ?? c.code.code}」
                    </span>
                  )}
                  {!c.valid && (
                    <span className="text-[11px] text-destructive/80">
                      · 未在内置法条库命中，请人工核对
                    </span>
                  )}
                </div>
                {c.valid && c.article && (
                  <p className="mt-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
                    {c.article.content}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
