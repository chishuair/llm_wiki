import { useEffect, useCallback, useRef, useState } from "react"
import { X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { preprocessFile, readFile, writeFile } from "@/commands/fs"
import { getFileCategory } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { EvidenceEditor } from "@/components/editor/evidence-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { TranscriptEditor } from "@/components/transcript/transcript-editor"
import { getFileName } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { loadTranscriptRecord } from "@/lib/transcript/storage"

function isEvidenceListPage(markdown: string): boolean {
  if (!markdown) return false
  const { data } = parseFrontmatter<{ type?: string }>(markdown)
  return data.type === "evidence-list"
}

function isTranscriptPage(markdown: string): boolean {
  if (!markdown) return false
  const { data } = parseFrontmatter<{ type?: string }>(markdown)
  return data.type === "hearing-transcript"
}

export function PreviewPanel() {
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!selectedFile) {
      setFileContent("")
      return
    }

    const category = getFileCategory(selectedFile)

    // 图片支持原图 + OCR 文本视图，因此这里仍尝试预处理出可读文本
    // 纯音视频不在前端展示正文
    if (["video", "audio"].includes(category)) {
      setFileContent("")
      return
    }

    // PDF / Word / Excel / PPT / 图片 等走 Tauri 的 preprocess_file
    const loader = ["pdf", "document", "image"].includes(category) ? preprocessFile : readFile

    let cancelled = false
    setFileContent("正在加载文件…")
    loader(selectedFile)
      .then((text) => {
        if (cancelled) return
        setFileContent(text || "（该文件未能提取出文本，可能是扫描件或加密文件）")
      })
      .catch((err) => {
        if (cancelled) return
        const msg = String(err ?? "")
        const friendly = /No such file|os error 2/.test(msg)
          ? "文件已不存在。它可能被移动或删除了；请在左侧目录中刷新，或重新导入材料。"
          : `加载文件失败：${msg}`
        setFileContent(friendly)
      })

    return () => {
      cancelled = true
    }
  }, [selectedFile, setFileContent])

  const handleSave = useCallback(
    (markdown: string) => {
      if (!selectedFile) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        writeFile(selectedFile, markdown).catch((err) =>
          console.error("Failed to save:", err)
        )
      }, 1000)
    },
    [selectedFile]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请选择一个文件以查看内容
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const fileName = getFileName(selectedFile)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
          {fileName}
        </span>
        <button
          onClick={() => setSelectedFile(null)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {category === "markdown" ? (
          isEvidenceListPage(fileContent) ? (
            <EvidenceEditor
              key={selectedFile}
              content={fileContent}
              onSave={handleSave}
            />
          ) : isTranscriptPage(fileContent) ? (
            <TranscriptPreview
              key={selectedFile}
              filePath={selectedFile}
              markdown={fileContent}
              onSaved={(markdown) => setFileContent(markdown)}
            />
          ) : (
            <WikiEditor
              key={selectedFile}
              content={fileContent}
              onSave={handleSave}
            />
          )
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
    </div>
  )
}

function TranscriptPreview({
  filePath,
  markdown,
  onSaved,
}: {
  filePath: string
  markdown: string
  onSaved: (markdown: string) => void
}) {
  const project = useWikiStore((s) => s.project)
  const [record, setRecord] = useState<Awaited<ReturnType<typeof loadTranscriptRecord>> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTranscriptRecord(filePath)
      .then((next) => {
        if (!cancelled) setRecord(next)
      })
      .catch(() => {
        const { data, body } = parseFrontmatter(markdown)
        if (!cancelled && project) {
          setRecord({
            frontmatter: data as never,
            body,
            data: {
              version: 1,
              sourceHash: "",
              overview: "",
              segments: [],
              issues: [],
              evidenceOpinions: [],
              argumentPoints: [],
              proceduralNotes: [],
            },
            markdownPath: filePath,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [filePath, markdown, project])

  if (!project) {
    return <div className="p-4 text-sm text-muted-foreground">未打开案件知识库</div>
  }

  if (!record) {
    return <div className="p-4 text-sm text-muted-foreground">正在加载笔录整理结果...</div>
  }

  return (
    <TranscriptEditor
      key={record.markdownPath}
      projectPath={project.path}
      record={record}
      onSaved={(next) => {
        setRecord(next)
        readFile(next.markdownPath).then(onSaved).catch(() => {})
      }}
    />
  )
}
