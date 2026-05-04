// Генерация PNG-иконок из SVG для PWA-манифеста.
// Запуск: pnpm icons
//
// Источники: public/icons/icon.svg (обычная) и icon-maskable.svg (для Android adaptive).
// Пересоздаёт PNG идемпотентно — можно гонять сколько угодно раз.

import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const p = (rel) => path.join(root, rel)

const targets = [
  { svg: 'public/icons/icon.svg',          out: 'public/icons/icon-192.png',             size: 192 },
  { svg: 'public/icons/icon.svg',          out: 'public/icons/icon-512.png',             size: 512 },
  { svg: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-192.png',    size: 192 },
  { svg: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-512.png',    size: 512 },
  { svg: 'public/icons/icon.svg',          out: 'public/icons/apple-touch-icon-180.png', size: 180 },
]

for (const { svg, out, size } of targets) {
  await sharp(await readFile(p(svg)))
    .resize(size, size)
    .png()
    .toFile(p(out))
  console.log(`✓ ${out} (${size}×${size})`)
}
