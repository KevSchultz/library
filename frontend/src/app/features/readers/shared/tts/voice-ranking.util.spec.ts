import {describe, expect, it} from 'vitest';

import {RankableVoice, pickBestVoice, rankVoices, scoreVoice} from './voice-ranking.util';

function voice(name: string, lang: string, extra: Partial<RankableVoice> = {}): RankableVoice {
  return {
    name,
    lang,
    localService: true,
    default: false,
    voiceURI: name,
    ...extra,
  };
}

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
    const englishNeural = voice('Microsoft Ava Online (Natural)', 'en-US');
    expect(scoreVoice(frenchPlain, 'fr-FR')).toBeGreaterThan(scoreVoice(englishNeural, 'fr-FR'));
  });

  it('recognises the neural voice families', () => {
    const plain = voice('Alex', 'en-US');
    for (const name of [
      'Microsoft Ava Online (Natural) - English (United States)',
      'Ava (Premium)',
      'Samantha (Enhanced)',
      'Siri Voice 1',
      'en-US-Studio-O',
      'en-US-Wavenet-D',
    ]) {
      expect(scoreVoice(voice(name, 'en-US'), 'en-US')).toBeGreaterThan(scoreVoice(plain, 'en-US'));
    }
  });

  it('penalises legacy formant synthesisers', () => {
    const espeak = voice('eSpeak English', 'en-US', {voiceURI: 'espeak:en'});
    expect(scoreVoice(espeak, 'en-US')).toBeLessThan(scoreVoice(voice('Alex', 'en-US'), 'en-US'));
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
      voice('eSpeak English', 'en-US', {voiceURI: 'espeak:en'}),
      voice('Alex', 'en-US'),
      voice('Microsoft Ava Online (Natural)', 'en-US'),
      voice('Thomas', 'fr-FR'),
      voice('Daniel', 'en-US'),
    ];

    const ranked = rankVoices(voices, 'en-US').map(v => v.name);
    expect(ranked[0]).toBe('Microsoft Ava Online (Natural)');
    expect(ranked.indexOf('Alex')).toBeLessThan(ranked.indexOf('Daniel'));
    expect(ranked.at(-1)).toBe('Thomas');
  });

  it('does not mutate the input', () => {
    const voices = [voice('B', 'en-US'), voice('Microsoft Ava (Natural)', 'en-US')];
    const before = voices.map(v => v.name);
    rankVoices(voices, 'en-US');
    expect(voices.map(v => v.name)).toEqual(before);
  });
});

describe('pickBestVoice', () => {
  it('returns null when nothing is installed', () => {
    expect(pickBestVoice([], 'en-US')).toBeNull();
  });

  it('picks the highest-ranked voice', () => {
    const best = voice('Microsoft Ava Online (Natural)', 'en-US');
    expect(pickBestVoice([voice('Alex', 'en-US'), best], 'en-US')).toBe(best);
  });
});
