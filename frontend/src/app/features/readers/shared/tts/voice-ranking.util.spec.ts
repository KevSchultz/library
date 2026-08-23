import {describe, expect, it} from 'vitest';

import {
  RankableVoice,
  isHiddenVoice,
  lacksHighQualityVoice,
  pickBestVoice,
  rankVoices,
  scoreVoice,
  voiceBaseName,
  voiceQuality,
} from './voice-ranking.util';

function voice(name: string, lang: string, extra: Partial<RankableVoice> = {}): RankableVoice {
  return {
    name,
    lang,
    localService: true,
    default: false,
    // Chrome on macOS reports voiceURI as the display name; mirror that here
    // unless a test is specifically about the Apple voice ids.
    voiceURI: name,
    ...extra,
  };
}

describe('voiceBaseName', () => {
  it('strips a quality suffix', () => {
    expect(voiceBaseName('Allison (Enhanced)')).toBe('allison');
    expect(voiceBaseName('Zoe (Premium)')).toBe('zoe');
  });

  it('strips a nested locale suffix, as the Eloquence voices carry', () => {
    expect(voiceBaseName('Eddy (English (United States))')).toBe('eddy');
  });

  it('leaves an unqualified name alone', () => {
    expect(voiceBaseName('Google UK English Female')).toBe('google uk english female');
  });
});

describe('voiceQuality', () => {
  it('reads the tier from the name', () => {
    expect(voiceQuality(voice('Zoe (Premium)', 'en-US'))).toBe('premium');
    expect(voiceQuality(voice('Allison (Enhanced)', 'en-US'))).toBe('enhanced');
    expect(voiceQuality(voice('Microsoft Ava Online (Natural)', 'en-US'))).toBe('neural');
    expect(voiceQuality(voice('Samantha', 'en-US'))).toBe('standard');
  });

  it('reads the tier from an Apple voice id when a browser exposes one', () => {
    const premium = voice('Zoe', 'en-US', {voiceURI: 'com.apple.voice.premium.en-US.Zoe'});
    const enhanced = voice('Ava', 'en-US', {voiceURI: 'com.apple.voice.enhanced.en-US.Ava'});
    expect(voiceQuality(premium)).toBe('premium');
    expect(voiceQuality(enhanced)).toBe('enhanced');
  });

  it('recognises localised quality suffixes', () => {
    expect(voiceQuality(voice('Kyoko（拡張）', 'ja-JP'))).toBe('enhanced');
    expect(voiceQuality(voice('Zoe（プレミアム）', 'en-US'))).toBe('premium');
  });

  it('treats Apple compact as standard rather than legacy', () => {
    // Safari exposes the compact id; it is the basic tier, not a bad voice.
    const compact = voice('Samantha', 'en-US', {voiceURI: 'com.apple.voice.compact.en-US.Samantha'});
    expect(voiceQuality(compact)).toBe('standard');
  });

  it('classes formant synthesisers and novelty voices as legacy', () => {
    expect(voiceQuality(voice('eSpeak English', 'en-US', {voiceURI: 'espeak:en'}))).toBe('legacy');
    expect(voiceQuality(voice('Zarvox', 'en-US'))).toBe('legacy');
  });

  it('does not mistake an Eloquence locale suffix for a quality tier', () => {
    expect(voiceQuality(voice('Grandma (English (United States))', 'en-US'))).toBe('legacy');
  });
});

describe('isHiddenVoice', () => {
  it('hides the macOS novelty and Eloquence voices', () => {
    for (const name of ['Bells', 'Zarvox', 'Bad News', 'Bubbles', 'Whisper', 'Fred', 'Albert']) {
      expect(isHiddenVoice(voice(name, 'en-US')), name).toBe(true);
    }
    for (const name of ['Eddy (English (United States))', 'Flo (English (United Kingdom))', 'Shelley (English (United States))']) {
      expect(isHiddenVoice(voice(name, 'en-US')), name).toBe(true);
    }
  });

  it('keeps the voices worth reading with', () => {
    for (const name of ['Samantha', 'Allison (Enhanced)', 'Daniel', 'Karen', 'Moira', 'Google US English']) {
      expect(isHiddenVoice(voice(name, 'en-US')), name).toBe(false);
    }
  });
});

describe('scoreVoice', () => {
  it('ranks an exact language match above a base-language match', () => {
    const exact = voice('A', 'en-GB');
    const base = voice('A', 'en-US');
    expect(scoreVoice(exact, 'en-GB')).toBeGreaterThan(scoreVoice(base, 'en-GB'));
  });

  it('scores an unrelated language lowest', () => {
    expect(scoreVoice(voice('A', 'de-DE'), 'en-US')).toBeLessThan(scoreVoice(voice('A', 'en-AU'), 'en-US'));
  });

  it('prefers language match over voice quality', () => {
    // A plain French voice must beat a neural English one for French text,
    // otherwise the reader mangles the pronunciation.
    const frenchPlain = voice('Thomas', 'fr-FR');
    const englishPremium = voice('Zoe (Premium)', 'en-US');
    expect(scoreVoice(frenchPlain, 'fr-FR')).toBeGreaterThan(scoreVoice(englishPremium, 'fr-FR'));
  });

  it('orders the quality tiers premium > enhanced > neural > standard', () => {
    const premium = scoreVoice(voice('Zoe (Premium)', 'en-US'), 'en-US');
    const enhanced = scoreVoice(voice('Allison (Enhanced)', 'en-US'), 'en-US');
    const neural = scoreVoice(voice('Microsoft Ava Online (Natural)', 'en-US'), 'en-US');
    const standard = scoreVoice(voice('Samantha', 'en-US'), 'en-US');

    expect(premium).toBeGreaterThan(enhanced);
    expect(enhanced).toBeGreaterThan(neural);
    expect(neural).toBeGreaterThan(standard);
  });

  it('prefers a local voice over a same-tier network voice', () => {
    const local = voice('Samantha', 'en-US');
    const network = voice('Google US English', 'en-US', {localService: false});
    expect(scoreVoice(local, 'en-US')).toBeGreaterThan(scoreVoice(network, 'en-US'));
  });

  it('still ranks a network neural voice above a local basic one', () => {
    const network = voice('Microsoft Ava Online (Natural)', 'en-US', {localService: false});
    const local = voice('Samantha', 'en-US');
    expect(scoreVoice(network, 'en-US')).toBeGreaterThan(scoreVoice(local, 'en-US'));
  });

  it('ignores language entirely when none is requested', () => {
    expect(scoreVoice(voice('Alex', 'en-US'), null)).toBe(scoreVoice(voice('Thomas', 'fr-FR'), null));
  });

  it('normalises language tag casing and separators', () => {
    expect(scoreVoice(voice('A', 'EN_us'), 'en-US')).toBe(scoreVoice(voice('A', 'en-US'), 'en-US'));
  });
});

describe('rankVoices', () => {
  it('orders best-first and keeps platform order for ties', () => {
    const voices = [
      voice('Samantha', 'en-US'),
      voice('Allison (Enhanced)', 'en-US'),
      voice('Thomas', 'fr-FR'),
      voice('Daniel', 'en-GB'),
    ];

    const ranked = rankVoices(voices, 'en-US').map(v => v.name);
    expect(ranked[0]).toBe('Allison (Enhanced)');
    expect(ranked.at(-1)).toBe('Thomas');
  });

  it('removes novelty voices from the list', () => {
    const voices = [
      voice('Bells', 'en-US'),
      voice('Samantha', 'en-US'),
      voice('Zarvox', 'en-US'),
      voice('Grandma (English (United States))', 'en-US'),
    ];

    expect(rankVoices(voices, 'en-US').map(v => v.name)).toEqual(['Samantha']);
  });

  it('collapses a speaker to their highest-quality variant', () => {
    const voices = [
      voice('Samantha', 'en-US'),
      voice('Samantha (Enhanced)', 'en-US'),
      voice('Samantha (Premium)', 'en-US'),
    ];

    expect(rankVoices(voices, 'en-US').map(v => v.name)).toEqual(['Samantha (Premium)']);
  });

  it('keeps the same speaker in different languages apart', () => {
    const voices = [voice('Daniel', 'en-GB'), voice('Daniel', 'fr-FR')];
    expect(rankVoices(voices, 'en-GB')).toHaveLength(2);
  });

  it('falls back to the unfiltered list when every voice is a hidden one', () => {
    // Nothing usable to fall back to, so a novelty voice beats silence.
    const voices = [voice('Zarvox', 'en-US'), voice('Bells', 'en-US')];
    expect(rankVoices(voices, 'en-US')).toHaveLength(2);
  });

  it('keeps eSpeak, which on Linux may be the only voice there is', () => {
    const voices = [voice('eSpeak English', 'en-US', {voiceURI: 'espeak:en'}), voice('Zarvox', 'en-US')];
    expect(rankVoices(voices, 'en-US').map(v => v.name)).toEqual(['eSpeak English']);
  });

  it('does not mutate the input', () => {
    const voices = [voice('Samantha', 'en-US'), voice('Allison (Enhanced)', 'en-US')];
    const before = voices.map(v => v.name);
    rankVoices(voices, 'en-US');
    expect(voices.map(v => v.name)).toEqual(before);
  });
});

describe('pickBestVoice', () => {
  it('returns null when nothing is installed', () => {
    expect(pickBestVoice([], 'en-US')).toBeNull();
  });

  it('picks the highest-quality voice for the language', () => {
    const best = voice('Zoe (Premium)', 'en-US');
    const voices = [voice('Samantha', 'en-US'), voice('Allison (Enhanced)', 'en-US'), best];
    expect(pickBestVoice(voices, 'en-US')).toBe(best);
  });

  it('never picks a novelty voice over a usable one', () => {
    const voices = [voice('Bells', 'en-US'), voice('Samantha', 'en-US')];
    expect(pickBestVoice(voices, 'en-US')?.name).toBe('Samantha');
  });
});

describe('lacksHighQualityVoice', () => {
  it('is true when only basic voices are installed', () => {
    expect(lacksHighQualityVoice([voice('Samantha', 'en-US')], 'en-US')).toBe(true);
  });

  it('is true for Enhanced, because Premium is the tier above it', () => {
    expect(lacksHighQualityVoice([voice('Allison (Enhanced)', 'en-US')], 'en-US')).toBe(true);
  });

  it('is false once a Premium voice is installed', () => {
    expect(lacksHighQualityVoice([voice('Zoe (Premium)', 'en-US')], 'en-US')).toBe(false);
  });

  it('is false for the platform neural voices, where nothing better exists', () => {
    const natural = voice('Microsoft Ava Online (Natural)', 'en-US', {localService: false});
    expect(lacksHighQualityVoice([natural], 'en-US')).toBe(false);
  });

  it('is false when there are no voices at all', () => {
    expect(lacksHighQualityVoice([], 'en-US')).toBe(false);
  });
});
