import {Signal} from '@angular/core';

/** One unit of speech — for our readers, a paragraph or a sentence. */
export interface SpeakRequest {
  text: string;
  lang?: string | null;
  rate?: number;
  /**
   * Fired as speech advances, with the offset into `text`. Drives the ebook
   * reader's word highlight — and, through it, its auto page-turn.
   */
  onBoundary?: (charIndex: number) => void;
  /** Fired once when the utterance finishes on its own. Never after `stop()`. */
  onEnd?: () => void;
  onError?: (error: string) => void;
}

/** Whether an engine can speak right now. */
export type EngineStatus = 'unavailable' | 'ready';

/**
 * A synthesis backend.
 *
 * Implementations are single-utterance-at-a-time: `speak` replaces whatever was
 * playing. Callers drive the sequence by calling `speak` again from `onEnd`.
 */
export interface SpeechEngine {
  readonly id: 'web-speech';

  readonly status: Signal<EngineStatus>;
  readonly isSpeaking: Signal<boolean>;
  readonly isPaused: Signal<boolean>;

  /** Gets the engine ready to speak, resolving to whether it can. */
  prepare(): Promise<boolean>;

  speak(request: SpeakRequest): void;

  pause(): void;
  resume(): void;

  /** Cancels immediately. `onEnd` of the in-flight utterance will not fire. */
  stop(): void;

  dispose(): void;
}
