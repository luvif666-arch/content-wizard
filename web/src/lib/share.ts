// 分享链接：把向导状态编码进 URL hash，纯前端、不经过任何服务端。
// 注意：只编码重建流程所需的字段，不包含 API Key。

import { emptyState } from '../types';
import type { WizardState } from '../types';

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : '';
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildShareUrl(state: WizardState): string {
  const payload = {
    v: 1,
    audience: state.audience,
    topic: state.topic,
    subject: state.subject,
    angle: state.angle,
    title: state.title,
    expression: state.expression,
  };
  const encoded = b64encode(JSON.stringify(payload));
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#s=${encoded}`;
}

/** 从当前 URL 读取分享状态。任何解析失败都返回 null，让调用方走全新草稿。 */
export function readSharedState(): WizardState | null {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const raw = params.get('s');
    if (!raw) return null;
    const parsed = JSON.parse(b64decode(raw)) as Partial<WizardState> & { v?: number };
    const base = emptyState();
    return {
      audience: parsed.audience ?? base.audience,
      topic: parsed.topic ?? base.topic,
      subject: parsed.subject ?? base.subject,
      angle: parsed.angle ?? base.angle,
      title: parsed.title ?? base.title,
      expression: parsed.expression ?? base.expression,
    };
  } catch {
    return null;
  }
}
