import {DestroyRef, Injectable, computed, inject} from '@angular/core';
import {EngineStatus, SpeakRequest} from './speech-engine';
import {WebSpeechEngine} from './web-speech.engine';

export type {SpeakRequest, EngineStatus} from './speech-engine';

/**
 * Single-utterance-at-a-time speech over the device's own voices.
 *
 * Kept as a façade in front of `WebSpeechEngine` so the PDF and ebook readers
 * never touch `speechSynthesis` — or a `SpeechSynthesisVoice` — directly.
 */
@Injectable({providedIn: 'root'})
export class SpeechQueueService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly engine = inject(WebSpeechEngine);

  /** Whether read-aloud can speak. */
  readonly status = computed<EngineStatus>(() => this.engine.status());

  readonly isSpeaking = computed(() => this.engine.isSpeaking());
  readonly isPaused = computed(() => this.engine.isPaused());

  constructor() {
    this.destroyRef.onDestroy(() => this.engine.dispose());
  }

  /** Readies the backend, resolving to whether it can speak. */
  async prepare(): Promise<boolean> {
    return this.engine.prepare();
  }

  speak(request: SpeakRequest): void {
    this.engine.speak(request);
  }

  pause(): void {
    this.engine.pause();
  }

  resume(): void {
    this.engine.resume();
  }

  /** Cancels immediately. `onEnd` of the in-flight utterance will not fire. */
  stop(): void {
    this.engine.stop();
  }
}
