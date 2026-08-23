/**
 * Ranking for `speechSynthesis.getVoices()`.
 *
 * The Web Speech API is the only speech engine available in the browser, and the
 * voices it offers come from the *client device*, not from the server — a reader
 * on Edge/Windows or Safari/iOS gets modern neural voices, while Firefox on Linux
 * may only expose eSpeak. We cannot change what is installed, so "best available"
 * means picking the highest-quality voice on offer and letting the user override.
 *
 * Ranking is intentionally a pure function so its behaviour is testable without a
 * browser speech stack.
 */

export interface RankableVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  voiceURI: string;
}

/**
 * Vendor markers for the current generation of neural voices:
 * - Microsoft: "Microsoft Ava Online (Natural) - English (United States)"
 * - Google:    "Google UK English Female", plus WaveNet/Neural2/Studio/Journey
 * - Apple:     "Ava (Premium)", "Samantha (Enhanced)", "Siri Voice 1"
 */
const NEURAL_MARKERS = /natural|neural|premium|enhanced|siri|studio|journey|wavenet|polyglot/i;

/** Formant synthesisers. Intelligible, but a chore to listen to for a chapter. */
const LEGACY_MARKERS = /espeak|pico|festival|flite|mbrola/i;

const GOOGLE_NETWORK = /^Google\s/i;
const MICROSOFT = /^Microsoft\s/i;

const SCORE = {
  exactLang: 1000,
  baseLang: 500,
  neural: 100,
  googleNetwork: 60,
  microsoft: 40,
  legacyPenalty: -200,
  isDefault: 10,
  isLocal: 5,
} as const;

/** Normalises "en-US", "en_US" and "EN" to a comparable "en-us". */
function normaliseLang(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, '-');
}

/** "en-us" -> "en" */
function baseLang(lang: string): string {
  return normaliseLang(lang).split('-')[0];
}

/**
 * Scores one voice against a desired language. Higher is better.
 *
 * Language match dominates deliberately: a mediocre voice reading French text in
 * French beats an excellent English voice mangling it.
 */
export function scoreVoice(voice: RankableVoice, preferredLang: string | null): number {
  let score = 0;

  if (preferredLang) {
    const wanted = normaliseLang(preferredLang);
    const actual = normaliseLang(voice.lang);
    if (actual === wanted) {
      score += SCORE.exactLang;
    } else if (baseLang(actual) === baseLang(wanted)) {
      score += SCORE.baseLang;
    }
  }

  if (NEURAL_MARKERS.test(voice.name)) {
    score += SCORE.neural;
  } else if (GOOGLE_NETWORK.test(voice.name)) {
    score += SCORE.googleNetwork;
  } else if (MICROSOFT.test(voice.name)) {
    score += SCORE.microsoft;
  }

  if (LEGACY_MARKERS.test(voice.name) || LEGACY_MARKERS.test(voice.voiceURI)) {
    score += SCORE.legacyPenalty;
  }

  if (voice.default) {
    score += SCORE.isDefault;
  }

  // Tiebreaker only: a local voice keeps working offline and starts without
  // network latency.
  if (voice.localService) {
    score += SCORE.isLocal;
  }

  return score;
}

/**
 * Returns voices best-first. Stable for equal scores, so the platform's own
 * ordering survives as a final tiebreak.
 */
export function rankVoices<T extends RankableVoice>(voices: readonly T[], preferredLang: string | null): T[] {
  return voices
    .map((voice, index) => ({voice, index, score: scoreVoice(voice, preferredLang)}))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(entry => entry.voice);
}

/** The single best voice for a language, or null when none are installed. */
export function pickBestVoice<T extends RankableVoice>(voices: readonly T[], preferredLang: string | null): T | null {
  return rankVoices(voices, preferredLang)[0] ?? null;
}
