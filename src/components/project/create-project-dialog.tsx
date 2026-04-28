import { useMemo, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FolderOpen, ChevronRight, ChevronDown, Check } from "lucide-react"
import { createProject, writeFile, createDirectory } from "@/commands/fs"
import { defaultCaseMeta, type CaseType } from "@/lib/case-meta"
import { extraDirsForTemplate, getTemplate, templates } from "@/lib/templates"
import { TemplatePicker } from "@/components/project/template-picker"
import type { WikiProject } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: WikiProject) => void
}

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.id ?? "civil")
  const [customDirs, setCustomDirs] = useState<Record<string, Set<string>>>({})
  const [previewOpen, setPreviewOpen] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)

  const currentTemplate = useMemo(() => getTemplate(selectedTemplate), [selectedTemplate])

  const pickedDirs = useMemo(() => {
    const existing = customDirs[selectedTemplate]
    if (existing) return existing
    // 默认勾选全部（包含可选）
    return new Set(currentTemplate.dirs.map((d) => d.path))
  }, [customDirs, selectedTemplate, currentTemplate])

  function toggleDir(dirPath: string) {
    setCustomDirs((prev) => {
      const current = prev[selectedTemplate] ?? new Set(currentTemplate.dirs.map((d) => d.path))
      const next = new Set(current)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return { ...prev, [selectedTemplate]: next }
    })
  }

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择案件父目录",
    })
    if (selected) setPath(selected)
  }

  async function handleCreate() {
    if (!name.trim() || !path.trim()) {
      setError("案件名称和父目录不能为空")
      return
    }
    setCreating(true)
    setError("")
    try {
      const project = await createProject(name.trim(), path.trim())
      const pp = normalizePath(project.path)

      await writeFile(`${pp}/schema.md`, currentTemplate.schema)
      await writeFile(`${pp}/purpose.md`, currentTemplate.purpose)
      const templateCaseType: Record<string, CaseType> = {
        civil: "民事",
        criminal: "刑事",
        administrative: "行政",
        enforcement: "执行",
      }
      await writeFile(
        `${pp}/case.meta.json`,
        JSON.stringify(defaultCaseMeta(name.trim(), templateCaseType[selectedTemplate] ?? "其他"), null, 2)
      )

      const dirsToCreate = extraDirsForTemplate(selectedTemplate, [...pickedDirs])
      for (const dir of dirsToCreate) {
        await createDirectory(`${pp}/${dir}`)
      }

      onCreated(project)
      onOpenChange(false)
      setName("")
      setPath("")
      setSelectedTemplate(templates[0]?.id ?? "civil")
      setCustomDirs({})
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(90vw,820px)] max-w-none flex-col p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>新建案件知识库</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-5 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">案件名称</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：合同纠纷案-2026-001"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>选择模板</Label>
            <TemplatePicker selected={selectedTemplate} onSelect={setSelectedTemplate} />
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {previewOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              目录结构预览（共 {currentTemplate.dirs.length} 个，勾选的将被创建）
            </button>
            {previewOpen && (
              <div className="rounded-md border bg-card/40 p-3 text-xs">
                <p className="mb-2 text-muted-foreground">{currentTemplate.longDescription}</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {currentTemplate.dirs.map((dir) => {
                    const checked = pickedDirs.has(dir.path)
                    const disabled = dir.required
                    return (
                      <label
                        key={dir.path}
                        className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 transition-colors ${
                          checked ? "bg-primary/10" : "hover:bg-accent/50"
                        } ${disabled ? "opacity-90" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => !disabled && toggleDir(dir.path)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-foreground">{dir.label}</span>
                            {dir.required && (
                              <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] text-primary">
                                必选
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] leading-relaxed text-muted-foreground">
                            {dir.description}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <Check className="h-3 w-3 text-emerald-500" />
                  已勾选 {pickedDirs.size} 个目录，将在创建时生成
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="path">案件父目录</Label>
            <div className="flex gap-2">
              <Input
                id="path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/你/案件库"
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={handleBrowse} type="button">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="m-0 shrink-0 rounded-b-xl px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "创建中..." : "创建案件库"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
