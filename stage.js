import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copy the verified mk2 source files to a consumer-owned staging directory. */
export function stageModel(destination, manifestSha256) {
  const model = fileURLToPath(new URL('./models/mk2/', import.meta.url));
  const raw = readFileSync(join(model, 'manifest.json'));
  if (sha256(raw) !== manifestSha256) throw new Error('Incorrect mk2 manifest SHA-256');
  const manifest = JSON.parse(raw);
  if (manifest.schema !== 'blink1-model/v1' || manifest.model !== 'mk2') {
    throw new Error('Unsupported model manifest');
  }
  const payload = Object.entries(manifest.files).map(([name, expected]) => {
    if (!name.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part))) {
      throw new Error('Invalid model filename');
    }
    const data = readFileSync(join(model, name));
    if (data.length !== expected.bytes || sha256(data) !== expected.sha256) {
      throw new Error('Incorrect model file: ' + name);
    }
    return [name, data];
  });
  for (const [name, data] of payload) {
    const path = join(destination, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, data);
  }
  return manifest;
}
