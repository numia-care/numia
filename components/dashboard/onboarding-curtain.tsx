'use client'

import {
  ArrowDownIcon,
  ArrowRightIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FlaskConicalIcon,
  LeafIcon,
  PlusSquareIcon,
  RouteIcon,
  ShareIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// Онбординг-занавес поверх дашборда при САМОМ первом входе. Показывается один
// раз (флаг в localStorage) и только если у юзера ещё совсем пусто (нет ни
// препаратов, ни записей «Пути») — иначе человек уже освоился.
//
// Шаги (переделаны по фидбеку тестеров):
//   0 обзор разделов (что делает трекер / Путь / анализы) — вместо абстракции
//   1 приватность (коротко, ключевое жирным)
//   2 установка на главный экран (иллюстрация, куда нажимать; iOS/Android).
//     Если открыто во ВНУТРЕННЕМ браузере (Telegram и т.п.) — «Открой в Safari»
//     с копированием ссылки: из webview на главный экран не поставить.
//   3 выбор, с чего начать
// Шаг 2 пропускается в standalone (уже установлено) и на десктопе.

const SEEN_KEY = 'numia_onboarding_seen'

type Step = 0 | 1 | 2 | 3
type Platform = 'ios' | 'android'

// Уже стоит на главном экране? (display-mode из manifest + легаси-флаг Safari)
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

// Платформа для инструкции установки — шаги iOS и Android различаются.
function detectPlatform(): Platform | 'other' {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  // iPadOS 13+ прикидывается маком — выдаёт себя тач-экраном.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

// Открыто во встроенном браузере приложения (Telegram, Instagram, и т.п.)?
// В таком webview «на главный экран» недоступно — надо открыть в Safari/Chrome.
function detectInAppBrowser(): boolean {
  const ua = navigator.userAgent || ''
  if (
    /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|WhatsApp|Snapchat|Twitter|MicroMessenger/i.test(
      ua,
    )
  ) {
    return true
  }
  if ('TelegramWebviewProxy' in window || 'TelegramWebviewProxyProto' in window) {
    return true
  }
  // iOS: WKWebView вне Safari (и не Chrome/Firefox/Edge) обычно без «Safari» в UA.
  const isIos = /iPhone|iPad|iPod/i.test(ua)
  if (
    isIos &&
    /AppleWebKit/i.test(ua) &&
    !/Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS/i.test(ua)
  ) {
    return true
  }
  return false
}

export function OnboardingCurtain() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<Step>(0)

  // Среду считаем в инициализаторе (клиент-only; visible до эффекта false).
  //   install — платформа для шага установки, null = шаг пропускаем.
  //   inApp   — встроенный браузер: показываем «Открой в Safari» вместо инструкции.
  const [env] = useState<{ install: Platform | null; inApp: boolean }>(() => {
    if (typeof window === 'undefined') return { install: null, inApp: false }
    if (isStandalone()) return { install: null, inApp: false }
    const p = detectPlatform()
    return {
      install: p === 'other' ? null : p,
      inApp: detectInAppBrowser(),
    }
  })

  useEffect(() => {
    // Флаг локальный: онбординг — свойство устройства, не аккаунта. На новом
    // устройстве покажется снова — там та же ситуация «всё в новинку».
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

  async function copyLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('copied'))
      return
    } catch {
      // Во встроенных браузерах clipboard API бывает недоступен — фолбэк.
    }
    try {
      const el = document.createElement('textarea')
      el.value = url
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      toast.success(t('copied'))
    } catch {
      // Совсем не вышло — молчим, ссылка всё равно видна в адресной строке.
    }
  }

  if (!visible) return null

  // После приватности: на установку (если есть) или сразу к выбору.
  const afterPrivacy: Step = env.install ? 2 : 3

  return (
    // Подложка: почти непрозрачный фон + блюр, дашборд лишь угадывается.
    // Декоративный градиент — поверх, с малой альфой.
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={t('tourTitle')}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-secondary/30 to-accent/25"
      />

      {/* «Позже» — всегда доступный выход, без чувства вины. */}
      <div className="relative flex justify-end p-5">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          {t('later')}
        </button>
      </div>

      {/* key={step} перезапускает анимацию появления на каждом шаге. */}
      <div
        key={step}
        className="relative flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center animate-in fade-in slide-in-from-bottom-3 duration-500"
      >
        <div className="mb-6 text-4xl text-moss">✦</div>

        {step === 0 && (
          <>
            <h2 className="mb-6 font-heading text-3xl text-foreground">
              {t('tourTitle')}
            </h2>
            <div className="flex w-full max-w-xs flex-col gap-3">
              <TourItem
                icon={LeafIcon}
                name={t('tourTrackerName')}
                desc={t('tourTracker')}
              />
              <TourItem
                icon={RouteIcon}
                name={t('tourPathName')}
                desc={t('tourPath')}
              />
              <TourItem
                icon={FlaskConicalIcon}
                name={t('tourLabsName')}
                desc={t('tourLabs')}
              />
            </div>
            <NextButton onClick={() => setStep(1)} label={t('next')} />
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('privacyTitle')}
            </h2>
            <p className="mt-3 max-w-sm text-lg leading-relaxed text-foreground/80">
              {t.rich('privacyText', {
                b: (c) => <b className="font-semibold text-moss">{c}</b>,
              })}
            </p>
            <NextButton onClick={() => setStep(afterPrivacy)} label={t('next')} />
          </>
        )}

        {step === 2 && env.install && (
          <>
            {env.inApp ? (
              <InAppPanel platform={env.install} t={t} onCopy={copyLink} />
            ) : (
              <>
                <h2 className="font-heading text-3xl text-foreground">
                  {t('installTitle')}
                </h2>
                <p className="mt-3 max-w-sm leading-relaxed text-foreground/80">
                  {t('installText')}
                </p>
                <InstallGuide
                  platform={env.install}
                  step1={env.install === 'ios' ? t('installShare') : t('installMenu')}
                  step2={
                    env.install === 'ios' ? t('installAddHome') : t('installApp')
                  }
                />
              </>
            )}
            <NextButton onClick={() => setStep(3)} label={t('next')} />
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-heading text-3xl text-foreground">
              {t('startTitle')}
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

// Строка обзора раздела: иконка → стрелка → название + одна фраза.
function TourItem({
  icon: Icon,
  name,
  desc,
}: {
  icon: LucideIcon
  name: string
  desc: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-border">
        <Icon className="size-5 text-moss" />
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-moss/50" />
      <div className="min-w-0 text-left">
        <p className="font-semibold leading-tight text-foreground">{name}</p>
        <p className="text-sm leading-tight text-muted-foreground">{desc}</p>
      </div>
    </div>
  )
}

// Иллюстрация установки: два выделенных «нажимаемых» элемента реальными
// иконками платформы, между ними стрелка вниз — «сначала это, потом это».
function InstallGuide({
  platform,
  step1,
  step2,
}: {
  platform: Platform
  step1: string
  step2: string
}) {
  const isIos = platform === 'ios'
  return (
    <div className="mt-6 flex w-full max-w-[15rem] flex-col items-stretch gap-2">
      <GuideRow icon={isIos ? ShareIcon : EllipsisVerticalIcon} label={step1} />
      <ArrowDownIcon className="mx-auto size-5 text-moss/60" />
      <GuideRow icon={isIos ? PlusSquareIcon : DownloadIcon} label={step2} />
    </div>
  )
}

function GuideRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-fairy/60">
      <Icon className="size-5 shrink-0 text-moss" />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  )
}

// Встроенный браузер: на главный экран не поставить, зовём открыть в Safari/
// Chrome и даём кнопку копирования ссылки.
function InAppPanel({
  platform,
  t,
  onCopy,
}: {
  platform: Platform
  t: ReturnType<typeof useTranslations<'onboarding'>>
  onCopy: () => void
}) {
  const isIos = platform === 'ios'
  return (
    <>
      <h2 className="font-heading text-3xl text-foreground">
        {isIos ? t('safariTitleIos') : t('safariTitleAndroid')}
      </h2>
      <p className="mt-3 max-w-sm leading-relaxed text-foreground/80">
        {t('safariText')}
      </p>
      <p className="mt-4 w-full max-w-xs rounded-2xl bg-card px-4 py-3 text-sm text-foreground ring-1 ring-border">
        {isIos ? t('safariHintIos') : t('safariHintAndroid')}
      </p>
      <button
        type="button"
        onClick={onCopy}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-card px-5 py-3 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:ring-sage/60"
      >
        <CopyIcon className="size-4 text-moss" />
        {t('copyLink')}
      </button>
    </>
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
