import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { MessageService } from '@openng/optimus-ui/api';
import { TranslocoService } from '@jsverse/transloco';
import { EmbedPdfBookService } from './embedpdf-book.service';
import { SpeechQueueService } from '../../shared/tts/speech-queue.service';
import { LOOKAHEAD } from '../../shared/tts/kokoro.engine';
import { SpeechVoiceService } from '../../shared/tts/speech-voice.service';
import { isPageTextEmpty, splitIntoSentences } from '../utils/pdf-text.util';

/**
 * How many consecutive text-free pages we tolerate before concluding the PDF has
 * no text layer. A scanned book looks exactly like this on every page, and the
 * only fix is OCR — so we say so instead of silently doing nothing.
 */
const MAX_CONSECUTIVE_EMPTY_PAGES = 3;

/**
 * Read-aloud for the PDF reader.
 *
 * Unlike the ebook reader — which gets word-level marks from foliate — a PDF's
 * text layer is just characters with coordinates, so this reads sentence by
 * sentence and turns the page when it runs out. There is no word highlighting.
 *
 * Only the `book` viewer mode is supported. In `document` mode EmbedPDF lives
 * inside an iframe and would need the message protocol extended to reach it.
 */
@Injectable()
export class PdfTtsService {
  private readonly speech = inject(SpeechQueueService);
  private readonly voiceService = inject(SpeechVoiceService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly t = inject(TranslocoService);

  private readonly _isReading = signal(false);
  readonly isReading = this._isReading.asReadonly();

  readonly status = this.speech.status;
  readonly isSupported = computed(() => this.status() !== 'unavailable');

  private book: EmbedPdfBookService | null = null;
  private language: string | null = null;

  /** Zero-based index of the page being read. */
  private pageIndex = 0;
  private sentences: string[] = [];
  private sentenceIndex = 0;
  private consecutiveEmptyPages = 0;
  /** The slow-device warning is shown at most once per reading session. */
  private warnedSlow = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  initialize(book: EmbedPdfBookService, language: string | null): void {
    this.book = book;
    this.language = language;
  }

  toggle(): void {
    if (this._isReading()) {
      this.stop();
    } else {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (this._isReading() || !this.book) {
      return;
    }
    // Inside the toolbar click, so the AudioContext Kokoro needs is allowed to start.
    if (!await this.speech.prepare()) {
      this.notify('readerPdf.toast.readAloudUnsupported');
      return;
    }

    this._isReading.set(true);
    this.consecutiveEmptyPages = 0;
    this.warnedSlow = false;

    // `currentPage` is 1-based; page text is addressed zero-based.
    this.pageIndex = Math.max(0, this.book.currentPage - 1);
    await this.loadAndSpeakPage();
  }

  stop(): void {
    this._isReading.set(false);
    this.sentences = [];
    this.sentenceIndex = 0;
    this.speech.stop();
  }

  private async loadAndSpeakPage(): Promise<void> {
    const book = this.book;
    if (!this._isReading() || !book) {
      return;
    }

    const text = await book.getPageText(this.pageIndex);
    if (!this._isReading()) {
      return;
    }

    if (isPageTextEmpty(text)) {
      this.consecutiveEmptyPages += 1;
      if (this.consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
        // Every page so far has been image-only: this is a scanned document.
        this.stop();
        this.notify('readerPdf.toast.readAloudNoText');
        return;
      }
      this.advancePage();
      return;
    }

    this.consecutiveEmptyPages = 0;
    this.sentences = splitIntoSentences(text ?? '', this.language);
    this.sentenceIndex = 0;
    this.speakNextSentence();
  }

  private speakNextSentence(): void {
    if (!this._isReading()) {
      return;
    }

    if (this.sentenceIndex >= this.sentences.length) {
      this.advancePage();
      return;
    }

    const sentence = this.sentences[this.sentenceIndex];
    this.sentenceIndex += 1;
    const rate = this.voiceService.rate();

    this.speech.speak({
      text: sentence,
      lang: this.language,
      rate,
      onEnd: () => this.speakNextSentence(),
      onError: () => {
        this.stop();
        this.notify('readerPdf.toast.readAloudFailed');
      }
    });

    // Generate the following sentences while this one plays. Without this, a
    // synthesising engine leaves an audible gap at every sentence boundary; one
    // sentence of lead is not enough when generation is near real time, so keep
    // several in flight.
    this.warnIfSlow();

    for (let i = 0; i < LOOKAHEAD; i++) {
      const upcoming = this.sentences[this.sentenceIndex + i];
      if (upcoming) {
        this.speech.prefetch(upcoming, rate);
      }
    }
  }

  private advancePage(): void {
    const book = this.book;
    if (!this._isReading() || !book) {
      return;
    }

    const nextIndex = this.pageIndex + 1;
    if (nextIndex >= book.totalPages) {
      this.stop();
      return;
    }

    this.pageIndex = nextIndex;
    // scrollToPage takes a 1-based page number.
    book.scrollToPage(nextIndex + 1, 'smooth');
    void this.loadAndSpeakPage();
  }

  /**
   * Says why the gaps are there. Synthesis slower than playback cannot be fixed
   * by buffering — the buffer drains — so silence about it just looks broken.
   */
  private warnIfSlow(): void {
    if (this.warnedSlow || !this.speech.cannotKeepUp()) {
      return;
    }
    this.warnedSlow = true;
    this.notify('readerPdf.toast.readAloudSlow');
  }

  private notify(key: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: this.t.translate('readerPdf.toast.readAloudSummary'),
      detail: this.t.translate(key)
    });
  }
}
