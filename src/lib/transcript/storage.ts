import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { parseFrontmatter, writeFrontmatter } from "@/lib/frontmatter"
import { buildTranscriptElementAlerts, buildTranscriptWorkPlan } from "@/lib/transcript/alerts"
import type {
  HearingTranscriptData,
  HearingTranscriptFrontmatter,
  TranscriptCaseType,
  TranscriptRecord,
} from "@/types/transcript"

function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function sourceHash(text: string): string {
  return hashString(text)
}

export function buildTranscriptTitle(sourcePath: string, sessionIndex?: number) {
  const fileName = getFileName(sourcePath).replace(/\.[^.]+$/, "")
  return sessionIndex ? `第${sessionIndex}次庭审笔录-${fileName}` : `庭审笔录-${fileName}`
}

function safeStem(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-")
}

export function buildTranscriptPaths(
  projectPath: string,
  title: string,
  sessionDate?: string
): { markdownPath: string; dataPath: string; relativeDataPath: string } {
  const root = normalizePath(projectPath)
  const datePrefix = (sessionDate || new Date().toISOString().slice(0, 10)).replace(/-/g, "")
  const stem = `${datePrefix}-${safeStem(title)}`
  const markdownPath = `${root}/wiki/庭审笔录/${stem}.md`
  const relativeDataPath = `wiki/庭审笔录/${stem}.transcript.json`
  const dataPath = `${root}/${relativeDataPath}`
  return { markdownPath, dataPath, relativeDataPath }
}

export function buildTranscriptBody(data: HearingTranscriptData): string {
  const alerts = buildTranscriptElementAlerts(data.keyElements)
  const workPlan = buildTranscriptWorkPlan(data.keyElements, data.proceduralNotes)
  const lines: string[] = [
    "# 庭审笔录整理",
    "",
    `- 案件子类型：${data.caseSubtypeLabel || "未指定"}`,
    "",
    "## 庭审综述",
    data.overview || "（待补充）",
    "",
  ]

  const sections: Array<[string, typeof data.issues | string[]]> = [
    ["关键要素", data.keyElements],
    ["争议焦点", data.issues],
    ["质证意见", data.evidenceOpinions],
    ["辩论要点", data.argumentPoints],
    ["程序提示", data.proceduralNotes],
  ]

  for (const [heading, value] of sections) {
    lines.push(`## ${heading}`)
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
      for (const item of value as string[]) lines.push(`- ${item}`)
    } else if (Array.isArray(value) && value.length > 0) {
      for (const item of value as typeof data.issues) {
        if ("label" in item) {
          lines.push(`- ${item.label}（${item.status}）：${item.summary}`)
        } else {
          lines.push(`- ${item.title}：${item.summary}`)
        }
      }
    } else {
      lines.push("- （暂无）")
    }
    lines.push("")
  }

  lines.push("## 争议要素提醒")
  if (alerts.disputedMessages.length > 0) {
    for (const item of alerts.disputedMessages) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前未发现标记为“有争议”的关键要素）")
  }
  lines.push("")

  lines.push("## 待补证提示")
  if (alerts.missingEvidenceMessages.length > 0) {
    for (const item of alerts.missingEvidenceMessages) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前未发现标记为“待补证”的关键要素）")
  }
  lines.push("")

  lines.push("## 下一步发问建议")
  if (alerts.questionSuggestions.length > 0) {
    for (const item of alerts.questionSuggestions) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前没有需要追加发问的争议要素）")
  }
  lines.push("")

  lines.push("## 补证建议")
  if (alerts.evidenceSuggestions.length > 0) {
    for (const item of alerts.evidenceSuggestions) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前没有需要补充材料的关键要素）")
  }
  lines.push("")

  lines.push("## 庭审提纲")
  if (workPlan.hearingOutline.length > 0) {
    for (const item of workPlan.hearingOutline) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前没有自动生成的庭审提纲）")
  }
  lines.push("")

  lines.push("## 法官工作清单")
  if (workPlan.judgeChecklist.length > 0) {
    for (const item of workPlan.judgeChecklist) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前没有自动生成的法官工作清单）")
  }
  lines.push("")

  lines.push("## 书记员工作清单")
  if (workPlan.clerkChecklist.length > 0) {
    for (const item of workPlan.clerkChecklist) lines.push(`- ${item}`)
  } else {
    lines.push("- （当前没有自动生成的书记员工作清单）")
  }
  lines.push("")

  lines.push("## 说明")
  lines.push("- 详细结构化段落、支持片段与合并信息保存在同名 `.transcript.json` 文件中。")
  lines.push("- 如需人工调整，可在应用内打开“庭审笔录”模块继续编辑。")
  lines.push("")
  return lines.join("\n")
}

export async function saveTranscriptRecord(args: {
  projectPath: string
  title: string
  caseType: TranscriptCaseType
  caseSubtypeId?: string
  caseSubtypeLabel?: string
  sessionDate?: string
  sessionIndex?: number
  sourcePath?: string
  data: HearingTranscriptData
  body?: string
  markdownPath?: string
  relativeDataPath?: string
}): Promise<TranscriptRecord> {
  const root = normalizePath(args.projectPath)
  const paths = args.markdownPath && args.relativeDataPath
    ? {
        markdownPath: normalizePath(args.markdownPath),
        dataPath: `${root}/${args.relativeDataPath}`,
        relativeDataPath: args.relativeDataPath,
      }
    : buildTranscriptPaths(root, args.title, args.sessionDate)

  await createDirectory(`${root}/wiki/庭审笔录`).catch(() => {})

  const frontmatter: HearingTranscriptFrontmatter = {
    type: "hearing-transcript",
    title: args.title,
    caseType: args.caseType,
    caseSubtypeId: args.caseSubtypeId,
    caseSubtypeLabel: args.caseSubtypeLabel,
    sessionDate: args.sessionDate,
    sessionIndex: args.sessionIndex,
    sourcePath: args.sourcePath,
    dataPath: paths.relativeDataPath,
    updated: new Date().toISOString().slice(0, 10),
  }

  const body = args.body ?? buildTranscriptBody(args.data)
  const markdown = writeFrontmatter(body, frontmatter)

  await writeFile(paths.dataPath, JSON.stringify(args.data, null, 2))
  await writeFile(paths.markdownPath, markdown)

  const indexPath = `${root}/wiki/index.md`
  const entry = `- [[庭审笔录/${getFileName(paths.markdownPath).replace(/\.md$/, "")}|${args.title}]]`
  try {
    let indexContent = ""
    try {
      indexContent = await readFile(indexPath)
    } catch {
      indexContent = "# 案件知识库索引\n\n## 庭审笔录\n"
    }
    const heading = "## 庭审笔录"
    if (!indexContent.includes(heading)) {
      indexContent = indexContent.trimEnd() + `\n\n${heading}\n`
    }
    if (!indexContent.includes(entry)) {
      indexContent = indexContent.replace(
        /(## 庭审笔录\n)/,
        `$1${entry}\n`
      )
    }
    await writeFile(indexPath, indexContent)
  } catch {
    // 索引更新失败不阻断主流程
  }

  return {
    frontmatter,
    body,
    data: args.data,
    markdownPath: paths.markdownPath,
  }
}

export async function loadTranscriptRecord(markdownPath: string): Promise<TranscriptRecord> {
  const normalized = normalizePath(markdownPath)
  const markdown = await readFile(normalized)
  const parsed = parseFrontmatter<HearingTranscriptFrontmatter>(markdown)
  const projectRoot = normalized.split("/wiki/")[0]
  const dataPath = `${projectRoot}/${parsed.data.dataPath}`
  const data = JSON.parse(await readFile(dataPath)) as HearingTranscriptData
  return {
    frontmatter: parsed.data,
    body: parsed.body,
    data,
    markdownPath: normalized,
  }
}
