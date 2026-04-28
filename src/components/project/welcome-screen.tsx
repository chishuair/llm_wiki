import { useEffect, useState } from "react"
import { FolderOpen, Plus, X, ArrowLeft, Briefcase, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
  onReturn?: (project: WikiProject) => void
}

interface RecentProjectMeta {
  project: WikiProject
  updatedAt?: number
}

async function enrichWithStats(projects: WikiProject[]): Promise<RecentProjectMeta[]> {
  // Recency is already implied by ordering from getRecentProjects.
  // Timestamp badge is intentionally omitted to avoid a Tauri stat round-trip.
  return projects.map((project) => ({ project }))
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return ""
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const days = Math.floor(diff / 86_400_000)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString("zh-CN")
}

export function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onSelectProject,
  onReturn,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [recentProjects, setRecentProjects] = useState<RecentProjectMeta[]>([])

  async function refresh() {
    const projects = await getRecentProjects().catch(() => [])
    const enriched = await enrichWithStats(projects)
    setRecentProjects(enriched)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    await refresh()
  }

  const hasProjects = recentProjects.length > 0
  const lastProject = recentProjects[0]?.project

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 0%, oklch(0.82 0.13 85 / 0.08) 0%, transparent 70%), radial-gradient(60% 50% at 50% 100%, oklch(0.35 0.04 260 / 0.35) 0%, transparent 70%)",
        }}
      />

      {onReturn && lastProject && (
        <div className="absolute left-4 top-4 z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReturn(lastProject)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回上次案件
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="relative pt-12 pb-6 text-center">
        <div className="mx-auto mb-4 h-[2px] w-24 bg-primary/70" />
        <h1 className="text-3xl font-semibold tracking-[0.18em] text-foreground">
          {t("app.title")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("app.subtitle")}</p>
        <div className="mx-auto mt-4 h-[2px] w-24 bg-primary/70" />

        <div className="mt-8 flex justify-center gap-3">
          <Button onClick={onCreateProject}>
            <Plus className="mr-2 h-4 w-4" />
            新建案件
          </Button>
          <Button variant="outline" onClick={onOpenProject}>
            <FolderOpen className="mr-2 h-4 w-4" />
            打开案件文件夹
          </Button>
        </div>
      </div>

      {/* Case grid */}
      <div className="relative flex-1 overflow-auto px-8 pb-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            案件列表（{recentProjects.length}）
          </div>

          {!hasProjects && (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              暂无案件，请点击上方「新建案件」开始建库。
            </div>
          )}

          {hasProjects && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentProjects.map(({ project, updatedAt }) => (
                <div
                  key={project.path}
                  className="group relative rounded-xl border bg-card/60 p-4 shadow-sm transition-all hover:border-primary/60 hover:shadow-md"
                >
                  <button
                    onClick={() => onSelectProject(project)}
                    className="flex w-full flex-col gap-2 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                        <Briefcase className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {project.name}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {project.path}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-end text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground/80">
                        点击进入
                      </span>
                      {updatedAt ? (
                        <span className="ml-2 text-[10px] text-muted-foreground/70">
                          {formatRelativeTime(updatedAt)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveRecent(e, project.path)}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="从列表中移除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
