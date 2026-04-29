import { useState, useEffect, useRef } from "react"
import {
  LayoutDashboard, FolderOpen, Settings, ArrowLeftRight, Globe,
  Briefcase, Plus, FolderInput, Check, Scale, Wand2, ScrollText, Blocks, MessageSquare,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useResearchStore } from "@/stores/research-store"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/logo.svg"
import type { WikiState } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"
import { getRecentProjects } from "@/lib/project-store"

type NavView = WikiState["activeView"]

const NAV_ITEMS: { view: NavView; icon: typeof LayoutDashboard; label: string }[] = [
  { view: "dashboard", icon: LayoutDashboard, label: "案件总览" },
  { view: "wiki", icon: MessageSquare, label: "案件问答" },
  { view: "sources", icon: FolderOpen, label: "案件材料" },
  { view: "transcript", icon: ScrollText, label: "证据与庭审" },
  { view: "tools", icon: Blocks, label: "辅助工具" },
  { view: "lawbase", icon: Scale, label: "法律依据" },
  { view: "legal-doc", icon: Wand2, label: "法律文书" },
]

interface IconSidebarProps {
  onSwitchProject: () => void
  onSelectProject: (project: WikiProject) => void | Promise<void>
  onNewProject: () => void
  onOpenProject: () => void | Promise<void>
}

export function IconSidebar({ onSwitchProject, onSelectProject, onNewProject, onOpenProject }: IconSidebarProps) {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const currentProject = useWikiStore((s) => s.project)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)
  const researchPanelOpen = useResearchStore((s) => s.panelOpen)
  const researchActiveCount = useResearchStore((s) => s.tasks.filter((t) => t.status !== "done" && t.status !== "error").length)
  const toggleResearchPanel = useResearchStore((s) => s.setPanelOpen)

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!switcherOpen) return
    getRecentProjects().then(setRecentProjects).catch(() => setRecentProjects([]))
  }, [switcherOpen])

  useEffect(() => {
    if (!switcherOpen) return
    function onDocClick(e: MouseEvent) {
      if (!switcherRef.current) return
      if (!switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [switcherOpen])

  // Daemon health check
  const [daemonStatus, setDaemonStatus] = useState<string>("starting")
  useEffect(() => {
    const check = async () => {
      try {
        const { clipServerStatus } = await import("@/commands/fs")
        const status = await clipServerStatus()
        setDaemonStatus(status)
      } catch {
        setDaemonStatus("error")
      }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-12 flex-col items-center border-r bg-muted/50 py-2">
        {/* Logo */}
        <div className="mb-2 flex items-center justify-center">
          <img
            src={logoImg}
            alt="案件知识库"
            className="h-8 w-8 rounded-[22%]"
          />
        </div>

        {/* Case switcher */}
        <div ref={switcherRef} className="relative mb-2">
          <Tooltip>
            <TooltipTrigger
              onClick={() => setSwitcherOpen((o) => !o)}
              className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                switcherOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <Briefcase className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">切换案件</TooltipContent>
          </Tooltip>
          {switcherOpen && (
            <div className="absolute left-12 top-0 z-40 w-72 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                案件列表
              </div>
              <div className="max-h-80 overflow-auto">
                {recentProjects.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    暂无案件
                  </div>
                )}
                {recentProjects.map((proj) => {
                  const active = currentProject?.path === proj.path
                  return (
                    <button
                      key={proj.path}
                      onClick={async () => {
                        setSwitcherOpen(false)
                        if (!active) await onSelectProject(proj)
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <Briefcase className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{proj.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{proj.path}</div>
                      </div>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
              <div className="mt-1 border-t pt-1">
                <button
                  onClick={() => {
                    setSwitcherOpen(false)
                    onNewProject()
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/50"
                >
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  新建案件
                </button>
                <button
                  onClick={async () => {
                    setSwitcherOpen(false)
                    await onOpenProject()
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/50"
                >
                  <FolderInput className="h-3.5 w-3.5 text-primary" />
                  打开本地案件文件夹
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Top: main nav items + Deep Research */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map(({ view, icon: Icon, label }) => (
            <Tooltip key={view}>
              <TooltipTrigger
                onClick={() => setActiveView(view)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  activeView === view
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {view === "tools" && pendingCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">
                {label}
                {view === "tools" && pendingCount > 0 && ` (${pendingCount})`}
              </TooltipContent>
            </Tooltip>
          ))}
          {/* 深度研究入口 */}
          <Tooltip>
            <TooltipTrigger
              onClick={() => toggleResearchPanel(!researchPanelOpen)}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                researchPanelOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <Globe className="h-5 w-5" />
              {researchActiveCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
                  {researchActiveCount}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent side="right">深度研究</TooltipContent>
          </Tooltip>
        </div>
        {/* Bottom: daemon status + settings + switch project */}
        <div className="flex flex-col items-center gap-1 pb-1">
          {/* Daemon status indicator */}
          <Tooltip>
            <TooltipTrigger className="flex h-6 w-6 items-center justify-center">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  daemonStatus === "running" ? "bg-emerald-500" :
                  daemonStatus === "starting" ? "bg-amber-400 animate-pulse" :
                  daemonStatus === "port_conflict" ? "bg-red-500" :
                  "bg-red-500 animate-pulse"
                }`}
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              {daemonStatus === "running" && "剪藏服务运行中"}
              {daemonStatus === "starting" && "剪藏服务启动中..."}
              {daemonStatus === "port_conflict" && "19827 端口被占用，网页剪藏不可用"}
              {daemonStatus === "error" && "剪藏服务异常，正在重试"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => setActiveView("settings")}
              className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                activeView === "settings"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <Settings className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">{t("nav.settings")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={onSwitchProject}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
            >
              <ArrowLeftRight className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">{t("nav.switchProject")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
