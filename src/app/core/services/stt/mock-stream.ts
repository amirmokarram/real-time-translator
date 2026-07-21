// Deterministic STT backend used ONLY by end-to-end tests. It speaks no protocol
// and ignores the audio MediaStream entirely; instead it turns test-driven DOM
// events into the same SttCallbacks the real backends emit, so the whole real
// pipeline downstream (sentence segmentation → queue → translation IPC → UI) runs
// unchanged. Selected via stt.provider === 'mock', which the real UI never sets.
//
// A test drives it with:
//   window.dispatchEvent(new CustomEvent('e2e-stt', { detail: {
//     kind: 'interim' | 'final' | 'utteranceEnd',
//     text?: string,            // for interim/final
//     endOfUtterance?: boolean, // for final
//   }}))
import { ISttStream, SttCallbacks, SttStartOptions } from './stt-stream';

export interface E2eSttDetail {
  kind: 'interim' | 'final' | 'utteranceEnd';
  text?: string;
  endOfUtterance?: boolean;
}

export class MockSttStream implements ISttStream {
  private cb: SttCallbacks | null = null;
  private handler = (event: Event): void => {
    const detail = (event as CustomEvent<E2eSttDetail>).detail;
    const cb = this.cb;
    if (!cb || !detail) return;
    switch (detail.kind) {
      case 'interim':
        cb.interim(detail.text ?? '');
        break;
      case 'final':
        cb.final({
          text: detail.text ?? '',
          endOfUtterance: detail.endOfUtterance ?? false,
        });
        break;
      case 'utteranceEnd':
        cb.utteranceEnd();
        break;
    }
  };

  async start(_stream: MediaStream, _opts: SttStartOptions, cb: SttCallbacks): Promise<void> {
    this.cb = cb;
    window.addEventListener('e2e-stt', this.handler);
  }

  stop(): void {
    window.removeEventListener('e2e-stt', this.handler);
    this.cb = null;
  }
}
