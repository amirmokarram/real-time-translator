import { desktopCapturer } from 'electron';

export interface AudioSource {
  id: string;
  name: string;
  kind: 'system' | 'microphone';
  thumbnail?: string;
}

export class AudioCapture {
  private captureActive = false;

  // Returns a single "System Audio" entry. Chromium still requires a real
  // screen source id to drive its desktop-audio loopback, so we grab the first
  // screen and embed its id (microphones are enumerated in the renderer).
  async getSources(): Promise<AudioSource[]> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        fetchWindowIcons: false,
      });

      if (sources.length === 0) return [];

      return [
        {
          id: `system:${sources[0].id}`,
          name: 'System Audio',
          kind: 'system',
        },
      ];
    } catch {
      return [];
    }
  }

  // Actual audio capture happens in renderer via getUserMedia.
  // Main process only tracks active state for IPC queries.
  startCapture(_sourceId: string): void {
    this.captureActive = true;
  }

  stopCapture(): void {
    this.captureActive = false;
  }

  isActive(): boolean {
    return this.captureActive;
  }
}
