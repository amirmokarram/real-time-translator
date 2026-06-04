import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.html',
  styleUrl: './overlay.scss',
})
export class OverlayComponent implements OnInit, OnDestroy {
  private bridge = inject(ElectronBridgeService);

  protected english = signal('');
  protected persian = signal('');
  protected isTranslating = signal(false);

  protected clickThrough = signal(false);
  protected fontSize = signal(24);
  protected showEnglish = signal(true);

  private unsubs: Array<() => void> = [];

  ngOnInit(): void {
    this.unsubs.push(
      this.bridge.onTranslationSource((text) => {
        this.english.set(text);
        this.persian.set('');
        this.isTranslating.set(true);
      }),
      this.bridge.onTranslationChunk((chunk) => {
        this.persian.update((s) => s + chunk);
      }),
      this.bridge.onTranslationComplete((text) => {
        this.persian.set(text);
        this.isTranslating.set(false);
      })
    );
  }

  ngOnDestroy(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  protected close(): void {
    this.bridge.closeOverlay();
  }

  protected toggleClickThrough(): void {
    const next = !this.clickThrough();
    this.clickThrough.set(next);
    // Enable forwarding so the toolbar can still wake on hover
    this.bridge.setOverlayMouseIgnore(next, true);
  }

  protected toggleEnglish(): void {
    this.showEnglish.update((v) => !v);
  }

  protected biggerFont(): void {
    this.fontSize.update((v) => Math.min(48, v + 2));
  }

  protected smallerFont(): void {
    this.fontSize.update((v) => Math.max(14, v - 2));
  }

  // When click-through is on, hovering the toolbar temporarily re-enables clicks
  protected onToolbarEnter(): void {
    if (this.clickThrough()) this.bridge.setOverlayMouseIgnore(false, false);
  }

  protected onToolbarLeave(): void {
    if (this.clickThrough()) this.bridge.setOverlayMouseIgnore(true, true);
  }
}
