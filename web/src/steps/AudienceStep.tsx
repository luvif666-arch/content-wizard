import { useState } from 'react';
import { AUDIENCE_PRESETS } from '../presets';
import type { AudienceAnswer } from '../types';
import StepQuote from './StepQuote';

interface Props {
  value: AudienceAnswer | null;
  onChange: (v: AudienceAnswer) => void;
}

/** 第 1 步：关系。单选预设，或自己描述；选中后展示这个选择意味着什么语境。 */
export default function AudienceStep({ value, onChange }: Props) {
  const [custom, setCustom] = useState(value?.id === 'custom' ? value.label : '');
  const isCustom = value?.id === 'custom';
  const done = !!value && value.label !== '（待填写）';

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 1 步 · 关系</div>
        <h1>这条内容是给谁看的？</h1>
      </div>

      {/* 定位卡片：交代整套向导的参照系，并说明答案都用第二人称，避免用户倒推「我」指谁。
          刻意只讲这个类比，不剧透后面的步骤和结论。 */}
      <div className="orient">
        <p className="orient-lead">这套向导只做一件事：把「做内容」当成「跟一个人聊天」。</p>
        <p>
          就像你跟一个刚认识的人吃饭——先看对面坐着谁，再找双方都能接上的话题，然后挑他正在经历的事聊，
          并按照他已经知道多少，决定从哪句话接下去。
        </p>
        <p className="orient-perspective">
          <strong>你的位置：</strong>你是创作者，你在跟「读者」讲话。
          所以下面每个选项都是在描述<strong>他会怎么接收你的内容</strong>，
          选项里的「你」指你本人，句子开头都是「他」——不必再倒推是谁的视角。
        </p>
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

      {done && <StepQuote step="audience" />}
    </div>
  );
}
