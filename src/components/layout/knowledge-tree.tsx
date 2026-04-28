import { useState, useEffect, useCallback } from "react"
import {
  FileText, Users, Lightbulb, BookOpen, HelpCircle, GitMerge, BarChart3, ChevronRight, ChevronDown, Layout, Globe, Plus,
  ScrollText,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, listDirectory, writeFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { writeFrontmatter } from "@/lib/frontmatter"
import type { EvidenceListFrontmatter } from "@/types/evidence"

interface WikiPageInfo {
  path: string
  title: string
  type: string
  tags: string[]
  origin?: string
}

const TYPE_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string; order: number }> = {
  "案情概述": { icon: Layout, label: "案情概述", color: "text-yellow-500", order: 0 },
  "当事人信息": { icon: Users, label: "当事人信息", color: "text-blue-500", order: 1 },
  "证据清单": { icon: BookOpen, label: "证据清单", color: "text-orange-500", order: 2 },
  "争议焦点": { icon: HelpCircle, label: "争议焦点", color: "text-green-500", order: 3 },
  "法院认定事实": { icon: Lightbulb, label: "法院认定事实", color: "text-purple-500", order: 4 },
  "本院认为": { icon: GitMerge, label: "本院认为", color: "text-red-500", order: 5 },
  "法律依据": { icon: BarChart3, label: "法律依据", color: "text-emerald-500", order: 6 },
  "判决结果": { icon: FileText, label: "判决结果", color: "text-cyan-500", order: 7 },
  "审理过程": { icon: Globe, label: "审理过程", color: "text-indigo-500", order: 8 },
  "庭审笔录": { icon: ScrollText, label: "庭审笔录", color: "text-rose-500", order: 9 },
  overview: { icon: Layout, label: "案情概述", color: "text-yellow-500", order: 0 },
  entity: { icon: Users, label: "当事人信息", color: "text-blue-500", order: 1 },
  concept: { icon: Lightbulb, label: "法院认定事实", color: "text-purple-500", order: 4 },
  source: { icon: BookOpen, label: "证据清单", color: "text-orange-500", order: 2 },
  synthesis: { icon: GitMerge, label: "本院认为", color: "text-red-500", order: 5 },
  comparison: { icon: BarChart3, label: "法律依据", color: "text-emerald-500", order: 6 },
  query: { icon: HelpCircle, label: "争议焦点", color: "text-green-500", order: 3 },
}

const DEFAULT_CONFIG = { icon: FileText, label: "其他页面", color: "text-muted-foreground", order: 99 }

export function KnowledgeTree() {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const fileTree = useWikiStore((s) => s.fileTree)
  const [pages, setPages] = useState<WikiPageInfo[]>([])
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(["案情概述", "当事人信息", "证据清单", "庭审笔录"]))

  const loadPages = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const wikiTree = await listDirectory(`${pp}/wiki`)
      const mdFiles = flattenMdFiles(wikiTree)

      const pageInfos: WikiPageInfo[] = []
      for (const file of mdFiles) {
        // Skip index.md and log.md
        if (file.name === "index.md" || file.name === "log.md") continue
        try {
          const content = await readFile(file.path)
          const info = parsePageInfo(file.path, file.name, content)
          pageInfos.push(info)
        } catch {
          pageInfos.push({
            path: file.path,
            title: file.name.replace(".md", "").replace(/-/g, " "),
            type: "其他页面",
            tags: [],
          })
        }
      }

      setPages(pageInfos)
    } catch {
      setPages([])
    }
  }, [project])

  // Reload when file tree changes (after ingest writes new pages)
  useEffect(() => {
    loadPages()
  }, [loadPages, fileTree])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        未打开案件知识库
      </div>
    )
  }

  // Group pages by type
  const grouped = new Map<string, WikiPageInfo[]>()
  for (const page of pages) {
    const list = grouped.get(page.type) ?? []
    list.push(page)
    grouped.set(page.type, list)
  }

  // Sort groups by configured order
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    const orderA = TYPE_CONFIG[a[0]]?.order ?? DEFAULT_CONFIG.order
    const orderB = TYPE_CONFIG[b[0]]?.order ?? DEFAULT_CONFIG.order
    return orderA - orderB
  })

  function toggleType(type: string) {
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  async function createEvidenceListPage() {
    if (!project) return
    const pp = normalizePath(project.path)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const dir = `${pp}/wiki/证据清单`
    const ts = Date.now().toString().slice(-4)
    const path = `${dir}/证据清单-${today}-${ts}.md`
    const initial: EvidenceListFrontmatter = {
      type: "evidence-list",
      title: "证据清单",
      case_number: "",
      updated: new Date().toISOString().slice(0, 10),
      evidences: [],
    }
    const content = writeFrontmatter("\n# 证据清单\n\n（请在上方表格中录入证据条目。）\n", initial)
    try {
      await writeFile(path, content)
      setSelectedFile(path)
      useWikiStore.getState().bumpDataVersion()
    } catch (err) {
      console.error("创建证据清单页面失败:", err)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {project.name}
          </span>
          <button
            onClick={createEvidenceListPage}
            title="新建结构化证据清单"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {sortedGroups.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无知识页面，请先导入案件材料，或点击右上角 <Plus className="mx-1 inline h-3 w-3" /> 新建结构化证据清单。
          </div>
        )}

        {sortedGroups.map(([type, items]) => {
          const config = TYPE_CONFIG[type] ?? DEFAULT_CONFIG
          const Icon = config.icon
          const isExpanded = expandedTypes.has(type)

          return (
            <div key={type} className="mb-1">
              <button
                onClick={() => toggleType(type)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                <span className="flex-1 text-left font-medium">{config.label}</span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </button>

              {isExpanded && (
                <div className="ml-3">
                  {items.map((page) => {
                    const isSelected = selectedFile === page.path
                    return (
                      <button
                        key={page.path}
                        onClick={() => setSelectedFile(page.path)}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ${
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                        }`}
                        title={page.path}
                      >
                        {page.origin === "web-clip" && <Globe className="h-3 w-3 shrink-0 text-blue-400" />}
                        <span className="truncate">{page.title}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Raw sources quick access */}
        <RawSourcesSection />
      </div>
    </ScrollArea>
  )
}

function RawSourcesSection() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const [expanded, setExpanded] = useState(false)
  const [sources, setSources] = useState<FileNode[]>([])

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    listDirectory(`${pp}/raw/sources`)
      .then((tree) => setSources(flattenAllFiles(tree)))
      .catch(() => setSources([]))
  }, [project])

  if (sources.length === 0) return null

  return (
    <div className="mt-2 border-t pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="flex-1 text-left font-medium text-muted-foreground">原始材料</span>
        <span className="text-xs text-muted-foreground">{sources.length}</span>
      </button>
      {expanded && (
        <div className="ml-3">
          {sources.map((file) => {
            const isSelected = selectedFile === file.path
            return (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file.path)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <span className="truncate">{file.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function parsePageInfo(path: string, fileName: string, content: string): WikiPageInfo {
  let type = "其他页面"
  let title = fileName.replace(".md", "").replace(/-/g, " ")
  const tags: string[] = []
  let origin: string | undefined

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const typeMatch = fm.match(/^type:\s*(.+)$/m)
    if (typeMatch) type = typeMatch[1].trim().toLowerCase()

    const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch) title = titleMatch[1].trim()

    const tagsMatch = fm.match(/^tags:\s*\[(.+?)\]/m)
    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, "")))
    }

    const originMatch = fm.match(/^origin:\s*(.+)$/m)
    if (originMatch) origin = originMatch[1].trim()
  }

  // Fallback: try first heading if no frontmatter title
  if (title === fileName.replace(".md", "").replace(/-/g, " ")) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch) title = headingMatch[1].trim()
  }

  // Fallback: infer type from path
  if (type === "其他页面") {
    if (path.includes("/entities/")) type = "entity"
    else if (path.includes("/concepts/")) type = "concept"
    else if (path.includes("/sources/")) type = "source"
    else if (path.includes("/queries/")) type = "query"
    else if (path.includes("/comparisons/")) type = "comparison"
    else if (path.includes("/synthesis/")) type = "synthesis"
    else if (fileName === "overview.md") type = "overview"
    else if (path.includes("/案情概述/")) type = "案情概述"
    else if (path.includes("/当事人信息/")) type = "当事人信息"
    else if (path.includes("/证据清单/")) type = "证据清单"
    else if (path.includes("/争议焦点/")) type = "争议焦点"
    else if (path.includes("/法院认定事实/")) type = "法院认定事实"
    else if (path.includes("/本院认为/")) type = "本院认为"
    else if (path.includes("/法律依据/")) type = "法律依据"
    else if (path.includes("/判决结果/")) type = "判决结果"
    else if (path.includes("/审理过程/")) type = "审理过程"
    else if (path.includes("/庭审笔录/")) type = "庭审笔录"
  }

  return { path, title, type, tags, origin }
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}
