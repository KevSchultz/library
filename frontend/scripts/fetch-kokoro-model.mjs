#!/usr/bin/env node
/**
 * Fetches the Kokoro-82M ONNX weights for local development.
 *
 * The weights are ~92MB, so they are not committed. Production gets them from
 * the `ADD --checksum=` layer in the Dockerfile; `ng serve` has no such step,
 * so run this once after cloning:
 *
 *     pnpm -C frontend run fetch:kokoro
 *
 * Keep MODEL_SHA256 in step with KOKORO_MODEL_CHECKSUM in the Dockerfile --
 * they pin the same file and drifting apart means dev and prod run different
 * weights.
 */
import {createHash} from 'node:crypto';
import {mkdir, rename, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const MODEL_URL =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx';
const MODEL_SHA256 = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'assets', 'kokoro', 'onnx', 'model_quantized.onnx');

async function alreadyCorrect() {
  try {
    await stat(target);
  } catch {
    return false;
  }
  const {readFile} = await import('node:fs/promises');
  const digest = createHash('sha256').update(await readFile(target)).digest('hex');
  if (digest === MODEL_SHA256) {
    return true;
  }
  console.warn(`Existing model has unexpected digest ${digest}; re-downloading.`);
  return false;
}

if (await alreadyCorrect()) {
  console.log(`Kokoro weights already present at ${target}`);
  process.exit(0);
}

console.log(`Downloading Kokoro weights (~92MB) from ${MODEL_URL}`);
const response = await fetch(MODEL_URL);
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== MODEL_SHA256) {
  // Refuse rather than silently shipping unverified weights.
  console.error(`Checksum mismatch.\n  expected ${MODEL_SHA256}\n  actual   ${digest}`);
  process.exit(1);
}

await mkdir(dirname(target), {recursive: true});
// Write then rename so an interrupted run cannot leave a truncated model behind.
const staging = `${target}.partial`;
await writeFile(staging, bytes);
await rename(staging, target);
console.log(`Wrote ${target} (${(bytes.length / 1048576).toFixed(1)}MB)`);
