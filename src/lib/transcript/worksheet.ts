import {
  AlignmentType,
  Document,
  Footer,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx"
import { saveAs } from "file-saver"
import { loadCaseMeta } from "@/lib/case-meta"
import { buildTranscriptElementAlerts, buildTranscriptWorkPlan } from "@/lib/transcript/alerts"
import type { TranscriptRecord } from "@/types/transcript"
import type { HearingWorkspaceTab } from "@/stores/hearing-workspace-store"

export interface TranscriptWorksheetTarget {
  tab: HearingWorkspaceTab
  transcriptPath?: string
  elementId?: string
  focusText?: string
  evidenceId?: string
}

export interface TranscriptWorksheetItem {
  text: string
  target?: TranscriptWorksheetTarget
}

export interface TranscriptWorksheetSection {
  heading: string
  items: TranscriptWorksheetItem[]
  lines: string[]
}

export interface TranscriptWorksheetDocument {
  title: string
  subtitle: string[]
  sections: TranscriptWorksheetSection[]
}

const FONT_BODY = "FangSong"
const FONT_TITLE = "SimHei"
const SIZE_TITLE = 40
const SIZE_SECTION = 32
const SIZE_BODY = 30
const INDENT_FIRST_LINE = 560
const LINE_SPACING = 560

function normalizeLines(lines: string[]): string[] {
  return lines.filter((item) => item && item.trim()).map((item) => item.trim())
}

function elementLines(record: TranscriptRecord): string[] {
  return record.data.keyElements.map(
    (item) => `${item.label}（${item.status}）：${item.summary || "（待补充）"}`
  )
}

function findElementTarget(record: TranscriptRecord, text: string, fallbackTab: HearingWorkspaceTab): TranscriptWorksheetTarget {
  const element = record.data.keyElements.find((item) => text.includes(item.label))
  const evidenceId = text.match(/(证据\d+|原\d+|被\d+|第\d+号证据)/)?.[1]
  return {
    tab: evidenceId ? "evidence" : fallbackTab,
    transcriptPath: record.markdownPath,
    elementId: element?.id,
    focusText: text,
    evidenceId,
  }
}

function makeItems(
  record: TranscriptRecord,
  lines: string[],
  fallbackTab: HearingWorkspaceTab
): TranscriptWorksheetItem[] {
  return lines.map((text) => ({ text, target: findElementTarget(record, text, fallbackTab) }))
}

export function buildTranscriptWorksheet(record: TranscriptRecord): TranscriptWorksheetDocument {
  const alerts = buildTranscriptElementAlerts(record.data.keyElements)
  const workPlan = buildTranscriptWorkPlan(record.data.keyElements, record.data.proceduralNotes)
  const keyElementLines = normalizeLines(elementLines(record))
  const disputedLines = normalizeLines(alerts.disputedMessages)
  const missingLines = normalizeLines(alerts.missingEvidenceMessages)
  const questionLines = normalizeLines(alerts.questionSuggestions)
  const evidenceLines = normalizeLines(alerts.evidenceSuggestions)
  const hearingOutlineLines = normalizeLines(workPlan.hearingOutline)
  const judgeLines = normalizeLines(workPlan.judgeChecklist)
  const clerkLines = normalizeLines(workPlan.clerkChecklist)

  const sections: TranscriptWorksheetSection[] = [
    {
      heading: "庭审综述",
      lines: normalizeLines([record.data.overview || "（待补充）"]),
      items: [{ text: record.data.overview || "（待补充）", target: { tab: "transcript", transcriptPath: record.markdownPath } }],
    },
    { heading: "关键要素", lines: keyElementLines, items: makeItems(record, keyElementLines, "elements") },
    { heading: "争议要素提醒", lines: disputedLines, items: makeItems(record, disputedLines, "disputes") },
    { heading: "待补证提示", lines: missingLines, items: makeItems(record, missingLines, "disputes") },
    { heading: "下一步发问建议", lines: questionLines, items: makeItems(record, questionLines, "disputes") },
    { heading: "补证建议", lines: evidenceLines, items: makeItems(record, evidenceLines, "disputes") },
    { heading: "庭审提纲", lines: hearingOutlineLines, items: makeItems(record, hearingOutlineLines, "disputes") },
    { heading: "法官工作清单", lines: judgeLines, items: makeItems(record, judgeLines, "disputes") },
    { heading: "书记员工作清单", lines: clerkLines, items: makeItems(record, clerkLines, "disputes") },
  ]

  return {
    title: `${record.frontmatter.title}-开庭工作单`,
    subtitle: [
      `案件类型：${record.frontmatter.caseType}`,
      `案件子类型：${record.frontmatter.caseSubtypeLabel || "未指定"}`,
      `庭审日期：${record.frontmatter.sessionDate || "未填写"}`,
      `庭次：${record.frontmatter.sessionIndex || "未填写"}`,
      `来源材料：${record.frontmatter.sourcePath || "多份整理稿"}`,
    ],
    sections,
  }
}

export async function buildTranscriptWorksheetWithProjectMeta(
  projectPath: string,
  record: TranscriptRecord
): Promise<TranscriptWorksheetDocument> {
  const worksheet = buildTranscriptWorksheet(record)
  const meta = await loadCaseMeta(projectPath, record.frontmatter.title)
  const subtitle = [
    `案件名称：${meta.caseName || record.frontmatter.title}`,
    `案号：${meta.caseNumber || "未填写"}`,
    `受诉法院：${meta.courtName || "未填写"}`,
    ...worksheet.subtitle,
  ]
  return { ...worksheet, subtitle }
}

function makeTitle(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: FONT_TITLE,
        size: SIZE_TITLE,
      }),
    ],
  })
}

function makeMetaLine(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 100, line: LINE_SPACING, lineRule: LineRuleType.EXACT },
    children: [
      new TextRun({
        text,
        font: FONT_BODY,
        size: SIZE_BODY,
      }),
    ],
  })
}

function makeSectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 100, line: LINE_SPACING, lineRule: LineRuleType.EXACT },
    children: [
      new TextRun({
        text,
        bold: true,
        font: FONT_TITLE,
        size: SIZE_SECTION,
      }),
    ],
  })
}

function makeBullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60, line: LINE_SPACING, lineRule: LineRuleType.EXACT },
    indent: { firstLine: INDENT_FIRST_LINE },
    children: [
      new TextRun({
        text: `• ${text}`,
        font: FONT_BODY,
        size: SIZE_BODY,
      }),
    ],
  })
}

export async function exportTranscriptWorksheetToDocx(record: TranscriptRecord): Promise<void> {
  const worksheet = buildTranscriptWorksheet(record)
  const children: Paragraph[] = [makeTitle(worksheet.title)]
  for (const line of worksheet.subtitle) {
    children.push(makeMetaLine(line))
  }
  for (const section of worksheet.sections) {
    children.push(makeSectionHeading(section.heading))
    if (section.lines.length === 0) {
      children.push(makeBullet("（暂无）"))
      continue
    }
    for (const line of section.lines) {
      children.push(makeBullet(line))
    }
  }

  const wordDoc = new Document({
    creator: "案件知识库",
    title: worksheet.title,
    description: `由案件知识库生成的「${worksheet.title}」`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1.2),
              right: convertInchesToTwip(1.0),
              bottom: convertInchesToTwip(1.0),
              left: convertInchesToTwip(1.0),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    font: FONT_BODY,
                    size: 24,
                    children: [PageNumber.CURRENT],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(wordDoc)
  saveAs(blob, `${worksheet.title}.docx`)
}

export async function exportTranscriptWorksheetToDocxWithMeta(projectPath: string, record: TranscriptRecord): Promise<void> {
  const worksheet = await buildTranscriptWorksheetWithProjectMeta(projectPath, record)
  const children: Paragraph[] = [makeTitle(worksheet.title)]
  for (const line of worksheet.subtitle) children.push(makeMetaLine(line))
  for (const section of worksheet.sections) {
    children.push(makeSectionHeading(section.heading))
    if (section.lines.length === 0) children.push(makeBullet("（暂无）"))
    else for (const line of section.lines) children.push(makeBullet(line))
  }
  const wordDoc = new Document({
    creator: "案件知识库",
    title: worksheet.title,
    description: `由案件知识库生成的「${worksheet.title}」`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1.2),
              right: convertInchesToTwip(1.0),
              bottom: convertInchesToTwip(1.0),
              left: convertInchesToTwip(1.0),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT_BODY, size: 24, children: [PageNumber.CURRENT] })] })],
          }),
        },
        children,
      },
    ],
  })
  const blob = await Packer.toBlob(wordDoc)
  saveAs(blob, `${worksheet.title}.docx`)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function buildTranscriptWorksheetHtml(record: TranscriptRecord): string {
  const worksheet = buildTranscriptWorksheet(record)
  const subtitle = worksheet.subtitle.map((line) => `<div class="meta-line">${escapeHtml(line)}</div>`).join("")
  const sections = worksheet.sections
    .map((section) => {
      const items = (section.lines.length > 0 ? section.lines : ["（暂无）"])
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")
      return `<section class="sheet-section"><h2>${escapeHtml(section.heading)}</h2><ul>${items}</ul></section>`
    })
    .join("")

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(worksheet.title)}</title>
  <style>
    body { font-family: "FangSong", "STFangsong", serif; margin: 32px; color: #111827; }
    h1 { text-align: center; font-family: "SimHei", "Heiti SC", sans-serif; font-size: 28px; margin-bottom: 20px; }
    h2 { font-family: "SimHei", "Heiti SC", sans-serif; font-size: 18px; margin: 18px 0 8px; }
    .meta-line { font-size: 14px; line-height: 1.8; }
    .sheet-section { margin-top: 12px; }
    ul { margin: 0; padding-left: 22px; }
    li { font-size: 14px; line-height: 1.8; margin: 4px 0; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(worksheet.title)}</h1>
  <div>${subtitle}</div>
  ${sections}
</body>
</html>`
}

export function exportTranscriptWorksheetToPrint(record: TranscriptRecord): void {
  const html = buildTranscriptWorksheetHtml(record)
  const printWindow = window.open("", "_blank", "width=960,height=720")
  if (!printWindow) {
    throw new Error("无法打开打印窗口，请检查浏览器是否拦截弹窗。")
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 200)
}

export async function exportTranscriptWorksheetToPrintWithMeta(projectPath: string, record: TranscriptRecord): Promise<void> {
  const worksheet = await buildTranscriptWorksheetWithProjectMeta(projectPath, record)
  const subtitle = worksheet.subtitle.map((line) => `<div class="meta-line">${escapeHtml(line)}</div>`).join("")
  const sections = worksheet.sections
    .map((section) => {
      const items = (section.lines.length > 0 ? section.lines : ["（暂无）"]).map((line) => `<li>${escapeHtml(line)}</li>`).join("")
      return `<section class="sheet-section"><h2>${escapeHtml(section.heading)}</h2><ul>${items}</ul></section>`
    })
    .join("")
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(worksheet.title)}</title>
  <style>
    body { font-family: "FangSong", "STFangsong", serif; margin: 32px; color: #111827; }
    h1 { text-align: center; font-family: "SimHei", "Heiti SC", sans-serif; font-size: 28px; margin-bottom: 20px; }
    h2 { font-family: "SimHei", "Heiti SC", sans-serif; font-size: 18px; margin: 18px 0 8px; }
    .meta-line { font-size: 14px; line-height: 1.8; }
    .sheet-section { margin-top: 12px; }
    ul { margin: 0; padding-left: 22px; }
    li { font-size: 14px; line-height: 1.8; margin: 4px 0; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(worksheet.title)}</h1>
  <div>${subtitle}</div>
  ${sections}
</body>
</html>`
  const printWindow = window.open("", "_blank", "width=960,height=720")
  if (!printWindow) throw new Error("无法打开打印窗口，请检查浏览器是否拦截弹窗。")
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => printWindow.print(), 200)
}
