/**
 * Ranking for `speechSynthesis.getVoices()`.
 *
 * The voices on offer come from the *client device*, not from the server, and we
 * cannot change what is installed — so "best available" means ordering what the
 * platform gives us and letting the user override.
 *
 * Two things make that harder than it sounds:
 *
 * 1. macOS ships ~180 voices, the majority of which are novelty ("Bells",
 *    "Zarvox", "Bad News") or the low-quality Eloquence set. Left unfiltered they
 *    bury the handful of voices anyone would want to listen to.
 * 2. `voiceURI` is not the stable identifier the spec implies. Chrome on macOS
 *    sets it to the display name, so the Apple voice ids that would tell us the
 *    quality tier (`com.apple.voice.premium.en-US.Zoe`) are simply not there. We
 *    check both, but the name is usually all we get.
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
 * Synthesis quality, best first.
 *
 * `standard` is Apple's "compact" tier and the unmarked default elsewhere:
 * perfectly intelligible, noticeably robotic. `legacy` is the formant
 * synthesisers and novelty voices, which are not worth reading a book with.
 */
export type VoiceQuality = 'premium' | 'enhanced' | 'neural' | 'standard' | 'legacy';

/**
 * Apple's downloadable tiers. The suffix is localised — "(Enhanced)" is
 * "（拡張）" on a Japanese system — so the localisations Apple actually uses are
 * listed alongside the English.
 */
const PREMIUM_MARKERS = /\bpremium\b|プレミアム|优质|優質|프리미엄/i;
const ENHANCED_MARKERS = /\benhanced\b|拡張|增强|增強|향상|améliorée?|mejorada|erweitert|migliorata|aprimorada|verbeterd/i;

/** Apple and Microsoft voice ids, when a browser exposes them. */
const PREMIUM_URI = /\.premium\./i;
const ENHANCED_URI = /\.enhanced\./i;

/**
 * Vendor markers for the current generation of neural voices:
 * - Microsoft: "Microsoft Ava Online (Natural) - English (United States)"
 * - Google:    WaveNet/Neural2/Studio/Journey
 * - Apple:     "Siri Voice 1"
 */
const NEURAL_MARKERS = /natural|neural|siri|studio|journey|wavenet|polyglot/i;

/**
 * Formant synthesisers. Intelligible, but a chore to listen to for a chapter.
 *
 * Apple's "compact" is deliberately absent: it is the standard tier, not a
 * legacy one, and demoting it would push Samantha below a cloud voice.
 */
const LEGACY_MARKERS = /espeak|pico|festival|flite|mbrola/i;

/**
 * macOS novelty and Eloquence voices, matched on the base name.
 *
 * These are all `localService` voices in ordinary languages, so nothing about
 * their metadata distinguishes them from a voice you would actually use — the
 * list has to be explicit. "Bells" plays chimes; "Zarvox" is a robot; the
 * Eloquence set (Eddy, Flo, Grandma, ...) is a 1980s formant synthesiser that
 * macOS still ships in every language.
 */
const HIDDEN_VOICE_NAMES = new Set([
  // Effects / novelty
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'deranged', 'good news', 'hysterical', 'jester', 'junior', 'organ',
  'pipe organ', 'princess', 'ralph', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox',
  // Legacy formant voices macOS keeps for compatibility
  'agnes', 'bruce', 'fred', 'kathy', 'vicki', 'victoria',
  // Eloquence
  'eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley',
]);

const SCORE = {
  exactLang: 1000,
  baseLang: 500,
  premium: 300,
  enhanced: 200,
  neural: 150,
  standard: 0,
  legacy: -400,
  /**
   * Not just a tiebreak: a network voice stops working offline and pauses at
   * every utterance while it round-trips. Enough to outrank a same-tier cloud
   * voice, never enough to outrank a better tier.
   */
  isLocal: 20,
  isDefault: 5,
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
 * The speaker's name, without any trailing qualifier.
 *
 * macOS appends both quality tiers and, for Eloquence, the locale:
 * "Allison (Enhanced)" and "Eddy (English (United States))" are both one
 * speaker whose name is the part before the first bracket.
 */
export function voiceBaseName(name: string): string {
  const bracket = name.indexOf(' (');
  const base = bracket === -1 ? name : name.slice(0, bracket);
  return base.trim().toLowerCase();
}

/** The quality tier of a voice, from its id when available and its name otherwise. */
export function voiceQuality(voice: RankableVoice): VoiceQuality {
  const {name, voiceURI} = voice;

  if (PREMIUM_URI.test(voiceURI) || PREMIUM_MARKERS.test(name)) {
    return 'premium';
  }
  if (ENHANCED_URI.test(voiceURI) || ENHANCED_MARKERS.test(name)) {
    return 'enhanced';
  }
  if (isHiddenVoice(voice)) {
    return 'legacy';
  }
  if (NEURAL_MARKERS.test(name)) {
    return 'neural';
  }
  if (LEGACY_MARKERS.test(name) || LEGACY_MARKERS.test(voiceURI)) {
    return 'legacy';
  }
  return 'standard';
}

/** True for novelty, effect and Eloquence voices: never worth offering by default. */
export function isHiddenVoice(voice: RankableVoice): boolean {
  return HIDDEN_VOICE_NAMES.has(voiceBaseName(voice.name));
}

function qualityScore(quality: VoiceQuality): number {
  switch (quality) {
    case 'premium':
      return SCORE.premium;
    case 'enhanced':
      return SCORE.enhanced;
    case 'neural':
      return SCORE.neural;
    case 'legacy':
      return SCORE.legacy;
    default:
      return SCORE.standard;
  }
}

/**
 * Scores one voice against a desired language. Higher is better.
 *
 * Language match dominates deliberately: a mediocre voice reading French text in
 * French beats an excellent English voice mangling it.
 */
export function scoreVoice(voice: RankableVoice, preferredLang: string | null): number {
  let score = qualityScore(voiceQuality(voice));

  if (preferredLang) {
    const wanted = normaliseLang(preferredLang);
    const actual = normaliseLang(voice.lang);
    if (actual === wanted) {
      score += SCORE.exactLang;
    } else if (baseLang(actual) === baseLang(wanted)) {
      score += SCORE.baseLang;
    }
  }

  if (voice.localService) {
    score += SCORE.isLocal;
  }

  if (voice.default) {
    score += SCORE.isDefault;
  }

  return score;
}

/**
 * Drops the lower-quality copies of a speaker the platform lists more than once.
 *
 * A Mac with the Samantha download installed reports both "Samantha" and
 * "Samantha (Enhanced)" for en-US; only the better one is worth showing. Keyed
 * on language too, so Daniel-en-GB and Daniel-fr-FR stay separate voices.
 */
function collapseVariants<T extends RankableVoice>(voices: readonly T[]): T[] {
  const best = new Map<string, {voice: T; score: number; index: number}>();

  voices.forEach((voice, index) => {
    const key = `${voiceBaseName(voice.name)}|${normaliseLang(voice.lang)}`;
    const score = qualityScore(voiceQuality(voice));
    const existing = best.get(key);
    if (!existing || score > existing.score) {
      best.set(key, {voice, score, index});
    }
  });

  return [...best.values()]
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.voice);
}

/**
 * Returns voices best-first, without the novelty voices or the redundant
 * lower-quality copies of a speaker. Stable for equal scores, so the platform's
 * own ordering survives as a final tiebreak.
 *
 * If filtering would leave nothing — a Linux box with only eSpeak, say — the
 * unfiltered list is returned instead. A bad voice beats no voice.
 */
export function rankVoices<T extends RankableVoice>(voices: readonly T[], preferredLang: string | null): T[] {
  const usable = voices.filter(voice => !isHiddenVoice(voice));
  return sortByScore(collapseVariants(usable.length > 0 ? usable : voices), preferredLang);
}

function sortByScore<T extends RankableVoice>(voices: readonly T[], preferredLang: string | null): T[] {
  return voices
    .map((voice, index) => ({voice, index, score: scoreVoice(voice, preferredLang)}))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(entry => entry.voice);
}

/** The single best voice for a language, or null when none are installed. */
export function pickBestVoice<T extends RankableVoice>(voices: readonly T[], preferredLang: string | null): T | null {
  return rankVoices(voices, preferredLang)[0] ?? null;
}

/**
 * Whether a better voice is plausibly a download away, so the hint about
 * installing one is worth the space in the UI.
 *
 * True below the top tier, which includes Apple's "Enhanced" — Premium sits
 * above it and is the one worth fetching. False for the platform neural voices
 * on Windows and Android, where there is nothing better to install.
 */
export function lacksHighQualityVoice(
  voices: readonly RankableVoice[],
  preferredLang: string | null,
): boolean {
  const best = pickBestVoice(voices, preferredLang);
  if (!best) {
    return false;
  }
  const quality = voiceQuality(best);
  return quality !== 'premium' && quality !== 'neural';
}
