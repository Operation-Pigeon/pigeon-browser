// Renders the app icon from build/logo.svg, the same mark the web app uses.
// Writes build/icon.png (512) and build/icon.ico (16 through 256).
// Run: npx electron tools/render-icon.js
//
// Chromium does the rasterising because it is the only renderer here that
// draws SVG properly, and each size is rendered from the vector rather than
// downscaled from one big bitmap: the mark was drawn to stay legible at 16px,
// and shrinking a 512px render smears exactly the detail that was tuned for.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const CANVAS = 512;
const root = join(__dirname, '..');
const svg = readFileSync(join(root, 'build', 'logo.svg'), 'utf8');

/**
 * Packs PNGs into an .ico.
 *
 * Every entry is a PNG rather than a BMP. Windows has accepted PNG-compressed
 * icon entries since Vista, and it avoids hand-rolling a BMP encoder with its
 * upside-down rows and separate AND mask.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, png }, i) => {
    const at = i * 16;
    // 256 is stored as 0: the field is one byte and 256 does not fit in it.
    directory.writeUInt8(size >= 256 ? 0 : size, at + 0);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette entries
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.png)]);
}

/**
 * Draws the mark at one size into the corner of a fixed canvas and captures
 * just that square.
 *
 * Reuses one window for every size. Creating and destroying an offscreen
 * window per size fails: the first render succeeds and every one after it
 * comes back ERR_FAILED, with nothing to say why. A fixed canvas also means
 * no resizing between captures.
 *
 * Loaded from a temp file rather than a data: URL, because the mark carries
 * long comments and the encoded URL runs past what Chromium will load.
 */
async function renderAt(win, size) {
  const marked = svg
    .replace(/width="64"/, `width="${size}"`)
    .replace(/height="64"/, `height="${size}"`);
  // The SVG carries its own rounded background, so the page behind it only
  // has to stay out of the way.
  // overflow:hidden matters at the largest size, where the mark exactly
  // fills the canvas: without it Chromium shows scrollbars and they land in
  // the capture as grey strips down the right and bottom edges.
  const html = `<!doctype html><html style="overflow:hidden">
    <body style="margin:0;overflow:hidden;background:transparent">
    <div style="width:${size}px;height:${size}px">${marked}</div></body></html>`;

  const page = join(tmpdir(), 'pigeon-icon.html');
  writeFileSync(page, html);
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  unlinkSync(page);
  return image;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: CANVAS,
    height: CANVAS,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });

  const images = [];
  for (const size of SIZES) {
    images.push({ size, png: (await renderAt(win, size)).toPNG() });
    console.log(`rendered ${size}x${size}`);
  }
  writeFileSync(join(root, 'build', 'icon.png'), (await renderAt(win, CANVAS)).toPNG());
  writeFileSync(join(root, 'build', 'icon.ico'), buildIco(images));
  console.log(`wrote build/icon.png (${CANVAS}) and build/icon.ico (${images.length} sizes)`);

  win.destroy();
  app.quit();
});
