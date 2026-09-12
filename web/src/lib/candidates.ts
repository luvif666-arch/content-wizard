// 「候选依据」的公共判定：什么情况下这一步的旧选择必须作废清空。
//
// 这里要守住一条容易混掉的界线：
//   待确认（stale）：用户已经确认过这一步，但上游动了 —— 保留他的答案，让他决定要不要沿用；
//   作废清空（invalid）：这一步的候选本身已经换了一批 —— 旧答案连参照物都没了，留着只会误导。
// 前者是现有行为，不能弄丢；后者是这次要补上的。
//
// 判定方式：给每一批候选记一个「依据」（上游里真正影响这批文案的字段）。
// 依据对不上时，再看旧选择的文案是否还在当前候选里——还在就说明选择仍然成立（老草稿补记依据即可），
// 不在就说明参照物没了，必须清空，并把「为什么清空」说清楚。

/** 一批候选的生成依据：字段名 → 取值。字段名用于给用户解释是哪一项变了 */
export type BasisFields = Record<string, string>;

/** 归因顺序：越靠前的越可能是用户真正改的那一项 */
const FIELD_ORDER = ['subject', 'topic', 'angle', 'title', 'structure', 'audience', 'model'];

const FIELD_LABEL: Record<string, string> = {
  subject: '选题变了',
  topic: '话题变了',
  angle: '切入点变了',
  title: '标题变了',
  structure: '正文结构变了',
  audience: '受众变了',
  model: '生成候选的设置变了',
};

export function basisKeyOf(fields: BasisFields): string {
  return JSON.stringify(fields);
}

/**
 * 描述依据变在哪。
 * 老草稿（或导入的数据）没有记过依据时返回 null，由调用方改用不带归因的说法，
 * 不能硬猜一个原因，否则就是在编。
 */
export function describeBasisChange(oldKey: string | undefined, next: BasisFields): string | null {
  if (!oldKey) return null;
  let old: BasisFields;
  try {
    const parsed = JSON.parse(oldKey) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    old = parsed as BasisFields;
  } catch {
    return null;
  }
  const changed = FIELD_ORDER.filter((k) => k in next && (old[k] ?? '') !== next[k]);
  if (!changed.length) return null;
  return Array.from(new Set(changed.map((k) => FIELD_LABEL[k] ?? '上游变了'))).join('、');
}

/** 拼一句给用户看的原因。清空必须带原因，不能静默发生。 */
export function clearReason(layer: string, cause: string | null): string {
  return cause
    ? `${cause}，原来的${layer}已经不适用，已清空，请重新选。`
    : `上游的内容改了，原来的${layer}已经不适用，已清空，请重新选。`;
}

/** 这条旧选择还认得出参照物吗：候选中必须存在同 id 且文案一致的条目 */
export function optionStillOffered<T extends { id: string; text: string }>(option: T, options: T[]): boolean {
  return options.some((o) => o.id === option.id && o.text === option.text);
}
