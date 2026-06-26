// Клиентское сжатие фото ПЕРЕД E2E-шифрованием.
//
// Почему на клиенте и до шифрования: зашифрованный блоб для сервера —
// случайный шум, его уже не ужмёшь. Поэтому resize + перекодирование в JPEG
// делаем здесь, до AES-GCM (CLAUDE.md, раздел «Путь»: «медиа сжимается на
// клиенте перед шифрованием»). Цель — уложиться в ~300КБ, чтобы лента грузилась
// быстро и Storage не разрастался.

const MAX_EDGE = 1200 // большая сторона фото, px
const TARGET_BYTES = 300 * 1024 // цель размера готового JPEG
const START_QUALITY = 0.8
const MIN_QUALITY = 0.5 // ниже — заметная деградация, дальше не давим
const QUALITY_STEP = 0.1

/**
 * Сжать выбранное фото: ужать до MAX_EDGE по большей стороне, перекодировать в
 * JPEG, по возможности уложиться в TARGET_BYTES (постепенно снижая quality, но
 * не ниже MIN_QUALITY). Возвращает JPEG-Blob, готовый к шифрованию.
 */
export async function compressImage(file: File): Promise<Blob> {
  // imageOrientation: 'from-image' — применяет EXIF-поворот, иначе фото с
  // телефона может лечь боком (камера пишет ориентацию в метаданные).
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas_2d_unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)

    // Снижаем quality шагами, пока не уложимся в цель или не упрёмся в минимум.
    let quality = START_QUALITY
    let blob = await canvasToJpeg(canvas, quality)
    while (blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, Math.round((quality - QUALITY_STEP) * 100) / 100)
      blob = await canvasToJpeg(canvas, quality)
    }
    return blob
  } finally {
    // Освобождаем декодированный битмап — он держит память до GC.
    bitmap.close()
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas_toBlob_failed'))),
      'image/jpeg',
      quality,
    )
  })
}
