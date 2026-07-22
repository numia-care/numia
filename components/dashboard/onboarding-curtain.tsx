'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// Онбординг-занавес: 2–3 экрана поверх дашборда при САМОМ первом входе.
// Показывается один раз (флаг в localStorage) и только если у юзера ещё
// совсем пусто (нет ни препаратов, ни записей «Пути») — иначе человек уже
// освоился и занавес будет только мешать.
//
// Лёгкий: две head-count-выборки (RLS сам ограничит своим), CSS-анимации из
// tw-animate-css, никаких таймеров/жестов. Пропускаем «позже» в любой момент.

const SEEN_KEY = 'numia_onboarding_seen'

// 0 приветствие → 1 приватность → 2 «установи на главный экран» (только из
// браузера на мобильном, в standalone/на десктопе пропускается) → 3 выбор.
type Step = 0 | 1 | 2 | 3

// Уже стоит на главном экране? (display-mode из manifest + легаси-флаг Safari)
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

// Платформа для инструкции установки — шаги iOS и Android различаются.
function detectPlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  // iPadOS 13+ прикидывается маком — выдаёт себя тач-экраном.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

export function OnboardingCurtain() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<Step>(0)
  // Инструкция установки: null = шаг пропускаем (standalone или десктоп).
  // Считаем в инициализаторе: компонент рендерится только на клиенте
  // (visible до эффекта false), но SSR-ветку всё равно страхуем.
  const [installPlatform] = useState<'ios' | 'android' | null>(() => {
    if (typeof window === 'undefined') return null
    if (isStandalone()) return null
    const p = detectPlatform()
    return p === 'other' ? null : p
  })

  useEffect(() => {
    // Флаг локальный: онбординг — свойство устройства, не аккаунта. На новом
    // устройстве покажется снова — и это ок (там та же ситуация «всё в новинку»).
    if (localStorage.getItem(SEEN_KEY)) return

    let cancelled = false
    async function check() {
      try {
        const supabase = createClient()
        // head:true — только count, без строк. RLS ограничивает своим юзером.
        const [meds, paths] = await Promise.all([
          supabase
            .from('medications')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null),
          supabase
            .from('path_entries')
            .select('id', { count: 'exact', head: true }),
        ])
        if (cancelled) return
        if ((meds.count ?? 0) === 0 && (paths.count ?? 0) === 0) {
          setVisible(true)
        } else {
          // Данные уже есть — занавес не нужен и в будущем: помечаем сразу.
          localStorage.setItem(SEEN_KEY, '1')
        }
      } catch {
        // Проверка не удалась — не показываем (занавес некритичен).
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  function dismiss() {
    localStorage.setItem(SEEN_KEY, '1')
    setVisible(false)
  }

  function go(href: string) {
    dismiss()
    router.push(href)
  }

  if (!visible) return null

  return (
    // Подложка: почти непрозрачный фон + блюр — дашборд за занавесом лишь
    // угадывается, контент шагов на него не налезает. Раньше тут был градиент
    // с альфой (via-secondary/50 to-accent/40) — на новой палитре он
    // просвечивал, и текст шагов ложился прямо на карточки дашборда (баг с
    // живого iPhone). Декоративный градиент остался, но ПОВЕРХ непрозрачной
    // подложки и с малой альфой.
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={t('step1Title')}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-secondary/30 to-accent/25"
      />

      {/* «Позже» — всегда доступный выход, без чувства вины. */}
      {/* relative — чтобы контент лежал над декоративным градиентом. */}
      <div className="relative flex justify-end p-5">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          {t('later')}
        </button>
      </div>

      {/* key={step} перезапускает CSS-анимацию появления на каждом шаге. */}
      <div
        key={step}
        className="relative flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center animate-in fade-in slide-in-from-bottom-3 duration-500"
      >
        <div className="mb-6 text-4xl text-moss">✦</div>

        {step === 0 && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('step1Title')}
            </h2>
            <NextButton onClick={() => setStep(1)} label={t('next')} />
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('step2Title')}
            </h2>
            <p className="mt-3 max-w-sm leading-relaxed text-foreground/80">
              {t('step2Text')}
            </p>
            <NextButton
              onClick={() => setStep(installPlatform ? 2 : 3)}
              label={t('next')}
            />
          </>
        )}

        {step === 2 && installPlatform && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('installTitle')}
            </h2>
            <p className="mt-3 max-w-sm leading-relaxed text-foreground/80">
              {t('installText')}
            </p>
            {/* Пошаговая инструкция — своя для iOS и Android (по user agent). */}
            <p className="mt-4 max-w-sm rounded-2xl bg-card px-5 py-4 text-sm leading-relaxed text-foreground ring-1 ring-border">
              {installPlatform === 'ios' ? t('installIos') : t('installAndroid')}
            </p>
            <NextButton onClick={() => setStep(3)} label={t('next')} />
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('step3Title')}
            </h2>
            <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
              <ChoiceButton onClick={() => go('/tracker')} primary>
                {t('choiceTracker')}
              </ChoiceButton>
              <ChoiceButton onClick={() => go('/path')} primary>
                {t('choicePath')}
              </ChoiceButton>
              <ChoiceButton onClick={dismiss}>{t('choiceLook')}</ChoiceButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NextButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-8 rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {label}
    </button>
  )
}

function ChoiceButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl px-6 py-4 text-base font-medium transition-colors',
        primary
          ? 'bg-card text-foreground ring-1 ring-border hover:ring-sage/60'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
