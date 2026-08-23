import {Injectable, NgZone, computed, inject, signal} from '@angular/core';
import {EngineStatus, SpeakRequest, SpeechEngine} from './speech-engine';
import type {KokoroRuntimeInfo, KokoroWorkerRequest, KokoroWorkerResponse} from './kokoro.worker';

/**
 * How long to wait with *no progress at all* before giving up.
 *
 * Deliberately not a total budget: the first load fetches ~92MB, which over a
 * slow LAN link can legitimately take many minutes. A fixed overall deadline
 * used to abort those loads and silently drop to the fallback engine.
 */
const INIT_STALL_TIMEOUT_MS = 90_000;

/**
 * Minimum spacing between synthesized boundary callbacks. Word rate in normal
 * speech is roughly 2-3/sec, so this is comfortably finer than needed while
 * keeping us far below one change-detection pass per animation frame.
 */
const BOUNDARY_INTERVAL_MS = 80;

/**
 * Cap on synthesised-but-unplayed audio, to bound memory on long reads.
 * Must stay comfortably above the callers' lookahead depth or entries get
 * evicted before they are played and have to be generated twice.
 */
const MAX_PREFETCHED = 8;

/** How many chunks ahead callers should generate. See `LOOKAHEAD` use sites. */
export const LOOKAHEAD = 2;

/**
 * Real-time factor above which playback cannot stay ahead of synthesis.
 *
 * Slightly under 1 rather than at it: at exactly 1 the buffer never refills
 * after the first hiccup. Above this the reader will pause between chunks no
 * matter how deep the lookahead, because audio is consumed faster than it is
 * produced -- so we say so instead of stuttering silently.
 */
const SUSTAINABLE_RTF = 0.9;

interface AudioChunk {
  pcm: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

/**
 * Kokoro-82M backend: real neural TTS, synthesised in-browser.
 *
 * Two things distinguish it from the Web Speech backend, and both are the
 * reason this class is not just a thin wrapper:
 *
 * 1. Synthesis is not instant. If we only started generating a sentence when
 *    the caller asked for it, every sentence boundary would carry an audible
 *    gap. `prefetch` lets callers generate the next sentence during the
 *    current one, and playback is scheduled through Web Audio so consecutive
 *    buffers butt up against each other.
 * 2. Kokoro reports no word boundaries. The ebook reader's highlight — and,
 *    through `ttsSetMark`, its auto page-turn — depends on them, so we
 *    synthesise them from playback position: speech rate is near-uniform
 *    within a sentence, so charIndex tracks elapsed/duration closely enough.
 */
@Injectable({providedIn: 'root'})
export class KokoroEngine implements SpeechEngine {
  readonly id = 'kokoro' as const;

  private readonly zone = inject(NgZone);

  private readonly _isSpeaking = signal(false);
  private readonly _isPaused = signal(false);
  readonly isSpeaking = this._isSpeaking.asReadonly();
  readonly isPaused = this._isPaused.asReadonly();

  private readonly _status = signal<EngineStatus>('unavailable');
  readonly status = this._status.asReadonly();

  private worker: Worker | null = null;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  private initPromise: Promise<boolean> | null = null;

  /** Bumped on every stop/speak so stale audio and timers can be ignored. */
  private generation = 0;
  private nextRequestId = 1;

  /** In-flight and completed synthesis, keyed by rate+text. */
  private readonly pending = new Map<string, Promise<AudioChunk>>();
  private readonly resolvers = new Map<number, {
    resolve: (chunk: AudioChunk) => void;
    reject: (error: Error) => void;
    key: string;
  }>();

  private boundaryTimer: ReturnType<typeof setInterval> | null = null;

  /** How the worker ended up running; surfaced for diagnosing slow playback. */
  private runtime: KokoroRuntimeInfo | null = null;

  private readonly _realTimeFactor = signal<number | null>(null);
  /**
   * Seconds of synthesis per second of audio, from the most recent chunk.
   * Above 1 means this device cannot generate speech as fast as it plays it.
   */
  readonly realTimeFactor = this._realTimeFactor.asReadonly();

  /** True once we know this device cannot keep up. Latches; never un-sets. */
  readonly cannotKeepUp = computed(() => {
    const rtf = this._realTimeFactor();
    return rtf !== null && rtf > SUSTAINABLE_RTF;
  });

  async prepare(): Promise<boolean> {
    this.initPromise ??= this.doPrepare();
    return this.initPromise;
  }

  private async doPrepare(): Promise<boolean> {
    if (typeof Worker === 'undefined' || typeof AudioContext === 'undefined') {
      this._status.set('unavailable');
      return false;
    }

    this._status.set('loading');
    try {
      // Must happen while we still have the user gesture that got us here.
      this.context = new AudioContext();
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      // A real URL, not a blob: the PDF reader replaces window.Worker while it
      // is open and injects a synthetic "ready" into blob-backed module workers.
      const worker = new Worker(new URL('./kokoro.worker', import.meta.url), {type: 'module'});
      this.worker = worker;
      worker.addEventListener('message', event => this.onWorkerMessage(event));

      const ready = new Promise<boolean>((resolve, reject) => {
        let timer = setTimeout(onStall, INIT_STALL_TIMEOUT_MS);
        function onStall(): void {
          reject(new Error('the Kokoro model stopped loading'));
        }
        function restartStallTimer(): void {
          clearTimeout(timer);
          timer = setTimeout(onStall, INIT_STALL_TIMEOUT_MS);
        }
        const onMessage = (event: MessageEvent<KokoroWorkerResponse>) => {
          if (event.data.type === 'progress') {
            // Still moving: restart the stall clock rather than counting down
            // against a slow but healthy download.
            restartStallTimer();
            return;
          }
          if (event.data.type === 'ready') {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            this.runtime = event.data.runtime;
            if (!event.data.runtime.crossOriginIsolated) {
              console.warn(
                '[kokoro] page is not cross-origin isolated, so ONNX Runtime is '
                + 'limited to a single thread and synthesis will be several times '
                + 'slower. Cross-origin isolation needs a secure context: use '
                + 'https:// or http://localhost, not a plain-http LAN address.',
              );
            } else {
              console.info(`[kokoro] ready, ${event.data.runtime.threads} wasm threads`);
            }
            resolve(true);
          } else if (event.data.type === 'initError') {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            reject(new Error(event.data.error));
          }
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', event => {
          clearTimeout(timer);
          reject(new Error(event.message || 'Kokoro worker failed to start'));
        });
      });

      this.post({type: 'init'});
      await ready;
      this._status.set('ready');
      return true;
    } catch (error) {
      console.warn('[kokoro] unavailable, falling back', error);
      this._status.set('unavailable');
      this.teardownWorker();
      return false;
    }
  }

  speak(request: SpeakRequest): void {
    const text = request.text.trim();
    if (!text) {
      // Nothing to say; report completion so callers keep moving.
      request.onEnd?.();
      return;
    }
    if (this._status() !== 'ready') {
      request.onError?.('Kokoro is not ready');
      return;
    }

    const generation = this.beginGeneration();
    const rate = request.rate ?? 1;

    this._isSpeaking.set(true);
    this._isPaused.set(false);

    this.synthesize(text, rate).then(
      chunk => {
        if (generation !== this.generation) {
          return;
        }
        void this.play(chunk, text, request, generation);
      },
      (error: Error) => {
        if (generation !== this.generation) {
          return;
        }
        this.zone.run(() => {
          this._isSpeaking.set(false);
          request.onError?.(error.message);
        });
      },
    );
  }

  /** Start generating `text` now so a later `speak` can begin without a gap. */
  prefetch(text: string, rate = 1): void {
    const trimmed = text.trim();
    if (!trimmed || this._status() !== 'ready') {
      return;
    }
    // Errors here are not actionable — `speak` will surface them if it comes to
    // that — but they must be swallowed or they become unhandled rejections.
    void this.synthesize(trimmed, rate).catch(() => undefined);
  }

  private synthesize(text: string, rate: number): Promise<AudioChunk> {
    const key = `${rate}|${text}`;
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    const startedAt = performance.now();
    const id = this.nextRequestId++;
    const promise = new Promise<AudioChunk>((resolve, reject) => {
      this.resolvers.set(id, {resolve, reject, key});
    }).then(chunk => {
      const generated = (performance.now() - startedAt) / 1000;
      const played = chunk.pcm.length / chunk.sampleRate;
      if (played > 0) {
        this._realTimeFactor.set(generated / played);
      }
      return chunk;
    });
    this.pending.set(key, promise);

    // Oldest-first eviction; the entry being awaited is re-added by its caller
    // if it is still needed.
    if (this.pending.size > MAX_PREFETCHED) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined && oldest !== key) {
        this.pending.delete(oldest);
      }
    }

    this.post({type: 'synthesize', id, text, speed: rate});
    return promise;
  }

  private async play(
    chunk: AudioChunk,
    text: string,
    request: SpeakRequest,
    generation: number,
  ): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }

    // Browsers suspend an AudioContext when the tab is backgrounded or idle.
    // Starting a source on a suspended context produces silence *and* never
    // fires `onended`, which strands the reader mid-page with no error.
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        // Left suspended: report rather than hanging silently.
      }
      if (generation !== this.generation) {
        return;
      }
      if (context.state === 'suspended') {
        this.zone.run(() => {
          this._isSpeaking.set(false);
          request.onError?.('audio playback is blocked until you interact with the page');
        });
        return;
      }
    }

    const buffer = context.createBuffer(1, chunk.pcm.length, chunk.sampleRate);
    buffer.copyToChannel(chunk.pcm, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    this.stopSource();
    this.source = source;

    const startedAt = context.currentTime;
    const duration = buffer.duration;

    source.onended = () => {
      if (generation !== this.generation) {
        return;
      }
      this.stopBoundaryTimer();
      this.zone.run(() => {
        this._isSpeaking.set(false);
        this._isPaused.set(false);
        request.onEnd?.();
      });
    };

    source.start();
    if (request.onBoundary) {
      this.startBoundaryTimer(request.onBoundary, text.length, startedAt, duration, generation);
    }
  }

  /**
   * Emits an estimated charIndex as playback advances.
   *
   * Runs outside Angular — it ticks several times a second for the whole
   * session — and re-enters only to deliver each callback.
   */
  private startBoundaryTimer(
    onBoundary: (charIndex: number) => void,
    textLength: number,
    startedAt: number,
    duration: number,
    generation: number,
  ): void {
    this.stopBoundaryTimer();
    if (duration <= 0) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      let last = -1;
      this.boundaryTimer = setInterval(() => {
        const context = this.context;
        if (!context || generation !== this.generation) {
          this.stopBoundaryTimer();
          return;
        }
        const elapsed = context.currentTime - startedAt;
        const progress = Math.min(1, Math.max(0, elapsed / duration));
        const charIndex = Math.min(textLength - 1, Math.floor(progress * textLength));
        if (charIndex === last) {
          return;
        }
        last = charIndex;
        this.zone.run(() => onBoundary(charIndex));
      }, BOUNDARY_INTERVAL_MS);
    });
  }

  private stopBoundaryTimer(): void {
    if (this.boundaryTimer !== null) {
      clearInterval(this.boundaryTimer);
      this.boundaryTimer = null;
    }
  }

  pause(): void {
    if (!this.context || !this._isSpeaking() || this._isPaused()) {
      return;
    }
    void this.context.suspend();
    this._isPaused.set(true);
  }

  resume(): void {
    if (!this.context || !this._isPaused()) {
      return;
    }
    void this.context.resume();
    this._isPaused.set(false);
  }

  stop(): void {
    this.beginGeneration();
    this.stopBoundaryTimer();
    this.stopSource();
    // Abandon anything the worker is still generating for the old generation.
    for (const [id] of this.resolvers) {
      this.post({type: 'drop', id});
    }
    this.resolvers.clear();
    this.pending.clear();
    this._isSpeaking.set(false);
    this._isPaused.set(false);
  }

  dispose(): void {
    this.stop();
    this.teardownWorker();
    void this.context?.close();
    this.context = null;
    this._status.set('unavailable');
    this.initPromise = null;
  }

  private stopSource(): void {
    if (!this.source) {
      return;
    }
    this.source.onended = null;
    try {
      this.source.stop();
    } catch {
      // Already stopped, or never started. Nothing to undo.
    }
    this.source.disconnect();
    this.source = null;
  }

  private teardownWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private post(message: KokoroWorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private onWorkerMessage(event: MessageEvent<KokoroWorkerResponse>): void {
    const message = event.data;
    if (message.type === 'audio') {
      const entry = this.resolvers.get(message.id);
      if (!entry) {
        return;
      }
      this.resolvers.delete(message.id);
      entry.resolve({pcm: message.pcm, sampleRate: message.sampleRate});
      return;
    }
    if (message.type === 'synthesizeError') {
      const entry = this.resolvers.get(message.id);
      if (!entry) {
        return;
      }
      this.resolvers.delete(message.id);
      this.pending.delete(entry.key);
      entry.reject(new Error(message.error));
    }
  }
}
