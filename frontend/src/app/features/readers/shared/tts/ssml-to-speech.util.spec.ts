import {describe, expect, it} from 'vitest';

import {isSpeakable, markNameAtCharIndex, ssmlToSpeechPlan} from './ssml-to-speech.util';

/** Mirrors what foliate's `fragmentToSSML` serialises for a marked-up block. */
function ssml(body: string, lang?: string): string {
  const langAttr = lang ? ` xml:lang="${lang}"` : '';
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis"${langAttr}>${body}</speak>`;
}

describe('ssmlToSpeechPlan', () => {
  it('returns an empty plan for missing or malformed input', () => {
    expect(ssmlToSpeechPlan(null).text).toBe('');
    expect(ssmlToSpeechPlan(undefined).text).toBe('');
    expect(ssmlToSpeechPlan('').text).toBe('');
    expect(ssmlToSpeechPlan('<speak>unclosed').text).toBe('');
  });

  it('flattens text and records the language', () => {
    const plan = ssmlToSpeechPlan(ssml('Call me Ishmael.', 'en-US'));
    expect(plan.text).toBe('Call me Ishmael.');
    expect(plan.lang).toBe('en-US');
    expect(plan.marks).toEqual([]);
  });

  it('normalises the whitespace an EPUB carries', () => {
    const plan = ssmlToSpeechPlan(ssml('\n      Some years\n   ago\t— never mind  how long.\n  '));
    expect(plan.text).toBe('Some years ago — never mind how long.');
  });

  it('points each mark at the first character of its word', () => {
    const plan = ssmlToSpeechPlan(ssml(
      '<mark name="0"/>Call <mark name="1"/>me <mark name="2"/>Ishmael.'
    ));

    expect(plan.text).toBe('Call me Ishmael.');
    expect(plan.marks).toEqual([
      {charIndex: 0, name: '0'},
      {charIndex: 5, name: '1'},
      {charIndex: 8, name: '2'},
    ]);
    // The offsets must actually land on the words, or highlighting drifts.
    for (const mark of plan.marks) {
      expect(plan.text[mark.charIndex]).not.toBe(' ');
    }
  });

  it('accounts for whitespace deferred across element boundaries', () => {
    // The space before "world" lives outside the <emphasis>, so the mark has to
    // know the word starts one character later than the text built so far.
    const plan = ssmlToSpeechPlan(ssml(
      '<mark name="0"/>Hello <emphasis><mark name="1"/>world</emphasis>'
    ));

    expect(plan.text).toBe('Hello world');
    expect(plan.marks).toEqual([
      {charIndex: 0, name: '0'},
      {charIndex: 6, name: '1'},
    ]);
    expect(plan.text.slice(6)).toBe('world');
  });

  it('descends through emphasis, lang and phoneme wrappers', () => {
    const plan = ssmlToSpeechPlan(ssml(
      'a <emphasis>b</emphasis> <lang xml:lang="fr">c</lang> <phoneme ph="d">d</phoneme>'
    ));
    expect(plan.text).toBe('a b c d');
  });

  it('treats a break as a word separator without emitting text', () => {
    const plan = ssmlToSpeechPlan(ssml('line one<break/>line two'));
    expect(plan.text).toBe('line one line two');
  });

  it('ignores a mark with no name', () => {
    const plan = ssmlToSpeechPlan(ssml('<mark/>text'));
    expect(plan.marks).toEqual([]);
    expect(plan.text).toBe('text');
  });
});

describe('markNameAtCharIndex', () => {
  const marks = [
    {charIndex: 0, name: '0'},
    {charIndex: 5, name: '1'},
    {charIndex: 8, name: '2'},
  ];

  it('returns the last mark at or before the offset', () => {
    expect(markNameAtCharIndex(marks, 0)).toBe('0');
    expect(markNameAtCharIndex(marks, 4)).toBe('0');
    expect(markNameAtCharIndex(marks, 5)).toBe('1');
    expect(markNameAtCharIndex(marks, 7)).toBe('1');
    expect(markNameAtCharIndex(marks, 8)).toBe('2');
    expect(markNameAtCharIndex(marks, 999)).toBe('2');
  });

  it('returns null before the first mark and for an empty list', () => {
    expect(markNameAtCharIndex([{charIndex: 3, name: 'a'}], 0)).toBeNull();
    expect(markNameAtCharIndex([], 10)).toBeNull();
  });
});

describe('isSpeakable', () => {
  it('rejects blank plans', () => {
    expect(isSpeakable({text: '', marks: [], lang: null})).toBe(false);
    expect(isSpeakable({text: '   \n ', marks: [], lang: null})).toBe(false);
    expect(isSpeakable({text: 'x', marks: [], lang: null})).toBe(true);
  });
});
