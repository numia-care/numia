import { decryptText } from '@/lib/crypto/envelope'
import { requireDek } from '@/lib/path/entries'

/**
 * Расшифровка E2E-заметки к анализу.
 *
 * Зеркало decryptNote для «Пути» (lib/path/entries.ts): текст лежит голой
 * строкой в note_ciphertext — base64(iv‖ct) из encryptText, IV упакован
 * внутрь, — а не JSON'ом, как caption у медиа-записей.
 *
 * ТОЛЬКО КЛИЕНТ. Функция дёргает requireDek, а DEK живёт в памяти вкладки
 * (lib/crypto/session.ts) и на сервер не попадает никогда. Вызов из
 * серверного компонента бросит PinRequiredError — это не баг, а инвариант:
 * сервер заметку прочитать не должен.
 *
 * Бросает PinRequiredError, если PIN-сессия истекла (закрыли вкладку,
 * переоткрыли приложение). UI обязан это поймать и отправить на /pin —
 * образец в components/labs/lab-form.tsx.
 *
 * Отдельный файл, а не records.ts: тот про запись и тянет за собой сжатие
 * изображений и Storage, которые для чтения текста не нужны.
 */
export async function decryptLabNote(
  ciphertext: string | null,
): Promise<string | null> {
  if (!ciphertext) return null
  return decryptText(requireDek(), ciphertext)
}
