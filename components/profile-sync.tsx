'use client'

import { useEffect } from 'react'

import { syncProfile } from '@/lib/profile/sync'

// Невидимый компонент в layout'е защищённой зоны. Рендерится внутри PinGate,
// то есть строго ПОСЛЕ разблокировки (DEK уже в памяти) — можно расшифровать
// серверную копию профиля. Что именно делает — см. lib/profile/sync.ts:
// тянет шифроблоб → кэш (или мягко мигрирует локальный профиль на сервер).
export function ProfileSync() {
  useEffect(() => {
    void syncProfile()
  }, [])
  return null
}
