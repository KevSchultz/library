import {describe, expect, it} from 'vitest';

import {MAX_CHUNK_CHARS, isPageTextEmpty, normalisePdfText, splitIntoSentences} from './pdf-text.util';

describe('normalisePdfText', () => {
  it('folds the page layout back into prose', () => {
    expect(normalisePdfText('The quick brown\nfox jumps over\nthe lazy dog.'))
      .toBe('The quick brown fox jumps over the lazy dog.');
  });

  it('rejoins words hyphenated across a line break', () => {
    expect(normalisePdfText('an inter-\nesting result')).toBe('an interesting result');
  });

  it('keeps a genuine hyphen that is not at a line break', () => {
    expect(normalisePdfText('a well-known result')).toBe('a well-known result');
  });

  it('handles carriage returns and collapses runs of whitespace', () => {
    expect(normalisePdfText('a\r\n\r\n  b\t\tc  ')).toBe('a b c');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalisePdfText('   \n\n \t ')).toBe('');
  });
});

describe('splitIntoSentences', () => {
  it('splits on sentence boundaries', () => {
    const sentences = splitIntoSentences('First one. Second one! Third one?', 'en');
    expect(sentences).toEqual(['First one.', 'Second one!', 'Third one?']);
  });

  it('normalises before splitting', () => {
    expect(splitIntoSentences('Split across\ntwo lines. Then more.', 'en'))
      .toEqual(['Split across two lines.', 'Then more.']);
  });

  it('returns nothing for empty input', () => {
    expect(splitIntoSentences('', 'en')).toEqual([]);
    expect(splitIntoSentences('  \n ', 'en')).toEqual([]);
  });

  it('falls back gracefully on an invalid locale tag', () => {
    expect(splitIntoSentences('One. Two.', 'not a locale')).toEqual(['One.', 'Two.']);
  });

  it('breaks up text with no sentence punctuation', () => {
    // An index or table: no full stops, so sentence segmentation yields one
    // enormous chunk that has to be split on word boundaries instead.
    const text = Array.from({length: 200}, (_, i) => `entry${i}`).join(' ');
    const chunks = splitIntoSentences(text, 'en');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    // Splitting must not lose or corrupt any words.
    expect(chunks.join(' ')).toBe(text);
  });

  it('leaves a chunk at the limit intact', () => {
    const text = 'x'.repeat(MAX_CHUNK_CHARS);
    expect(splitIntoSentences(text, 'en')).toEqual([text]);
  });
});

describe('isPageTextEmpty', () => {
  it('treats null, empty and whitespace-only pages as empty', () => {
    expect(isPageTextEmpty(null)).toBe(true);
    expect(isPageTextEmpty('')).toBe(true);
    expect(isPageTextEmpty('  \n\t ')).toBe(true);
  });

  it('treats a page with any text as non-empty', () => {
    expect(isPageTextEmpty('a')).toBe(false);
  });
});
