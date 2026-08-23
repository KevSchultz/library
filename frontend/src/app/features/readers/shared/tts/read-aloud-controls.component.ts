import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal} from '@angular/core';
import {TranslocoDirective} from '@jsverse/transloco';
import {RATE_MAX, RATE_MIN, SpeechVoiceService} from './speech-voice.service';

/**
 * Voice and speed controls for read-aloud, shared by the ebook and PDF readers.
 *
 * The voices on offer come from the device the reader is running on, ordered
 * best-first for the book's language — see `voice-ranking.util.ts` for how
 * "best" is decided and why low-quality and novelty voices are hidden.
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

  readonly rateMin = RATE_MIN;
  readonly rateMax = RATE_MAX;

  readonly rate = this.voiceService.rate;
  readonly selectedVoiceURI = this.voiceService.selectedVoiceURI;

  private readonly langSignal = signal<string | null>(null);

  /** Best-first for this book's language. */
  readonly voices = computed(() => this.voiceService.voicesFor(this.langSignal()));

  readonly hasVoices = computed(() => this.voices().length > 0);

  /**
   * Whether the device is offering only its lower-quality voices, so the hint
   * about downloading better ones is worth the space.
   */
  readonly showQualityHint = computed(() => this.voiceService.lacksHighQualityVoice(this.langSignal()));

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
