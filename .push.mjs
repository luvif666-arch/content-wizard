// 用一个提交推送整个工作区：通过 GitHub Git Data API 建 blob → tree → commit → 更新分支。
// 背景：本机 git over HTTPS 连不上 github.com:443，只能走 gh 的 API 通道。
// 仓库非空后，blobs/trees/commits 接口可用，所以能做成单个提交而不是逐文件提交。

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const REPO = 'luvif666-arch/content-wizard';
const BRANCH = 'main';
const ROOT = resolve(import.meta.dirname);
const SKIP = new Set(['.git', 'node_modules', 'dist', '.chrome-profile']);

const MESSAGE = process.argv[2] ?? '更新网站';
const DELETE = process.argv.slice(3).filter((a) => !a.startsWith('--'));

function api(args, input) {
  const out = execFileSync('gh', ['api', ...args], {
    input: input ? JSON.stringify(input) : undefined,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out) : null;
}

/**
 * 上传 blob。
 * 不能把 base64 放进命令行参数：二进制文件（截图）编码后会超出 Windows 的参数长度上限，
 * 表现为 spawn 直接失败（pid 0、status null）。所以统一走 stdin。
 */
function putBlob(content) {
  return api(['-X', 'POST', `repos/${REPO}/git/blobs`, '--input', '-'], {
    content,
    encoding: 'base64',
  });
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

const head = api([`repos/${REPO}/git/ref/heads/${BRANCH}`]);
const baseTree = head.object.sha;
console.log(`父提交：${baseTree}`);

const files = await collect(ROOT);
console.log(`待上传：${files.length} 个文件`);

const tree = [];
for (const file of files) {
  const path = relative(ROOT, file).replace(/\\/g, '/');
  const content = readFileSync(file).toString('base64');
  const blob = putBlob(content);
  tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
}
// 已删除的文件用 sha:null 表示移除
for (const path of DELETE) {
  tree.push({ path, mode: '100644', type: 'blob', sha: null });
  console.log(`  删除 ${path}`);
}
console.log(`blob 就绪：${tree.length} 项`);

const baseCommit = api([`repos/${REPO}/git/commits/${baseTree}`]);
const newTree = api(['-X', 'POST', `repos/${REPO}/git/trees`, '--input', '-'], {
  base_tree: baseCommit.tree.sha,
  tree,
});
console.log(`tree：${newTree.sha}`);

const commit = api(['-X', 'POST', `repos/${REPO}/git/commits`, '--input', '-'], {
  message: MESSAGE,
  tree: newTree.sha,
  parents: [baseTree],
});
console.log(`commit：${commit.sha}`);

api(['-X', 'PATCH', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--input', '-'], { sha: commit.sha });
console.log(`\n已推送：https://github.com/${REPO}/commit/${commit.sha}`);
