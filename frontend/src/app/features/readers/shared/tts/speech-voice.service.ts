import {Injectable, computed, signal} from '@angular/core';
import {lacksHighQualityVoice, pickBestVoice, rankVoices} from './voice-ranking.util';

const STORAGE_KEY = 'grimmory.readAloud.preferences';

const RATE_MIN = 0.5;
// Past 2x most platform voices stop being intelligible, and several clamp there
// anyway rather than honouring the value.
const RATE_MAX = 2;
const DEFAULT_RATE = 1;

interface StoredPreferences {
  voiceURI?: string;
  rate?: number;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return DEFAULT_RATE;
  }
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

/**
 * Owns voice discovery and the user's read-aloud preferences.
 *
 * Voice discovery is asynchronous in a way the API does not make obvious:
 * `getVoices()` returns an empty array on first call in Chromium and only fills
 * in once `voiceschanged` fires, so anything that reads voices eagerly at
 * startup sees nothing.
 */
@Injectable({providedIn: 'root'})
export class SpeechVoiceService {
  readonly isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  private readonly _voices = signal<SpeechSynthesisVoice[]>([]);
  readonly voices = this._voices.asReadonly();

  private readonly _selectedVoiceURI = signal<string | null>(null);
  readonly selectedVoiceURI = this._selectedVoiceURI.asReadonly();

  private readonly _rate = signal(DEFAULT_RATE);
  readonly rate = this._rate.asReadonly();

  /** The voice actually in use: the user's pick when it exists, else null. */
  readonly selectedVoice = computed(() => {
    const uri = this._selectedVoiceURI();
    if (!uri) {
      return null;
    }
    return this._voices().find(voice => voice.voiceURI === uri) ?? null;
  });

  private loaded = false;

  constructor() {
    this.restorePreferences();
  }

  /**
   * Loads voices, resolving once the browser has actually populated them.
   * Safe to call repeatedly.
   */
  load(): void {
    if (!this.isSupported || this.loaded) {
      return;
    }
    this.loaded = true;

    const read = (): void => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        this._voices.set(voices);
      }
    };

    read();
    // Fires when the list is ready, and again if the OS installs a voice later.
    window.speechSynthesis.addEventListener('voiceschanged', read);
  }

  /** Voices ordered best-first for `lang`, for display in the picker. */
  voicesFor(lang: string | null): SpeechSynthesisVoice[] {
    return rankVoices(this._voices(), lang);
  }

  /**
   * Whether this device has nothing better than its basic voices for `lang`, so
   * the UI should mention that a better one can be installed.
   */
  lacksHighQualityVoice(lang: string | null): boolean {
    return lacksHighQualityVoice(this._voices(), lang);
  }

  /**
   * The voice to speak `lang` with: the user's explicit choice if they made one,
   * otherwise the best-ranked voice available for that language.
   */
  resolveVoice(lang: string | null): SpeechSynthesisVoice | null {
    const chosen = this.selectedVoice();
    if (chosen) {
      return chosen;
    }
    return pickBestVoice(this._voices(), lang);
  }

  selectVoice(voiceURI: string | null): void {
    this._selectedVoiceURI.set(voiceURI);
    this.persistPreferences();
  }

  setRate(rate: number): void {
    this._rate.set(clampRate(rate));
    this.persistPreferences();
  }

  private restorePreferences(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const stored = JSON.parse(raw) as StoredPreferences;
      if (typeof stored.voiceURI === 'string') {
        this._selectedVoiceURI.set(stored.voiceURI);
      }
      if (typeof stored.rate === 'number') {
        this._rate.set(clampRate(stored.rate));
      }
    } catch {
      // Corrupt or unavailable storage is not worth failing the reader over.
    }
  }

  private persistPreferences(): void {
    try {
      const stored: StoredPreferences = {
        voiceURI: this._selectedVoiceURI() ?? undefined,
        rate: this._rate(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Private-mode storage failures should not break playback.
    }
  }
}

export {RATE_MIN, RATE_MAX, DEFAULT_RATE};
