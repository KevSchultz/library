/**
 * Turning a PDF page's extracted text into something worth speaking.
 *
 * PDFium hands back text with the page's *visual* line breaks baked in, so a
 * sentence arrives split across several lines and long words are hyphenated at
 * the margin. Fed straight to a speech engine that produces audible stumbles at
 * every line ending, so we rebuild the prose first.
 */
import {MAX_CHUNK_CHARS, chunkForSpeech} from '../../shared/tts/speech-chunk.util';

/**
 * Rejoins hyphenated line breaks, folds visual line breaks into spaces and
 * collapses the leftover whitespace.
 */
export function normalisePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // "inter-\nesting" is one word split by the margin, not two.
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits text into speakable chunks — sentences where possible.
 *
 * `Intl.Segmenter` knows about abbreviations and non-Latin scripts in a way a
 * regex does not, but it is not everywhere, hence the fallback.
 */
export function splitIntoSentences(text: string, lang: string | null): string[] {
  const normalised = normalisePdfText(text);
  if (!normalised) {
    return [];
  }

  // The PDF path has no use for the offsets; the ebook reader does.
  return chunkForSpeech(normalised, lang).map(chunk => chunk.text);
}

/**
 * True when a page yielded no usable text. Pages of a scanned book look like
 * this for every page, which is how we tell the user OCR would be needed.
 */
export function isPageTextEmpty(text: string | null): boolean {
  return !text || normalisePdfText(text).length === 0;
}

export {MAX_CHUNK_CHARS};
