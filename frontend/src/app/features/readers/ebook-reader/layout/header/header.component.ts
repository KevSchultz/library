import {Component, EventEmitter, inject, Output} from '@angular/core';
import {TranslocoDirective} from '@jsverse/transloco';
import {ReaderHeaderService} from './header.service';
import {ReaderIconComponent} from '../../shared/icon.component';
import {ReadAloudControlsComponent} from '../../../shared/tts/read-aloud-controls.component';
import {Router} from '@angular/router';

@Component({
  selector: 'app-reader-header',
  standalone: true,
  imports: [TranslocoDirective, ReaderIconComponent, ReadAloudControlsComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class ReaderHeaderComponent {
  private readonly headerService = inject(ReaderHeaderService);
  private readonly router = inject(Router);

  readonly forceVisible = this.headerService.forceVisible;
  readonly isCurrentCfiBookmarked = this.headerService.isCurrentCfiBookmarked;
  readonly isFullscreen = this.headerService.isFullscreen;
  readonly bookTitle = this.headerService.bookTitle;
  readonly theme = this.headerService.theme;
  readonly isReadingAloud = this.headerService.isReadingAloud;
  readonly isReadAloudSupported = this.headerService.isReadAloudSupported;
  @Output() hoverChange = new EventEmitter<boolean>();
  overflowOpen = false;
  readAloudSettingsOpen = false;

  onShowChapters(): void {
    this.headerService.openSidebar();
  }

  onOpenNotes(): void {
    this.headerService.openLeftSidebar('notes');
  }

  onOpenSearch(): void {
    this.headerService.openLeftSidebar('search');
  }

  onCreateBookmark(): void {
    this.headerService.createBookmark();
  }

  onShowControls(): void {
    this.headerService.openControls();
  }

  onToggleFullscreen(): void {
    this.headerService.toggleFullscreen();
  }

  onShowHelp(): void {
    this.headerService.showShortcutsHelp();
  }

  onToggleReadAloud(): void {
    this.headerService.toggleReadAloud();
  }

  onToggleReadAloudSettings(): void {
    this.readAloudSettingsOpen = !this.readAloudSettingsOpen;
  }

  get readAloudLanguage(): string | null {
    return this.headerService.readAloudLanguage();
  }

  onClose(): void {
    if (window.history.length <= 2) {
      this.router.navigate(['/dashboard']);
    } else {
      this.headerService.close();
    }
  }
}
