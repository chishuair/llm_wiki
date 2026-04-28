/**
 * 案件知识库模板库。
 *
 * 每一部模板对应一类案件的典型工作流，由若干目录构成。目录分为：
 * - required：必选核心目录，必定创建；
 * - optional：建议目录，用户可在新建向导中取消勾选。
 *
 * 模板本身是 TS 数据结构，便于法院后续自定义或迁移为 JSON。
 */

export interface WikiTemplateDir {
  path: string
  label: string
  description: string
  required?: boolean
}

export interface WikiTemplate {
  id: string
  name: string
  description: string
  icon: string
  longDescription: string
  schema: string
  purpose: string
  dirs: WikiTemplateDir[]
}

function joinDirs(dirs: WikiTemplateDir[]): string[] {
  return dirs.map((d) => d.path)
}

function schemaTable(dirs: WikiTemplateDir[]): string {
  const rows = dirs
    .map((d) => `| ${d.label} | ${d.path}/ | ${d.description} |`)
    .join("\n")
  return `| 页面类型 | 目录 | 用途说明 |\n|---|---|---|\n${rows}`
}

function commonFooter(caseType: string): string {
  return `
## 证据清单页面（结构化）

为减少手写 markdown 表格的负担，「证据清单」目录支持结构化页面：

- 页面 frontmatter 使用 \`type: evidence-list\`，证据条目写在 \`evidences\` 列表中
- 打开此类页面时，应用会展示表格编辑器：编号、名称、提交方、证明目的、三性审查、是否采信、原件链接
- 表格内容会自动回写到 frontmatter，markdown 主体保留给附加说明

## 庭审笔录页面（结构化）

「庭审笔录」目录支持智能整理后的结构化页面：

- 页面 frontmatter 使用 \`type: hearing-transcript\`
- 大段结构化数据保存在同名 \`.transcript.json\` 文件中，markdown 主体保留为法官可读摘要
- 应用会提供专门的庭审笔录工作区，用于整理单份笔录、合并多次开庭结果、人工校对争议焦点与质证意见

## 命名规范

- 文件统一使用：\`YYYYMMDD-主题.md\`
- 每个页面必须包含：案号、页面类型、更新时间
- 文件名应简洁明确，避免口语化和模糊描述

## Frontmatter 规范

\`\`\`yaml
---
type: 目录名称（例如 当事人信息）
title: 页面标题
case_number: （${new Date().getFullYear()}）某法${caseType}初XX号
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

## 索引与引用

- \`wiki/index.md\` 按目录分组列出页面；\`wiki/log.md\` 记录办案关键节点
- 页面间使用 \`[[页面文件名]]\` 建立引用
- 争议焦点 / 争议问题页面必须链接对应证据、事实认定与法律依据页面
- 裁判文书页面必须链接说理与法律依据页面
`
}

// ── 民事案件模板 ──────────────────────────────────────────────
const CIVIL_DIRS: WikiTemplateDir[] = [
  { path: "wiki/案情概述", label: "案情概述", description: "案件基本事实、时间线、程序摘要", required: true },
  { path: "wiki/当事人信息", label: "当事人信息", description: "原告、被告、第三人及代理人", required: true },
  { path: "wiki/证据清单", label: "证据清单", description: "证据名称、来源、证明目的、三性审查", required: true },
  { path: "wiki/争议焦点", label: "争议焦点", description: "归纳审理中需解决的核心争议", required: true },
  { path: "wiki/法院认定事实", label: "法院认定事实", description: "经审查认定的客观事实", required: true },
  { path: "wiki/本院认为", label: "本院认为", description: "裁判说理、法律适用逻辑", required: true },
  { path: "wiki/法律依据", label: "法律依据", description: "适用的法律、司法解释与裁判规则", required: true },
  { path: "wiki/判决结果", label: "判决结果", description: "主文、履行义务、诉讼费用承担", required: true },
  { path: "wiki/审理过程", label: "审理过程", description: "立案、送达、开庭、合议等程序节点", required: true },
  { path: "wiki/庭审笔录", label: "庭审笔录", description: "开庭笔录、质证辩论记录" },
  { path: "wiki/办案手记", label: "办案手记", description: "承办人的办案思路、疑点、合议讨论要点" },
  { path: "wiki/类案检索", label: "类案检索", description: "指导性案例、参考案例、本院同类案件" },
  { path: "wiki/文书台账", label: "文书台账", description: "发出的全部裁判文书与程序文书存档" },
]

const CIVIL_TEMPLATE: WikiTemplate = {
  id: "civil",
  name: "民事案件模板",
  description: "面向一审/二审民事审判的通用结构",
  icon: "⚖️",
  longDescription:
    "覆盖合同纠纷、侵权责任、婚姻家庭、劳动争议等常见民事案件。包含判决书写作所需的九大核心模块，再加上庭审笔录、办案手记、类案检索与文书台账四个辅助模块。",
  dirs: CIVIL_DIRS,
  schema: `# 民事案件知识库结构规范

## 页面类型（预设）

${schemaTable(CIVIL_DIRS)}
${commonFooter("民")}`,
  purpose: `# 民事案件知识库建设目标

## 基本信息

- 案件名称：
- 案号：
- 案由：
- 承办法官：
- 审判组织：

## 建库目的

本案件知识库用于服务民事案件审理全流程，确保事实归纳、证据审查、法律适用与裁判说理可追溯、可复核、可沉淀。

## 重点审查事项

1. 争议焦点是否完整、准确。
2. 证据三性审查是否充分。
3. 事实认定是否与证据对应。
4. 说理论证是否充分、规范。
5. 法律依据是否准确、现行、适用恰当。

## 当前阶段

> 待完善（请根据审理进度及时更新）
`,
}

// ── 刑事案件模板 ──────────────────────────────────────────────
const CRIMINAL_DIRS: WikiTemplateDir[] = [
  { path: "wiki/案情概述", label: "案情概述", description: "起诉罪名、基本案情与程序摘要", required: true },
  { path: "wiki/被告人信息", label: "被告人信息", description: "被告人身份、前科、辩护人、涉案地位", required: true },
  { path: "wiki/被害人信息", label: "被害人信息", description: "被害人情况、损失、参加诉讼情况" },
  { path: "wiki/指控犯罪事实", label: "指控犯罪事实", description: "公诉机关指控的犯罪事实与罪名", required: true },
  { path: "wiki/证据清单", label: "证据清单", description: "证据种类、来源、证明目的、质证意见", required: true },
  { path: "wiki/被告人供述与辩解", label: "被告人供述与辩解", description: "到案经过、讯问笔录要点、当庭陈述" },
  { path: "wiki/辩护意见", label: "辩护意见", description: "辩护人书面与当庭意见汇总" },
  { path: "wiki/法院认定事实", label: "法院认定事实", description: "经审理认定的犯罪事实", required: true },
  { path: "wiki/量刑情节", label: "量刑情节", description: "法定情节（自首、立功、累犯）与酌定情节", required: true },
  { path: "wiki/本院认为", label: "本院认为", description: "定罪与量刑的说理", required: true },
  { path: "wiki/法律依据", label: "法律依据", description: "适用的刑法、刑诉法、司法解释条款", required: true },
  { path: "wiki/判决结果", label: "判决结果", description: "定罪、刑罚、附带民事、财物处理", required: true },
  { path: "wiki/审理过程", label: "审理过程", description: "立案、退补、开庭、延长审限等程序节点", required: true },
  { path: "wiki/庭审笔录", label: "庭审笔录", description: "开庭笔录、质证辩论记录" },
  { path: "wiki/办案手记", label: "办案手记", description: "承办人办案思路、疑点、合议讨论要点" },
  { path: "wiki/类案检索", label: "类案检索", description: "指导性案例、参考案例" },
  { path: "wiki/文书台账", label: "文书台账", description: "发出的各类裁判与程序文书" },
]

const CRIMINAL_TEMPLATE: WikiTemplate = {
  id: "criminal",
  name: "刑事案件模板",
  description: "面向普通刑事案件一审审理",
  icon: "🛡️",
  longDescription:
    "围绕「指控-证据-认定-定性-量刑-裁判」结构展开。补充被告人、被害人、供述与辩解、辩护意见、量刑情节等刑事特有栏目。",
  dirs: CRIMINAL_DIRS,
  schema: `# 刑事案件知识库结构规范

## 页面类型（预设）

${schemaTable(CRIMINAL_DIRS)}
${commonFooter("刑")}`,
  purpose: `# 刑事案件知识库建设目标

## 基本信息

- 案号：
- 罪名：
- 被告人（多人时分别列明）：
- 承办法官：
- 合议庭组成：

## 建库目的

本库为刑事案件审理服务，确保指控事实、证据采信、定罪量刑、法律适用可追溯可复核。

## 重点审查事项

1. 起诉书指控事实是否清楚、证据是否确实充分。
2. 证据取得是否合法，非法证据排除审查是否到位。
3. 定罪证据链是否闭合。
4. 量刑情节是否认定全面，是否符合量刑规范。
5. 对辩护意见是否逐项回应。

## 当前阶段

> 待完善
`,
}

// ── 行政案件模板 ──────────────────────────────────────────────
const ADMIN_DIRS: WikiTemplateDir[] = [
  { path: "wiki/案情概述", label: "案情概述", description: "诉请、被诉行政行为、程序摘要", required: true },
  { path: "wiki/当事人信息", label: "当事人信息", description: "原告、被告（行政机关）、第三人", required: true },
  { path: "wiki/被诉行政行为", label: "被诉行政行为", description: "行政行为内容、作出时间、送达情况", required: true },
  { path: "wiki/主体适格审查", label: "主体适格审查", description: "原告资格、被告适格、第三人参加" },
  { path: "wiki/证据清单", label: "证据清单", description: "行政机关举证、原告举证、证据审查", required: true },
  { path: "wiki/争议焦点", label: "争议焦点", description: "行政行为合法性 / 合理性争议", required: true },
  { path: "wiki/法院认定事实", label: "法院认定事实", description: "经审查认定的事实", required: true },
  { path: "wiki/合法性审查", label: "合法性审查", description: "职权、程序、事实、法律依据、裁量", required: true },
  { path: "wiki/本院认为", label: "本院认为", description: "对行政行为的司法评价与说理", required: true },
  { path: "wiki/法律依据", label: "法律依据", description: "适用的法律、行政法规、规章", required: true },
  { path: "wiki/判决结果", label: "判决结果", description: "维持、撤销、确认违法、履行判决或赔偿等", required: true },
  { path: "wiki/审理过程", label: "审理过程", description: "立案、送达、开庭、合议等程序节点", required: true },
  { path: "wiki/庭审笔录", label: "庭审笔录", description: "开庭笔录、质证辩论记录" },
  { path: "wiki/办案手记", label: "办案手记", description: "承办人思路、合议讨论、争点梳理" },
  { path: "wiki/类案检索", label: "类案检索", description: "同类行政案件参考" },
  { path: "wiki/文书台账", label: "文书台账", description: "裁判文书与程序文书" },
]

const ADMIN_TEMPLATE: WikiTemplate = {
  id: "administrative",
  name: "行政案件模板",
  description: "面向行政诉讼一审案件",
  icon: "🏛️",
  longDescription:
    "针对行政诉讼特有的「被诉行政行为 + 合法性审查」结构设计。涵盖主体适格、职权依据、程序合法、事实证据、法律依据、裁量合理六维审查。",
  dirs: ADMIN_DIRS,
  schema: `# 行政案件知识库结构规范

## 页面类型（预设）

${schemaTable(ADMIN_DIRS)}
${commonFooter("行")}`,
  purpose: `# 行政案件知识库建设目标

## 基本信息

- 案号：
- 被诉行政行为：
- 原告：
- 被告（行政机关）：
- 承办法官：

## 建库目的

本库为行政诉讼案件审理服务，着重围绕被诉行政行为的合法性审查构建。

## 重点审查事项

1. 主体是否适格（原告资格 / 被告适格）。
2. 行政机关是否有法定职权。
3. 行政程序是否合法。
4. 事实是否清楚，证据是否确凿。
5. 法律适用是否正确。
6. 行政裁量是否合理，有无明显不当。

## 当前阶段

> 待完善
`,
}

// ── 执行案件模板 ──────────────────────────────────────────────
const ENFORCEMENT_DIRS: WikiTemplateDir[] = [
  { path: "wiki/执行依据", label: "执行依据", description: "生效裁判文书、仲裁裁决、公证债权文书等", required: true },
  { path: "wiki/当事人信息", label: "当事人信息", description: "申请执行人、被执行人、利害关系人", required: true },
  { path: "wiki/标的与义务", label: "标的与义务", description: "执行标的、金钱给付、特定物交付、行为义务", required: true },
  { path: "wiki/财产调查", label: "财产调查", description: "银行查询、不动产查询、车辆工商等调查记录", required: true },
  { path: "wiki/强制措施", label: "强制措施", description: "冻结、查封、扣押、划拨、搜查等", required: true },
  { path: "wiki/履行情况", label: "履行情况", description: "自动履行、分期履行、部分履行、违约" },
  { path: "wiki/异议复议", label: "异议复议", description: "执行异议、复议、执行异议之诉" },
  { path: "wiki/终结情形", label: "终结情形", description: "终结执行、终结本次执行、终本恢复", required: true },
  { path: "wiki/本院认为", label: "本院认为", description: "执行事项中的说理" },
  { path: "wiki/法律依据", label: "法律依据", description: "民诉法执行编、司法解释、规范性文件", required: true },
  { path: "wiki/执行过程", label: "执行过程", description: "立案、传唤、笔录、合议等节点", required: true },
  { path: "wiki/办案手记", label: "办案手记", description: "执行员思路、困难、合议讨论" },
  { path: "wiki/类案检索", label: "类案检索", description: "同类执行案件参考" },
  { path: "wiki/文书台账", label: "文书台账", description: "裁定书、通知书、公告等存档" },
]

const ENFORCEMENT_TEMPLATE: WikiTemplate = {
  id: "enforcement",
  name: "执行案件模板",
  description: "面向民事执行案件办案流程",
  icon: "⚙️",
  longDescription:
    "以「执行依据-财产调查-强制措施-履行-终结」为主线。覆盖终本情形、异议复议、分期履行等执行特有场景。",
  dirs: ENFORCEMENT_DIRS,
  schema: `# 执行案件知识库结构规范

## 页面类型（预设）

${schemaTable(ENFORCEMENT_DIRS)}
${commonFooter("执")}`,
  purpose: `# 执行案件知识库建设目标

## 基本信息

- 执行案号：
- 执行依据：
- 申请执行人：
- 被执行人：
- 承办执行员：

## 建库目的

本库为执行案件办理服务，记录执行依据、财产调查、强制措施、履行情况与终结情形。

## 重点审查事项

1. 执行依据是否生效。
2. 被执行人财产线索是否穷尽调查。
3. 强制措施是否合法适当。
4. 异议复议是否及时处理。
5. 终本情形是否符合规定。

## 当前阶段

> 待完善
`,
}

export const templates: WikiTemplate[] = [
  CIVIL_TEMPLATE,
  CRIMINAL_TEMPLATE,
  ADMIN_TEMPLATE,
  ENFORCEMENT_TEMPLATE,
]

export function getTemplate(id: string): WikiTemplate {
  const found = templates.find((t) => t.id === id)
  if (!found) {
    throw new Error(`未知模板类型: "${id}"`)
  }
  return found
}

/** 当前模板的全部目录路径（供创建工程时使用）。 */
export function extraDirsForTemplate(templateId: string, selectedDirs?: string[]): string[] {
  const tpl = getTemplate(templateId)
  if (selectedDirs && selectedDirs.length > 0) {
    // 只创建用户勾选的目录，但必选目录无论如何都保留
    const required = new Set(tpl.dirs.filter((d) => d.required).map((d) => d.path))
    const picked = new Set(selectedDirs)
    return tpl.dirs
      .filter((d) => required.has(d.path) || picked.has(d.path))
      .map((d) => d.path)
  }
  return joinDirs(tpl.dirs)
}
