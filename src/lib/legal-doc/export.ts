import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  Footer,
  convertInchesToTwip,
  LineRuleType,
} from "docx"
import { saveAs } from "file-saver"
import type { GeneratedDocument, GeneratedSection } from "@/types/legal-doc"

/**
 * 按《人民法院裁判文书格式规范》导出 Word：
 * - 页面：A4；页边距 上3.7cm 下3.5cm 左2.8cm 右2.6cm（与最高院样式一致）；
 * - 字体：正文仿宋_GB2312 三号（16pt）；标题黑体二号（22pt）；小标题黑体三号；
 * - 行距：固定 28pt（与规范相近）；
 * - 首行缩进：2 字符（约 32pt，docx 用 twips：2 * 16pt * 20 = 640）；
 * - 页脚：页码居中；
 * - 签名栏、尾部：无首行缩进，右对齐。
 */

const FONT_BODY = "FangSong"
const FONT_TITLE = "SimHei"

const SIZE_TITLE = 44 // 黑体二号 22pt * 2 (half-pt)
const SIZE_SECTION = 32 // 小标题黑体三号 16pt * 2（加粗）
const SIZE_BODY = 32 // 正文三号 16pt * 2

// 首行缩进 2 字（大约 640 twips = 2 × 16pt × 20）
const INDENT_FIRST_LINE = 640

// 行距：固定 28pt → 28 * 20 = 560 twips
const LINE_SPACING = 560

const SIGNATURE_IDS = new Set(["tail", "appeal", "remedies", "approval"])

function makeTitle(doc: GeneratedDocument): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360 },
    children: [
      new TextRun({
        text: doc.title,
        bold: true,
        font: FONT_TITLE,
        size: SIZE_TITLE,
      }),
    ],
  })
}

function makeSectionHeading(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 280, after: 120, line: LINE_SPACING, lineRule: LineRuleType.EXACT },
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

function makeBodyParagraph(line: string, options?: { indent?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph {
  const { indent = true, align = AlignmentType.JUSTIFIED } = options ?? {}
  return new Paragraph({
    alignment: align,
    spacing: { line: LINE_SPACING, lineRule: LineRuleType.EXACT, after: 60 },
    indent: indent ? { firstLine: INDENT_FIRST_LINE } : undefined,
    children: [
      new TextRun({
        text: line || " ",
        font: FONT_BODY,
        size: SIZE_BODY,
      }),
    ],
  })
}

function renderSection(section: GeneratedSection): Paragraph[] {
  const out: Paragraph[] = [makeSectionHeading(section.heading)]
  const content = (section.content && section.content.trim()) || "（待补充）"
  // 签名栏等不做首行缩进
  const isSignatureLike = SIGNATURE_IDS.has(section.id)
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    out.push(
      makeBodyParagraph(line, {
        indent: !isSignatureLike,
        align: isSignatureLike ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
      })
    )
  }
  return out
}

export async function exportToDocx(doc: GeneratedDocument): Promise<void> {
  const paragraphs: Paragraph[] = [makeTitle(doc)]
  for (const section of doc.sections) {
    paragraphs.push(...renderSection(section))
  }

  const wordDoc = new Document({
    creator: "案件知识库",
    title: doc.title,
    description: `由案件知识库生成的「${doc.title}」草稿`,
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: SIZE_BODY },
          paragraph: {
            spacing: { line: LINE_SPACING, lineRule: LineRuleType.EXACT },
          },
        },
        heading1: {
          run: { font: FONT_TITLE, size: SIZE_TITLE, bold: true },
        },
        heading2: {
          run: { font: FONT_TITLE, size: SIZE_SECTION, bold: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1.46),   // 3.7cm
              right: convertInchesToTwip(1.02), // 2.6cm
              bottom: convertInchesToTwip(1.38), // 3.5cm
              left: convertInchesToTwip(1.1),   // 2.8cm
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
        children: paragraphs,
      },
    ],
  })

  const blob = await Packer.toBlob(wordDoc)
  const filename = `${doc.caseContext.projectName}_${doc.title}.docx`
  saveAs(blob, filename)
}

// 保留 HeadingLevel 引用防止 tree-shaking 警告，实际未使用可忽略
export { HeadingLevel }

export function exportToPdfViaPrint(_printRootId: string): void {
  window.print()
}
