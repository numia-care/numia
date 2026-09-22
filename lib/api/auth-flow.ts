import type { Session } from '@supabase/supabase-js'

import type { RateLimitRule } from './rate-limit'
import type { TokenResponse } from './schemas'

/**
 * Общее для маршрутов входа: лимиты и формат токенов. Схемы тел запросов —
 * в lib/api/schemas.ts.
 * Контракт: docs/api-v1.md, §3.
 */

const MINUTE = 60_000

// Отправка кода. По email — чтобы не заваливать чужой ящик письмами.
// По IP — чтобы один источник не рассылал коды на тысячи адресов.
export const OTP_PER_EMAIL: RateLimitRule = { name: 'otp:email', limit: 3, windowMs: 15 * MINUTE }
export const OTP_PER_IP: RateLimitRule = { name: 'otp:ip', limit: 20, windowMs: 15 * MINUTE }

// Проверка кода. Главная защита от перебора — лимит ПО EMAIL: код из 6 цифр
// это миллион вариантов, 5 попыток за 15 минут делают перебор бессмысленным,
// даже если атакующий меняет IP.
export const VERIFY_PER_EMAIL: RateLimitRule = { name: 'verify:email', limit: 5, windowMs: 15 * MINUTE }
export const VERIFY_PER_IP: RateLimitRule = { name: 'verify:ip', limit: 30, windowMs: 15 * MINUTE }

// Обновление токенов. Нормальный клиент делает это раз в час.
export const REFRESH_PER_TOKEN: RateLimitRule = { name: 'refresh:token', limit: 10, windowMs: 15 * MINUTE }
export const REFRESH_PER_IP: RateLimitRule = { name: 'refresh:ip', limit: 60, windowMs: 15 * MINUTE }

/**
 * Ответ с токенами.
 *
 * ПРАВИЛО: токены для клиента НЕПРОЗРАЧНЫ. Отдаём ровно четыре поля и не
 * отдаём user из сессии Supabase. Если приложение начнёт декодировать JWT
 * и читать из него поля, привязка к Supabase просто переедет из SDK в
 * разбор токена — и бэкенд перестанет быть заменяемым. user_id клиент
 * берёт только из GET /me.
 */
export function toTokenResponse(session: Session): TokenResponse {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: 'bearer',
  }
}
