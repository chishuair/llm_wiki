import { useEffect, useMemo, useRef, useState } from "react"
import {
  Plus, Trash2, Check, Link as LinkIcon, FileSearch, StickyNote, FolderInput,
  Maximize2, Minimize2, X, FileWarning, MessageSquare, Keyboard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseFrontmatter, writeFrontmatter } from "@/lib/frontmatter"
import {
  EVIDENCE_PARTY_OPTIONS,
  EVIDENCE_REVIEW_OPTIONS,
  countOpinions,
  emptyEvidence,
  type EvidenceItem,
  type EvidenceListFrontmatter,
  type EvidenceOpinions,
  type EvidenceParty,
  type EvidenceReviewStatus,
} from "@/types/evidence"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { FilePreview } from "@/components/editor/file-preview"

interface EvidenceEditorProps {
  content: string
  focusEvidenceId?: string | null
  onSave: (markdown: string) => void
}

function nextEvidenceId(items: EvidenceItem[]): string {
  const nums = items
    .map((item) => item.id.match(/(\d+)/)?.[1])
    .filter((n): n is string => Boolean(n))
    .map((n) => parseInt(n, 10))
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `证据${next}`
}

export function EvidenceEditor({ content, focusEvidenceId, onSave }: EvidenceEditorProps) {
  const { data, body } = useMemo(
    () => parseFrontmatter<Partial<EvidenceListFrontmatter>>(content),
    [content]
  )
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)

  const [items, setItems] = useState<EvidenceItem[]>(() => data.evidences ?? [])
  const [caseNumber, setCaseNumber] = useState<string>(data.case_number ?? "")
  const [title, setTitle] = useState<string>(data.title ?? "证据清单")
  const [sourceOptions, setSourceOptions] = useState<string[]>([])
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null)
  const [pickerFilter, setPickerFilter] = useState<string>("")
  const [fullscreen, setFullscreen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedRowRef = useRef<HTMLTableRowElement | null>(null)

  // Load list of raw sources for the inline picker
  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    listDirectory(`${pp}/raw/sources`)
      .then((tree) => setSourceOptions(collectFileRelatives(tree, "raw/sources")))
      .catch(() => setSourceOptions([]))
  }, [project])

  // Close picker when clicking outside
  useEffect(() => {
    if (pickerOpenFor === null) return
    function onDocClick(e: MouseEvent) {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpenFor(null)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [pickerOpenFor])

  // Global keyboard shortcuts while in fullscreen.
  // - ESC: close picker, then exit fullscreen
  // - ArrowUp / ArrowDown (outside of text inputs): move selected row
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pickerOpenFor !== null) setPickerOpenFor(null)
        else if (fullscreen) setFullscreen(false)
        return
      }
      if (!fullscreen) return
      // Don't hijack arrows while typing in an input/textarea/select
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ""
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedRow((prev) => {
          if (items.length === 0) return null
          if (prev === null) return 0
          return Math.min(prev + 1, items.length - 1)
        })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedRow((prev) => {
          if (items.length === 0) return null
          if (prev === null) return 0
          return Math.max(prev - 1, 0)
        })
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [pickerOpenFor, fullscreen, items.length])

  function updateOpinion(index: number, field: keyof EvidenceOpinions, value: string) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const opinions: EvidenceOpinions = { ...(item.opinions ?? {}) }
        opinions[field] = value
        // Strip empty keys so the serialized YAML stays clean
        if (!opinions.plaintiff?.trim()) delete opinions.plaintiff
        if (!opinions.defendant?.trim()) delete opinions.defendant
        if (!opinions.court?.trim()) delete opinions.court
        const next: EvidenceItem = { ...item }
        if (Object.keys(opinions).length === 0) {
          delete next.opinions
        } else {
          next.opinions = opinions
        }
        return next
      })
    )
  }

  // Debounced persistence back to disk
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const nextFrontmatter: EvidenceListFrontmatter = {
        type: "evidence-list",
        title,
        case_number: caseNumber,
        updated: new Date().toISOString().slice(0, 10),
        evidences: items,
      }
      const nextRaw = writeFrontmatter(content, nextFrontmatter) + (body.endsWith("\n") ? "" : "\n")
      onSave(nextRaw.endsWith("\n") ? nextRaw : nextRaw + "\n")
    }, 400)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, caseNumber, title])

  function updateItem(index: number, patch: Partial<EvidenceItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
    if (selectedRow === index) setSelectedRow(null)
  }

  function addItem() {
    setItems((prev) => {
      const next = [...prev, emptyEvidence(nextEvidenceId(prev))]
      setSelectedRow(next.length - 1)
      return next
    })
  }

  function openSource(sourcePath?: string) {
    if (!sourcePath || !project) return
    const [rel] = sourcePath.split("#")
    const target = rel.startsWith("/") ? rel : `${normalizePath(project.path)}/${rel}`
    setSelectedFile(target)
  }

  function primarySource(item: EvidenceItem): string | undefined {
    return item.sourcePath || item.sourcePaths?.[0]
  }

  const total = items.length
  const admittedCount = items.filter((it) => it.admitted).length

  useEffect(() => {
    if (!focusEvidenceId) return
    const index = items.findIndex((item) => item.id === focusEvidenceId)
    if (index >= 0) setSelectedRow(index)
  }, [focusEvidenceId, items])

  useEffect(() => {
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [selectedRow, focusEvidenceId])

  function renderToolbar() {
    return (
      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="evidence-title" className="text-xs text-muted-foreground">页面标题</Label>
          <Input
            id="evidence-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-number" className="text-xs text-muted-foreground">案号</Label>
          <Input
            id="case-number"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            placeholder="（2026）鲁XXXX民初XX号"
            className="h-8 w-64"
          />
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StickyNote className="h-3.5 w-3.5" />
            共 {total} 条 · 已采信 {admittedCount} 条
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFullscreen(true)}
            className="h-8 text-xs"
          >
            <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
            全屏查看
          </Button>
        </div>
      </div>
    )
  }

  function renderTable() {
    return (
      <table className="min-w-[1080px] w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col style={{ width: "72px" }} />
          <col style={{ width: "180px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "200px" }} />
          <col style={{ width: "88px" }} />
          <col style={{ width: "88px" }} />
          <col style={{ width: "88px" }} />
          <col style={{ width: "60px" }} />
          <col style={{ width: "200px" }} />
          <col style={{ width: "48px" }} />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-card text-[11px] font-medium tracking-wider text-muted-foreground">
          <tr>
            <th className="whitespace-nowrap border-b px-2 py-2 text-left">编号</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-left">名称</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-left">提交方</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-left">证明目的</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-center">真实性</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-center">合法性</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-center">关联性</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-center">采信</th>
            <th className="whitespace-nowrap border-b px-2 py-2 text-left">原件</th>
            <th className="border-b px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={index}
              ref={focusEvidenceId === item.id ? focusedRowRef : null}
              onClick={() => setSelectedRow(index)}
              className={`align-middle cursor-pointer ${
                selectedRow === index
                  ? focusEvidenceId === item.id
                    ? "bg-primary/10 ring-2 ring-primary/30"
                    : "bg-accent/40"
                  : "hover:bg-accent/30"
              }`}
            >
              <td className="border-b px-2 py-1.5">
                <Input
                  value={item.id}
                  onChange={(e) => updateItem(index, { id: e.target.value })}
                  className="h-8 w-full text-xs"
                />
              </td>
              <td className="border-b px-2 py-1.5">
                <Input
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                  placeholder="证据名称"
                  className="h-8 w-full text-xs"
                />
              </td>
              <td className="border-b px-2 py-1.5">
                <select
                  value={item.submitter}
                  onChange={(e) =>
                    updateItem(index, { submitter: e.target.value as EvidenceParty })
                  }
                  className="h-8 w-full rounded border bg-transparent px-1.5 text-xs"
                >
                  {EVIDENCE_PARTY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </td>
              <td className="border-b px-2 py-1.5">
                <Input
                  value={item.purpose}
                  onChange={(e) => updateItem(index, { purpose: e.target.value })}
                  placeholder="证明…"
                  className="h-8 w-full text-xs"
                />
              </td>
              <td className="border-b px-2 py-1.5">
                <ReviewSelect
                  value={item.authenticity}
                  onChange={(v) => updateItem(index, { authenticity: v })}
                />
              </td>
              <td className="border-b px-2 py-1.5">
                <ReviewSelect
                  value={item.legality}
                  onChange={(v) => updateItem(index, { legality: v })}
                />
              </td>
              <td className="border-b px-2 py-1.5">
                <ReviewSelect
                  value={item.relevance}
                  onChange={(v) => updateItem(index, { relevance: v })}
                />
              </td>
              <td className="border-b px-2 py-1.5 text-center">
                <div className="flex flex-col items-center gap-1">
                  <input
                    type="checkbox"
                    checked={item.admitted}
                    onChange={(e) => updateItem(index, { admitted: e.target.checked })}
                    className="h-4 w-4 cursor-pointer accent-primary align-middle"
                  />
                  {countOpinions(item) > 0 && (
                    <span
                      className="flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-[1px] text-[9px] font-medium text-primary"
                      title={`已录入 ${countOpinions(item)} 条质证意见`}
                    >
                      <MessageSquare className="h-2.5 w-2.5" />
                      {countOpinions(item)}
                    </span>
                  )}
                </div>
              </td>
              <td className="relative border-b px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPickerFilter("")
                      setPickerOpenFor(pickerOpenFor === index ? null : index)
                    }}
                    className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded border bg-transparent px-2 text-left text-xs hover:bg-accent/50"
                    title={primarySource(item) || "点击选择原件"}
                  >
                    <FolderInput className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {primarySource(item)
                        ? `${primarySource(item)?.replace(/^raw\/sources\//, "")}${item.sourcePaths && item.sourcePaths.length > 1 ? ` 等 ${item.sourcePaths.length} 份` : ""}`
                        : "选择原件..."}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={!primarySource(item)}
                    title="打开原件"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSource(primarySource(item))
                    }}
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {pickerOpenFor === index && (
                  <div
                    ref={pickerRef}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 right-2 top-[calc(100%-4px)] z-30 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
                  >
                    <div className="flex items-center gap-1 border-b px-1 pb-1.5">
                      <Input
                        autoFocus
                        value={pickerFilter}
                        onChange={(e) => setPickerFilter(e.target.value)}
                        placeholder="搜索原件..."
                        className="h-7 text-xs"
                      />
                      {primarySource(item) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] text-muted-foreground"
                          onClick={() => {
                            updateItem(index, { sourcePath: undefined, sourcePaths: undefined })
                            setPickerOpenFor(null)
                          }}
                        >
                          清空
                        </Button>
                      )}
                    </div>
                    <div className="max-h-56 overflow-auto py-1">
                      {sourceOptions
                        .filter((p) => p.toLowerCase().includes(pickerFilter.toLowerCase()))
                        .map((relative) => {
                          const label = relative.replace(/^raw\/sources\//, "")
                          const selected = primarySource(item) === relative
                          return (
                            <button
                              key={relative}
                              type="button"
                              onClick={() => {
                                updateItem(index, { sourcePath: relative, sourcePaths: [relative] })
                                setPickerOpenFor(null)
                              }}
                              className={`flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs ${
                                selected
                                  ? "bg-accent text-accent-foreground"
                                  : "hover:bg-accent/50"
                              }`}
                            >
                              <FileSearch className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">{label}</span>
                              {selected && (
                                <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />
                              )}
                            </button>
                          )
                        })}
                      {sourceOptions.length === 0 && (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                          raw/sources/ 下暂无材料
                        </div>
                      )}
                      {sourceOptions.length > 0 &&
                        sourceOptions.filter((p) =>
                          p.toLowerCase().includes(pickerFilter.toLowerCase())
                        ).length === 0 && (
                          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                            无匹配文件
                          </div>
                        )}
                    </div>
                  </div>
                )}
              </td>
              <td className="border-b px-1 py-1.5 text-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeItem(index)
                  }}
                  title="删除此证据"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function renderEmptyState() {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
        <LinkIcon className="h-6 w-6 opacity-60" />
        <div>暂无证据，点击下方按钮添加第一条。</div>
      </div>
    )
  }

  function renderFooter() {
    return (
      <div className="flex items-center gap-2 border-t pt-3">
        <Button onClick={addItem} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          添加证据
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          自动保存
        </div>
      </div>
    )
  }

  // Inline editor (regular preview panel)
  const inlineEditor = (
    <div className="flex h-full flex-col gap-4 p-6">
      {renderToolbar()}
      <div className="flex-1 overflow-auto">
        {renderTable()}
        {items.length === 0 && renderEmptyState()}
      </div>
      {renderFooter()}
    </div>
  )

  // Fullscreen overlay
  const selectedItem = selectedRow !== null ? items[selectedRow] ?? null : null
  const fullscreenOverlay = (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="text-lg font-semibold tracking-wider text-foreground">
            {title || "证据清单"}
          </h2>
          {caseNumber && (
            <span className="truncate text-xs text-muted-foreground">{caseNumber}</span>
          )}
          <span className="ml-3 flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
            <StickyNote className="h-3 w-3" />
            共 {total} 条 · 已采信 {admittedCount} 条
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFullscreen(false)}
          className="h-8 text-xs"
        >
          <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
          退出全屏
          <span className="ml-2 rounded border px-1 py-0.5 text-[10px] text-muted-foreground/80">
            ESC
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setFullscreen(false)}
          className="h-8 w-8"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r">
          <div className="flex-1 overflow-auto">
            {renderTable()}
            {items.length === 0 && renderEmptyState()}
          </div>
          <div className="flex items-center gap-2 border-t bg-card/40 px-6 py-3">
            <Button onClick={addItem} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              添加证据
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              自动保存
            </div>
          </div>
        </div>
        <div className="flex w-[460px] shrink-0 flex-col border-l bg-card/20">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <EvidenceSourcePane
              selected={selectedItem}
              projectPath={project?.path}
            />
          </div>
          <div className="shrink-0 border-t">
            <CrossExamPanel
              item={selectedItem}
              onChange={(field, value) => {
                if (selectedRow === null) return
                updateOpinion(selectedRow, field, value)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {inlineEditor}
      {fullscreen && fullscreenOverlay}
    </>
  )
}

function collectFileRelatives(nodes: FileNode[], prefix: string): string[] {
  const out: string[] = []
  for (const node of nodes) {
    const rel = `${prefix}/${node.name}`
    if (node.is_dir && node.children) {
      out.push(...collectFileRelatives(node.children, rel))
    } else if (!node.is_dir) {
      if (node.name.startsWith(".")) continue
      out.push(rel)
    }
  }
  return out
}

function ReviewSelect({
  value,
  onChange,
}: {
  value: EvidenceReviewStatus
  onChange: (v: EvidenceReviewStatus) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as EvidenceReviewStatus)}
      className="h-8 w-full rounded border bg-transparent px-1.5 text-xs"
    >
      {EVIDENCE_REVIEW_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  )
}

function CrossExamPanel({
  item,
  onChange,
}: {
  item: EvidenceItem | null
  onChange: (field: keyof EvidenceOpinions, value: string) => void
}) {
  const order: Array<{
    key: keyof EvidenceOpinions
    label: string
    accent: string
    placeholder: string
  }> = [
    {
      key: "plaintiff",
      label: "原告意见",
      accent: "border-blue-500/60",
      placeholder: "请输入原告举证/质证主张…",
    },
    {
      key: "defendant",
      label: "被告意见",
      accent: "border-rose-500/60",
      placeholder: "请输入被告质证意见…",
    },
    {
      key: "court",
      label: "本院意见",
      accent: "border-primary/60",
      placeholder: "请输入合议庭/审判员认定意见…",
    },
  ]
  const refs = useRef<Array<HTMLTextAreaElement | null>>([null, null, null])

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number
  ) {
    // ⌘↵ / Ctrl+Enter → 跳到下一栏；到末尾则失去焦点，交回方向键给列表
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      const next = refs.current[index + 1]
      if (next) next.focus()
      else {
        ;(e.currentTarget as HTMLTextAreaElement).blur()
      }
    }
  }

  if (!item) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-1.5 px-6 py-6 text-center text-xs text-muted-foreground">
        <MessageSquare className="h-5 w-5 opacity-60" />
        <div>选中左侧任一证据后，可在此录入质证意见</div>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/80">
          <Keyboard className="h-3 w-3" />
          ↑ / ↓ 切换证据 · ⌘↵ 切换到下一栏 · ESC 退出全屏
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          质证意见
          <span className="text-[11px] font-normal text-muted-foreground">
            · {item.id} {item.name ? `《${item.name}》` : ""}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
          <Keyboard className="h-3 w-3" />
          ↑ / ↓ 切换 · ⌘↵ 下一栏
        </span>
      </div>
      {order.map((entry, index) => (
        <div key={entry.key} className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={`inline-block h-1.5 w-4 rounded-full border ${entry.accent} bg-transparent`}
            />
            {entry.label}
          </label>
          <textarea
            ref={(el) => {
              refs.current[index] = el
            }}
            value={item.opinions?.[entry.key] ?? ""}
            onChange={(e) => onChange(entry.key, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            placeholder={entry.placeholder}
            rows={2}
            className="resize-none rounded-md border bg-background px-2.5 py-1.5 text-xs leading-relaxed outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />
        </div>
      ))}
    </div>
  )
}

function EvidenceSourcePane({
  selected,
  projectPath,
}: {
  selected: EvidenceItem | null
  projectPath?: string
}) {
  const [textContent, setTextContent] = useState<string>("")

  const absoluteSource = useMemo(() => {
    if (!selected?.sourcePath || !projectPath) return null
    const [rel] = selected.sourcePath.split("#")
    return rel.startsWith("/") ? rel : `${normalizePath(projectPath)}/${rel}`
  }, [selected, projectPath])

  useEffect(() => {
    if (!absoluteSource) {
      setTextContent("")
      return
    }
    readFile(absoluteSource)
      .then(setTextContent)
      .catch(() => setTextContent(""))
  }, [absoluteSource])

  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <FileWarning className="h-7 w-7 opacity-60" />
        <div>点击左侧任一行以预览该证据原件</div>
      </div>
    )
  }

  if (!absoluteSource) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <FileWarning className="h-7 w-7 opacity-60" />
        <div>
          “{selected.id}” 尚未关联原件
          <div className="mt-1 text-[11px] text-muted-foreground/80">
            请先在「原件」列里选择 raw/sources/ 下的文件
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-[11px] text-muted-foreground">
        <FileSearch className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{selected.id}</span>
        <span className="truncate">{selected.name || "（未命名）"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <FilePreview filePath={absoluteSource} textContent={textContent} />
      </div>
    </div>
  )
}
