import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Layers3, MessageSquareWarning, Scale, ScrollText } from "lucide-react"
import { readFile, writeFile } from "@/commands/fs"
import { listDirectory } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { EvidenceEditor } from "@/components/editor/evidence-editor"
import { TranscriptView } from "@/components/transcript/transcript-view"
import { useHearingWorkspaceStore } from "@/stores/hearing-workspace-store"
import type { HearingWorkspaceTab } from "@/stores/hearing-workspace-store"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { writeFrontmatter } from "@/lib/frontmatter"
import type { FileNode } from "@/types/wiki"
import type { EvidenceListFrontmatter } from "@/types/evidence"
import { loadTranscriptRecord } from "@/lib/transcript/storage"
import { buildTranscriptElementAlerts } from "@/lib/transcript/alerts"
import { emptyEvidence } from "@/types/evidence"
import { extractEvidenceDraftFromSources } from "@/lib/hearing/material-intelligence"

const TABS: Array<{ id: HearingTab; label: string; icon: typeof Layers3 }> = [
  { id: "evidence", label: "证据清单", icon: Scale },
  { id: "transcript", label: "庭审笔录", icon: ScrollText },
  { id: "elements", label: "关键要素", icon: Layers3 },
  { id: "disputes", label: "争议与补证", icon: MessageSquareWarning },
]

function flatten(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) files.push(...flatten(node.children))
    else if (!node.is_dir) files.push(node)
  }
  return files
}

function buildEmptyEvidencePage(): string {
  const initial: EvidenceListFrontmatter = {
    type: "evidence-list",
    title: "证据清单",
    case_number: "",
    updated: new Date().toISOString().slice(0, 10),
    evidences: [emptyEvidence("证据1")],
  }
  return writeFrontmatter("\n# 证据清单\n\n（请在上方表格中录入证据条目。）\n", initial)
}

export function HearingWorkspaceView() {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const activeTab = useHearingWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useHearingWorkspaceStore((s) => s.setActiveTab)
  const focusTranscriptPath = useHearingWorkspaceStore((s) => s.focusTranscriptPath)
  const focusElementId = useHearingWorkspaceStore((s) => s.focusElementId)
  const focusText = useHearingWorkspaceStore((s) => s.focusText)
  const focusEvidenceId = useHearingWorkspaceStore((s) => s.focusEvidenceId)

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先打开案件知识库</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-5 py-4">
        <div className="text-xl font-semibold">证据与庭审</div>
        <div className="mt-1 text-sm text-muted-foreground">
          将证据清单、庭审笔录、关键要素与争议补证整合到一个连续工作区。
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                activeTab === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "evidence" && <EvidenceWorkspace onChanged={bumpDataVersion} focusEvidenceId={focusEvidenceId} />}
        {activeTab === "transcript" && <TranscriptView />}
        {activeTab === "elements" && (
          <TranscriptElementsView
            transcriptPath={focusTranscriptPath}
            focusElementId={focusElementId}
          />
        )}
        {activeTab === "disputes" && (
          <TranscriptDisputesView
            transcriptPath={focusTranscriptPath}
            focusElementId={focusElementId}
            focusText={focusText}
          />
        )}
      </div>
    </div>
  )
}

function EvidenceWorkspace({ onChanged, focusEvidenceId }: { onChanged: () => void; focusEvidenceId: string | null }) {
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const root = project ? normalizePath(project.path) : ""
  const [pages, setPages] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [autoBusy, setAutoBusy] = useState("")

  const refreshPages = useCallback(async () => {
    if (!root) return
    setLoading(true)
    const tree = await listDirectory(`${root}/wiki/证据清单`).catch(() => [] as FileNode[])
    const files = flatten(tree)
      .filter((file) => file.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((file) => file.path)
    setPages(files)
    if (!selectedPath && files[0]) setSelectedPath(files[0])
    else if (selectedPath && !files.includes(selectedPath)) setSelectedPath(files[0] ?? null)
    setLoading(false)
  }, [root, selectedPath])

  useEffect(() => {
    refreshPages().catch(() => setLoading(false))
  }, [refreshPages])

  useEffect(() => {
    if (!selectedPath) {
      setContent("")
      return
    }
    readFile(selectedPath).then(setContent).catch(() => setContent(""))
  }, [selectedPath])

  async function handleCreate() {
    if (!root) return
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const path = `${root}/wiki/证据清单/证据清单-${stamp}-${Date.now().toString().slice(-4)}.md`
    await writeFile(path, buildEmptyEvidencePage())
    await refreshPages()
    setSelectedPath(path)
    onChanged()
  }

  async function ensureTargetPath(): Promise<string | null> {
    if (selectedPath) return selectedPath
    if (!root) return null
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const path = `${root}/wiki/证据清单/证据清单-${stamp}-${Date.now().toString().slice(-4)}.md`
    await writeFile(path, buildEmptyEvidencePage())
    await refreshPages()
    setSelectedPath(path)
    onChanged()
    return path
  }

  async function handleAutoExtractEvidence() {
    if (!project) return
    setAutoBusy("正在扫描原始材料并提炼证据...")
    try {
      const sourceTree = await listDirectory(`${root}/raw/sources`).catch(() => [] as FileNode[])
      const sourceFiles = flatten(sourceTree)
        .filter((file) => !file.is_dir && !file.path.includes("/.cache/"))
        .map((file) => file.path)
      const draft = await extractEvidenceDraftFromSources({
        projectPath: project.path,
        sourcePaths: sourceFiles,
        llmConfig,
      })
      const targetPath = await ensureTargetPath()
      if (!targetPath) return
      const raw = await readFile(targetPath)
      const parsed = parseFrontmatter<Partial<EvidenceListFrontmatter>>(raw)
      const existing = parsed.data.evidences ?? []
      const merged = [...existing, ...draft.items]
      const next = writeFrontmatter(raw, {
        type: "evidence-list",
        title: parsed.data.title ?? "证据清单",
        case_number: parsed.data.case_number ?? "",
        updated: new Date().toISOString().slice(0, 10),
        evidences: merged,
      } satisfies EvidenceListFrontmatter)
      await writeFile(targetPath, next)
      setContent(next)
      onChanged()
      await refreshPages()
      setSelectedPath(targetPath)
      setAutoBusy(draft.note)
    } catch (error) {
      setAutoBusy(`自动提炼失败：${String(error)}`)
    }
  }

  const currentName = useMemo(() => selectedPath?.split("/").pop() || "未选择", [selectedPath])

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_1fr]">
      <div className="flex min-h-0 flex-col border-r">
        <div className="border-b px-4 py-3">
          <div className="mb-2 text-sm font-semibold">证据清单页面</div>
          <div className="space-y-2">
            <Button className="w-full" onClick={handleCreate}>新建证据清单</Button>
            <Button variant="outline" className="w-full" onClick={handleAutoExtractEvidence}>
              从材料自动提炼证据
            </Button>
            {autoBusy && <div className="text-[11px] text-muted-foreground">{autoBusy}</div>}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">正在加载证据页面...</div>
          ) : pages.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              尚无证据清单页面，请先新建。
            </div>
          ) : (
            <div className="space-y-2">
              {pages.map((path) => {
                const active = selectedPath === path
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setSelectedPath(path)}
                    className={`w-full rounded-md border px-3 py-2 text-left ${
                      active ? "border-primary bg-primary/5" : "hover:border-primary/40"
                    }`}
                  >
                    <div className="truncate text-sm font-medium">{path.split("/").pop()}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{path.replace(`${root}/`, "")}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 overflow-hidden">
        {selectedPath && content ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-4 py-2 text-sm text-muted-foreground">{currentName}</div>
            <div className="min-h-0 flex-1 overflow-auto">
              <EvidenceEditor
                key={selectedPath}
                content={content}
                focusEvidenceId={focusEvidenceId}
                onSave={(markdown) => {
                  setContent(markdown)
                  writeFile(selectedPath, markdown).then(onChanged).catch(() => {})
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            请选择或新建一份证据清单。
          </div>
        )}
      </div>
    </div>
  )
}

function TranscriptElementsView({
  transcriptPath,
  focusElementId,
}: {
  transcriptPath: string | null
  focusElementId: string | null
}) {
  const project = useWikiStore((s) => s.project)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof loadTranscriptRecord>> | null>(null)
  const focusRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!project) return
    const root = normalizePath(project.path)
    const resolvePath = transcriptPath
      ? Promise.resolve(transcriptPath)
      : listDirectory(`${root}/wiki/庭审笔录`)
          .then((tree) => {
            const files = flatten(tree).filter((file) => file.name.endsWith(".md")).sort((a, b) => b.name.localeCompare(a.name))
            return files[0]?.path
          })
    resolvePath
      .then((path) => (path ? loadTranscriptRecord(path) : null))
      .then((next) => setRecord(next))
      .catch(() => setRecord(null))
  }, [project, transcriptPath])

  useEffect(() => {
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [record, focusElementId])

  if (!record) {
    return <EmptyState title="关键要素" hint="请先在庭审笔录页签中整理一份笔录，系统再从中提取关键要素。" />
  }

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-4">
        <div className="text-lg font-semibold">关键要素</div>
        <div className="text-sm text-muted-foreground">来源：{record.frontmatter.title}</div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {record.data.keyElements.length > 0 ? record.data.keyElements.map((item) => {
          const focused = focusElementId === item.id
          return (
          <div
            key={item.id}
            ref={focused ? focusRef : null}
            className={`rounded-xl border bg-card/40 p-4 ${focused ? "border-primary ring-2 ring-primary/30" : ""}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-medium">{item.label}</div>
              <span className={`rounded px-2 py-0.5 text-xs ${
                item.status === "已明确"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : item.status === "有争议"
                    ? "bg-amber-500/10 text-amber-600"
                    : "bg-rose-500/10 text-rose-600"
              }`}>
                {item.status}
              </span>
            </div>
            <div className="mb-2 text-xs text-muted-foreground">{item.description}</div>
            <div className="text-sm">{item.summary || "（待补充）"}</div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              支持片段：{item.supportSegmentIds.length > 0 ? item.supportSegmentIds.join("、") : "暂无"}
            </div>
          </div>
        )}) : <EmptyCard text="当前整理稿尚未提取到关键要素。" />}
      </div>
    </div>
  )
}

function TranscriptDisputesView({
  transcriptPath,
  focusElementId,
  focusText,
}: {
  transcriptPath: string | null
  focusElementId: string | null
  focusText: string | null
}) {
  const project = useWikiStore((s) => s.project)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof loadTranscriptRecord>> | null>(null)
  const focusRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!project) return
    const root = normalizePath(project.path)
    const resolvePath = transcriptPath
      ? Promise.resolve(transcriptPath)
      : listDirectory(`${root}/wiki/庭审笔录`)
          .then((tree) => {
            const files = flatten(tree).filter((file) => file.name.endsWith(".md")).sort((a, b) => b.name.localeCompare(a.name))
            return files[0]?.path
          })
    resolvePath
      .then((path) => (path ? loadTranscriptRecord(path) : null))
      .then((next) => setRecord(next))
      .catch(() => setRecord(null))
  }, [project, transcriptPath])

  useEffect(() => {
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [record, focusElementId, focusText])

  if (!record) {
    return <EmptyState title="争议与补证" hint="请先整理庭审笔录，以生成争议提醒、补证提示与发问建议。" />
  }

  const alerts = buildTranscriptElementAlerts(record.data.keyElements)

  return (
    <div className="h-full overflow-auto p-5">
      <div className="mb-4">
        <div className="text-lg font-semibold">争议与补证</div>
        <div className="text-sm text-muted-foreground">来源：{record.frontmatter.title}</div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AdviceCard
          title={`争议要素提醒（${alerts.disputedMessages.length}）`}
          items={alerts.disputedMessages}
          empty="当前没有争议要素提醒。"
          tone="warning"
          focusRef={focusRef}
          focusText={focusText}
          elementLabels={record.data.keyElements.map((item) => ({ id: item.id, label: item.label }))}
          focusElementId={focusElementId}
        />
        <AdviceCard
          title={`待补证提示（${alerts.missingEvidenceMessages.length}）`}
          items={alerts.missingEvidenceMessages}
          empty="当前没有待补证提示。"
          tone="danger"
          focusRef={focusRef}
          focusText={focusText}
          elementLabels={record.data.keyElements.map((item) => ({ id: item.id, label: item.label }))}
          focusElementId={focusElementId}
        />
        <AdviceCard
          title={`下一步发问建议（${alerts.questionSuggestions.length}）`}
          items={alerts.questionSuggestions}
          empty="当前没有发问建议。"
          tone="warning"
          focusRef={focusRef}
          focusText={focusText}
          elementLabels={record.data.keyElements.map((item) => ({ id: item.id, label: item.label }))}
          focusElementId={focusElementId}
        />
        <AdviceCard
          title={`补证建议（${alerts.evidenceSuggestions.length}）`}
          items={alerts.evidenceSuggestions}
          empty="当前没有补证建议。"
          tone="danger"
          focusRef={focusRef}
          focusText={focusText}
          elementLabels={record.data.keyElements.map((item) => ({ id: item.id, label: item.label }))}
          focusElementId={focusElementId}
        />
      </div>
    </div>
  )
}

function AdviceCard({
  title,
  items,
  empty,
  tone,
  focusRef,
  focusText,
  elementLabels,
  focusElementId,
}: {
  title: string
  items: string[]
  empty: string
  tone: "warning" | "danger"
  focusRef?: React.RefObject<HTMLLIElement | null>
  focusText?: string | null
  elementLabels?: Array<{ id: string; label: string }>
  focusElementId?: string | null
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "warning" ? "border-amber-500/30 bg-amber-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
      <div className="mb-2 font-medium">{title}</div>
      {items.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {items.map((item) => {
            const focusedByText = focusText ? item === focusText : false
            const focusedByElement = focusElementId
              ? elementLabels?.some((entry) => entry.id === focusElementId && item.includes(entry.label))
              : false
            const focused = focusedByText || focusedByElement
            return (
              <li
                key={item}
                ref={focused ? focusRef : null}
                className={`rounded-md bg-background/70 px-3 py-2 ${focused ? "ring-2 ring-primary/30 border border-primary" : ""}`}
              >
                {item}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">{empty}</div>
      )}
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-xl rounded-xl border border-dashed bg-card/20 p-6 text-center">
        <div className="text-base font-semibold">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{hint}</div>
      </div>
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">{text}</div>
}
