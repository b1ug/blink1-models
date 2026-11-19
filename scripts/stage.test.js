import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {stageModel} from '../stage.js';

test('staging checks the consumer pin before writing and copies exact model bytes', t => {
  const folder = mkdtempSync(join(tmpdir(), 'blink1-models-'));
  t.after(() => rmSync(folder, {recursive:true, force:true}));
  const target = join(folder, 'mk2');
  assert.throws(() => stageModel(target, '0'.repeat(64)), /manifest SHA/);
  assert.equal(existsSync(target), false);
  const manifestBytes = readFileSync(new URL('../models/mk2/manifest.json', import.meta.url));
  const digest = createHash('sha256').update(manifestBytes).digest('hex');
  const manifest = stageModel(target, digest);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = readFileSync(join(target, name));
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  }
});
