import { createBrowserClient } from '@supabase/ssr'

// Клиент для использования в Client Components ('use client').
// Каждый вызов создаёт новый инстанс — это ок, библиотека внутри переиспользует соединения.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
