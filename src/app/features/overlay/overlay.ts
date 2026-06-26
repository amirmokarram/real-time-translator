import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { Language, languageByCode } from '../../core/models/languages';

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.html',
  styleUrl: './overlay.scss',
})
export class OverlayComponent implements OnInit, OnDestroy {
  private bridge = inject(ElectronBridgeService);

  protected source = signal('');
  protected target = signal('');
  protected isTranslating = signal(false);

  protected clickThrough = signal(false);
  protected fontSize = signal(24);
  protected showSource = signal(true);

  // Configured languages — drive the per-line direction/font and the toolbar label.
  // The overlay only subscribes to translation events, so it reads settings once.
  protected sourceLang = signal<Language>(languageByCode('en'));
  protected targetLang = signal<Language>(languageByCode('fa'));

  private unsubs: Array<() => void> = [];

  ngOnInit(): void {
    void this.bridge.getSettings().then((s) => {
      this.sourceLang.set(languageByCode(s.languages.source));
      this.targetLang.set(languageByCode(s.languages.target));
    });

    this.unsubs.push(
      this.bridge.onTranslationSource((text) => {
        this.source.set(text);
        this.target.set('');
        this.isTranslating.set(true);
      }),
      this.bridge.onTranslationChunk((chunk) => {
        this.target.update((s) => s + chunk);
      }),
      this.bridge.onTranslationComplete((text) => {
        this.target.set(text);
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

  protected toggleSource(): void {
    this.showSource.update((v) => !v);
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
