import {describe, expect, it} from 'vitest';
import {MAX_CHUNK_CHARS, chunkForSpeech, segmentWithOffsets} from './speech-chunk.util';

describe('segmentWithOffsets', () => {
  it('returns nothing for empty text', () => {
    expect(segmentWithOffsets('', null)).toEqual([]);
  });

  it('splits sentences and reports where each begins', () => {
    const text = 'One fish. Two fish. Red fish.';
    const chunks = segmentWithOffsets(text, 'en');

    expect(chunks.map(c => c.text)).toEqual(['One fish.', 'Two fish.', 'Red fish.']);
    // Every offset must index the original string, or ebook marks land on the
    // wrong word once past the first sentence.
    for (const chunk of chunks) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });

  it('excludes the separating whitespace from the offset', () => {
    const chunks = segmentWithOffsets('A. B.', 'en');
    expect(chunks[1].offset).toBe(3);
  });

  it('keeps a single unpunctuated run as one chunk', () => {
    const chunks = segmentWithOffsets('no punctuation here', 'en');
    expect(chunks).toEqual([{text: 'no punctuation here', offset: 0}]);
  });

  it('falls back cleanly on an unusable locale tag', () => {
    const text = 'First. Second.';
    const chunks = segmentWithOffsets(text, 'not-a-locale!!');
    expect(chunks.map(c => c.text)).toEqual(['First.', 'Second.']);
    for (const chunk of chunks) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });
});

describe('chunkForSpeech', () => {
  it('breaks an over-long run on word boundaries', () => {
    const text = `${'word '.repeat(200).trim()}.`;
    const chunks = chunkForSpeech(text, 'en');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('keeps offsets accurate across a split long run', () => {
    const text = `${'alpha '.repeat(120).trim()}.`;
    const chunks = chunkForSpeech(text, 'en');

    for (const chunk of chunks) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });

  it('loses no words when splitting', () => {
    const text = `${'beta '.repeat(150).trim()}.`;
    const rejoined = chunkForSpeech(text, 'en')
      .map(chunk => chunk.text)
      .join(' ');
    expect(rejoined.split(/\s+/).length).toBe(text.split(/\s+/).length);
  });

  it('leaves a short sentence untouched', () => {
    expect(chunkForSpeech('Short one.', 'en')).toEqual([{text: 'Short one.', offset: 0}]);
  });
});
