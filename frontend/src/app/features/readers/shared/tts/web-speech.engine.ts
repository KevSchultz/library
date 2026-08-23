import {Injectable, NgZone, inject, signal} from '@angular/core';
import {EngineStatus, SpeakRequest, SpeechEngine} from './speech-engine';
import {SpeechVoiceService} from './speech-voice.service';

/**
 * Chromium silently stops synthesising after roughly 15 seconds of continuous
 * speech. Toggling pause/resume on a timer keeps it alive. This is a real,
 * long-standing bug (crbug.com/679437) — without this a long paragraph simply
 * cuts off mid-sentence with no error.
 */
const KEEPALIVE_INTERVAL_MS = 10_000;

function isChromium(): boolean {
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg/.test(ua) && !/Firefox/.test(ua);
}

/**
 * `window.speechSynthesis` backend — the fallback when Kokoro cannot run.
 *
 * Owns the two things that make the raw API awkward: the Chromium cutoff above,
 * and the fact that `cancel()` still fires `end` on the utterance it killed —
 * which, left unguarded, makes a caller think the block finished normally and
 * advance to the next one.
 *
 * Voice selection lives here rather than in `SpeakRequest` so callers never
 * have to hold a `SpeechSynthesisVoice`, which the Kokoro engine has no notion of.
 */
@Injectable({providedIn: 'root'})
export class WebSpeechEngine implements SpeechEngine {
  readonly id = 'web-speech' as const;

  private readonly zone = inject(NgZone);
  private readonly voiceService = inject(SpeechVoiceService);

  private readonly _isSpeaking = signal(false);
  private readonly _isPaused = signal(false);
  readonly isSpeaking = this._isSpeaking.asReadonly();
  readonly isPaused = this._isPaused.asReadonly();

  private readonly _status = signal<EngineStatus>(
    typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
      ? 'ready'
      : 'unavailable',
  );
  readonly status = this._status.asReadonly();

  /** Bumped on every stop/speak so stale events from `cancel()` can be ignored. */
  private generation = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  async prepare(): Promise<boolean> {
    if (this._status() === 'unavailable') {
      return false;
    }
    this.voiceService.load();
    return true;
  }

  speak(request: SpeakRequest): void {
    if (this._status() === 'unavailable') {
      request.onError?.('speechSynthesis is not available in this browser');
      return;
    }

    const text = request.text.trim();
    if (!text) {
      // Nothing to say; report completion so callers keep moving.
      request.onEnd?.();
      return;
    }

    const generation = this.beginGeneration();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.voiceService.resolveVoice(request.lang ?? null);
    if (voice) {
      utterance.voice = voice;
      // Safari mis-selects the voice unless lang agrees with it.
      utterance.lang = voice.lang;
    } else if (request.lang) {
      utterance.lang = request.lang;
    }
    if (request.rate !== undefined) {
      utterance.rate = request.rate;
    }

    utterance.onboundary = event => {
      if (generation !== this.generation) {
        return;
      }
      // Some engines emit sentence boundaries too; both carry a usable charIndex.
      this.zone.run(() => request.onBoundary?.(event.charIndex));
    };

    utterance.onend = () => {
      if (generation !== this.generation) {
        return;
      }
      this.stopKeepalive();
      this.zone.run(() => {
        this._isSpeaking.set(false);
        this._isPaused.set(false);
        request.onEnd?.();
      });
    };

    utterance.onerror = event => {
      if (generation !== this.generation) {
        return;
      }
      this.stopKeepalive();
      // `cancel()` surfaces as an "interrupted"/"canceled" error on some engines;
      // that is our own doing, not a failure worth reporting.
      const reason = event.error;
      const selfInflicted = reason === 'interrupted' || reason === 'canceled';
      this.zone.run(() => {
        this._isSpeaking.set(false);
        this._isPaused.set(false);
        if (!selfInflicted) {
          request.onError?.(reason);
        }
      });
    };

    this._isSpeaking.set(true);
    this._isPaused.set(false);
    window.speechSynthesis.speak(utterance);
    this.startKeepalive();
  }

  pause(): void {
    if (this._status() === 'unavailable' || !this._isSpeaking()) {
      return;
    }
    this.stopKeepalive();
    window.speechSynthesis.pause();
    this._isPaused.set(true);
  }

  resume(): void {
    if (this._status() === 'unavailable' || !this._isPaused()) {
      return;
    }
    window.speechSynthesis.resume();
    this._isPaused.set(false);
    this.startKeepalive();
  }

  stop(): void {
    if (this._status() === 'unavailable') {
      return;
    }
    this.beginGeneration();
    this.stopKeepalive();
    window.speechSynthesis.cancel();
    this._isSpeaking.set(false);
    this._isPaused.set(false);
  }

  dispose(): void {
    this.stop();
  }

  private beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    if (!isChromium()) {
      return;
    }
    // Outside Angular: this fires every 10s for the whole session and would
    // otherwise trigger change detection for no reason.
    this.zone.runOutsideAngular(() => {
      this.keepaliveTimer = setInterval(() => {
        if (!this._isSpeaking() || this._isPaused()) {
          return;
        }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, KEEPALIVE_INTERVAL_MS);
    });
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
