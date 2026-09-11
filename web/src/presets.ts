// 内置预设库与规则模板。
// 设计要求：没有 API Key、甚至完全断网时，全部候选都由这里生成，向导必须能走完。

export interface PresetOption {
  id: string;
  label: string;
  hint: string;
  implies: string;
}

/** 第 1 步：受众预设 */
export const AUDIENCE_PRESETS: PresetOption[] = [
  {
    id: 'stranger',
    label: '完全陌生的人',
    hint: '对我和我的领域一无所知',
    implies: '需要从头建立语境，不能跳步，也不要假设他知道任何背景。',
  },
  {
    id: 'follower',
    label: '已关注我的人',
    hint: '知道我是谁，愿意听我说',
    implies: '可以直接进入观点，不必再铺垫身份和资历。',
  },
  {
    id: 'peers',
    label: '同行的从业者',
    hint: '有共同背景和经验',
    implies: '可以省略基础概念，直接讨论分歧点和判断依据。',
  },
  {
    id: 'customers',
    label: '潜在客户 / 有具体需求的人',
    hint: '带着问题来找答案',
    implies: '以解决问题为优先，少讲情怀，多给可执行的判断。',
  },
  {
    id: 'friends',
    label: '熟人 / 朋友',
    hint: '关系亲近，接受口语化表达',
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
