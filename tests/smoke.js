'use strict';

/**
 * Lightweight smoke checks for DotMD main-process modules.
 * Run: node tests/smoke.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const meta = require('../lib/meta');
const { readDirectory } = require('../lib/folder');
const { mapPool, chunkArray } = require('../lib/util');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotmd-smoke-'));

function fakeApp(userData) {
  return {
    getPath(name) {
      if (name === 'userData') return userData;
      throw new Error(`Unexpected path: ${name}`);
    },
  };
}

async function main() {
  const userData = path.join(tmpRoot, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  meta.initMeta(fakeApp(userData));

  assert.strictEqual(meta.isMarkdownFile('notes.md'), true);
  assert.strictEqual(meta.isMarkdownFile('notes.txt'), false);
  assert.strictEqual(meta.ensureMarkdownExtension('Hello'), 'Hello.md');
  assert.strictEqual(meta.ensureMarkdownExtension('Hello.md'), 'Hello.md');

  const normalized = meta.normalizeFileMeta({ tags: [' a ', 'a', '', 1], pinned: 1 });
  assert.deepStrictEqual(normalized.tags, ['a']);
  assert.strictEqual(normalized.pinned, true);

  const folder = path.join(tmpRoot, 'notes');
  fs.mkdirSync(folder);
  const files = [];
  for (let i = 0; i < 25; i += 1) {
    const name = `file-${String(i).padStart(2, '0')}.md`;
    const filePath = path.join(folder, name);
    fs.writeFileSync(filePath, `# ${name}\n`, 'utf-8');
    files.push(filePath);
  }
  fs.writeFileSync(path.join(folder, 'ignore.txt'), 'nope', 'utf-8');
  fs.writeFileSync(path.join(folder, '.hidden.md'), 'secret', 'utf-8');

  await meta.writeFileMeta(files[0], { tags: ['smoke'], pinned: true });
  const metaRead = await meta.readFileMeta(files[0]);
  assert.deepStrictEqual(metaRead.tags, ['smoke']);
  assert.strictEqual(metaRead.pinned, true);

  const items = await readDirectory(folder);
  assert.strictEqual(items.length, 25, 'should list only markdown files');
  assert.ok(items.every((item) => item.type === 'file'));
  const pinned = items.find((item) => item.path === files[0]);
  assert.ok(pinned);
  assert.strictEqual(pinned.pinned, true);
  assert.deepStrictEqual(pinned.tags, ['smoke']);

  // Second scan should hit the mtime meta cache path.
  const again = await readDirectory(folder);
  assert.strictEqual(again.length, 25);

  const pooled = await mapPool([1, 2, 3, 4], 2, async (n) => n * 2);
  assert.deepStrictEqual(pooled, [2, 4, 6, 8]);
  assert.deepStrictEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

  const unique = await meta.uniqueFilePath(folder, 'Unnamed.md');
  assert.ok(unique.endsWith('Unnamed.md'));
  fs.writeFileSync(unique, '', 'utf-8');
  const unique2 = await meta.uniqueFilePath(folder, 'Unnamed.md');
  assert.ok(unique2.includes('Unnamed-2') || unique2.includes('Unnamed-'));

  console.log('smoke: ok');
}

main()
  .catch((err) => {
    console.error('smoke: failed');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });
