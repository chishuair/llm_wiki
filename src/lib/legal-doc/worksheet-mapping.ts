import type { LegalDocSection } from "@/types/legal-doc"

export interface WorksheetSectionMappingRule {
  id: string
  description: string
  match: {
    sectionIds?: string[]
    headingIncludes?: string[]
  }
  worksheetSections: string[]
}

export const WORKSHEET_SECTION_MAPPINGS: WorksheetSectionMappingRule[] = [
  {
    id: "procedure",
    description: "审理经过、程序类章节优先参考庭审提纲与书记员记录清单。",
    match: {
      sectionIds: ["procedure"],
      headingIncludes: ["审理经过"],
    },
    worksheetSections: ["庭审提纲", "书记员工作清单"],
  },
  {
    id: "facts-review",
    description: "事实查明、经审查类章节优先参考关键要素与待补证提示。",
    match: {
      sectionIds: ["facts", "review"],
      headingIncludes: ["查明", "经审查"],
    },
    worksheetSections: ["关键要素", "待补证提示"],
  },
  {
    id: "disputes",
    description: "争议焦点类章节优先参考争议提醒与发问建议。",
    match: {
      sectionIds: ["disputes", "focus"],
      headingIncludes: ["争议焦点"],
    },
    worksheetSections: ["争议要素提醒", "下一步发问建议"],
  },
  {
    id: "reasoning",
    description: "本院认为、审查意见类章节优先参考关键要素、争议提醒、补证建议和法官工作清单。",
    match: {
      sectionIds: ["reasoning", "review"],
      headingIncludes: ["本院认为"],
    },
    worksheetSections: ["关键要素", "争议要素提醒", "补证建议", "法官工作清单"],
  },
  {
    id: "decision-result",
    description: "判决结果、裁定、协议或处理结果类章节优先参考关键要素与法官工作清单。",
    match: {
      sectionIds: ["judgment", "decision", "agreement", "result"],
      headingIncludes: ["判决结果", "裁定", "协议", "处理结果"],
    },
    worksheetSections: ["关键要素", "法官工作清单"],
  },
  {
    id: "default",
    description: "默认规则：参考关键要素与庭审提纲。",
    match: {},
    worksheetSections: ["关键要素", "庭审提纲"],
  },
]

function parseWorksheetSections(markdown: string): Record<string, string> {
  if (!markdown.trim()) return {}
  const sections: Record<string, string> = {}
  const matches = [...markdown.matchAll(/^##\s+(.+?)\n([\s\S]*?)(?=^##\s+.+|\Z)/gm)]
  for (const match of matches) {
    const heading = match[1]?.trim()
    const body = match[2]?.trim()
    if (heading && body) sections[heading] = body
  }
  return sections
}

function matchesRule(rule: WorksheetSectionMappingRule, section: LegalDocSection): boolean {
  const id = section.id.toLowerCase()
  const heading = section.heading
  const idMatched = rule.match.sectionIds?.some((value) => id.includes(value.toLowerCase())) ?? false
  const headingMatched = rule.match.headingIncludes?.some((value) => heading.includes(value)) ?? false
  if (!rule.match.sectionIds && !rule.match.headingIncludes) return true
  return idMatched || headingMatched
}

export function buildSectionWorksheetContext(section: LegalDocSection, worksheetMarkdown: string): string {
  const parsed = parseWorksheetSections(worksheetMarkdown)
  if (Object.keys(parsed).length === 0) return ""

  const rule = WORKSHEET_SECTION_MAPPINGS.find((item) => item.id !== "default" && matchesRule(item, section))
    ?? WORKSHEET_SECTION_MAPPINGS.find((item) => item.id === "default")

  if (!rule) return ""

  const parts = rule.worksheetSections
    .map((heading) => {
      const text = parsed[heading]
      return text ? `### ${heading}\n${text}` : ""
    })
    .filter(Boolean)

  return parts.join("\n\n")
}
