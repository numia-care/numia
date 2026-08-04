import { decryptBytes } from '@/lib/crypto/envelope'
import { base64ToBytes } from '@/lib/crypto/pin'
import { requireDek } from '@/lib/path/entries'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'path-media'

/**
 * Показать фото бланка: скачать шифроблоб → расшифровать в памяти → отдать
 * object URL для <img src>.
 *
 * Зеркало loadMediaUrl «Пути» (lib/path/entries.ts). Отличие одно: у бланков
 * тип всегда image/jpeg — их гонит через compressImage, который отдаёт JPEG
 * и ничего кроме, — поэтому разветвления по типу записи, как mediaMimeType
 * там, здесь нет.
 *
 * ТОЛЬКО КЛИЕНТ: нужен DEK из памяти вкладки, на сервере его нет.
 * Бросает PinRequiredError, если PIN-сессия истекла.
 *
 * ВАЖНО: вызывающий ОБЯЗАН вызвать URL.revokeObjectURL(url), когда картинка
 * больше не нужна (размонтирование, замена файла). Иначе РАСШИФРОВАННЫЙ блоб
 * висит в памяти вкладки до перезагрузки страницы — это и утечка памяти, и
 * лишнее время жизни открытых данных.
 */
export async function loadBlankPhotoUrl(
  path: string,
  ivB64: string,
): Promise<string> {
  const dek = requireDek()
  const supabase = createClient()

  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) {
    throw new Error(`blank_photo_download_failed: ${error?.message ?? 'no data'}`)
  }

  const ciphertext = new Uint8Array(await data.arrayBuffer())
  const iv = base64ToBytes(ivB64)
  const plain = await decryptBytes(dek, iv, ciphertext)

  return URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }))
}
