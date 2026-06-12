'use server'

import { headers } from 'next/headers'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Server actions для push_subscriptions.
 *
 * Подписка приходит с клиента из pushManager.subscribe(). Структура — то
 * что отдаёт PushSubscription.toJSON(): endpoint + keys{p256dh, auth}.
 *
 * Идемпотентность: unique-индекс на endpoint. Upsert вместо insert →
 * повторная подписка с того же устройства просто обновит last_seen_at.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
})

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>

/**
 * Сохранить (или обновить last_seen_at) push-подписку текущего юзера.
 */
export async function subscribeToPush(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = PushSubscriptionInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // User-Agent для отображения в /settings (этап 1b шаг 3): «iPhone PWA»,
  // «Chrome on Mac». Для отправки push не используется.
  const ua = (await headers()).get('user-agent') ?? null

  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: ua,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { id: data.id } }
}

/**
 * Удалить подписку по endpoint (юзер отозвал permission в браузере или
 * нажал «Выключить» в настройках приложения).
 */
export async function unsubscribeFromPush(
  endpoint: string,
): Promise<ActionResult> {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return { ok: false, error: 'invalid_endpoint' }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
