import { app } from 'electron';
import * as path from 'path';

/**
 * Absolute path to a file in public/. Dev reads it straight from the repo
 * (…/dist-electron/../public); the packaged app from extraResources
 * (electron-builder.json copies public/ → resources/public).
 */
export function publicAsset(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'public', name)
    : path.join(__dirname, '../public', name);
}
