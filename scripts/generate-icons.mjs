import sharp from 'sharp';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const masterSvg = resolve(root, 'assets/icon-master.svg');
const keysOnlySvg = resolve(root, 'assets/icon-keys-only.svg');

async function render(svgPath, size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(svgPath).resize(size, size).png().toFile(outPath);
  console.log(`  ${size}x${size} → ${outPath}`);
}

async function renderBuffer(svgPath, size) {
  return sharp(svgPath).resize(size, size).png().toBuffer();
}

async function generateIco(svgPath, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(sizes.map((s) => renderBuffer(svgPath, s)));
  const icoBuffer = await pngToIco(buffers);
  writeFileSync(outPath, icoBuffer);
  console.log(`  multi-size ICO (${sizes.join(', ')}px) → ${outPath}`);
}

async function generateIcns(svgPath, outPath) {
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
      await render(svgPath, size, resolve(iconsetDir, name));
    }
    execFileSync('iconutil', ['--convert', 'icns', '--output', outPath, iconsetDir]);
    console.log(`  .icns via iconutil → ${outPath}`);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Generating icons from master SVG...\n');

  // Mobile (Expo) — 1024x1024
  await render(masterSvg, 1024, resolve(root, 'apps/mobile/assets/icon.png'));

  // Desktop (Tauri) — main icons
  const tauriIcons = resolve(root, 'apps/desktop/src-tauri/icons');
  await render(masterSvg, 512, resolve(tauriIcons, 'icon.png'));
  await render(masterSvg, 256, resolve(tauriIcons, '128x128@2x.png'));
  await render(masterSvg, 128, resolve(tauriIcons, '128x128.png'));
  await render(masterSvg, 64, resolve(tauriIcons, '64x64.png'));
  await render(masterSvg, 32, resolve(tauriIcons, '32x32.png'));

  // Desktop — Windows Store squares
  for (const size of [310, 284, 150, 142, 107, 89, 71, 44, 30]) {
    await render(masterSvg, size, resolve(tauriIcons, `Square${size}x${size}Logo.png`));
  }
  await render(masterSvg, 50, resolve(tauriIcons, 'StoreLogo.png'));

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
    await render(masterSvg, size, resolve(iosDir, name));
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
    await render(masterSvg, size, resolve(d, 'ic_launcher.png'));
    await render(masterSvg, size, resolve(d, 'ic_launcher_round.png'));
    await render(keysOnlySvg, size, resolve(d, 'ic_launcher_foreground.png'));
  }

  // Extension icons
  const extIcons = resolve(root, 'apps/extension/icons');
  await render(masterSvg, 128, resolve(extIcons, 'icon-128.png'));
  await render(masterSvg, 48, resolve(extIcons, 'icon-48.png'));
  await render(keysOnlySvg, 16, resolve(extIcons, 'icon-16.png'));

  // Windows .ico — proper multi-size ICO
  await generateIco(masterSvg, resolve(tauriIcons, 'icon.ico'));

  // macOS .icns — via iconutil (macOS only)
  await generateIcns(masterSvg, resolve(tauriIcons, 'icon.icns'));

  console.log('\nDone!');
}

main().catch(console.error);
