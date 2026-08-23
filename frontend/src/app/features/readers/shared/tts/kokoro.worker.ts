//
// Kokoro-82M synthesis, off the UI thread.
//
// Everything here is deliberately self-hosted: `kokoro-js` and the transformers
// runtime both reach for a CDN by default, which would break a LAN-only server.
// See `configureOffline()` below — the three settings there are the difference
// between working offline and silently depending on the internet.

import type {KokoroTTS} from 'kokoro-js';

/** Request messages, main thread -> worker. */
export type KokoroWorkerRequest =
  | {type: 'init'}
  | {type: 'synthesize'; id: number; text: string; speed: number}
  | {type: 'drop'; id: number};

/** How the model ended up running, for diagnosing "why is this slow". */
export interface KokoroRuntimeInfo {
  /** WASM threads in use. 1 means no cross-origin isolation. */
  threads: number;
  /** False on plain-HTTP LAN origins, which forces single-threaded inference. */
  crossOriginIsolated: boolean;
}

/** Response messages, worker -> main thread. */
export type KokoroWorkerResponse =
  | {type: 'ready'; runtime: KokoroRuntimeInfo}
  | {type: 'progress'; loaded: number; total: number}
  | {type: 'initError'; error: string}
  | {type: 'audio'; id: number; pcm: Float32Array<ArrayBuffer>; sampleRate: number}
  | {type: 'synthesizeError'; id: number; error: string};

/** Where the model, the voice pack and the ORT wasm are served from. */
const MODEL_ID = 'kokoro';
const LOCAL_MODEL_ROOT = '/assets/';
const ORT_WASM_PATH = '/assets/onnxruntime/';
const VOICE_ASSET_URL = '/assets/kokoro/voices/af_heart.bin';

/**
 * kokoro-js hardcodes this URL for voice packs and has no option to change it.
 * It checks the `kokoro-voices` Cache Storage bucket first though, so seeding
 * that bucket with our own copy under the same key keeps it off the network
 * without patching the library.
 */
const VOICE_CACHE_NAME = 'kokoro-voices';
const VOICE_UPSTREAM_URL =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';

/** The only voice we ship. Kokoro's best-graded voice. */
const VOICE = 'af_heart';

/**
 * Upper bound on WASM threads.
 *
 * Measured on a 4-core i5-7500: real-time factor was 3.10 at one thread, 2.68
 * at two, and 2.74 at four -- i.e. this model barely parallelises, and past two
 * threads there is nothing to gain and a busy UI thread to lose. We still ask
 * for one more than ORT's own `min(4, ceil(cores/2))` heuristic on larger
 * machines, but deliberately leave a core free.
 */
const MAX_WASM_THREADS = 4;

/**
 * The worker's own globals, declared locally.
 *
 * A `/// <reference lib="webworker" />` would add the worker lib to the entire
 * TypeScript program, which changes what `addEventListener` means in ordinary
 * app and test files. Naming just the two globals this file uses keeps that
 * contained.
 */
const ctx = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<KokoroWorkerRequest>) => void,
  ): void;
  postMessage(message: KokoroWorkerResponse, transfer?: Transferable[]): void;
  crossOriginIsolated?: boolean;
  navigator?: {hardwareConcurrency?: number};
};

let tts: KokoroTTS | null = null;

/**
 * Points every remote default at our own origin.
 *
 * Without this the worker fetches ~92MB of weights from huggingface.co and the
 * ORT wasm from cdn.jsdelivr.net on first use.
 */
async function configureOffline(): Promise<KokoroRuntimeInfo> {
  const {env} = await import('@huggingface/transformers');

  // Resolve `MODEL_ID` against /assets/ instead of the Hub.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = LOCAL_MODEL_ROOT;

  const isolated = ctx.crossOriginIsolated === true;
  const cores = ctx.navigator?.hardwareConcurrency ?? 1;

  // ORT hard-forces 1 thread when the page is not cross-origin isolated, which
  // needs a secure context -- plain http:// on a LAN IP never qualifies, however
  // the COOP/COEP headers are set. Leave one core for the UI.
  const threads = isolated ? Math.max(1, Math.min(cores - 1, MAX_WASM_THREADS)) : 1;

  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = ORT_WASM_PATH;
    wasm.numThreads = threads;
    // We are already on a worker thread; ORT's own proxy worker would add a
    // second hop, and it is blob-backed, which the PDF reader's global Worker
    // patch injects a spurious "ready" message into.
    wasm.proxy = false;
  }

  return {threads, crossOriginIsolated: isolated};
}

/**
 * Copies the bundled voice pack into the cache kokoro-js reads, under the
 * upstream URL it looks for. No-op if it is already there.
 */
async function seedVoiceCache(): Promise<void> {
  if (typeof caches === 'undefined') {
    return;
  }
  try {
    const cache = await caches.open(VOICE_CACHE_NAME);
    if (await cache.match(VOICE_UPSTREAM_URL)) {
      return;
    }
    const response = await fetch(VOICE_ASSET_URL);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    await cache.put(VOICE_UPSTREAM_URL, response);
  } catch (error) {
    // Not fatal on its own: kokoro-js will try the network next. It only
    // matters offline, where init fails right after with a clearer error.
    console.warn('[kokoro] could not seed voice cache', error);
  }
}

async function init(): Promise<KokoroRuntimeInfo> {
  const runtime = await configureOffline();
  await seedVoiceCache();

  const {KokoroTTS: Kokoro} = await import('kokoro-js');
  tts = await Kokoro.from_pretrained(MODEL_ID, {
    // q8 rather than q8f16: fp16 support is inconsistent across wasm builds.
    dtype: 'q8',
    device: 'wasm',
    // Lets the main thread show real progress, and proves the load is moving
    // rather than hung, which matters most on the slow first fetch.
    progress_callback: (progress: {status: string; loaded?: number; total?: number}) => {
      if (progress.status === 'progress' && progress.total) {
        ctx.postMessage({
          type: 'progress',
          loaded: progress.loaded ?? 0,
          total: progress.total,
        });
      }
    },
  });

  return runtime;
}

/**
 * Ids the main thread has abandoned. A stop can land while a synthesis is
 * already running, and there is no way to cancel one mid-flight — so we finish
 * it and drop the result rather than posting audio nobody wants to hear.
 */
const dropped = new Set<number>();

async function synthesize(id: number, text: string, speed: number): Promise<void> {
  if (!tts) {
    throw new Error('model not initialised');
  }
  const audio = await tts.generate(text, {voice: VOICE, speed});
  if (dropped.has(id)) {
    dropped.delete(id);
    return;
  }
  // Copy into a plain ArrayBuffer: the runtime may hand back a SharedArrayBuffer
  // view, which is neither transferable nor accepted by copyToChannel. The
  // memcpy is nothing next to the inference that just produced it.
  const pcm = new Float32Array(audio.audio);
  const message: KokoroWorkerResponse = {
    type: 'audio',
    id,
    pcm,
    sampleRate: audio.sampling_rate,
  };
  // Transfer rather than copy: a minute of speech is several MB.
  ctx.postMessage(message, [pcm.buffer]);
}

/** One synthesis at a time, so requests queue instead of thrashing the runtime. */
let chain: Promise<void> = Promise.resolve();

ctx.addEventListener('message', event => {
  const message = event.data;

  if (message.type === 'init') {
    chain = chain.then(async () => {
      try {
        const runtime = await init();
        ctx.postMessage({type: 'ready', runtime});
      } catch (error) {
        ctx.postMessage({
          type: 'initError',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return;
  }

  if (message.type === 'drop') {
    dropped.add(message.id);
    return;
  }

  if (message.type === 'synthesize') {
    const {id, text, speed} = message;
    chain = chain.then(async () => {
      if (dropped.has(id)) {
        dropped.delete(id);
        return;
      }
      try {
        await synthesize(id, text, speed);
      } catch (error) {
        ctx.postMessage({
          type: 'synthesizeError',
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
});
