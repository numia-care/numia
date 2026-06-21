/**
 * Web Push API ждёт BufferSource (ArrayBuffer) в applicationServerKey.
 * VAPID-public key хранится как base64url-строка; разворачиваем её в чистый
 * ArrayBuffer (а не Uint8Array, чтобы tsc-strict не цеплял ArrayBufferLike).
 *
 * Используется и кнопкой включения пушей, и фоновой саморегенерацией подписки.
 */
export function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return buf
}
