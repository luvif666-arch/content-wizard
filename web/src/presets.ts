// 内置预设库与规则模板。
// 设计要求：没有 API Key、甚至完全断网时，全部候选都由这里生成，向导必须能走完。

export interface PresetOption {
  id: string;
  label: string;
  hint: string;
  implies: string;
}

/** 第 1 步：受众预设。文案统一用第二人称，避免用户倒推「我」指谁 */
export const AUDIENCE_PRESETS: PresetOption[] = [
  {
    id: 'stranger',
    label: '完全陌生的人',
    hint: '他对你和你做的事一无所知',
    implies: '需要从头建立语境，不能跳步，也不要假设他知道任何背景。',
  },
  {
    id: 'follower',
    label: '已关注我的人',
    hint: '他知道你是谁，也愿意听你说',
    implies: '可以直接进入观点，不必再铺垫身份和资历。',
  },
  {
    id: 'peers',
    label: '同行的从业者',
    hint: '你们有共同背景和经验',
    implies: '可以省略基础概念，直接讨论分歧点和判断依据。',
  },
  {
    id: 'customers',
    label: '潜在客户 / 有具体需求的人',
    hint: '他带着问题来找答案',
    implies: '以解决问题为优先，少讲情怀，多给可执行的判断。',
  },
  {
    id: 'friends',
    label: '熟人 / 朋友',
    hint: '你们关系亲近，他接受口语化表达',
    implies: '可以用内部梗和更松弛的语气，不必端着。',
  },
];

/** 第 2 步：大类话题 → 子话题 的预设映射表（优先于模型） */
export const TOPIC_PRESET_MAP: Record<string, string[]> = {
  情感: ['约会', '暧昧期', '长期关系', '分手与复合', '婚姻磨合', '如何认识一个人'],
  恋爱: ['约会', '暧昧期', '长期关系', '分手与复合', '婚姻磨合', '如何认识一个人'],
  职场: ['求职', '转行', '晋升', '汇报与沟通', '副业', '和老板相处'],
  职涯: ['求职', '转行', '晋升', '汇报与沟通', '副业', '和老板相处'],
  AI: ['工具选型', '提示词写法', '工作流自动化', 'AI 对岗位的影响', '学习路径', '常见误区'],
  人工智能: ['工具选型', '提示词写法', '工作流自动化', 'AI 对岗位的影响', '学习路径', '常见误区'],
  健康: ['睡眠', '饮食结构', '运动习惯', '情绪管理', '体检解读', '久坐问题'],
  消费: ['品牌选择', '性价比判断', '踩坑复盘', '情绪消费', '收纳整理', '送礼'],
  自媒体: ['起号', '选题方法', '涨粉', '变现', '内容复盘', '账号定位'],
  内容创作: ['选题方法', '标题写法', '切入点', '内容复盘', '创作节奏', '素材积累'],
  写作: ['选题', '结构', '开头', '修改', '素材积累', '写作习惯'],
  理财: ['记账', '储蓄', '基金定投', '风险识别', '收入结构', '大额支出'],
  育儿: ['睡眠', '喂养', '情绪引导', '亲子沟通', '入园适应', '习惯培养'],
  教育: ['学习方法', '专注力', '亲子沟通', '升学选择', '兴趣培养', '考试焦虑'],
};

/** 没命中预设表时，用这些通用后缀拼出可用的子话题候选，保证不出现空白 */
const GENERIC_SUFFIXES = ['的入门', '的常见误区', '的真实成本', '的第一步', '的长期影响', '的选择标准'];

export function normalizeKey(input: string): string {
  return input.trim().replace(/[\s\u3000]+/g, '').toLowerCase();
}

/**
 * 返回子话题候选。命中预设表时直接用，否则按通用模板推导。
 * 无论哪条路径，都保证返回 3–6 条非空候选。
 */
export function presetSubtopics(big: string): string[] {
  const raw = big.trim();
  if (!raw) return [];
  const key = normalizeKey(raw);
  const direct =
    TOPIC_PRESET_MAP[key] ??
    Object.entries(TOPIC_PRESET_MAP).find(([k]) => normalizeKey(k) === key)?.[1] ??
    Object.entries(TOPIC_PRESET_MAP).find(([k]) => {
      const nk = normalizeKey(k);
      return key.length >= 2 && (nk.includes(key) || key.includes(nk));
    })?.[1];
  if (direct) return direct;
  return GENERIC_SUFFIXES.map((s) => `${raw}${s}`);
}

/** 第 3 步：「具体的人」预设 */
export const WHO_PRESETS: Array<Omit<PresetOption, 'implies'>> = [
  { id: 'first-timer', label: '第一次做这件事的人', hint: '担心做错、不知道该准备什么' },
  { id: 'stuck', label: '做过很多次却一直卡住的人', hint: '想搞清楚为什么总停在同一阶段' },
  { id: 'deciding', label: '正在做选择、拿不定主意的人', hint: '需要判断依据，而不是更多信息' },
  { id: 'doubting', label: '已经做了但结果不好、在怀疑自己的人', hint: '需要解释原因和修正方向' },
  { id: 'custom', label: '其他（我自己描述）', hint: '用一句话说清他的处境' },
];

/** 第 3 步：从选题自动推导「这次不讲什么」 */
export function buildFilterList(subjectWhat: string, subs: string[]): { skip: string[]; must: string[] } {
  const scope = subs.length ? subs.join('、') : '这个话题';
  return {
    skip: [
      `与「${subjectWhat}」无关的周边知识：属于${scope}的其他分支，这一篇不展开。`,
      '只有正确但没有信息量的常识：读者已经默认知道的部分不再重复。',
      '需要长期相处、长期积累才能谈的部分：留给后续内容。',
    ],
    must: [
      `让读者看完能回答一句话：${subjectWhat}`,
      '至少一个他能立刻用上的具体判断或动作。',
    ],
  };
}

/** 第 4 步：切入点类型 */
export interface AngleTypeDef {
  id: string;
  label: string;
  /** 模板里 {noun} 会被替换成选题的领域名词 */
  template: string;
}

export const ANGLE_TYPES: AngleTypeDef[] = [
  { id: 'scene', label: '具体场景', template: '从一个最常见的具体场景开始：讲「{noun}」时，大多数人第一步会做什么、卡在哪。' },
  { id: 'misconception', label: '普遍误区', template: '从一个人人都信但其实是错的做法开始：越努力做某件事，结果反而越差。' },
  { id: 'cost', label: '一次踩坑', template: '从一次真实踩坑开始：看起来准备得很充分，最后还是没得到想要的结果。' },
  { id: 'comparison', label: '两类人对比', template: '从两类人的对比开始：一类总是做不成，另一类很轻松，差别不在努力程度。' },
  { id: 'tiny-detail', label: '极小细节', template: '从一个极小但决定成败的细节开始：一个几乎没人注意的选择，直接改变了结果。' },
  { id: 'timepoint', label: '一个时间点', template: '从一个具体的时间点或收尾动作开始：事情结束之后，那个决定性的动作做没做。' },
];

/** 第 5 步：标题句式模板 */
export interface TitleFormulaDef {
  id: string;
  kind: string;
  text: (noun: string) => string;
  reason: (audience: string) => string;
}

export const TITLE_FORMULAS: TitleFormulaDef[] = [
  {
    id: 'question',
    kind: '问题式',
    text: (noun) => `${noun}，到底应该怎么选？`,
    reason: (audience) =>
      `问题式把${audience}正在做的那次选择直接摆出来，他一看就知道这句跟自己有关，会想看你怎么给判断。`,
  },
  {
    id: 'judgement',
    kind: '判断式',
    text: (noun) => `${noun}，先把它变成一个能好好开始的地方。`,
    reason: (audience) =>
      `判断式先给结论，${audience}会带着「凭什么」的疑问点进来，正文负责解释为什么。`,
  },
  {
    id: 'resonance',
    kind: '共鸣式',
    text: (noun) => `准备得很认真，${noun}最后还是没成。`,
    reason: (audience) =>
      `共鸣式从一个容易代入的失败经历切入，${audience}会想知道问题到底出在哪一步。`,
  },
];

/** 第 6 步：默认表达结构 */
export const DEFAULT_SECTIONS = [
  { id: 'scene', label: '场景', role: '让对方先认出现象' },
  { id: 'explain', label: '解释', role: '回答为什么值得在意' },
  { id: 'advice', label: '具体建议', role: '让对方下次做决定时用得上' },
];

/** 第 6 步：体裁追问 */
export const FORMAT_FOLLOW_UPS: Record<string, string[]> = {
  text: [],
  video: ['哪些地方需要画面演示？', '哪些段落可以剪短？'],
  carousel: ['哪几页各承担一个信息点？', '哪一页必须放在第一张？'],
};

/**
 * 从选题里抽出可复用的「领域名词」，用于拼接切入点与标题模板。
 * 规则：去掉句末标点，若句子里有逗号/句号，取最后一个分句。
 */
export function extractNoun(subjectWhat: string, subs: string[]): string {
  let s = subjectWhat.trim().replace(/[。！？!?；;，,、\s]+$/g, '');
  if (!s) return subs[0] ?? '这件事';
  const parts = s.split(/[，,。；;]/).map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? s;
  const candidate = last.length >= 4 && last.length <= 18 ? last : s;
  return candidate.length > 26 ? `${candidate.slice(0, 24)}…` : candidate;
}

/* ------------------------------------------------------------------ *
 * 第 3 步的「灵感示例」
 * 目的：抽象的处境类型给不出具体的人和事，用户在这一步最容易卡住。
 * 示例的作用是启发，不是替用户决定——点选后仍可随意修改。
 * ------------------------------------------------------------------ */

export interface Inspiration {
  id: string;
  /** 处境类型，用于回填「具体的人」 */
  whoLabel: string;
  /** 这个人的具体问题，一句话，用于回填「具体的事」 */
  what: string;
  /**
   * 这一条的来源。区分「内置库」和「模板推导」很重要：
   * 前者是预先写好的成稿文案，后者是用话题 + 通用句式现拼的。
   * 把拼出来的说成内置的，就是在夸大准确度。
   */
  source: 'preset' | 'template' | 'model' | 'search';
}

/** 内置库：成稿文案，只针对这些话题，不做模板替换 */
export const INSPIRATION_LIBRARY: Record<string, Array<{ whoLabel: string; what: string }>> = {
  约会: [
    { whoLabel: '第一次见网友的人', what: '马上要第一次见网友，不知道该准备什么，怕全程冷场。' },
    { whoLabel: '约过很多次却进不了关系的人', what: '见了不少人，每次聊得还行，但关系始终停在第一次见面。' },
    { whoLabel: '在选地点上拿不定主意的人', what: '餐厅挑了半天，既怕太吵聊不起来，又怕太正式让人紧张。' },
  ],
  暧昧期: [
    { whoLabel: '分不清对方有没有兴趣的人', what: '每天都有来有回，但一提到确定关系对方就转移话题。' },
    { whoLabel: '怕自己先动心的人', what: '想推进又怕显得急，忍着不主动，结果两个人都停在原地。' },
  ],
  长期关系: [
    { whoLabel: '在一起久了没话说的人', what: '住在一起，日常都正常，但已经很久没有真正聊过一件事。' },
  ],
  转行: [
    { whoLabel: '想转行但不敢动的人', what: '已经想了两年，简历改过好几版，始终没投出去。' },
    { whoLabel: '转了一次又退回原行业的人', what: '真的转了，发现新行业和想象的不一样，现在不知道该不该回头。' },
  ],
  育儿: [
    { whoLabel: '被各路建议搞晕的新手父母', what: '家里长辈和网上说的完全相反，不知道听谁的。' },
  ],
};

/** 内置库的 key 按长度降序，保证「长期关系」优先于「关系」这类包含关系 */
const LIBRARY_KEYS = Object.keys(INSPIRATION_LIBRARY).sort((a, b) => b.length - a.length);

/** 找到与当前话题相关的内置文案：子话题和子串都要匹配 */
export function lookupLibrary(subs: string[], big: string): Array<{ whoLabel: string; what: string }> {
  const haystack = [...subs, big].filter(Boolean);
  for (const key of LIBRARY_KEYS) {
    if (haystack.some((h) => h.includes(key))) return INSPIRATION_LIBRARY[key];
  }
  return [];
}

/** 张力类型：让示例「看得出问题」，而不是泛泛的类型标签 */
interface TensionPattern {
  id: string;
  whoLabel: string;
  /** {a} 是领域名词（子话题），{b} 是大方向 */
  template: string;
}

export const INSPIRATION_PATTERNS: TensionPattern[] = [
  {
    id: 'first-time',
    whoLabel: '第一次做这件事的人',
    template: '马上要第一次认真面对「{a}」，不知道从哪下手，怕一上来就选错方向。',
  },
  {
    id: 'stuck-repeat',
    whoLabel: '做过很多次却一直卡住的人',
    template: '在「{a}」上已经试过好几轮，每次都在同一个地方停住，想不通卡在哪。',
  },
  {
    id: 'decision-paralysis',
    whoLabel: '正在做选择、拿不定主意的人',
    template: '面前有几个「{a}」的做法，各有各的道理，需要判断依据而不是更多建议。',
  },
  {
    id: 'gap-expectation',
    whoLabel: '已经做了但结果不好、在怀疑自己的人',
    template: '照着普遍说法做了「{a}」，结果和别人说的完全不一样，开始怀疑是不是自己哪里错了。',
  },
  {
    id: 'minority-need',
    whoLabel: '有特殊处境、主流建议都不适用的人',
    template: '在「{a}」这件事上，他的条件（时间／预算／家庭状况）跟主流建议都对不上，找不到能参考的说法。',
  },
  {
    id: 'information-gap',
    whoLabel: '信息不对称、怕被坑的人',
    template: '关于「{a}」的信息又碎又互相矛盾，他没法判断谁说得对，也怕踩坑。',
  },
];

/**
 * 用当前话题把张力模板实例化成具体的人和事。
 * 这是「模板推导」路径：不依赖任何接口，覆盖任意话题，永远给得出示例。
 * 内置库命中时优先用成稿文案，其余用模板拼——两条路径的 source 不同，界面上要分开标。
 * 这里返回全量候选（≥4 条），由调用方决定展示几条、怎么轮换。
 */
export function presetInspirations(topic: TopicAnswerLike | null): Inspiration[] {
  const a = pickDomainNoun(topic);
  const library = lookupLibrary(topic?.subs ?? [], topic?.big ?? '');

  const fromLibrary: Inspiration[] = library.map((item, i) => ({
    id: `lib-${i}`,
    whoLabel: item.whoLabel,
    what: item.what,
    source: 'preset',
  }));

  const usedLabels = new Set(fromLibrary.map((x) => x.whoLabel));
  const fromTemplate: Inspiration[] = INSPIRATION_PATTERNS.filter((p) => !usedLabels.has(p.whoLabel)).map(
    (p, i) => ({
      id: `tpl-${i}`,
      whoLabel: p.whoLabel,
      what: p.template.replace(/\{a\}/g, a),
      source: 'template',
    }),
  );

  return [...fromLibrary, ...fromTemplate];
}

/** 一批示例的整体来源：只要有一条来自内置成稿文案，就算「内置预设」，否则是「模板推导」 */
export function batchSource(items: Inspiration[]): 'preset' | 'template' {
  return items.some((x) => x.source === 'preset') ? 'preset' : 'template';
}

interface TopicAnswerLike {
  big: string;
  subs: string[];
}

/** 取一个适合塞进句子的领域名词：优先用最具体的子话题，其次用大方向 */
export function pickDomainNoun(topic: TopicAnswerLike | null): string {
  if (!topic) return '这件事';
  const sub = topic.subs[topic.subs.length - 1]?.trim();
  if (sub) return sub;
  return topic.big.trim() || '这件事';
}

