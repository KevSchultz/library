import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal} from '@angular/core';
import {TranslocoDirective} from '@jsverse/transloco';
import {RATE_MAX, RATE_MIN, SpeechVoiceService} from './speech-voice.service';
import {SpeechQueueService} from './speech-queue.service';

/**
 * Voice and speed controls for read-aloud, shared by the ebook and PDF readers.
 *
 * What is on offer depends on which engine won. Kokoro ships one voice, so it
 * gets a speed control and nothing to pick; the Web Speech fallback gets the
 * browser's voice list, ordered best-first for the book's language — see
 * `voice-ranking.util.ts` for why that ordering is the most we can do there.
 */
@Component({
  selector: 'app-read-aloud-controls',
  standalone: true,
  imports: [TranslocoDirective],
  templateUrl: './read-aloud-controls.component.html',
  styleUrls: ['./read-aloud-controls.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReadAloudControlsComponent implements OnInit {
  /** Book language, used to order the voice list. */
  @Input() lang: string | null = null;
  @Output() closed = new EventEmitter<void>();

  private readonly voiceService = inject(SpeechVoiceService);
  private readonly speech = inject(SpeechQueueService);

  readonly rateMin = RATE_MIN;
  readonly rateMax = RATE_MAX;

  readonly rate = this.voiceService.rate;
  readonly selectedVoiceURI = this.voiceService.selectedVoiceURI;

  private readonly langSignal = signal<string | null>(null);

  /** Best-first for this book's language. */
  readonly voices = computed(() => this.voiceService.voicesFor(this.langSignal()));

  private readonly hasVoices = computed(() => this.voices().length > 0);

  /** Kokoro has a single built-in voice, so there is nothing to choose between. */
  readonly isKokoro = computed(() => this.speech.engineId() === 'kokoro');

  readonly showVoicePicker = computed(
    () => this.speech.engineId() === 'web-speech' && this.hasVoices(),
  );

  /**
   * Only meaningful for the fallback engine: Kokoro brings its own voice, so a
   * device with no OS voices installed is not a problem there.
   */
  readonly showNoVoices = computed(
    () => this.speech.engineId() === 'web-speech' && !this.hasVoices(),
  );

  ngOnInit(): void {
    this.langSignal.set(this.lang);
    this.voiceService.load();
  }

  onVoiceChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    // The empty option means "let Grimmory choose the best available voice".
    this.voiceService.selectVoice(value || null);
  }

  onRateChange(event: Event): void {
    this.voiceService.setRate(Number((event.target as HTMLInputElement).value));
  }

  resetRate(): void {
    this.voiceService.setRate(1);
  }

  close(): void {
    this.closed.emit();
  }
}
