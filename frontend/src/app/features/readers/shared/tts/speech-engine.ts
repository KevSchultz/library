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

/**
 * Whether an engine can speak right now.
 *
 * `loading` exists for Kokoro: the model is ~92MB, so there is a real window
 * between "the user pressed Read Aloud" and "audio can start" that the UI has
 * to be able to show. The Web Speech engine goes straight to `ready`.
 */
export type EngineStatus = 'unavailable' | 'loading' | 'ready';

/**
 * A synthesis backend.
 *
 * Implementations are single-utterance-at-a-time: `speak` replaces whatever was
 * playing. Callers drive the sequence by calling `speak` again from `onEnd`.
 */
export interface SpeechEngine {
  readonly id: 'kokoro' | 'web-speech';

  readonly status: Signal<EngineStatus>;
  readonly isSpeaking: Signal<boolean>;
  readonly isPaused: Signal<boolean>;

  /**
   * Gets the engine ready to speak, resolving to whether it can.
   *
   * Must be called from a user gesture: the Kokoro engine opens an
   * `AudioContext`, which browsers refuse to start otherwise.
   */
  prepare(): Promise<boolean>;

  speak(request: SpeakRequest): void;

  /**
   * Hint that `text` is likely to be spoken next, so an engine that has to
   * synthesise can start now rather than at `speak` time. Free to ignore.
   */
  prefetch?(text: string, rate?: number): void;

  pause(): void;
  resume(): void;

  /** Cancels immediately. `onEnd` of the in-flight utterance will not fire. */
  stop(): void;

  dispose(): void;
}
