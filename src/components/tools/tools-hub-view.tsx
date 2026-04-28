import { useEffect, useState } from "react"
import { MessageSquare, Search, Network, ClipboardCheck, ClipboardList } from "lucide-react"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"
import { LintView } from "@/components/lint/lint-view"
import { ReviewView } from "@/components/review/review-view"
import { useWikiStore } from "@/stores/wiki-store"

type ToolTab = "chat" | "search" | "graph" | "lint" | "review"

const TABS: Array<{ id: ToolTab; label: string; icon: typeof MessageSquare }> = [
  { id: "chat", label: "案件问答", icon: MessageSquare },
  { id: "search", label: "全文检索", icon: Search },
  { id: "graph", label: "关联图谱", icon: Network },
  { id: "lint", label: "规范检查", icon: ClipboardCheck },
  { id: "review", label: "待办审阅", icon: ClipboardList },
]

export function ToolsHubView() {
  const activeView = useWikiStore((s) => s.activeView)
  const [activeTab, setActiveTab] = useState<ToolTab>("chat")

  useEffect(() => {
    if (activeView === "search") setActiveTab("search")
    else if (activeView === "graph") setActiveTab("graph")
    else if (activeView === "lint") setActiveTab("lint")
    else if (activeView === "review") setActiveTab("review")
    else setActiveTab("chat")
  }, [activeView])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <div className="text-lg font-semibold">辅助工具</div>
        <div className="mt-1 text-sm text-muted-foreground">
          将问答、检索、图谱、规范检查和待办审阅集中到一个工具区，避免打断办案主线。
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
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
        {activeTab === "chat" && <ChatPanel />}
        {activeTab === "search" && <SearchView />}
        {activeTab === "graph" && <GraphView />}
        {activeTab === "lint" && <LintView />}
        {activeTab === "review" && <ReviewView />}
      </div>
    </div>
  )
}
