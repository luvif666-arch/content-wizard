import { useMemo, useState } from 'react';
import { buildBrief, copyText, download, slugify, toJson, toMarkdown, toPrompt } from '../lib/export';
import { describeImport, parseImportedState } from '../lib/import';
import { buildShareUrl } from '../lib/share';
import type { WizardState } from '../types';

interface Props {
  state: WizardState;
  /** 新建一份草稿：当前这份不会被清掉，会留在草稿箱里 */
  onNewDraft: () => void;
  onBack: () => void;
  onToast: (msg: string) => void;
  onImport: (state: WizardState) => void;
}

type Tab = 'brief' | 'prompt' | 'json';

const TAB_META: Record<Tab, { label: string; file: string; mime: string; copied: string }> = {
  brief: { label: '简报 Markdown', file: 'md', mime: 'text/markdown', copied: 'Markdown' },
  prompt: { label: '发给 Agent 的提示词', file: 'prompt.txt', mime: 'text/plain', copied: '提示词' },
  json: { label: '结构化 JSON', file: 'json', mime: 'application/json', copied: 'JSON' },
};

/** 最终输出：一屏创作简报 + 随当前格式切换的导出动作 */
export default function BriefView({ state, onNewDraft, onBack, onToast, onImport }: Props) {
  const [tab, setTab] = useState<Tab>('brief');
  const [importOpen, setImportOpen] = useState(false);
  const brief = useMemo(() => buildBrief(state), [state]);
  const markdown = useMemo(() => toMarkdown(state), [state]);
  const prompt = useMemo(() => toPrompt(state), [state]);
  const json = useMemo(() => toJson(state), [state]);

  const tabContent = tab === 'brief' ? markdown : tab === 'prompt' ? prompt : json;
  const meta = TAB_META[tab];

  async function handleCopy(text: string, label: string) {
    const ok = await copyText(text);
    onToast(ok ? `${label}已复制` : '复制失败，请手动选中文本');
  }

  async function handleShare() {
    const url = buildShareUrl(state);
    window.history.replaceState(null, '', url);
    const ok = await copyText(url);
    onToast(ok ? '分享链接已复制（已写入地址栏）' : '链接已写入地址栏，请手动复制');
  }

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">创作简报</div>
        <h1>{brief.title}</h1>
        <p className="lede">
          六个决定都已经定下来了。这份简报可以直接交给任何 AI，也可以导出留档；它不含成稿，成稿交给下一步。
        </p>
      </div>

      <div className="panel">
        {brief.sections.map((s) => (
          <div className="brief-section" key={s.layer}>
            <h3>{s.layer}</h3>
            <p className="q">{s.question}</p>
            <ul className="brief-lines">
              {s.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {(s.groups ?? []).map((g, gi) => (
              <div className="brief-group" key={gi}>
                {g.title && <p className="brief-group-title">{g.title}</p>}
                <ul className="brief-lines">
                  {g.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>导出</h2>
      <p className="lede" style={{ marginBottom: 10 }}>
        三种承载形式内容同源，用途不同：Markdown 留档与编辑，提示词直接发给 AI，JSON 给程序读。
      </p>
      <div className="tabs" role="tablist">
        {(Object.keys(TAB_META) as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
          >
            {TAB_META[k].label}
          </button>
        ))}
      </div>
      <pre className="raw">{tabContent}</pre>

      {/* 动作跟着当前格式走：预览哪个，就复制/下载哪个，避免按钮数量翻倍 */}
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => void handleCopy(tabContent, meta.copied)}>
          复制这份{meta.copied}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            download(
              `${slugify(brief.title)}.${meta.file}`,
              tabContent,
              meta.mime,
            )
          }
        >
          下载为文件
        </button>
        {tab === 'json' && (
          <button type="button" className="btn" onClick={() => setImportOpen(true)}>
            从 JSON 恢复
          </button>
        )}
        <button type="button" className="btn" onClick={() => void handleShare()}>
          分享链接
        </button>
      </div>

      {tab === 'json' && (
        <p className="lede" style={{ marginTop: 10 }}>
          JSON 是给程序读的结构化快照，不是给人读的版式；想继续编辑这份简报，用「从 JSON 恢复」把它粘回来。
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={onBack}>
          回去改上一步
        </button>
        <button type="button" className="btn ghost" onClick={onNewDraft}>
          新建一份草稿（这份留在草稿箱）
        </button>
      </div>

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImport={(next, note) => {
            onImport(next);
            setImportOpen(false);
            onToast(note);
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (state: WizardState, note: string) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleImport() {
    const result = parseImportedState(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImport(result.state, describeImport(result.state));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="从 JSON 恢复" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>从 JSON 恢复</h2>
        <p className="lede">
          把之前用「下载为文件」或「复制这份结构化 JSON」得到的 JSON 粘进来，就能接着改。
          恢复的内容会覆盖<strong>当前打开的这份草稿</strong>，草稿箱里的其它草稿不受影响。
        </p>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="import-json">粘贴 JSON</label>
          <textarea
            id="import-json"
            value={text}
            placeholder='{"schema":"content-wizard/brief@1", ...}'
            style={{ minHeight: 160, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13 }}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn primary" onClick={handleImport} disabled={!text.trim()}>
            恢复并继续编辑
          </button>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
