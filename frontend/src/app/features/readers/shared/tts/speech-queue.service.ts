import {DestroyRef, Injectable, computed, inject, signal} from '@angular/core';
import {EngineStatus, SpeakRequest, SpeechEngine} from './speech-engine';
import {KokoroEngine} from './kokoro.engine';
import {WebSpeechEngine} from './web-speech.engine';

export type {SpeakRequest, EngineStatus} from './speech-engine';

/**
 * Single-utterance-at-a-time speech, over whichever backend this device can run.
 *
 * Kokoro is preferred — it is a real neural voice, where `speechSynthesis` on
 * Linux is usually espeak-ng — but it needs a ~92MB model, a worker and
 * WebAssembly, so it can legitimately fail. When it does we fall back to
 * `speechSynthesis` rather than leaving the reader with no voice at all.
 *
 * The engine is chosen once per session, on the first `prepare()`.
 */
@Injectable({providedIn: 'root'})
export class SpeechQueueService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly kokoro = inject(KokoroEngine);
  private readonly webSpeech = inject(WebSpeechEngine);

  private readonly _engine = signal<SpeechEngine | null>(null);

  /** Which backend is actually in use, once resolved. */
  readonly engineId = computed(() => this._engine()?.id ?? null);

  /**
   * Whether read-aloud can speak. `loading` while the Kokoro model downloads,
   * which the UI shows rather than looking broken for a minute.
   */
  readonly status = computed<EngineStatus>(() => {
    const engine = this._engine();
    if (engine) {
      return engine.status();
    }
    if (this.preparing()) {
      return 'loading';
    }
    // Before the first prepare(), report what the device could plausibly do.
    return this.webSpeech.status() === 'ready' ? 'ready' : 'unavailable';
  });

  /**
   * True when the chosen engine generates speech slower than it plays, so
   * pauses between chunks are unavoidable on this device.
   */
  readonly cannotKeepUp = computed(
    () => this._engine()?.id === 'kokoro' && this.kokoro.cannotKeepUp(),
  );

  readonly isSpeaking = computed(() => this._engine()?.isSpeaking() ?? false);
  readonly isPaused = computed(() => this._engine()?.isPaused() ?? false);

  private readonly preparing = signal(false);
  private preparePromise: Promise<boolean> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.kokoro.dispose();
      this.webSpeech.dispose();
    });
  }

  /**
   * Picks and readies a backend. Call from a user gesture — Kokoro opens an
   * `AudioContext`, which browsers will not start otherwise.
   */
  async prepare(): Promise<boolean> {
    this.preparePromise ??= this.choose();
    return this.preparePromise;
  }

  private async choose(): Promise<boolean> {
    this.preparing.set(true);
    try {
      if (await this.kokoro.prepare()) {
        this._engine.set(this.kokoro);
        return true;
      }
      if (await this.webSpeech.prepare()) {
        this._engine.set(this.webSpeech);
        return true;
      }
      return false;
    } finally {
      this.preparing.set(false);
    }
  }

  speak(request: SpeakRequest): void {
    const engine = this._engine();
    if (!engine) {
      request.onError?.('no speech engine is ready');
      return;
    }
    engine.speak(request);
  }

  /** Hint that `text` is next, so a synthesising engine can start early. */
  prefetch(text: string, rate?: number): void {
    this._engine()?.prefetch?.(text, rate);
  }

  pause(): void {
    this._engine()?.pause();
  }

  resume(): void {
    this._engine()?.resume();
  }

  /** Cancels immediately. `onEnd` of the in-flight utterance will not fire. */
  stop(): void {
    this._engine()?.stop();
  }
}
