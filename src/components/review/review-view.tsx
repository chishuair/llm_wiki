import { useCallback } from "react"
import { queueResearch } from "@/lib/deep-research"
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  CheckCircle2,
  Lightbulb,
  MessageSquare,
  X,
  Check,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { writeFile, readFile, listDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

const typeConfig: Record<ReviewItem["type"], { icon: typeof AlertTriangle; label: string; color: string }> = {
  contradiction: { icon: AlertTriangle, label: "矛盾内容", color: "text-amber-500" },
  duplicate: { icon: Copy, label: "疑似重复", color: "text-blue-500" },
  "missing-page": { icon: FileQuestion, label: "缺失页面", color: "text-purple-500" },
  confirm: { icon: MessageSquare, label: "需要确认", color: "text-foreground" },
  suggestion: { icon: Lightbulb, label: "优化建议", color: "text-emerald-500" },
}

export function ReviewView() {
  const items = useReviewStore((s) => s.items)
  const resolveItem = useReviewStore((s) => s.resolveItem)
  const dismissItem = useReviewStore((s) => s.dismissItem)
  const clearResolved = useReviewStore((s) => s.clearResolved)
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const handleResolve = useCallback(async (id: string, action: string) => {
    const pp = project ? normalizePath(project.path) : ""
    // Deep Research — must be checked FIRST before any fuzzy matching
    if (action === "__deep_research__" && project) {
      const searchConfig = useWikiStore.getState().searchApiConfig
      if (searchConfig.provider === "none" || !searchConfig.apiKey) {
        window.alert("Web Search not configured. Go to Settings → Web Search to add a Tavily API key first.")
        return
      }
      const item = items.find((i) => i.id === id)
      if (item) {
        const llmConfig = useWikiStore.getState().llmConfig
        // Use pre-generated search queries if available, otherwise fall back to title
        const topic = item.title.replace(/^(Save to Wiki|Create|Research)[:\s]*/i, "").trim() || item.description.split("\n")[0]
        queueResearch(pp, topic, llmConfig, searchConfig, item.searchQueries)
        resolveItem(id, "Queued for research")
      } else {
        resolveItem(id, action)
      }
      return
    }

    if (action.startsWith("save:") && project) {
      // Decode and save the content to wiki
      try {
        const encoded = action.slice(5)
        const content = decodeURIComponent(atob(encoded))

        // Strip hidden comments
        const cleanContent = content
          .replace(/<!--\s*save-worthy:.*?-->/g, "")
          .replace(/<!--\s*sources:.*?-->/g, "")
          .trimEnd()

        // 按首行标题 + 日期构造中文文件名，保存到「本院认为」目录
        const firstLine = cleanContent.split("\n").find((l) => l.trim() && !l.startsWith("<!--"))?.replace(/^#+\s*/, "").trim() ?? "会话记录"
        const title = (firstLine.slice(0, 40) || "会话记录").replace(/[\\/:*?"<>|\n\r]/g, "")
        const isoDate = new Date().toISOString().slice(0, 10)
        const compactDate = isoDate.replace(/-/g, "")
        const fileName = `${compactDate}-${title}.md`
        const filePath = `${pp}/wiki/本院认为/${fileName}`

        const frontmatter = `---\ntype: 本院认为\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${isoDate}\nupdated: ${isoDate}\ntags: [待办审阅]\nrelated: []\n---\n\n`
        await writeFile(filePath, frontmatter + cleanContent)

        // 更新 index.md：把本院认为分组下加入新条目
        const indexPath = `${pp}/wiki/index.md`
        let indexContent = ""
        try { indexContent = await readFile(indexPath) } catch { indexContent = "# 案件知识库索引\n\n## 本院认为\n" }
        const entry = `- [[本院认为/${fileName.replace(/\.md$/, "")}|${title}]]`
        if (indexContent.includes("## 本院认为")) {
          indexContent = indexContent.replace(/(## 本院认为\n)/, `$1${entry}\n`)
        } else {
          indexContent = indexContent.trimEnd() + "\n\n## 本院认为\n" + entry + "\n"
        }
        await writeFile(indexPath, indexContent)

        // 追加日志
        const logPath = `${pp}/wiki/log.md`
        let logContent = ""
        try { logContent = await readFile(logPath) } catch { logContent = "# 案件办理日志\n" }
        await writeFile(logPath, logContent.trimEnd() + `\n- ${isoDate}：由待办审阅保存说理页面 \`${fileName}\`\n`)

        // 刷新文件树
        const tree = await listDirectory(pp)
        setFileTree(tree)

        resolveItem(id, "已保存到知识库")
      } catch (err) {
        console.error("Failed to save to wiki from review:", err)
        resolveItem(id, "Save failed")
      }
    } else if (action.startsWith("open:") && project) {
      // Open a page for editing
      const page = action.slice(5)
      const candidates = [
        `${pp}/wiki/${page}`,
        `${pp}/wiki/${page}.md`,
      ]
      for (const path of candidates) {
        try {
          const content = await readFile(path)
          useWikiStore.getState().setSelectedFile(path)
          useWikiStore.getState().setFileContent(content)
          useWikiStore.getState().setActiveView("wiki")
          break
        } catch {
          // try next
        }
      }
      resolveItem(id, action)
    } else if (action.startsWith("delete:") && project) {
      // Delete a file
      const filePath = action.slice(7)
      try {
        await deleteFile(filePath)
        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveItem(id, "Deleted")
      } catch (err) {
        console.error("Failed to delete:", err)
        resolveItem(id, "Delete failed")
      }
    } else if (actionLooksLikeResearch(action) && project) {
      // Actions with "research" trigger deep research, not just page creation
      const searchConfig = useWikiStore.getState().searchApiConfig
      if (searchConfig.provider === "none" || !searchConfig.apiKey) {
        // No search API — fall through to create a page instead
        const item = items.find((i) => i.id === id)
        if (item) {
          handleResolve(id, "__create_page__:" + action)
        }
        return
      }
      const item = items.find((i) => i.id === id)
      if (item) {
        const llmConfig = useWikiStore.getState().llmConfig
        const topic = action.replace(/^research\s*/i, "").trim() || item.description.split("\n")[0]
        queueResearch(pp, topic, llmConfig, searchConfig)
        resolveItem(id, "Queued for deep research")
      } else {
        resolveItem(id, action)
      }
    } else if (action.startsWith("__create_page__:") && project) {
      // Explicit create page fallback
      const realAction = action.slice("__create_page__:".length)
      await createPageFromReview(id, realAction, items, pp)
    } else if (actionLooksLikeCreate(action) && project) {
      // Create a wiki page from the review item's content
      const item = items.find((i) => i.id === id)
      if (item) {
        try {
          const title = item.title.replace(/^(Create|Save|Add)[:\s]*/i, "").trim() || "Untitled"
          const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)
          const date = new Date().toISOString().slice(0, 10)

          // Determine page type from review type or action text
          const pageType = detectPageType(action, item.type)
          const dir = pageType === "query" ? "queries" : pageType === "entity" ? "entities" : pageType === "concept" ? "concepts" : "queries"
          const fileName = `${slug}-${date}.md`
          const filePath = `${pp}/wiki/${dir}/${fileName}`

          const frontmatter = `---\ntype: ${pageType}\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\nrelated: []\n---\n\n`
          const body = `# ${title}\n\n${item.description}\n`
          await writeFile(filePath, frontmatter + body)

          // Update index
          const indexPath = `${pp}/wiki/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# Wiki Index\n" }
          const sectionHeader = `## ${dir.charAt(0).toUpperCase() + dir.slice(1)}`
          const entry = `- [[${dir}/${slug}-${date}|${title}]]`
          if (indexContent.includes(sectionHeader)) {
            indexContent = indexContent.replace(new RegExp(`(${sectionHeader}\n)`), `$1${entry}\n`)
          } else {
            indexContent = indexContent.trimEnd() + `\n\n${sectionHeader}\n${entry}\n`
          }
          await writeFile(indexPath, indexContent)

          // Log
          const logPath = `${pp}/wiki/log.md`
          let logContent = ""
          try { logContent = await readFile(logPath) } catch { logContent = "# Wiki Log\n" }
          await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Created ${pageType} page \`${fileName}\` from review\n`)

          // Refresh
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()

          resolveItem(id, `Created: wiki/${dir}/${fileName}`)
        } catch (err) {
          console.error("Failed to create page from review:", err)
          resolveItem(id, "Create failed")
        }
      } else {
        resolveItem(id, action)
      }
    } else {
      resolveItem(id, action)
    }
  }, [project, items, resolveItem, setFileTree])

  const pending = items.filter((i) => !i.resolved)
  const resolved = items.filter((i) => i.resolved)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          待办审阅
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {pending.length}
            </span>
          )}
        </h2>
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearResolved} className="text-xs">
            <Trash2 className="mr-1 h-3 w-3" />
            清除已处理
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            <p>当前无待审阅事项</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {pending.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
            {resolved.length > 0 && pending.length > 0 && (
              <div className="my-2 text-center text-xs text-muted-foreground">
                — 已处理 —
              </div>
            )}
            {resolved.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDismiss={dismissItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
  onDismiss: (id: string) => void
}) {
  const config = typeConfig[item.type]
  const Icon = config.icon

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-opacity ${
        item.resolved ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="font-medium">{item.title}</span>
        </div>
        <button
          onClick={() => onDismiss(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>

      {item.affectedPages && item.affectedPages.length > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          涉及页面：{item.affectedPages.join(", ")}
        </div>
      )}

      {!item.resolved ? (
        <div className="flex flex-wrap gap-1.5">
          {(item.type === "suggestion" || item.type === "missing-page") && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onResolve(item.id, "__deep_research__")}
            >
              🔍 深度研究
            </Button>
          )}
          {item.options.map((opt) => (
            <Button
              key={opt.action}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onResolve(item.id, opt.action)}
            >
              {localizeOptionLabel(opt.label, opt.action)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" />
          {item.resolvedAction}
        </div>
      )}
    </div>
  )
}

/**
 * Map English action labels (legacy / LLM-returned) to Chinese
 * display labels so the UI stays consistent for 中文 users.
 */
function localizeOptionLabel(label: string, action: string): string {
  const map: Record<string, string> = {
    "Create Page": "创建页面",
    "Skip": "跳过",
    "Open & Edit": "打开并编辑",
    "Delete Page": "删除页面",
    "Approve": "同意",
    "Reject": "拒绝",
    "Review": "审阅",
    "Save to Wiki": "写入知识库",
    "Research": "深度研究",
  }
  if (map[label]) return map[label]
  if (action.startsWith("open:")) return "打开并编辑"
  if (action.startsWith("delete:")) return "删除页面"
  return label
}

/** Detect if an action implies deep research (web search + LLM synthesis) */
function actionLooksLikeResearch(action: string): boolean {
  // Skip internal action identifiers
  if (action.startsWith("__")) return false
  const lower = action.toLowerCase()
  return (
    lower.includes("research") ||
    lower.includes("investigate") ||
    lower.includes("explore") ||
    lower.includes("look into") ||
    lower.includes("研究") ||
    lower.includes("调研") ||
    lower.includes("探索")
  )
}

/** Detect if an action is a dismissal (no-op) or should create a page */
function actionIsDismissal(action: string): boolean {
  const lower = action.toLowerCase()
  return (
    lower === "skip" ||
    lower === "dismiss" ||
    lower === "ignore" ||
    lower === "跳过" ||
    lower === "忽略" ||
    lower === "approve" ||
    lower === "keep existing" ||
    lower === "no"
  )
}

function actionLooksLikeCreate(action: string): boolean {
  // Anything that isn't a dismissal should create a page
  return !actionIsDismissal(action)
}

/** Infer wiki page type from action text and review item type */
function detectPageType(action: string, reviewType: string): string {
  const lower = action.toLowerCase()
  if (lower.includes("entity") || lower.includes("实体")) return "entity"
  if (lower.includes("concept") || lower.includes("概念")) return "concept"
  if (lower.includes("comparison") || lower.includes("compare") || lower.includes("比较")) return "comparison"
  if (lower.includes("synthesis") || lower.includes("综合")) return "synthesis"
  if (reviewType === "missing-page") return "concept"
  if (reviewType === "contradiction") return "query"
  if (reviewType === "suggestion") return "query"
  // Default: research/investigate/create → query
  return "query"
}
