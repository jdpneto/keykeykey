import sharp from 'sharp';
import { mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const masterSvg = resolve(root, 'assets/icon-master.svg');
const keysOnlySvg = resolve(root, 'assets/icon-keys-only.svg');

async function render(svgPath, size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(svgPath).resize(size, size).png().toFile(outPath);
  console.log(`  ${size}x${size} → ${outPath}`);
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
    await render(masterSvg, size, resolve(d, 'ic_launcher_foreground.png'));
  }

  // Extension icons
  const extIcons = resolve(root, 'apps/extension/icons');
  await render(masterSvg, 128, resolve(extIcons, 'icon-128.png'));
  await render(masterSvg, 48, resolve(extIcons, 'icon-48.png'));
  await render(keysOnlySvg, 16, resolve(extIcons, 'icon-16.png'));

  // Generate .ico and .icns as PNG placeholders
  await render(masterSvg, 256, resolve(tauriIcons, 'icon.ico'));
  await render(masterSvg, 512, resolve(tauriIcons, 'icon.icns'));

  console.log('\nDone! Note: icon.ico and icon.icns are PNG placeholders.');
  console.log('For production, generate proper .ico/.icns using platform tools.');
}

main().catch(console.error);
