import { listDirectory, preprocessFile, readFile } from "@/commands/fs"
import { loadCaseMeta } from "@/lib/case-meta"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { loadWorksheetState } from "@/lib/worksheet/state"
import type { FileNode, WikiProject } from "@/types/wiki"
import type { CaseContext, RawSourceFile } from "@/types/legal-doc"
import type { EvidenceListFrontmatter } from "@/types/evidence"

import { SUMMARIZE_THRESHOLD, readCachedSummary, cacheKeyFor } from "@/lib/legal-doc/source-summary"
/** 扫描件或提取失败时给的占位文字长度。 */
const EMPTY_PLACEHOLDER = "（无法提取文本，可能为扫描件或加密文件）"

/**
 * 从当前案件工程的 wiki 目录收集生成文书需要的结构化案件数据。
 *
 * 约定：案件工程的 9 个中文业务目录作为主要来源。
 * - wiki/案情概述/*.md      → case_overview
 * - wiki/当事人信息/*.md    → parties
 * - wiki/证据清单/*.md      → evidence_list（优先读结构化 evidence-list）
 * - wiki/争议焦点/*.md      → disputes
 * - wiki/法院认定事实/*.md  → facts
 * - wiki/本院认为/*.md      → reasoning
 * - wiki/判决结果/*.md      → judgment
 * - wiki/审理过程/*.md      → procedure_log
 * - wiki/庭审笔录/*.md      → hearing_transcripts
 *
 * 目录下若有多篇 md，按修改时间合并拼接，最上方标注来源文件。
 */

type DirKey =
  | "案情概述"
  | "当事人信息"
  | "证据清单"
  | "争议焦点"
  | "法院认定事实"
  | "本院认为"
  | "判决结果"
  | "审理过程"
  | "庭审笔录"

async function collectDir(projectPath: string, dir: DirKey): Promise<string> {
  const abs = `${projectPath}/wiki/${dir}`
  try {
    const nodes = await listDirectory(abs)
    const files = flatten(nodes)
      .filter((n) => n.name.endsWith(".md"))
      .filter((n) => !["index.md", "log.md", "overview.md"].includes(n.name))
    if (files.length === 0) return ""
    const texts: string[] = []
    for (const file of files) {
      try {
        const raw = await readFile(file.path)
        const { body } = parseFrontmatter(raw)
        const stripped = body.replace(/^# .+?\n/, "").trim()
        if (!stripped) continue
        texts.push(`### 来源：${file.name}\n\n${stripped}`)
      } catch {
        // ignore individual file errors
      }
    }
    return texts.join("\n\n")
  } catch {
    return ""
  }
}

async function collectHearingWorksheet(projectPath: string): Promise<string> {
  const abs = `${projectPath}/wiki/庭审笔录`
  try {
    const state = await loadWorksheetState(projectPath)
    const nodes = await listDirectory(abs)
    const files = flatten(nodes)
      .filter((n) => n.name.endsWith(".md"))
      .filter((n) => !["index.md", "log.md", "overview.md"].includes(n.name))
      .sort((a, b) => b.name.localeCompare(a.name))
    if (files.length === 0) return ""

    const preferred =
      (state.activeRecordPath && files.find((file) => normalizePath(file.path) === normalizePath(state.activeRecordPath))) ??
      files.find((file) => file.name.includes("合并庭审笔录")) ??
      files[0]
    const raw = await readFile(preferred.path)
    const { body } = parseFrontmatter(raw)
    const stripped = body.replace(/^# .+?\n/, "").trim()
    if (!stripped) return ""
    return `### 优先参考工作单：${preferred.name}\n\n${stripped}`
  } catch {
    return ""
  }
}

async function collectEvidence(projectPath: string): Promise<string> {
  const abs = `${projectPath}/wiki/证据清单`
  try {
    const nodes = await listDirectory(abs)
    const files = flatten(nodes)
      .filter((n) => n.name.endsWith(".md"))
      .filter((n) => !["index.md", "log.md"].includes(n.name))
    if (files.length === 0) return ""
    const blocks: string[] = []
    for (const file of files) {
      try {
        const raw = await readFile(file.path)
        const { data } = parseFrontmatter<Partial<EvidenceListFrontmatter>>(raw)
        if (data.type === "evidence-list" && Array.isArray(data.evidences)) {
          const lines = data.evidences.map((ev) => {
            const status = [
              `真实性：${ev.authenticity}`,
              `合法性：${ev.legality}`,
              `关联性：${ev.relevance}`,
              `采信：${ev.admitted ? "是" : "否"}`,
            ].join("；")
            const opinions = ev.opinions
              ? [
                  ev.opinions.plaintiff ? `原告意见：${ev.opinions.plaintiff}` : "",
                  ev.opinions.defendant ? `被告意见：${ev.opinions.defendant}` : "",
                  ev.opinions.court ? `本院意见：${ev.opinions.court}` : "",
                ]
                  .filter(Boolean)
                  .join("；")
              : ""
            return [
              `${ev.id} 《${ev.name || "未命名"}》（${ev.submitter} 提交）`,
              `证明目的：${ev.purpose || "（未填）"}`,
              status,
              opinions,
            ]
              .filter(Boolean)
              .join("\n")
          })
          blocks.push(`#### 来源：${file.name}\n\n${lines.join("\n\n")}`)
        } else {
          // 非结构化证据清单，作为普通文本
          const { body } = parseFrontmatter(raw)
          const stripped = body.replace(/^# .+?\n/, "").trim()
          if (stripped) blocks.push(`#### 来源：${file.name}\n\n${stripped}`)
        }
      } catch {
        // ignore
      }
    }
    return blocks.join("\n\n")
  } catch {
    return ""
  }
}

function flatten(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.is_dir && n.children) out.push(...flatten(n.children))
    else if (!n.is_dir) out.push(n)
  }
  return out
}

/**
 * 抽取 raw/sources/ 下全部文件的文本，用于喂给 LLM 作为「原始案件材料」。
 *
 * - 通过 Tauri 的 `preprocess_file` 命令（复用 pdfium/docx-rs 流水线）；
 * - 单份文件 PER_FILE_TEXT_CAP、总体 TOTAL_RAW_TEXT_CAP；
 * - 超额后剩余材料只保留文件名与大小，不读正文；
 * - 扫描 pdf 等无文字层的文件会返回占位符。
 */
async function collectRawSources(projectPath: string): Promise<{
  files: RawSourceFile[]
  truncated: boolean
}> {
  const abs = `${projectPath}/raw/sources`
  try {
    const nodes = await listDirectory(abs)
    const flatFiles = flatten(nodes)
      .filter((n) => !n.is_dir && !n.name.startsWith(".") && !n.path.includes("/.cache/"))
    if (flatFiles.length === 0) return { files: [], truncated: false }

    flatFiles.sort((a, b) => a.name.localeCompare(b.name))

    const results: RawSourceFile[] = []

    for (const node of flatFiles) {
      let extracted = ""
      try {
        extracted = await preprocessFile(node.path)
      } catch {
        extracted = ""
      }
      const text = (extracted ?? "").trim()
      const relativePath = node.path.replace(`${projectPath}/`, "")
      const needsSummary = text.length > SUMMARIZE_THRESHOLD

      let summary: string | undefined
      if (needsSummary) {
        const cached = await readCachedSummary(
          projectPath,
          relativePath,
          cacheKeyFor(relativePath, text)
        )
        if (cached) summary = cached.text
      }

      results.push({
        relativePath,
        name: node.name,
        text: text || EMPTY_PLACEHOLDER,
        size: text.length,
        needsSummary,
        summary,
      })
    }
    // 若所有长文件都已有缓存 summary，truncated 视为否；否则由调用方在生成前
    // 决定是否触发摘要预处理。
    const anyMissingSummary = results.some((r) => r.needsSummary && !r.summary)
    return { files: results, truncated: anyMissingSummary }
  } catch {
    return { files: [], truncated: false }
  }
}

/**
 * 从项目 wiki 里读出常用字段。
 *
 * case_number / court_name 当前版本没有独立存储字段，由 LLM 从「案情概述」中
 * 或「当事人信息」中自行识别；也允许在文书生成时由法官手动填写。
 */
export async function collectCaseContext(project: WikiProject): Promise<CaseContext> {
  const projectPath = normalizePath(project.path)
  const meta = await loadCaseMeta(projectPath, project.name)
  const [
    case_overview,
    parties,
    disputes,
    facts,
    reasoning,
    judgment,
    procedure_log,
    hearing_transcripts,
    hearing_worksheet,
    evidence_list,
    rawSources,
  ] = await Promise.all([
    collectDir(projectPath, "案情概述"),
    collectDir(projectPath, "当事人信息"),
    collectDir(projectPath, "争议焦点"),
    collectDir(projectPath, "法院认定事实"),
    collectDir(projectPath, "本院认为"),
    collectDir(projectPath, "判决结果"),
    collectDir(projectPath, "审理过程"),
    collectDir(projectPath, "庭审笔录"),
    collectHearingWorksheet(projectPath),
    collectEvidence(projectPath),
    collectRawSources(projectPath),
  ])

  return {
    projectPath,
    projectName: meta.caseName || project.name,
    case_number: meta.caseNumber,
    court_name: meta.courtName,
    parties,
    facts,
    disputes,
    reasoning,
    judgment,
    evidence_list,
    case_overview,
    procedure_log,
    hearing_transcripts,
    hearing_worksheet,
    raw_sources: rawSources.files,
    raw_sources_truncated: rawSources.truncated,
  }
}
