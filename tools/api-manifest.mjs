import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sourceRevision = process.env.GITHUB_SHA;
if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) throw new Error('Full checked source revision required');
const files = [];
for (const path of ['index.js', 'index.js.map']) {
  const bytes = await readFile(`server-dist/${path}`);
  files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile('server-dist/api-manifest.json', JSON.stringify({ sourceRevision, nodeTarget: 22, files }, null, 2) + '\n');
