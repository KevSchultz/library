import {DestroyRef, Injectable, computed, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MessageService} from '@openng/optimus-ui/api';
import {TranslocoService} from '@jsverse/transloco';
import {ReaderViewManagerService, ViewEvent} from '../../core/view-manager.service';
import {SpeechQueueService} from '../../../shared/tts/speech-queue.service';
import {SpeechVoiceService} from '../../../shared/tts/speech-voice.service';
import {
  SpeechPlan,
  isSpeakable,
  markNameAtCharIndex,
  ssmlToSpeechPlan
} from '../../../shared/tts/ssml-to-speech.util';
import {TextChunk, chunkForSpeech} from '../../../shared/tts/speech-chunk.util';

/**
 * If a section ends and no new document loads within this window, we are at the
 * end of the book (or navigation failed) and reading stops rather than hanging.
 */
const SECTION_ADVANCE_TIMEOUT_MS = 4000;

/**
 * Read-aloud for the ebook reader.
 *
 * Almost all of the hard work already lives in `assets/foliate/tts.js`, which
 * splits the section into blocks, segments each block into words, and hands back
 * SSML with a `<mark>` per word. This service is the loop around it:
 *
 *   visible range -> tts.from(range) -> SSML -> plain text -> speechSynthesis
 *                                  boundary event -> mark -> tts.setMark() -> highlight
 *
 * Foliate's own highlight callback scrolls the highlighted range into view,
 * which is what turns pages automatically as reading advances.
 */
@Injectable()
export class EbookTtsService {
  private readonly viewManager = inject(ReaderViewManagerService);
  private readonly speech = inject(SpeechQueueService);
  private readonly voiceService = inject(SpeechVoiceService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly t = inject(TranslocoService);

  private readonly _isReading = signal(false);
  readonly isReading = this._isReading.asReadonly();

  readonly status = this.speech.status;
  readonly isSupported = computed(() => this.status() !== 'unavailable');

  /** Most recent visible-page range from `relocate`; the start point for reading. */
  private visibleRange: Range | null = null;
  /** Set while waiting for the next section's document to load. */
  private awaitingSection = false;
  private sectionTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Avoids re-highlighting the same word on every boundary event. */
  private lastMark: string | null = null;
  /** The current block, split into utterance-sized pieces. */
  private chunks: TextChunk[] = [];
  private chunkIndex = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  /** Subscribes to view events. Call once the foliate view exists. */
  initialize(): void {
    this.viewManager.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: ViewEvent) => this.handleViewEvent(event));
  }

  /**
   * Language of the section on screen. Foliate stamps this onto the document in
   * its `load` handler (`doc.documentElement.lang ||= language.canonical`), so it
   * is available without going back to the book metadata.
   */
  documentLanguage(): string | null {
    const doc = this.viewManager.getRenderer()?.getContents()?.[0]?.doc;
    return doc?.documentElement?.lang || null;
  }

  toggle(): void {
    if (this._isReading()) {
      this.stop();
    } else {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (this._isReading()) {
      return;
    }
    if (!await this.speech.prepare()) {
      this.notifyError('readerEbook.toast.readAloudUnsupported');
      return;
    }

    const ready = await this.viewManager.initTTS();
    if (!ready) {
      this.notifyError('readerEbook.toast.readAloudFailed');
      return;
    }

    this._isReading.set(true);
    this.lastMark = null;

    // Start at the top of the page on screen, not the top of the chapter.
    const ssml = this.visibleRange
      ? this.viewManager.ttsFrom(this.visibleRange)
      : this.viewManager.ttsStart();

    this.speakBlock(ssml);
  }

  stop(): void {
    this._isReading.set(false);
    this.awaitingSection = false;
    this.lastMark = null;
    this.chunks = [];
    this.chunkIndex = 0;
    this.clearSectionTimeout();
    this.speech.stop();
  }

  private handleViewEvent(event: ViewEvent): void {
    if (event.type === 'relocate') {
      // Foliate emits the on-screen range with every relocation; it is the only
      // reliable definition of "the current page".
      if (event.detail.range) {
        this.visibleRange = event.detail.range;
      }
      return;
    }

    if (event.type === 'load' && this.awaitingSection) {
      void this.beginLoadedSection();
    }
  }

  /** Speaks one block of SSML, or moves on when there is nothing to say. */
  private speakBlock(ssml: string | undefined): void {
    if (!this._isReading()) {
      return;
    }

    if (!ssml) {
      this.advanceSection();
      return;
    }

    const plan = ssmlToSpeechPlan(ssml);
    if (!isSpeakable(plan)) {
      // Blank block (a spacer div, an image-only paragraph); skip it.
      this.speakBlock(this.viewManager.ttsNext());
      return;
    }

    this.speakPlan(plan);
  }

  /**
   * Speaks one block, a sentence at a time.
   *
   * Sentence-sized utterances keep `stop()` responsive and stay well clear of
   * the Chromium cutoff a whole-paragraph utterance can run into. The pause
   * between blocks stays, which reads as natural paragraph phrasing.
   */
  private speakPlan(plan: SpeechPlan): void {
    const lang = plan.lang ?? this.documentLanguage();
    this.lastMark = null;
    this.chunks = chunkForSpeech(plan.text, lang);
    this.chunkIndex = 0;
    this.speakNextChunk(plan, lang);
  }

  private speakNextChunk(plan: SpeechPlan, lang: string | null): void {
    if (!this._isReading()) {
      return;
    }

    if (this.chunkIndex >= this.chunks.length) {
      this.speakBlock(this.viewManager.ttsNext());
      return;
    }

    const chunk = this.chunks[this.chunkIndex];
    this.chunkIndex += 1;
    const rate = this.voiceService.rate();

    this.speech.speak({
      text: chunk.text,
      lang,
      rate,
      onBoundary: charIndex => {
        // charIndex is relative to the chunk; marks are recorded against the block.
        const mark = markNameAtCharIndex(plan.marks, chunk.offset + charIndex);
        if (mark !== null && mark !== this.lastMark) {
          this.lastMark = mark;
          // Highlights the word and scrolls it into view, turning the page when
          // the word falls beyond the current one.
          this.viewManager.ttsSetMark(mark);
        }
      },
      onEnd: () => this.speakNextChunk(plan, lang),
      onError: () => {
        this.stop();
        this.notifyError('readerEbook.toast.readAloudFailed');
      }
    });
  }

  /**
   * The section's blocks are exhausted. Turn the page — at a section boundary
   * that loads the next document — and pick up again on the `load` event.
   */
  private advanceSection(): void {
    if (!this._isReading() || this.awaitingSection) {
      return;
    }
    this.awaitingSection = true;
    this.clearSectionTimeout();
    this.sectionTimeout = setTimeout(() => {
      // No new document arrived: end of book.
      if (this.awaitingSection) {
        this.stop();
      }
    }, SECTION_ADVANCE_TIMEOUT_MS);

    this.viewManager.next();
  }

  private async beginLoadedSection(): Promise<void> {
    this.awaitingSection = false;
    this.clearSectionTimeout();

    if (!this._isReading()) {
      return;
    }

    const ready = await this.viewManager.initTTS();
    if (!ready) {
      this.stop();
      return;
    }
    this.speakBlock(this.viewManager.ttsStart());
  }

  private clearSectionTimeout(): void {
    if (this.sectionTimeout !== null) {
      clearTimeout(this.sectionTimeout);
      this.sectionTimeout = null;
    }
  }

  private notifyError(key: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: this.t.translate('readerEbook.toast.readAloudSummary'),
      detail: this.t.translate(key)
    });
  }
}
