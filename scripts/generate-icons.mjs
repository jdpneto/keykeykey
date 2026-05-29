import sharp from 'sharp';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const masterPng = resolve(root, 'assets/icon-master.png');
const featureGraphic = resolve(root, 'assets/android-feature-graphic.png');
const androidAdaptiveForegroundContentScale = 0.8;
const androidAdaptiveForegroundSourceSize = 1024;

async function render(pngPath, size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(pngPath).resize(size, size, { fit: 'cover' }).png().toFile(outPath);
  console.log(`  ${size}x${size} → ${outPath}`);
}

async function renderAndroidAdaptiveForeground(pngPath, size, outPath, format = 'png') {
  mkdirSync(dirname(outPath), { recursive: true });
  const { data, info } = await sharp(pngPath)
    .resize(androidAdaptiveForegroundSourceSize, androidAdaptiveForegroundSourceSize, {
      fit: 'cover',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const topCutoff = Math.round(info.height * 0.18);

  for (let i = 0; i < data.length; i += channels) {
    const pixel = i / channels;
    const y = Math.floor(pixel / info.width);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const greenGlow = g > 44 && g > r * 1.18 && g > b * 1.18;
    const metalKey = y > topCutoff && max > 92 && saturation < 95;

    if (!greenGlow && !metalKey) {
      data[i + 3] = 0;
      continue;
    }

    const alphaFromBrightness = Math.max(0, Math.min(255, (max - 58) * 4.8));
    const alphaFromGlow = greenGlow ? Math.max(0, Math.min(220, (g - 30) * 3.8)) : 0;
    data[i + 3] = Math.max(alphaFromBrightness, alphaFromGlow);
  }

  const extracted = await sharp(data, { raw: info }).png().toBuffer();
  const contentSize = Math.round(size * androidAdaptiveForegroundContentScale);
  const content = await sharp(extracted)
    .resize(contentSize, contentSize, { fit: 'contain' })
    .png()
    .toBuffer();
  let image = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: content, gravity: 'center' }]);
  image = format === 'webp' ? image.webp({ quality: 95, effort: 6 }) : image.png();
  await image.toFile(outPath);
  console.log(`  ${size}x${size} Android adaptive foreground → ${outPath}`);
}

async function renderBuffer(pngPath, size) {
  return sharp(pngPath).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

async function generateIco(pngPath, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(sizes.map((s) => renderBuffer(pngPath, s)));
  const icoBuffer = await pngToIco(buffers);
  writeFileSync(outPath, icoBuffer);
  console.log(`  multi-size ICO (${sizes.join(', ')}px) → ${outPath}`);
}

async function generateIcns(pngPath, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  if (process.platform !== 'darwin') {
    console.warn(
      `  WARNING: Skipping ${outPath} — .icns generation requires macOS (iconutil). ` +
        'Run this script on macOS to generate a proper .icns file.',
    );
    return;
  }
  const tmpBase = mkdtempSync(resolve(tmpdir(), 'icon-gen-'));
  const iconsetDir = resolve(tmpBase, 'icon.iconset');
  mkdirSync(iconsetDir);
  try {
    const icnsSizes = [
      { name: 'icon_16x16.png', size: 16 },
      { name: 'icon_16x16@2x.png', size: 32 },
      { name: 'icon_32x32.png', size: 32 },
      { name: 'icon_32x32@2x.png', size: 64 },
      { name: 'icon_128x128.png', size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png', size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png', size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ];
    for (const { name, size } of icnsSizes) {
      await render(pngPath, size, resolve(iconsetDir, name));
    }
    execFileSync('iconutil', ['--convert', 'icns', '--output', outPath, iconsetDir]);
    console.log(`  .icns via iconutil → ${outPath}`);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Generating icons from raster PNG masters...\n');

  // Root raster deliverables.
  for (const size of [64, 128, 256, 512]) {
    await render(masterPng, size, resolve(root, `assets/icon-${size}.png`));
  }
  await sharp(featureGraphic)
    .resize(1024, 500, { fit: 'cover', position: 'center' })
    .png()
    .toFile(resolve(root, 'apps/mobile/assets/android-feature-graphic.png'));

  // Mobile (Expo) — 1024x1024
  await render(masterPng, 1024, resolve(root, 'apps/mobile/assets/icon.png'));
  await renderAndroidAdaptiveForeground(
    masterPng,
    1024,
    resolve(root, 'apps/mobile/assets/adaptive-icon-foreground.png'),
  );

  // Desktop (Tauri) — main icons
  const tauriIcons = resolve(root, 'apps/desktop/src-tauri/icons');
  await render(masterPng, 512, resolve(tauriIcons, 'icon.png'));
  await render(masterPng, 256, resolve(tauriIcons, '128x128@2x.png'));
  await render(masterPng, 128, resolve(tauriIcons, '128x128.png'));
  await render(masterPng, 64, resolve(tauriIcons, '64x64.png'));
  await render(masterPng, 32, resolve(tauriIcons, '32x32.png'));

  // Desktop — Windows Store squares
  for (const size of [310, 284, 150, 142, 107, 89, 71, 44, 30]) {
    await render(masterPng, size, resolve(tauriIcons, `Square${size}x${size}Logo.png`));
  }
  await render(masterPng, 50, resolve(tauriIcons, 'StoreLogo.png'));

  // Desktop — iOS icons
  const iosDir = resolve(tauriIcons, 'ios');
  const iosSizes = [
    { name: 'AppIcon-20x20@1x.png', size: 20 },
    { name: 'AppIcon-20x20@2x.png', size: 40 },
    { name: 'AppIcon-20x20@3x.png', size: 60 },
    { name: 'AppIcon-29x29@1x.png', size: 29 },
    { name: 'AppIcon-29x29@2x.png', size: 58 },
    { name: 'AppIcon-29x29@3x.png', size: 87 },
    { name: 'AppIcon-40x40@1x.png', size: 40 },
    { name: 'AppIcon-40x40@2x.png', size: 80 },
    { name: 'AppIcon-40x40@3x.png', size: 120 },
    { name: 'AppIcon-60x60@2x.png', size: 120 },
    { name: 'AppIcon-60x60@3x.png', size: 180 },
    { name: 'AppIcon-76x76@1x.png', size: 76 },
    { name: 'AppIcon-76x76@2x.png', size: 152 },
    { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },
    { name: 'AppIcon-512@2x.png', size: 1024 },
  ];
  for (const { name, size } of iosSizes) {
    await render(masterPng, size, resolve(iosDir, name));
  }

  // Desktop — Android icons
  const androidDir = resolve(tauriIcons, 'android');
  const androidDensities = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];
  for (const { dir, size } of androidDensities) {
    const d = resolve(androidDir, dir);
    await render(masterPng, size, resolve(d, 'ic_launcher.png'));
    await render(masterPng, size, resolve(d, 'ic_launcher_round.png'));
    await renderAndroidAdaptiveForeground(
      masterPng,
      size,
      resolve(d, 'ic_launcher_foreground.png'),
    );
  }

  // Mobile Android native resources — adaptive foreground uses the Android safe area.
  const mobileAndroidRes = resolve(root, 'apps/mobile/android/app/src/main/res');
  const mobileAndroidDensities = [
    { dir: 'mipmap-mdpi', iconSize: 48, foregroundSize: 108 },
    { dir: 'mipmap-hdpi', iconSize: 72, foregroundSize: 162 },
    { dir: 'mipmap-xhdpi', iconSize: 96, foregroundSize: 216 },
    { dir: 'mipmap-xxhdpi', iconSize: 144, foregroundSize: 324 },
    { dir: 'mipmap-xxxhdpi', iconSize: 192, foregroundSize: 432 },
  ];
  for (const { dir, iconSize, foregroundSize } of mobileAndroidDensities) {
    const d = resolve(mobileAndroidRes, dir);
    await render(masterPng, iconSize, resolve(d, 'ic_launcher.webp'));
    await render(masterPng, iconSize, resolve(d, 'ic_launcher_round.webp'));
    await renderAndroidAdaptiveForeground(
      masterPng,
      foregroundSize,
      resolve(d, 'ic_launcher_foreground.webp'),
      'webp',
    );
  }

  // Extension icons
  const extIcons = resolve(root, 'apps/extension/icons');
  await render(masterPng, 128, resolve(extIcons, 'icon-128.png'));
  await render(masterPng, 48, resolve(extIcons, 'icon-48.png'));
  await render(masterPng, 16, resolve(extIcons, 'icon-16.png'));

  // Windows .ico — proper multi-size ICO
  await generateIco(masterPng, resolve(tauriIcons, 'icon.ico'));

  // macOS .icns — via iconutil (macOS only)
  await generateIcns(masterPng, resolve(tauriIcons, 'icon.icns'));

  console.log('\nDone!');
}

main().catch(console.error);
