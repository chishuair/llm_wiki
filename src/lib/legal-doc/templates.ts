import type { LegalDocTemplate } from "@/types/legal-doc"

/**
 * 首批内置法律文书模板。
 *
 * 结构参照最高人民法院裁判文书样式规范与常见审判实务，但保留简化以便
 * LLM 首次生成出可读草稿；法官在预览界面可以随时微调。
 *
 * 后续可让法院录入自有版式（例如本院审判指引中的文书模板），替换本
 * 目录下的 TS 对象即可，无需改引擎代码。
 */

const CIVIL_JUDGMENT: LegalDocTemplate = {
  id: "civil-judgment-first-instance",
  name: "民事判决书（一审）",
  category: "裁判",
  description: "一审民事案件判决书草稿，按「事实-证据-争议-说理-主文」结构生成。",
  sections: [
    {
      id: "case-header",
      heading: "案件基本信息",
      kind: "static",
      template: "案号：{{case_number}}\n\n{{parties}}",
    },
    {
      id: "procedure",
      heading: "审理经过",
      kind: "llm",
      prompt:
        "根据案件的立案、送达、开庭、合议等程序信息，写一段审理经过的陈述，" +
        "段落控制在 150 字以内，客观、不评价。不要编造时间或节点。",
    },
    {
      id: "facts",
      heading: "经审理查明",
      kind: "llm",
      prompt:
        "结合知识库中的「法院认定事实」页面，按时间顺序整理案件事实，以「经审理查明，……」开头。" +
        "每一项事实如对应证据，使用『（见证据X）』注明。绝不编造。",
    },
    {
      id: "disputes",
      heading: "争议焦点",
      kind: "llm",
      prompt:
        "根据案件的「争议焦点」页面，用序号列出本案全部争议焦点。每条一两句话概括。",
    },
    {
      id: "reasoning",
      heading: "本院认为",
      kind: "llm",
      prompt:
        "针对每一项争议焦点做三段论说理：\n" +
        "1) 先陈述规则（必须引用「本地法条库」中的条款，格式《法律》第N条）；\n" +
        "2) 再结合查明事实和证据做涵摄；\n" +
        "3) 得出对该争议的结论。\n" +
        "如果本地法条库缺少必要依据，必须按约束输出库缺标识，不得自行编造法条。",
    },
    {
      id: "judgment",
      heading: "判决结果",
      kind: "llm",
      prompt:
        "按最高人民法院裁判文书主文规范写判决主文：\n" +
        "- 主文以「判决如下：」开头；\n" +
        "- 列项编号，使用「一、」「二、」……；\n" +
        "- 明确履行义务、履行期限、费用承担；\n" +
        "- 结合知识库「判决结果」页面中的要点，未明确的不要自行发挥。",
    },
    {
      id: "cost",
      heading: "诉讼费用",
      kind: "llm",
      optional: true,
      prompt:
        "如知识库或判决结果中已有诉讼费用分担方案，写一句「案件受理费 X 元，由…… 负担」；" +
        "未明确则写「案件受理费由双方依法分担」，不要具体编数字。",
    },
    {
      id: "appeal",
      heading: "上诉权利告知",
      kind: "static",
      template:
        "如不服本判决，可以在判决书送达之日起十五日内，向本院递交上诉状，并按对方当事人的人数提出副本，上诉于上一级人民法院。",
    },
    {
      id: "tail",
      heading: "尾部",
      kind: "static",
      template:
        "审\u3000判\u3000长　　　　\n审\u3000判\u3000员　　　　\n人民陪审员　　　　\n\n　　　　　　年　　月　　日\n\n书\u3000记\u3000员　　　　",
    },
  ],
}

const CIVIL_RULING: LegalDocTemplate = {
  id: "civil-ruling",
  name: "民事裁定书",
  category: "裁判",
  description: "民事程序事项裁定书，如管辖权、财产保全、中止/终结诉讼、不予受理等。",
  sections: [
    {
      id: "case-header",
      heading: "案件基本信息",
      kind: "static",
      template: "案号：{{case_number}}\n\n{{parties}}",
    },
    {
      id: "application",
      heading: "申请或事由",
      kind: "llm",
      prompt:
        "根据案件材料，写一段本次裁定需要解决的程序事项（如：原告申请财产保全、管辖权异议、" +
        "中止诉讼、不予受理等）。保持客观。",
    },
    {
      id: "review",
      heading: "经审查",
      kind: "llm",
      prompt:
        "结合查明事实与证据，写经审查的过程与所依据的事实。如有程序要件，逐一陈述。",
    },
    {
      id: "reasoning",
      heading: "本院认为",
      kind: "llm",
      prompt:
        "说明本院对程序事项的认定，须引用「本地法条库」中的程序性条款（如民诉法相关条文）。" +
        "严禁编造条文号。",
    },
    {
      id: "decision",
      heading: "裁定",
      kind: "llm",
      prompt:
        "以「裁定如下：」开头，逐项列出裁定内容。如：准许/驳回申请、中止诉讼、移送管辖等。",
    },
    {
      id: "appeal",
      heading: "复议或上诉",
      kind: "static",
      optional: true,
      template:
        "如不服本裁定，可以在裁定书送达之日起十日内，向本院申请复议一次；或依法向上一级人民法院提起上诉。",
    },
    {
      id: "tail",
      heading: "尾部",
      kind: "static",
      template:
        "审\u3000判\u3000长　　　　\n审\u3000判\u3000员　　　　\n\n　　　　　　年　　月　　日\n\n书\u3000记\u3000员　　　　",
    },
  ],
}

const CIVIL_MEDIATION: LegalDocTemplate = {
  id: "civil-mediation",
  name: "民事调解书",
  category: "裁判",
  description: "双方自愿达成调解协议后出具的调解书。",
  sections: [
    {
      id: "case-header",
      heading: "案件基本信息",
      kind: "static",
      template: "案号：{{case_number}}\n\n{{parties}}",
    },
    {
      id: "case-brief",
      heading: "案情摘要",
      kind: "llm",
      prompt: "用 100 字左右概括案件起因与诉请，客观中立。",
    },
    {
      id: "mediation",
      heading: "经本院主持调解",
      kind: "llm",
      prompt:
        "写一段调解经过：法官如何主持、双方如何表达诉求、最终如何达成合意。" +
        "不要提具体金额以外未在知识库出现的细节。",
    },
    {
      id: "agreement",
      heading: "双方自愿达成协议如下",
      kind: "llm",
      prompt:
        "按项列出调解协议主要内容：付款金额、履行方式、履行期限、违约后果、诉讼费负担等。" +
        "未在案件知识库出现的条款不得自行添加。",
    },
    {
      id: "note",
      heading: "告知事项",
      kind: "static",
      template:
        "上述协议，符合有关法律规定，本院予以确认。本调解书经双方签收后即具有法律效力。",
    },
    {
      id: "tail",
      heading: "尾部",
      kind: "static",
      template:
        "审\u3000判\u3000员　　　　\n\n　　　　　　年　　月　　日\n\n书\u3000记\u3000员　　　　",
    },
  ],
}

const TRIAL_MINUTES: LegalDocTemplate = {
  id: "trial-minutes",
  name: "开庭笔录提纲",
  category: "笔录",
  description: "开庭前辅助准备的庭审提纲，含庭审各阶段引导词、争议焦点提问清单。",
  sections: [
    {
      id: "meta",
      heading: "庭审基本信息",
      kind: "static",
      template:
        "案号：{{case_number}}\n开庭时间：　　年　　月　　日　　时　　分\n开庭地点：\n审判人员：\n书记员：",
    },
    {
      id: "parties",
      heading: "当事人与诉讼代理人到庭情况",
      kind: "case-field",
      source: "parties",
    },
    {
      id: "opening",
      heading: "开庭阶段",
      kind: "static",
      template:
        "1. 核实当事人身份与代理权限；\n" +
        "2. 告知当事人诉讼权利义务；\n" +
        "3. 询问是否申请回避；\n" +
        "4. 宣布合议庭组成人员及书记员。",
    },
    {
      id: "claims",
      heading: "法庭调查：诉讼请求与事实主张",
      kind: "llm",
      prompt:
        "按「原告宣读起诉状要点→被告答辩→第三人意见」顺序，列出对应提问与需核实的事实要点。",
    },
    {
      id: "evidence",
      heading: "法庭调查：举证与质证",
      kind: "llm",
      prompt:
        "根据知识库中的「证据清单」结构化数据，逐条列出举证顺序，并对每条证据列出应质证的三性（真实性/合法性/关联性）核查要点。",
    },
    {
      id: "focus",
      heading: "争议焦点归纳",
      kind: "llm",
      prompt: "根据知识库「争议焦点」页面整理归纳，引导双方逐一发表意见。",
    },
    {
      id: "debate",
      heading: "法庭辩论",
      kind: "static",
      template:
        "原告发表辩论意见：\n\n被告发表辩论意见：\n\n第三人发表意见（如有）：",
    },
    {
      id: "final",
      heading: "最后陈述",
      kind: "static",
      template: "原告：\n\n被告：\n\n第三人（如有）：",
    },
    {
      id: "closing",
      heading: "法庭秩序与闭庭",
      kind: "static",
      template:
        "合议庭休庭评议（如需）：　　　　\n宣布择期宣判 / 当庭宣判：　　　　\n闭庭时间：　　时　　分",
    },
  ],
}

const SERVICE_RECEIPT: LegalDocTemplate = {
  id: "service-receipt",
  name: "送达回证",
  category: "程序",
  description: "送达法律文书后由受送达人签收的送达回证。",
  sections: [
    {
      id: "meta",
      heading: "送达信息",
      kind: "static",
      template:
        "案号：{{case_number}}\n\n受送达人：\n送达文书名称：\n送达地点：\n送达方式：　直接送达 / 邮寄送达 / 电子送达 / 留置送达 / 公告送达",
    },
    {
      id: "time",
      heading: "送达时间",
      kind: "static",
      template: "　　　　年　　月　　日　　时　　分",
    },
    {
      id: "signature",
      heading: "受送达人签收",
      kind: "static",
      template:
        "受送达人（签名/盖章）：\n与受送达人关系：\n身份证件号码：",
    },
    {
      id: "witness",
      heading: "送达人及见证人",
      kind: "static",
      template: "送达人（签名）：\n见证人（如有）：",
    },
    {
      id: "remark",
      heading: "备注",
      kind: "static",
      optional: true,
      template: "（如拒绝签收、邮寄返回等情况，须在此说明）",
    },
  ],
}

const DIVORCE_JUDGMENT: LegalDocTemplate = {
  id: "divorce-judgment",
  name: "离婚纠纷民事判决书",
  category: "裁判",
  description: "婚姻家庭类一审判决书，含夫妻感情认定、子女抚养、财产分割、债务分担结构。",
  sections: [
    {
      id: "case-header",
      heading: "案件基本信息",
      kind: "static",
      template: "案号：{{case_number}}\n\n{{parties}}",
    },
    {
      id: "procedure",
      heading: "审理经过",
      kind: "llm",
      prompt:
        "结合立案、送达、开庭等程序节点，写一段审理经过，120 字以内，客观中立。不要编造时间。",
    },
    {
      id: "facts",
      heading: "经审理查明",
      kind: "llm",
      prompt:
        "按以下顺序整理事实：\n" +
        "1) 婚姻基础（结婚时间、婚前认识过程）；\n" +
        "2) 婚后共同生活情况；\n" +
        "3) 子女基本情况（姓名、出生日期、现随谁生活）；\n" +
        "4) 共同财产与共同债务概况；\n" +
        "5) 矛盾产生与分居情况。\n" +
        "严格依据知识库材料，未载明的不可编造。",
    },
    {
      id: "disputes",
      heading: "争议焦点",
      kind: "llm",
      prompt:
        "典型焦点：（一）夫妻感情是否确已破裂；（二）子女抚养权归属与抚养费；" +
        "（三）共同财产如何分割；（四）债务是否为共同债务。结合知识库实情增删。",
    },
    {
      id: "reasoning",
      heading: "本院认为",
      kind: "llm",
      prompt:
        "逐项回应争议焦点。必须引用本地法条库中的相关条款（如《民法典》婚姻家庭编相应条款）；" +
        "若无可用条款则按约束返回库缺标识。写作时体现 \"事实-规范-结论\" 三段论。",
    },
    {
      id: "judgment",
      heading: "判决结果",
      kind: "llm",
      prompt:
        "按下面要点写判决主文，序号用「一、」「二、」……：\n" +
        "- 是否准许离婚；\n" +
        "- 子女抚养权与抚养费；\n" +
        "- 共同财产分割（列明具体项目）；\n" +
        "- 债务承担；\n" +
        "未在知识库出现的具体金额与财产项目不得自行发挥。",
    },
    {
      id: "cost",
      heading: "诉讼费用",
      kind: "static",
      optional: true,
      template: "案件受理费由双方依法分担。",
    },
    {
      id: "appeal",
      heading: "上诉权利告知",
      kind: "static",
      template:
        "如不服本判决，可以在判决书送达之日起十五日内，向本院递交上诉状，并按对方当事人的人数提出副本，上诉于上一级人民法院。",
    },
    {
      id: "tail",
      heading: "尾部",
      kind: "static",
      template:
        "审\u3000判\u3000长　　　　\n审\u3000判\u3000员　　　　\n人民陪审员　　　　\n\n　　　　　　年　　月　　日\n\n书\u3000记\u3000员　　　　",
    },
  ],
}

const ENFORCEMENT_RULING: LegalDocTemplate = {
  id: "enforcement-ruling",
  name: "执行裁定书",
  category: "裁判",
  description: "执行程序中的裁定：冻结/扣划/拍卖/终结本次执行等。",
  sections: [
    {
      id: "case-header",
      heading: "执行案件基本信息",
      kind: "static",
      template:
        "申请执行人：\n被执行人：\n执行依据：（案号与生效裁判文书）\n本院执行案号：{{case_number}}",
    },
    {
      id: "application",
      heading: "申请事项",
      kind: "llm",
      prompt:
        "写本次裁定需解决的执行事项（如：冻结被执行人银行账户、查封不动产、拍卖车辆、" +
        "终结本次执行程序、追加执行人等）。",
    },
    {
      id: "facts",
      heading: "经查明",
      kind: "llm",
      prompt:
        "结合调查情况写执行财产查控结果、履行情况等事实。客观陈述，不评价。",
    },
    {
      id: "reasoning",
      heading: "本院认为",
      kind: "llm",
      prompt:
        "依据执行依据的生效裁判与本地法条库中相关执行程序条款（如《民诉法》执行一编）做说理，" +
        "不得编造条文号。",
    },
    {
      id: "decision",
      heading: "裁定",
      kind: "llm",
      prompt:
        "以「裁定如下：」开头。常见形式：\n" +
        "- 冻结/划拨/扣划 被执行人 XXX 在 XX 银行账户人民币 X 元；\n" +
        "- 查封/扣押/拍卖 被执行人名下位于 XXX 的房产；\n" +
        "- 本次执行程序终结（注明程序性依据）；\n" +
        "- 本裁定送达后即生效（或注明异议复议途径）。\n" +
        "仅根据知识库中出现的标的物、金额撰写，不得自行发挥。",
    },
    {
      id: "remedies",
      heading: "异议权告知",
      kind: "static",
      optional: true,
      template:
        "当事人、利害关系人认为执行行为违反法律规定的，可以自本裁定送达之日起十日内向本院提出书面异议。",
    },
    {
      id: "tail",
      heading: "尾部",
      kind: "static",
      template:
        "执行法官　　　　\n\n　　　　　　年　　月　　日\n\n书\u3000记\u3000员　　　　",
    },
  ],
}

const CASE_CLOSE_REPORT: LegalDocTemplate = {
  id: "case-close-report",
  name: "结案报告",
  category: "其他",
  description: "办案法官在结案归档前提交的内部报告，汇总案件基本信息、处理结果、合议情况。",
  sections: [
    {
      id: "meta",
      heading: "案件基本信息",
      kind: "static",
      template:
        "案号：{{case_number}}\n案由：\n承办法官：\n合议庭成员：\n书记员：\n立案日期：\n结案日期：",
    },
    {
      id: "parties",
      heading: "当事人信息",
      kind: "case-field",
      source: "parties",
    },
    {
      id: "brief",
      heading: "案情简介",
      kind: "llm",
      prompt: "用 200 字以内概括案件起因、诉讼请求、审理过程，客观中立。",
    },
    {
      id: "evidence",
      heading: "证据审查情况",
      kind: "llm",
      prompt:
        "结合知识库中的「证据清单」结构化数据，简要介绍证据数量、双方质证情况，" +
        "以及最终采信率。不要罗列每一条原文。",
    },
    {
      id: "focus",
      heading: "争议焦点与合议情况",
      kind: "llm",
      prompt:
        "列出争议焦点以及合议庭的多数意见、少数意见（若有）。" +
        "不要编造合议成员的姓名或具体表态。",
    },
    {
      id: "result",
      heading: "处理结果",
      kind: "llm",
      prompt:
        "写本案的处理结果（判决/调解/撤诉/裁定驳回等）及主文要点，适当引用本地法条库中相关条款。",
    },
    {
      id: "appraisal",
      heading: "办案小结",
      kind: "llm",
      optional: true,
      prompt: "用 100 字总结本案的审理亮点、风险提示或可资借鉴之处。",
    },
    {
      id: "tail",
      heading: "报告人",
      kind: "static",
      template: "承办法官（签名）：\n\n　　　　　　年　　月　　日",
    },
  ],
}

const DEADLINE_EXTENSION: LegalDocTemplate = {
  id: "deadline-extension",
  name: "审限延长审批表",
  category: "程序",
  description: "申请延长案件审理期限的内部审批文书。",
  sections: [
    {
      id: "meta",
      heading: "审限基本信息",
      kind: "static",
      template:
        "案号：{{case_number}}\n案由：\n立案日期：　　年　　月　　日\n原定结案日期：　　年　　月　　日\n申请延长至：　　年　　月　　日",
    },
    {
      id: "parties",
      heading: "当事人",
      kind: "case-field",
      source: "parties",
    },
    {
      id: "reason",
      heading: "申请延长事由",
      kind: "llm",
      prompt:
        "写申请延长审限的理由（如：案情复杂、鉴定中、送达困难、管辖争议未决、疫情影响等），" +
        "结合知识库中的审理过程。",
    },
    {
      id: "progress",
      heading: "当前审理进展",
      kind: "case-field",
      source: "procedure_log",
    },
    {
      id: "plan",
      heading: "后续审理计划",
      kind: "llm",
      prompt:
        "列明延长期内需要完成的事项（开庭、鉴定、送达、合议等）与时间安排。",
    },
    {
      id: "approval",
      heading: "合议庭 / 院领导意见",
      kind: "static",
      template:
        "承办法官意见：\n\n合议庭意见：\n\n庭长意见：\n\n分管院长意见：\n\n院长意见：",
    },
  ],
}

const COLLEGIAL_MINUTES: LegalDocTemplate = {
  id: "collegial-minutes",
  name: "合议庭评议笔录",
  category: "笔录",
  description: "合议庭就本案发表意见并形成决议的评议笔录。",
  sections: [
    {
      id: "meta",
      heading: "评议基本信息",
      kind: "static",
      template:
        "案号：{{case_number}}\n评议时间：　　年　　月　　日\n评议地点：\n合议庭成员：\n书记员：",
    },
    {
      id: "focus",
      heading: "拟评议的争议焦点",
      kind: "case-field",
      source: "disputes",
    },
    {
      id: "opinions",
      heading: "合议庭成员发言",
      kind: "static",
      template:
        "审判长发言：\n\n审判员A发言：\n\n审判员B发言：\n\n陪审员发言（如有）：",
    },
    {
      id: "decision",
      heading: "评议结果",
      kind: "llm",
      prompt:
        "汇总合议庭多数意见，阐述对每一争议焦点的处理意见与法律依据；" +
        "若有少数意见，写明保留意见的成员与主张。不要编造成员姓名。",
    },
    {
      id: "tail",
      heading: "签名栏",
      kind: "static",
      template:
        "审判长（签名）：\n审判员（签名）：\n审判员（签名）：\n人民陪审员（签名）：\n书记员（签名）：",
    },
  ],
}

export const LEGAL_DOC_TEMPLATES: LegalDocTemplate[] = [
  CIVIL_JUDGMENT,
  CIVIL_RULING,
  CIVIL_MEDIATION,
  DIVORCE_JUDGMENT,
  ENFORCEMENT_RULING,
  TRIAL_MINUTES,
  COLLEGIAL_MINUTES,
  SERVICE_RECEIPT,
  DEADLINE_EXTENSION,
  CASE_CLOSE_REPORT,
]

export function findTemplate(id: string): LegalDocTemplate | null {
  return LEGAL_DOC_TEMPLATES.find((t) => t.id === id) ?? null
}
