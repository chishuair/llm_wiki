import { useEffect, useState } from "react"
import { Search, Network, ClipboardCheck, ClipboardList, Activity, CheckCircle2, AlertTriangle } from "lucide-react"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"
import { LintView } from "@/components/lint/lint-view"
import { ReviewView } from "@/components/review/review-view"
import { useWikiStore } from "@/stores/wiki-store"
import { collectDashboardSummary, type DashboardSummary } from "@/lib/dashboard/summary"
import { getOcrStatus, type OcrStatus } from "@/commands/fs"
import { listCodes } from "@/lib/lawbase"

type ToolTab = "health" | "search" | "graph" | "lint" | "review"

const TABS: Array<{ id: ToolTab; label: string; icon: typeof Activity }> = [
  { id: "health", label: "数据健康检查", icon: Activity },
  { id: "search", label: "全文检索", icon: Search },
  { id: "graph", label: "关联图谱", icon: Network },
  { id: "lint", label: "规范检查", icon: ClipboardCheck },
  { id: "review", label: "待办审阅", icon: ClipboardList },
]

export function ToolsHubView() {
  const activeView = useWikiStore((s) => s.activeView)
  const [activeTab, setActiveTab] = useState<ToolTab>("health")

  useEffect(() => {
    if (activeView === "search") setActiveTab("search")
    else if (activeView === "graph") setActiveTab("graph")
    else if (activeView === "lint") setActiveTab("lint")
    else if (activeView === "review") setActiveTab("review")
    else setActiveTab("health")
  }, [activeView])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <div className="text-lg font-semibold">辅助工具</div>
        <div className="mt-1 text-sm text-muted-foreground">
          集中放置健康检查、检索、图谱、规范检查和待办审阅，避免打断办案主线。
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
        {activeTab === "health" && <HealthCheckView />}
        {activeTab === "search" && <SearchView />}
        {activeTab === "graph" && <GraphView />}
        {activeTab === "lint" && <LintView />}
        {activeTab === "review" && <ReviewView />}
      </div>
    </div>
  )
}

function HealthCheckView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [ocr, setOcr] = useState<OcrStatus | null>(null)

  useEffect(() => {
    if (!project) return
    collectDashboardSummary(project).then(setSummary).catch(() => setSummary(null))
    getOcrStatus().then(setOcr).catch(() => setOcr({ paddleocr: false, tesseract: false, ocrmypdf: false }))
  }, [project, dataVersion])

  if (!project) {
    return <div className="p-6 text-sm text-muted-foreground">请先打开案件。</div>
  }

  const lawCount = listCodes().length
  const items = [
    {
      label: "案件材料",
      ok: (summary?.materialCount ?? 0) > 0,
      detail: summary ? `已导入 ${summary.materialCount} 份材料` : "正在读取",
      advice: "未导入材料时，文书和问答缺少事实来源。",
    },
    {
      label: "案件主数据",
      ok: summary ? summary.metaConflictCount === 0 && summary.metaPendingCount === 0 : false,
      detail: summary ? `待确认 ${summary.metaPendingCount} 项，冲突 ${summary.metaConflictCount} 项` : "正在读取",
      advice: "建议先在案件总览确认案号、案由、法院、当事人等字段。",
    },
    {
      label: "本地法规库",
      ok: lawCount > 0,
      detail: `已载入 ${lawCount} 部法律法规`,
      advice: "法规库为空时，禁止依赖 AI 自行引用法条。",
    },
    {
      label: "OCR 环境",
      ok: Boolean(ocr?.paddleocr || ocr?.tesseract || ocr?.ocrmypdf),
      detail: ocr ? `PaddleOCR：${ocr.paddleocr ? "可用" : "未检测到"}；Tesseract：${ocr.tesseract ? "可用" : "未检测到"}；ocrmypdf：${ocr.ocrmypdf ? "可用" : "未检测到"}` : "正在检测",
      advice: "建议优先安装 PaddleOCR，用于图片和扫描 PDF。",
    },
    {
      label: "开庭工作单",
      ok: Boolean(summary?.hasWorksheet),
      detail: summary?.hasWorksheet ? "已生成或已设定当前工作单" : "未检测到当前工作单",
      advice: "生成裁判文书前，建议先形成开庭工作单。",
    },
  ]

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">数据健康检查</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            用于生成文书或裁判辅助前的基础体检，帮助发现材料、法规、OCR 和主数据问题。
          </p>
        </div>
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.label} className="rounded-xl border bg-card/50 p-4">
              <div className="flex items-start gap-3">
                {item.ok ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.label}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
                  {!item.ok && <div className="mt-2 text-xs text-amber-600">{item.advice}</div>}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${item.ok ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-600"}`}>
                  {item.ok ? "正常" : "需处理"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
