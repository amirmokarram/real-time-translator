import { desktopCapturer } from 'electron';

export interface AudioSource {
  id: string;
  name: string;
  thumbnail: string;
}

export class AudioCapture {
  private captureActive = false;

  async getSources(): Promise<AudioSource[]> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 240, height: 135 },
        fetchWindowIcons: false,
      });

      return sources.map((src) => ({
        id: src.id,
        name: src.name || 'Screen',
        thumbnail: src.thumbnail.toDataURL(),
      }));
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
