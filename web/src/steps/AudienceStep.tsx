import { useState } from 'react';
import { AUDIENCE_PRESETS } from '../presets';
import type { AudienceAnswer } from '../types';

interface Props {
  value: AudienceAnswer | null;
  onChange: (v: AudienceAnswer) => void;
}

/** 第 1 步：关系。单选预设，或自己描述；选中后展示这个选择意味着什么语境。 */
export default function AudienceStep({ value, onChange }: Props) {
  const [custom, setCustom] = useState(value?.id === 'custom' ? value.label : '');
  const isCustom = value?.id === 'custom';

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 1 步 · 关系</div>
        <h1>这条内容是给谁看的？</h1>
        <p className="lede">先想清楚你对面坐着谁，再想好这次要跟他聊什么，文章就开始有方向了。</p>
        <p className="quote">你跟一个刚认识的人吃饭，会先抿一下你们大概能打成什么关系。</p>
      </div>

      <div className="option-list">
        {AUDIENCE_PRESETS.map((p) => {
          const selected = value?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`option${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange({ id: p.id, label: p.label, implies: p.implies })}
            >
              <span className="option-label">
                <span className="check" aria-hidden="true" />
                {p.label}
              </span>
              <span className="option-hint">{p.hint}</span>
              {selected && <span className="option-implies">意味着：{p.implies}</span>}
            </button>
          );
        })}

        <button
          type="button"
          className={`option${isCustom ? ' selected' : ''}`}
          aria-pressed={isCustom}
          onClick={() =>
            onChange({
              id: 'custom',
              label: custom.trim() || '（待填写）',
              implies: '按你自己描述的语境来写，向导不会替你假设背景。',
            })
          }
        >
          <span className="option-label">
            <span className="check" aria-hidden="true" />
            其他（我自己描述）
          </span>
          <span className="option-hint">用一句话说清他是谁</span>
        </button>
      </div>

      {isCustom && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="audience-custom">他是谁？</label>
          <input
            id="audience-custom"
            type="text"
            value={custom}
            placeholder="例：刚工作两年、想转行但不敢动的设计师"
            onChange={(e) => {
              setCustom(e.target.value);
              onChange({
                id: 'custom',
                label: e.target.value.trim() || '（待填写）',
                implies: '按你自己描述的语境来写，向导不会替你假设背景。',
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
