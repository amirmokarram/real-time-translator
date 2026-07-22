/**
 * Rasterizes public/*.svg into the multi-size .ico files Windows needs.
 *
 * Runs under Electron rather than plain Node so we can use Chromium as the SVG
 * rasterizer — that keeps the toolchain at zero extra dependencies (no sharp,
 * no ImageMagick). A hidden window draws each SVG into a canvas at each target
 * size; we read the pixels back and assemble the .ico here.
 *
 *   npm run icons
 *
 * Entries <256px are stored as 32-bit BGRA DIBs and 256px as PNG, which is the
 * layout every mainstream icon tool emits — PNG-only .ico files render fine in
 * the Win11 shell but have a history of trouble in NSIS installer surfaces.
 */
import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TARGETS = [
  // App + installer icon. 256 is required by electron-builder.
  { svg: 'icon.svg', ico: 'icon.ico', sizes: [16, 24, 32, 48, 64, 128, 256] },
  // Browser tab (index.html) — only ever drawn small.
  { svg: 'icon.svg', ico: 'favicon.ico', sizes: [16, 32, 48] },
  // Tray. Windows picks 16/20/24/32 at 100/125/150/200% DPI.
  { svg: 'tray.svg', ico: 'tray.ico', sizes: [16, 20, 24, 32, 40, 48] },
  { svg: 'tray-active.svg', ico: 'tray-active.ico', sizes: [16, 20, 24, 32, 40, 48] },
];

/** Runs in the hidden window: SVG → canvas → raw RGBA (+ PNG for 256px). */
function rasterizeInPage(svgText, size, wantPng) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('SVG failed to load'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const rgba = ctx.getImageData(0, 0, size, size).data;
      let binary = '';
      for (let i = 0; i < rgba.length; i += 8192) {
        binary += String.fromCharCode.apply(null, rgba.subarray(i, i + 8192));
      }
      resolve({
        rgba: btoa(binary),
        png: wantPng ? canvas.toDataURL('image/png').split(',')[1] : null,
      });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
}

/** 32-bit BGRA DIB, bottom-up, with an all-zero AND mask (alpha carries it). */
function toDib(rgba, size) {
  const maskStride = Math.ceil(Math.ceil(size / 8) / 4) * 4;
  const xorSize = size * size * 4;
  const buf = Buffer.alloc(40 + xorSize + maskStride * size);

  buf.writeUInt32LE(40, 0); // biSize
  buf.writeInt32LE(size, 4); // biWidth
  buf.writeInt32LE(size * 2, 8); // biHeight — XOR + AND stacked
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount
  buf.writeUInt32LE(0, 16); // biCompression = BI_RGB
  buf.writeUInt32LE(xorSize, 20); // biSizeImage

  let out = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf[out++] = rgba[i + 2];
      buf[out++] = rgba[i + 1];
      buf[out++] = rgba[i];
      buf[out++] = rgba[i + 3];
    }
  }
  return buf;
}

function buildIco(images) {
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(images.length, 4);

  let offset = dir.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    dir[e] = size >= 256 ? 0 : size; // 0 means 256
    dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bit count
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });

  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

async function main() {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 });
  await win.loadURL('about:blank');

  for (const target of TARGETS) {
    const svg = fs.readFileSync(path.join(PUBLIC, target.svg), 'utf8');
    const images = [];

    for (const size of target.sizes) {
      const usePng = size >= 256;
      const { rgba, png } = await win.webContents.executeJavaScript(
        `(${rasterizeInPage.toString()})(${JSON.stringify(svg)}, ${size}, ${usePng})`
      );
      images.push({
        size,
        data: usePng
          ? Buffer.from(png, 'base64')
          : toDib(Buffer.from(rgba, 'base64'), size),
      });
    }

    const out = path.join(PUBLIC, target.ico);
    fs.writeFileSync(out, buildIco(images));
    console.log(
      `${target.svg} → ${target.ico}  [${target.sizes.join(', ')}]  ` +
        `${(fs.statSync(out).size / 1024).toFixed(1)} KB`
    );
  }

  win.destroy();
}

app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
