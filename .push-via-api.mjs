// 通过 GitHub Contents API 逐个推送文件。
// 背景：本机 git over HTTPS 连不上 github.com:443，且空仓库不支持直接创建 blob（HTTP 409），
// 所以改用 contents 接口——它会为每个文件建提交，是空仓库唯一可行的写入方式。

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const REPO = 'luvif666-arch/content-wizard';
const ROOT = resolve(import.meta.dirname);
const SKIP = new Set(['.git', 'node_modules', 'dist', '.chrome-profile']);

function api(args, input) {
  const out = execFileSync('gh', ['api', ...args], {
    input: input ? JSON.stringify(input) : undefined,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.trim() ? JSON.parse(out) : null;
}

async function collect(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (statSync(full).isFile()) files.push(full);
  }
  return files;
}

/** 已存在的文件要先取 sha 才能覆盖 */
function existingSha(path) {
  try {
    return api([`repos/${REPO}/contents/${encodeURI(path)}`])?.sha ?? null;
  } catch {
    return null;
  }
}

const files = await collect(ROOT);
console.log(`待上传文件：${files.length} 个\n`);

let ok = 0;
const failed = [];
for (const [i, file] of files.entries()) {
  const path = relative(ROOT, file).replace(/\\/g, '/');
  const body = {
    message: i === 0 ? '内容创作向导：六步收敛到一份创作简报' : `添加 ${path}`,
    content: readFileSync(file).toString('base64'),
    branch: 'main',
  };
  const sha = existingSha(path);
  if (sha) body.sha = sha;
  try {
    api(['-X', 'PUT', `repos/${REPO}/contents/${encodeURI(path)}`, '--input', '-'], body);
    ok += 1;
    console.log(`  ✓ ${path}`);
  } catch (err) {
    failed.push({ path, err: String(err.stderr ?? err.message).slice(0, 200) });
    console.log(`  ✗ ${path}`);
  }
}

console.log(`\n成功 ${ok} / ${files.length}`);
if (failed.length) {
  console.log('失败清单：');
  for (const f of failed) console.log(`  - ${f.path}\n    ${f.err}`);
  process.exit(1);
}
