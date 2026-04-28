import type { TranscriptCaseType, TranscriptPhase, TranscriptSubtypeId } from "@/types/transcript"

export interface TranscriptRuleSet {
  caseType: TranscriptCaseType
  version: string
  summary: string
  phasePriorities: TranscriptPhase[]
  extractionFocus: string[]
  outputFocus: string[]
  mergeFocus: string[]
  checklist: string[]
  promptRules: string[]
}

export interface TranscriptSubtypeRuleSet {
  id: TranscriptSubtypeId
  label: string
  summary: string
  sourceBasis?: string
  elementDefs: Array<{ id: string; label: string; description: string }>
  extractionFocus: string[]
  outputFocus: string[]
  mergeFocus: string[]
  checklist: string[]
  promptRules: string[]
}

export interface ResolvedTranscriptRuleSet extends TranscriptRuleSet {
  subtype?: TranscriptSubtypeRuleSet
}

export const TRANSCRIPT_RULESETS: Record<TranscriptCaseType, TranscriptRuleSet> = {
  刑事: {
    caseType: "刑事",
    version: "2026.04",
    summary: "围绕指控事实、证据链、质证意见、被告人陈述与量刑情节整理庭审内容。",
    phasePriorities: ["举证质证", "法庭辩论", "诉辩意见", "争议焦点", "最后陈述", "程序事项", "其他", "身份查明", "权利义务告知"],
    extractionFocus: [
      "被告人供述与辩解是否前后变化",
      "公诉机关的指控事实、证据编号和证明目的",
      "辩护人的无罪、罪轻、证据瑕疵、程序违法等意见",
      "非法证据排除、证据能力与证明力争议",
      "自首、立功、认罪认罚、退赃退赔等量刑情节",
    ],
    outputFocus: [
      "争议焦点优先围绕指控事实、证据链完整性、证据排除和量刑争议",
      "质证意见要区分控方、辩方、被告人态度",
      "辩论要点突出定罪与量刑的核心分歧",
    ],
    mergeFocus: [
      "识别多次开庭中被告人供述是否变化",
      "识别新的证据、补充质证和新增程序异议",
      "区分定罪争议与量刑争议的演进",
    ],
    checklist: [
      "是否已抓出控辩双方对关键证据的采纳/排除分歧",
      "是否已单列量刑情节，不与定罪事实混写",
      "是否已标注程序性异议、休庭、延期举证等事项",
    ],
    promptRules: [
      "重点关注被告人供述、辩护意见、举证质证、量刑情节与程序性异议。",
      "对程序性宣读、身份核验等内容可以标记为程序事项，但不得删除。",
      "争议焦点优先围绕指控事实、证据链完整性、排除非法证据、罪名与量刑。",
    ],
  },
  民事: {
    caseType: "民事",
    version: "2026.04",
    summary: "围绕诉讼请求、答辩、举证责任、证据三性和裁判要件事实整理庭审内容。",
    phasePriorities: ["诉辩意见", "举证质证", "法庭辩论", "争议焦点", "最后陈述", "程序事项", "其他", "身份查明", "权利义务告知"],
    extractionFocus: [
      "原告诉请、事实依据、金额和履行方式",
      "被告抗辩事由、事实争议和责任承担意见",
      "证据三性争议、补强说明与证明责任分配",
      "合同履行、违约、损失、因果关系等要件事实",
      "是否有调解意向、补充提交材料、庭后核对事项",
    ],
    outputFocus: [
      "争议焦点围绕要件事实和责任承担展开",
      "质证意见突出证据三性与证明目的是否成立",
      "辩论要点要区分诉请成立与抗辩成立两条线",
    ],
    mergeFocus: [
      "识别诉请是否变更、缩减或追加",
      "识别庭后补充证据是否改变举证格局",
      "梳理争议焦点是否从事实争议转向法律适用争议",
    ],
    checklist: [
      "是否已单独写出原告诉请与被告抗辩",
      "是否已突出关键证据的真实性、合法性、关联性争议",
      "是否已记录法庭归纳的争议焦点和庭后补充事项",
    ],
    promptRules: [
      "重点关注诉讼请求、答辩要点、举证责任、证据三性争议与法庭辩论主张。",
      "争议焦点优先围绕要件事实、履行情况、责任承担与证明责任分配。",
      "对身份核验、纪律宣读等内容标记为程序事项，不要混入实体结论。",
    ],
  },
  行政: {
    caseType: "行政",
    version: "2026.04",
    summary: "围绕被诉行政行为、职权依据、程序合法性、事实依据和裁量争议整理庭审内容。",
    phasePriorities: ["诉辩意见", "举证质证", "争议焦点", "法庭辩论", "最后陈述", "程序事项", "其他", "身份查明", "权利义务告知"],
    extractionFocus: [
      "被诉行政行为的内容、时间、送达及作出机关",
      "原告对主体适格、程序违法、事实不清、适法错误的主张",
      "行政机关举证的事实依据、职权依据、程序材料",
      "第三人及代理人对合法性、合理性的补充意见",
      "撤诉、补正、重新作出行政行为等程序走向",
    ],
    outputFocus: [
      "争议焦点优先围绕主体适格、程序合法、事实依据、法律适用、裁量边界",
      "质证意见突出行政机关举证是否充分、原告异议是否具体",
      "辩论要点要区分合法性审查与合理性审查",
    ],
    mergeFocus: [
      "识别行政机关补充提交的程序材料或证据",
      "识别原告是否新增撤销、确认违法、履行等诉请方向",
      "识别争议是否从程序问题转向实体合法性问题",
    ],
    checklist: [
      "是否已单列被诉行政行为及作出机关",
      "是否已把程序合法性和事实依据争议分开整理",
      "是否已记录重新作出、撤诉、补正等程序节点",
    ],
    promptRules: [
      "重点关注被诉行政行为、主体适格、职权依据、程序合法性、事实依据与裁量争议。",
      "争议焦点优先围绕行政行为是否合法、程序是否完备、证据是否充分。",
      "行政机关、原告、第三人的发言要尽量区分角色，不得混淆。",
    ],
  },
}

export const TRANSCRIPT_SUBTYPE_RULESETS: Record<TranscriptCaseType, TranscriptSubtypeRuleSet[]> = {
  刑事: [],
  民事: [
    {
      id: "loan-dispute",
      label: "民间借贷纠纷",
      summary: "重点整理借贷合意、实际交付款项、利息约定、还款情况与抗辩事由。",
      sourceBasis: "依据最高人民法院、司法部、中华全国律师协会联合发布的部分案件民事起诉状、答辩状示范文本（首批 11 类）之民间借贷纠纷要素化结构。",
      elementDefs: [
        { id: "loan-intent", label: "借贷合意", description: "借条、聊天、口头约定等体现借贷关系成立的内容" },
        { id: "delivery", label: "实际交付", description: "本金交付方式、时间、金额和凭证" },
        { id: "interest-repayment", label: "利息与还款", description: "利息约定、还款记录、抵扣和逾期情况" },
      ],
      extractionFocus: [
        "借条、转账记录、聊天记录中的借贷合意",
        "本金、利息、还款节点、逾期和催收情况",
        "被告对借款性质、金额、利率、还款的抗辩",
      ],
      outputFocus: [
        "争议焦点围绕借贷关系是否成立、本金数额、利息和还款抵扣",
      ],
      mergeFocus: [
        "识别是否新增转账、收条、还款流水等关键证据",
      ],
      checklist: [
        "是否已区分借贷合意与实际交付",
        "是否已核对利息、违约金和还款抵扣顺序",
      ],
      promptRules: [
        "对借贷合意、交付、还款、利息计算的争议要分别整理。",
      ],
    },
    {
      id: "sale-contract",
      label: "买卖合同纠纷",
      summary: "重点整理合同约定、交货/验收、付款、质量瑕疵与违约责任。",
      sourceBasis: "依据最高人民法院、司法部、中华全国律师协会联合发布的部分案件民事起诉状、答辩状示范文本（首批 11 类）之买卖合同纠纷要素化结构。",
      elementDefs: [
        { id: "contract-terms", label: "合同约定", description: "标的、数量、价款、交付与验收条款" },
        { id: "performance-payment", label: "履行与付款", description: "交货、签收、对账、开票和付款情况" },
        { id: "quality-breach", label: "质量与违约", description: "质量异议、违约事实、损失与责任承担" },
      ],
      extractionFocus: [
        "合同标的、数量、价款、交付和验收约定",
        "付款节点、发票、对账单、签收单和往来记录",
        "质量异议、逾期交付、违约责任和损失主张",
      ],
      outputFocus: [
        "争议焦点围绕履行情况、质量责任、付款义务和违约责任",
      ],
      mergeFocus: [
        "识别验收、质量鉴定、对账结果是否新增变化",
      ],
      checklist: [
        "是否已区分交付、验收、付款三条事实线",
      ],
      promptRules: [
        "对质量异议和付款抗辩要分别提炼，避免混写。",
      ],
    },
    {
      id: "marriage-family",
      label: "离婚纠纷",
      summary: "重点整理婚姻关系、感情破裂、子女抚养、共同财产债务和过错事实。",
      sourceBasis: "依据最高人民法院、司法部、中华全国律师协会联合发布的部分案件民事起诉状、答辩状示范文本（首批 11 类）之离婚纠纷要素化结构。",
      elementDefs: [
        { id: "relationship-breakdown", label: "感情破裂事实", description: "婚姻基础、分居、冲突、和好可能性等" },
        { id: "children-custody", label: "子女抚养", description: "抚养安排、抚养费、探望和未成年子女情况" },
        { id: "property-fault", label: "财产与过错", description: "共同财产债务、家庭暴力、出轨或其他过错事实" },
      ],
      extractionFocus: [
        "婚姻基础、感情破裂事实、分居时间",
        "共同财产、共同债务、子女抚养与探望安排",
        "家庭暴力、出轨、过错、调解意向",
      ],
      outputFocus: [
        "争议焦点围绕离婚条件、子女抚养、财产分割与过错认定",
      ],
      mergeFocus: [
        "识别调解方案、抚养方案、财产范围是否发生变化",
      ],
      checklist: [
        "是否已把感情破裂事实与财产、抚养问题分开整理",
      ],
      promptRules: [
        "对子女抚养、财产分割、过错事实要分项输出。",
      ],
    },
  ],
  行政: [],
}

export function getTranscriptRuleSet(caseType: TranscriptCaseType): TranscriptRuleSet {
  return TRANSCRIPT_RULESETS[caseType]
}

export function getTranscriptSubtypeOptions(caseType: TranscriptCaseType): TranscriptSubtypeRuleSet[] {
  return TRANSCRIPT_SUBTYPE_RULESETS[caseType] ?? []
}

export function getTranscriptSubtypeRule(
  caseType: TranscriptCaseType,
  subtypeId?: TranscriptSubtypeId
): TranscriptSubtypeRuleSet | undefined {
  if (!subtypeId) return undefined
  return getTranscriptSubtypeOptions(caseType).find((item) => item.id === subtypeId)
}

function mergeUnique(base: string[], extra?: string[]): string[] {
  return [...new Set([...(base || []), ...(extra || [])])]
}

export function resolveTranscriptRuleSet(
  caseType: TranscriptCaseType,
  subtypeId?: TranscriptSubtypeId
): ResolvedTranscriptRuleSet {
  const base = getTranscriptRuleSet(caseType)
  const subtype = getTranscriptSubtypeRule(caseType, subtypeId)
  if (!subtype) return base
  return {
    ...base,
    summary: `${base.summary} 当前子类型：${subtype.label}。${subtype.summary}`,
    extractionFocus: mergeUnique(base.extractionFocus, subtype.extractionFocus),
    outputFocus: mergeUnique(base.outputFocus, subtype.outputFocus),
    mergeFocus: mergeUnique(base.mergeFocus, subtype.mergeFocus),
    checklist: mergeUnique(base.checklist, subtype.checklist),
    promptRules: mergeUnique(base.promptRules, subtype.promptRules),
    subtype,
  }
}
