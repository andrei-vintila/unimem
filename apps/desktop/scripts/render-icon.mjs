// Render build/icon.svg to the 1024x1024 build/icon.png that electron-builder
// turns into .icns and .ico at package time.
//
// Run with `pnpm run icon`. Uses the Electron already in devDependencies rather
// than adding an SVG rasterizer - the renderer is a browser, and this is the
// same engine that will draw the app.

import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(packageRoot, 'build/icon.svg');
const output = path.join(packageRoot, 'build/icon.png');

const svg = fs.readFileSync(source, 'utf8');

// The page background stays transparent so the tile's rounded corners are
// actually round; macOS composites the icon over whatever is behind it.
const html = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style>
${svg}`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const captured = await win.webContents.capturePage();

  // On a HiDPI display capturePage returns the backing-store size, so normalise
  // rather than shipping a 2048px file that claims to be 1024.
  const icon = captured.getSize().width === SIZE
    ? captured
    : captured.resize({ width: SIZE, height: SIZE, quality: 'best' });

  fs.writeFileSync(output, icon.toPNG());

  // A corner pixel must stay transparent; if it came out opaque the rounded
  // tile silently became a square and every platform would ship it that way.
  const { width } = icon.getSize();
  const cornerAlpha = icon.getBitmap()[3];
  const centerOffset = (Math.floor(width / 2) * width + Math.floor(width / 2)) * 4;
  const centerAlpha = icon.getBitmap()[centerOffset + 3];

  console.log(`Wrote ${path.relative(packageRoot, output)} at ${width}x${width}`);
  console.log(`  corner alpha ${cornerAlpha} (want 0), center alpha ${centerAlpha} (want 255)`);

  app.exit(cornerAlpha === 0 && centerAlpha === 255 ? 0 : 1);
});
