import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { shell } from 'electron';
import { SettingsStore } from '../settings-store';
import { BankEntry, BankMatch, keywordSearch } from './matcher';

// Reads the user-configured Question Bank folder (a tree of markdown Q&A files) and
// keeps a lazily-rebuilt in-memory index. Selection itself is done by the LLM
// router (see ipc-handlers `bank:route`); this class owns the folder, index, and
// file opening. Filesystem access stays here in MAIN — the renderer never touches
// the disk directly.
export class QuestionBank {
  private entries: BankEntry[] = [];
  private indexedFolder = ''; // folder the current index was built from
  private dirty = true; // set by the watcher / folder change → rebuild on next read
  private watcher: fs.FSWatcher | null = null;

  constructor(private readonly settings: SettingsStore) {}

  // Current bank files, index rebuilt if the folder changed or the watcher fired.
  async getEntries(): Promise<BankEntry[]> {
    const { folderPath } = this.settings.get().questionBank;
    if (!folderPath?.trim()) return [];
    await this.ensureIndex(folderPath);
    return this.entries;
  }

  // Offline fallback used only when the LLM router is unavailable.
  async keywordSearch(query: string): Promise<BankMatch[]> {
    const { maxResults } = this.settings.get().questionBank;
    const entries = await this.getEntries();
    return keywordSearch(query, entries, Math.max(1, maxResults || 3));
  }

  // Open a matched file in the OS default markdown handler. The path must be one
  // we actually indexed from the configured folder — never open an arbitrary path
  // handed in from the renderer.
  async open(filePath: string): Promise<{ opened: boolean; error?: string }> {
    const known = this.entries.some((e) => e.path === filePath);
    if (!known) return { opened: false, error: 'File is not part of the question bank' };
    const error = await shell.openPath(filePath);
    return error ? { opened: false, error } : { opened: true };
  }

  // Rebuild the index when the folder changed or the watcher flagged a change.
  private async ensureIndex(folderPath: string): Promise<void> {
    if (folderPath !== this.indexedFolder) {
      this.indexedFolder = folderPath;
      this.dirty = true;
      this.watch(folderPath);
    }
    if (!this.dirty) return;
    this.entries = await this.scan(folderPath);
    this.dirty = false;
  }

  private async scan(folderPath: string): Promise<BankEntry[]> {
    let files: string[];
    try {
      files = await this.collectMarkdown(folderPath);
    } catch {
      return []; // folder missing/unreadable → empty bank, surfaced as "no matches"
    }

    const entries: BankEntry[] = [];
    for (const file of files) {
      try {
        const content = await fsp.readFile(file, 'utf-8');
        entries.push({ path: file, title: titleOf(content, file), content });
      } catch {
        // Skip files we can't read; keep the rest of the bank usable.
      }
    }
    return entries;
  }

  private async collectMarkdown(dir: string): Promise<string[]> {
    const out: string[] = [];
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === '.git' || dirent.name === 'node_modules') continue;
        out.push(...(await this.collectMarkdown(full)));
      } else if (/\.mdx?$/i.test(dirent.name)) {
        out.push(full);
      }
    }
    return out;
  }

  // Recursive watch so edits/adds/removes in the bank invalidate the index. fs.watch
  // recursive is supported on Windows and macOS (the target platforms here).
  private watch(folderPath: string): void {
    this.watcher?.close();
    this.watcher = null;
    try {
      this.watcher = fs.watch(folderPath, { recursive: true }, () => {
        this.dirty = true;
      });
    } catch {
      // Watch unsupported/failed → fall back to rescanning whenever the folder path
      // is re-set; searches still work, just without live invalidation.
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

// The first "# " heading gives the file its display title; fall back to the
// filename (without extension) so untitled files still read sensibly.
function titleOf(content: string, filePath: string): string {
  const heading = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (heading) return heading[1].trim();
  return path.basename(filePath).replace(/\.mdx?$/i, '');
}
