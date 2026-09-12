import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const REPO = 'luvif666-arch/content-wizard';
const BRANCH = 'main';
const ROOT = resolve(import.meta.dirname);
const SKIP = new Set(['.git', 'node_modules', 'dist', '.chrome-profile']);
const MESSAGE = process.argv[2] ?? '更新网站';

function api(args, input) {
  const out = execFileSync('gh', ['api', ...args], {
    input: input ? JSON.stringify(input) : undefined,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out) : null;
}
async function collect(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await collect(full)));
    else if (statSync(full).isFile()) files.push(full);
  }
  return files;
}
const head = api([`repos/${REPO}/git/ref/heads/${BRANCH}`]);
const parent = head.object.sha;
const files = await collect(ROOT);
const tree = [];
for (const f of files) {
  const blob = api(['-X','POST',`repos/${REPO}/git/blobs`,'--input','-'], {
    content: readFileSync(f).toString('base64'), encoding: 'base64',
  });
  tree.push({ path: relative(ROOT, f).replace(/\\/g,'/'), mode: '100644', type: 'blob', sha: blob.sha });
}
const baseCommit = api([`repos/${REPO}/git/commits/${parent}`]);
const newTree = api(['-X','POST',`repos/${REPO}/git/trees`,'--input','-'], { base_tree: baseCommit.tree.sha, tree });
const commit = api(['-X','POST',`repos/${REPO}/git/commits`,'--input','-'], { message: MESSAGE, tree: newTree.sha, parents: [parent] });
api(['-X','PATCH',`repos/${REPO}/git/refs/heads/${BRANCH}`,'--input','-'], { sha: commit.sha });
console.log(`已推送 ${files.length} 个文件：https://github.com/${REPO}/commit/${commit.sha}`);