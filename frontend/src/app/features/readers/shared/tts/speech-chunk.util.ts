/**
 * Splitting text into speakable chunks, keeping track of where each one started.
 *
 * The offsets matter for the ebook reader: its word marks are recorded as
 * character offsets into the whole block (see `ssml-to-speech.util.ts`), so
 * once a block is split for synthesis, each chunk has to know its own starting
 * offset or every mark after the first chunk resolves to the wrong word.
 */

/** Long stretches without punctuation get broken up so one utterance stays manageable. */
const MAX_CHUNK_CHARS = 300;

/**
 * Chunks shorter than this get merged with the next one.
 *
 * Synthesis has a fixed per-call cost, so a page of short sentences pays it over
 * and over. Merging trades a little extra latency on the very first chunk for
 * noticeably better throughput across a page.
 */
const MIN_CHUNK_CHARS = 160;

export interface TextChunk {
  text: string;
  /** Character offset of `text` within the string it was split from. */
  offset: number;
}

/**
 * Splits into sentences, preserving each sentence's offset in `text`.
 *
 * `Intl.Segmenter` knows about abbreviations and non-Latin scripts in a way a
 * regex does not, but it is not everywhere, hence the fallback.
 *
 * Expects text whose whitespace is already normalised — it does not rewrite the
 * input, because doing so would invalidate the offsets it reports.
 */
export function segmentWithOffsets(text: string, lang: string | null): TextChunk[] {
  if (!text) {
    return [];
  }

  const raw = rawSegments(text, lang);
  const chunks: TextChunk[] = [];

  for (const segment of raw) {
    // Trimming shifts the offset; a segment is usually preceded by the space
    // that separated it from the last one.
    const leading = segment.text.length - segment.text.trimStart().length;
    const trimmed = segment.text.trim();
    if (trimmed.length > 0) {
      chunks.push({text: trimmed, offset: segment.offset + leading});
    }
  }

  return chunks;
}

function rawSegments(text: string, lang: string | null): TextChunk[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(lang ?? undefined, {granularity: 'sentence'});
      return [...segmenter.segment(text)].map(segment => ({
        text: segment.segment,
        offset: segment.index,
      }));
    } catch {
      // An unusable locale tag should not cost us read-aloud entirely.
    }
  }

  const parts: TextChunk[] = [];
  const pattern = /(?<=[.!?…])\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    parts.push({text: text.slice(start, match.index), offset: start});
    start = match.index + match[0].length;
  }
  parts.push({text: text.slice(start), offset: start});
  return parts;
}

/**
 * Sentence chunks, with any over-long one broken on word boundaries.
 *
 * Reached by text carrying no sentence punctuation at all — tables, code
 * listings, indexes — where one "sentence" would otherwise be the whole block.
 */
export function chunkForSpeech(text: string, lang: string | null): TextChunk[] {
  const split = segmentWithOffsets(text, lang).flatMap(chunk => splitLongChunk(chunk));
  return mergeShortChunks(split, text);
}

/**
 * Merges runs of short chunks into bigger ones, without disturbing offsets.
 *
 * The merged text is re-sliced out of `source` rather than joined, so it stays
 * an exact substring and the offsets keep pointing where the marks expect.
 */
function mergeShortChunks(chunks: readonly TextChunk[], source: string): TextChunk[] {
  const merged: TextChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.text.length >= MIN_CHUNK_CHARS) {
      merged.push(chunk);
      continue;
    }

    const end = chunk.offset + chunk.text.length;
    if (end - previous.offset > MAX_CHUNK_CHARS) {
      merged.push(chunk);
      continue;
    }

    merged[merged.length - 1] = {
      text: source.slice(previous.offset, end),
      offset: previous.offset,
    };
  }

  return merged;
}

function splitLongChunk(chunk: TextChunk): TextChunk[] {
  if (chunk.text.length <= MAX_CHUNK_CHARS) {
    return [chunk];
  }

  const parts: TextChunk[] = [];
  let current = '';
  let currentOffset = chunk.offset;
  let cursor = chunk.offset;

  for (const word of chunk.text.split(' ')) {
    if (current && current.length + 1 + word.length > MAX_CHUNK_CHARS) {
      parts.push({text: current, offset: currentOffset});
      currentOffset = cursor;
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
    // +1 for the space that `split` consumed.
    cursor += word.length + 1;
  }

  if (current) {
    parts.push({text: current, offset: currentOffset});
  }

  return parts;
}

export {MAX_CHUNK_CHARS, MIN_CHUNK_CHARS};
