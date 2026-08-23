/**
 * Bridge between foliate-js's TTS output and the Web Speech API.
 *
 * `foliate/tts.js` emits SSML documents whose word positions are carried by
 * `<mark name="N"/>` elements, and `TTS.setMark(name)` highlights the matching
 * range back in the book. The Web Speech API has no SSML support at all: it
 * takes a plain string and reports progress as a `charIndex` into that string.
 *
 * So we flatten the SSML to the plain text we will actually speak, and record
 * where each mark lands in that text. A `boundary` event's `charIndex` then maps
 * back to a mark name, and from there to a highlight.
 */

const SSML_NAMESPACE = 'http://www.w3.org/2001/10/synthesis';

export interface SpeechMark {
  /** Offset into `SpeechPlan.text` at which this mark's word begins. */
  charIndex: number;
  /** The `name` attribute foliate assigned; passed back to `TTS.setMark`. */
  name: string;
}

export interface SpeechPlan {
  /** Whitespace-normalised text to hand to `SpeechSynthesisUtterance`. */
  text: string;
  /** Marks in ascending `charIndex` order. */
  marks: SpeechMark[];
  /** `xml:lang` from the SSML root, when the book declared one. */
  lang: string | null;
}

const EMPTY_PLAN: SpeechPlan = {text: '', marks: [], lang: null};

/**
 * Flattens a serialised SSML document into a `SpeechPlan`.
 *
 * Whitespace is normalised as we build rather than afterwards, because mark
 * offsets have to index into the exact string we pass to the speech engine —
 * normalising later would silently shift every mark.
 */
export function ssmlToSpeechPlan(ssml: string | null | undefined): SpeechPlan {
  if (!ssml) {
    return EMPTY_PLAN;
  }

  const doc = new DOMParser().parseFromString(ssml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return EMPTY_PLAN;
  }

  const root = doc.documentElement;
  if (!root) {
    return EMPTY_PLAN;
  }

  const marks: SpeechMark[] = [];
  let text = '';
  // True when we have swallowed whitespace that should become a single space
  // *if* more text follows. Deferring it keeps trailing whitespace out of the
  // string and lets a mark know the word after it starts one character later.
  let pendingSpace = false;

  const appendText = (raw: string): void => {
    for (const char of raw) {
      if (/\s/.test(char)) {
        // Leading whitespace never produces a space.
        if (text.length > 0) {
          pendingSpace = true;
        }
        continue;
      }
      if (pendingSpace) {
        text += ' ';
        pendingSpace = false;
      }
      text += char;
    }
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      appendText(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    const localName = element.localName;

    if (localName === 'mark') {
      const name = element.getAttribute('name');
      if (name !== null) {
        // The word this mark introduces starts after any deferred space.
        marks.push({charIndex: text.length + (pendingSpace ? 1 : 0), name});
      }
      return;
    }

    if (localName === 'break') {
      // A <break> stands in for a <br>; treat it as a word separator.
      if (text.length > 0) {
        pendingSpace = true;
      }
      return;
    }

    // <emphasis>, <lang>, <phoneme>, <speak>: nothing to render, just descend.
    for (let child = element.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  };

  visit(root);

  const lang = root.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')
    ?? root.getAttribute('xml:lang');

  return {text, marks, lang: lang || null};
}

/**
 * Returns the name of the last mark at or before `charIndex`, or null if the
 * position precedes every mark. Marks must be in ascending order, which
 * `ssmlToSpeechPlan` guarantees.
 *
 * Binary search because this runs on every `boundary` event — roughly once per
 * spoken word.
 */
export function markNameAtCharIndex(marks: readonly SpeechMark[], charIndex: number): string | null {
  let low = 0;
  let high = marks.length - 1;
  let found: string | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (marks[mid].charIndex <= charIndex) {
      found = marks[mid].name;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/** True when the plan has anything worth sending to the speech engine. */
export function isSpeakable(plan: SpeechPlan): boolean {
  return plan.text.trim().length > 0;
}

export {SSML_NAMESPACE};
