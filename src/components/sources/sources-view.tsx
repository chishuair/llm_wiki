import { useState, useEffect, useCallback } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { Plus, FileText, RefreshCw, Wand2, Trash2, Folder, ChevronRight, ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { copyFile, listDirectory, readFile, writeFile, deleteFile, findRelatedWikiPages, preprocessFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { startIngest } from "@/lib/ingest"
import { enqueueIngest, enqueueBatch } from "@/lib/ingest-queue"
import { useTranslation } from "react-i18next"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { routeImportedMaterials } from "@/lib/hearing/material-router"

export function SourcesView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [ingestingPath, setIngestingPath] = useState<string | null>(null)

  const loadSources = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const tree = await listDirectory(`${pp}/raw/sources`)
      // Filter out hidden files/dirs and cache
      const filtered = filterTree(tree)
      setSources(filtered)
    } catch {
      setSources([])
    }
  }, [project])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  async function handleImport() {
    if (!project) return

    const selected = await open({
      multiple: true,
      title: "Import Source Files",
      filters: [
        {
          name: "Documents",
          extensions: [
            "md", "mdx", "txt", "rtf", "pdf",
            "html", "htm", "xml",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "odt", "ods", "odp", "epub", "pages", "numbers", "key",
          ],
        },
        {
          name: "Data",
          extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"],
        },
        {
          name: "Code",
          extensions: [
            "py", "js", "ts", "jsx", "tsx", "rs", "go", "java",
            "c", "cpp", "h", "rb", "php", "swift", "sql", "sh",
          ],
        },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "avif", "heic"],
        },
        {
          name: "Media",
          extensions: ["mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac", "m4a"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    })

    if (!selected || selected.length === 0) return

    setImporting(true)
    const pp = normalizePath(project.path)
    const paths = Array.isArray(selected) ? selected : [selected]

    const importedPaths: string[] = []
    for (const sourcePath of paths) {
      const originalName = getFileName(sourcePath) || "unknown"
      const destPath = await getUniqueDestPath(`${pp}/raw/sources`, originalName)
      try {
        await copyFile(sourcePath, destPath)
        importedPaths.push(destPath)
      } catch (err) {
        console.error(`Failed to import ${originalName}:`, err)
      }
    }

    setImporting(false)
    await loadSources()

    if (importedPaths.length > 0) {
      routeImportedMaterials({
        projectPath: pp,
        sourcePaths: importedPaths,
        llmConfig,
        onRouted: async (routed) => {
          await loadSources()
          if (llmConfig.apiKey || llmConfig.provider === "ollama" || llmConfig.provider === "custom") {
            for (const item of routed.filter((entry) => entry.kind === "other")) {
              enqueueIngest(pp, item.path).catch((err) =>
                console.error(`Failed to enqueue ingest:`, err)
              )
            }
          }
        },
      }).catch((err) => {
        console.error("Failed to route imported materials:", err)
        for (const destPath of importedPaths) {
          preprocessFile(destPath).catch(() => {})
        }
      })
    }
  }

  function buildFolderContext(filePath: string, baseDir: string, folderName: string) {
    const normFilePath = normalizePath(filePath)
    const normBaseDir = normalizePath(baseDir)
    const relPath = normFilePath.replace(normBaseDir + "/", "")
    const parts = relPath.split("/")
    parts.pop()
    return parts.length > 0 ? `${folderName} > ${parts.join(" > ")}` : folderName
  }

  function isIngestibleFile(filePath: string) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
    return ["md", "mdx", "txt", "pdf", "docx", "pptx", "xlsx", "xls",
            "csv", "json", "html", "htm", "rtf", "xml", "yaml", "yml"].includes(ext)
  }

  function llmReady() {
    return Boolean(llmConfig.apiKey || llmConfig.provider === "ollama" || llmConfig.provider === "custom")
  }

  async function enqueueOtherMaterials(
    routed: Array<{ kind: string; path: string; originalPath: string }>,
    projectPath: string,
    destDir: string,
    folderName: string,
  ) {
    if (!llmReady()) return
    const tasks = routed
      .filter((item) => item.kind === "other" && isIngestibleFile(item.path))
      .map((item) => ({
        sourcePath: item.path,
        folderContext: buildFolderContext(item.originalPath, destDir, folderName),
      }))

    if (tasks.length > 0) {
      await enqueueBatch(projectPath, tasks)
      console.log(`[Folder Import] Enqueued ${tasks.length} other files for ingest`)
    }
  }

  async function handleImportFolder() {
    if (!project) return

    const selected = await open({
      directory: true,
      title: "Import Source Folder",
    })

    if (!selected || typeof selected !== "string") return

    setImporting(true)
    const pp = normalizePath(project.path)
    const folderName = getFileName(selected) || "imported"
    const destDir = `${pp}/raw/sources/${folderName}`

    try {
      // Recursively copy the folder
      const copiedFiles: string[] = await invoke("copy_directory", {
        source: selected,
        destination: destDir,
      })

      console.log(`[Folder Import] Copied ${copiedFiles.length} files from ${folderName}`)

      setImporting(false)
      await loadSources()

      if (copiedFiles.length > 0) {
        routeImportedMaterials({
          projectPath: pp,
          sourcePaths: copiedFiles,
          llmConfig,
          onRouted: async (routed) => {
            await loadSources()
            await enqueueOtherMaterials(routed, pp, destDir, folderName)
          },
        }).catch((err) => {
          console.error("Failed to route imported folder materials:", err)
          for (const filePath of copiedFiles) {
            preprocessFile(filePath).catch(() => {})
          }
        })
      }
    } catch (err) {
      console.error(`Failed to import folder:`, err)
      setImporting(false)
    }
  }

  async function handleOpenSource(node: FileNode) {
    setSelectedFile(node.path)
    try {
      const content = await readFile(node.path)
      setFileContent(content)
    } catch (err) {
      console.error("Failed to read source:", err)
    }
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    const fileName = node.name
    const confirmed = window.confirm(
      t("sources.deleteConfirm", { name: fileName })
    )
    if (!confirmed) return

    try {
      // Step 1: Find related wiki pages before deleting
      const relatedPages = await findRelatedWikiPages(pp, fileName)
      const deletedSlugs = relatedPages.map((p) => {
        const name = getFileName(p).replace(".md", "")
        return name
      }).filter(Boolean)

      // Step 2: Delete the source file
      await deleteFile(node.path)

      // Step 3: Delete preprocessed cache
      try {
        await deleteFile(`${pp}/raw/sources/.cache/${fileName}.txt`)
      } catch {
        // cache file may not exist
      }

      // Step 4: Delete or update related wiki pages
      // If a page has multiple sources, only remove this filename from sources[]; don't delete the page
      const actuallyDeleted: string[] = []
      for (const pagePath of relatedPages) {
        try {
          const content = await readFile(pagePath)
          // Parse sources from frontmatter
          const sourcesMatch = content.match(/^sources:\s*\[([^\]]*)\]/m)
          if (sourcesMatch) {
            const sourcesList = sourcesMatch[1]
              .split(",")
              .map((s) => s.trim().replace(/["']/g, ""))
              .filter((s) => s.length > 0)

            if (sourcesList.length > 1) {
              // Multiple sources — just remove this file from the list, keep the page
              const updatedSources = sourcesList.filter(
                (s) => s.toLowerCase() !== fileName.toLowerCase()
              )
              const updatedContent = content.replace(
                /^sources:\s*\[([^\]]*)\]/m,
                `sources: [${updatedSources.map((s) => `"${s}"`).join(", ")}]`
              )
              await writeFile(pagePath, updatedContent)
              continue // Don't delete this page
            }
          }

          // Single source or no sources field — delete the page
          await deleteFile(pagePath)
          actuallyDeleted.push(pagePath)
        } catch (err) {
          console.error(`Failed to process wiki page ${pagePath}:`, err)
        }
      }

      // Step 5: Clean index.md — remove entries for actually deleted pages only
      const deletedPageSlugs = actuallyDeleted.map((p) => {
        const name = getFileName(p).replace(".md", "")
        return name
      }).filter(Boolean)

      if (deletedPageSlugs.length > 0) {
        try {
          const indexPath = `${pp}/wiki/index.md`
          const indexContent = await readFile(indexPath)
          const updatedIndex = indexContent
            .split("\n")
            .filter((line) => !deletedPageSlugs.some((slug) => line.toLowerCase().includes(slug.toLowerCase())))
            .join("\n")
          await writeFile(indexPath, updatedIndex)
        } catch {
          // non-critical
        }
      }

      // Step 6: Clean [[wikilinks]] to deleted pages from remaining wiki files
      if (deletedPageSlugs.length > 0) {
        try {
          const wikiTree = await listDirectory(`${pp}/wiki`)
          const allMdFiles = flattenMdFiles(wikiTree)
          for (const file of allMdFiles) {
            try {
              const content = await readFile(file.path)
              let updated = content
              for (const slug of deletedPageSlugs) {
                const linkRegex = new RegExp(`\\[\\[${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\|([^\\]]+))?\\]\\]`, "gi")
                updated = updated.replace(linkRegex, (_match, displayText) => displayText || slug)
              }
              if (updated !== content) {
                await writeFile(file.path, updated)
              }
            } catch {
              // skip
            }
          }
        } catch {
          // non-critical
        }
      }

      // Step 7: Append deletion record to log.md
      try {
        const logPath = `${pp}/wiki/log.md`
        const logContent = await readFile(logPath).catch(() => "# Wiki Log\n")
        const date = new Date().toISOString().slice(0, 10)
        const keptCount = relatedPages.length - actuallyDeleted.length
        const logEntry = `\n## [${date}] delete | ${fileName}\n\nDeleted source file and ${actuallyDeleted.length} wiki pages.${keptCount > 0 ? ` ${keptCount} shared pages kept (have other sources).` : ""}\n`
        await writeFile(logPath, logContent.trimEnd() + logEntry)
      } catch {
        // non-critical
      }

      // Step 8: Refresh everything
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()

      // Clear selected file if it was the deleted one
      if (selectedFile === node.path || actuallyDeleted.includes(selectedFile ?? "")) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete source:", err)
      window.alert(`Failed to delete: ${err}`)
    }
  }

  async function handleIngest(node: FileNode) {
    if (!project || ingestingPath) return
    setIngestingPath(node.path)
    try {
      setChatExpanded(true)
      setActiveView("wiki")
      await startIngest(normalizePath(project.path), node.path, llmConfig)
    } catch (err) {
      console.error("Failed to start ingest:", err)
    } finally {
      setIngestingPath(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t("sources.title")}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={loadSources} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            <Plus className="mr-1 h-4 w-4" />
            {importing ? t("sources.importing") : t("sources.import")}
          </Button>
          <Button size="sm" onClick={handleImportFolder} disabled={importing}>
            <Plus className="mr-1 h-4 w-4" />
            {t("sources.importFolder", "Folder")}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>{t("sources.noSources")}</p>
            <p>{t("sources.importHint")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleImport}>
                <Plus className="mr-1 h-4 w-4" />
                {t("sources.importFiles")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportFolder}>
                <Plus className="mr-1 h-4 w-4" />
                Folder
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            <SourceTree
              nodes={sources}
              onOpen={handleOpenSource}
              onIngest={handleIngest}
              onDelete={handleDelete}
              ingestingPath={ingestingPath}
              depth={0}
            />
          </div>
        )}
      </ScrollArea>

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {t("sources.sourceCount", { count: countFiles(sources) })}
      </div>
    </div>
  )
}

/**
 * Generate a unique destination path. If file already exists, adds date/counter suffix.
 * "file.pdf" → "file.pdf" (first time)
 * "file.pdf" → "file-20260406.pdf" (conflict)
 * "file.pdf" → "file-20260406-2.pdf" (second conflict same day)
 */
async function getUniqueDestPath(dir: string, fileName: string): Promise<string> {
  const basePath = `${dir}/${fileName}`

  // Check if file exists by trying to read it
  try {
    await readFile(basePath)
  } catch {
    // File doesn't exist — use original name
    return basePath
  }

  // File exists — add date suffix
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")

  const withDate = `${dir}/${nameWithoutExt}-${date}${ext}`
  try {
    await readFile(withDate)
  } catch {
    return withDate
  }

  // Date suffix also exists — add counter
  for (let i = 2; i <= 99; i++) {
    const withCounter = `${dir}/${nameWithoutExt}-${date}-${i}${ext}`
    try {
      await readFile(withCounter)
    } catch {
      return withCounter
    }
  }

  // Shouldn't happen, but fallback
  return `${dir}/${nameWithoutExt}-${date}-${Date.now()}${ext}`
}

function filterTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => {
      if (n.is_dir && n.children) {
        return { ...n, children: filterTree(n.children) }
      }
      return n
    })
    .filter((n) => !n.is_dir || (n.children && n.children.length > 0))
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      count += countFiles(node.children)
    } else if (!node.is_dir) {
      count++
    }
  }
  return count
}

function inferMaterialType(name: string): string {
  const lower = name.toLowerCase()
  if (/起诉状|起诉书|诉状/.test(name)) return "起诉材料"
  if (/答辩状|答辩书/.test(name)) return "答辩材料"
  if (/证据|举证|凭证|发票|合同|收据|转账|聊天记录|微信|照片|截图/.test(name)) return "证据材料"
  if (/笔录|庭审|询问|讯问|谈话/.test(name)) return "庭审/笔录"
  if (/判决书|裁定书|调解书|决定书/.test(name)) return "裁判文书"
  if (/鉴定|评估|审计|检验|检测/.test(name)) return "鉴定/评估"
  if (/\.(png|jpe?g|webp|bmp|tiff?|heic|heif)$/i.test(lower)) return "图片/扫描件"
  if (/\.pdf$/i.test(lower)) return "PDF 材料"
  if (/\.(docx?|rtf|txt|md)$/i.test(lower)) return "文本材料"
  if (/\.(xlsx?|csv)$/i.test(lower)) return "表格材料"
  return "其他材料"
}

function materialStatusHint(name: string): { label: string; tone: "ok" | "warn" | "muted" } {
  if (/\.(png|jpe?g|webp|bmp|tiff?|heic|heif)$/i.test(name)) {
    return { label: "需 OCR/核对", tone: "warn" }
  }
  if (/\.pdf$/i.test(name)) {
    return { label: "可预处理/OCR", tone: "warn" }
  }
  if (/\.(docx?|txt|md|rtf|xlsx?|csv)$/i.test(name)) {
    return { label: "可 AI 归纳", tone: "ok" }
  }
  return { label: "已归档", tone: "muted" }
}

function statusClass(tone: "ok" | "warn" | "muted") {
  if (tone === "ok") return "bg-emerald-500/10 text-emerald-500"
  if (tone === "warn") return "bg-amber-500/10 text-amber-500"
  return "bg-muted text-muted-foreground"
}

function SourceTree({
  nodes,
  onOpen,
  onIngest,
  onDelete,
  ingestingPath,
  depth,
}: {
  nodes: FileNode[]
  onOpen: (node: FileNode) => void
  onIngest: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  ingestingPath: string | null
  depth: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  // Sort: folders first, then files, alphabetical within each group
  const sorted = [...nodes].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {sorted.map((node) => {
        if (node.is_dir && node.children) {
          const isCollapsed = collapsed[node.path] ?? false
          return (
            <div key={node.path}>
              <button
                onClick={() => toggle(node.path)}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="truncate font-medium">{node.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                  {countFiles(node.children)}
                </span>
              </button>
              {!isCollapsed && (
                <SourceTree
                  nodes={node.children}
                  onOpen={onOpen}
                  onIngest={onIngest}
                  onDelete={onDelete}
                  ingestingPath={ingestingPath}
                  depth={depth + 1}
                />
              )}
            </div>
          )
        }

        const materialType = inferMaterialType(node.name)
        const status = materialStatusHint(node.name)

        return (
          <div
            key={node.path}
            className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
          >
            <button
              onClick={() => onOpen(node)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {materialType}
              </span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${statusClass(status.tone)}`}>
                {status.label}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-primary hover:bg-primary/10"
              title="让 AI 提取并归类到知识库"
              disabled={ingestingPath === node.path}
              onClick={() => onIngest(node)}
            >
              {ingestingPath === node.path ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              title="删除该材料"
              onClick={() => onDelete(node)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })}
    </>
  )
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
