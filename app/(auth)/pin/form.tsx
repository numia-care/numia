'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { NewPinForm } from '@/components/new-pin-form'
import { BiometricEnrollDialog } from '@/components/settings/biometric-enroll-dialog'
import { PinInput } from '@/components/pin-input'
import { RecoveryKeyCard } from '@/components/recovery-key-card'
import { RecoveryEntryForm } from '@/components/recovery-entry-form'
import {
  detectBiometricSupport,
  isBiometricEnrolled,
  unlockWithBiometric,
} from '@/lib/crypto/biometric'
import type { Dek } from '@/lib/crypto/envelope'
import {
  base64ToBytes,
  constantTimeEqual,
  hashPin,
  LEGACY_KDF_ITERATIONS,
} from '@/lib/crypto/pin'
// Механика lockout общая с диалогом биометрии — см. lib/crypto/lockout.ts.
// После SOFT_LOCKOUT_AFTER неверных попыток выделяем "Не помню PIN" красным
// (сигналим что есть выход).
import {
  SOFT_LOCKOUT_AFTER,
  readLockoutSeconds,
  registerFailedPinAttempt,
} from '@/lib/crypto/lockout'
import { PinStorage } from '@/lib/crypto/storage'
import { hasRemoteVault, setupVault, unlockWithPin } from '@/lib/crypto/vault'
import { lock } from '@/lib/crypto/session'

export function PinUnlockForm() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [checked, setChecked] = useState(false)
  // Шаги:
  //   unlock     — обычный ввод PIN (+ кнопка биометрии, если включена)
  //   forgot     — промежуточный экран «не помнишь PIN?» (биометрия / ключ / сброс)
  //   recover    — ввод ключа восстановления (RecoveryEntryForm)
  //   recovery   — показ ключа после ленивого бэкфилла (старый PIN без envelope
  //                получает DEK+фразу на первом unlock)
  //   bio-newpin — «не помню PIN, но биометрия работает»: DEK развёрнут
  //                Face ID → задаём новый PIN без фразы (NewPinForm)
  //   bio-done   — новый PIN сохранён
  const [step, setStep] = useState<
    'unlock' | 'forgot' | 'recover' | 'recovery' | 'bio-newpin' | 'bio-done'
  >('unlock')
  const [phrase, setPhrase] = useState('')
  // Секунд до конца паузы ввода (0 = паузы нет). Тикает в эффекте ниже.
  const [lockoutLeft, setLockoutLeft] = useState(0)
  // Биометрия: включена ли на этом устройстве (кнопка), ошибка последней
  // попытки и DEK, развёрнутый биометрией для шага bio-newpin.
  const [bioAvailable, setBioAvailable] = useState(false)
  // Сообщение о биометрии + действие рядом с ним. Отдельная структура (а не
  // строка), потому что у «не настроен» и «не получилось» разные кнопки и тон,
  // и показывать их нужно ДАЖЕ когда bioAvailable уже false — иначе экран
  // просто гасит кнопку Face ID и молчит (так было до переезда на новый домен).
  const [bioNotice, setBioNotice] = useState<BioNotice | null>(null)
  const [bioDek, setBioDek] = useState<Dek | null>(null)
  // Умеет ли устройство биометрию вообще (для тихого предложения включить —
  // строчка под PIN-падом, видна пока биометрия не включена) + сам диалог.
  const [bioSupport, setBioSupport] = useState<'pending' | 'yes' | 'no' | 'unknown'>('pending')
  const [enrollOpen, setEnrollOpen] = useState(false)

  // На случай "PIN был удалён из IDB между переходами" — отправляем на setup.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const has = await PinStorage.hasPin()
      if (cancelled) return
      if (!has) {
        router.replace('/pin/setup')
        return
      }
      setAttempts(await PinStorage.getFailedAttempts())
      // Пауза переживает reload — восстанавливаем отсчёт из IndexedDB.
      setLockoutLeft(await readLockoutSeconds())
      setBioAvailable(await isBiometricEnrolled())
      setBioSupport(await detectBiometricSupport())
      setChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  // Отсчёт паузы: раз в секунду вниз до нуля.
  useEffect(() => {
    if (lockoutLeft <= 0) return
    const id = setInterval(() => {
      setLockoutLeft((s) => (s > 1 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [lockoutLeft])

  async function onUnlock() {
    setError(null)
    if (pin.length !== 6) {
      setError('Введи 6 цифр')
      return
    }
    // Пауза активна (state — и подстраховка из IDB, вдруг state обошли) → не
    // проверяем PIN вообще, PBKDF2 не гоняем.
    if (lockoutLeft > 0) return
    const left = await readLockoutSeconds()
    if (left > 0) {
      setLockoutLeft(left)
      return
    }

    setBusy(true)
    try {
      const stored = await PinStorage.readPin()
      if (!stored) {
        router.replace('/pin/setup')
        return
      }
      const salt = base64ToBytes(stored.salt)
      const expected = base64ToBytes(stored.hash)
      // Хэш проверяем теми итерациями, которыми он создан (null = legacy
      // 210k). На текущие набор переведёт lazy-апгрейд внутри unlockWithPin.
      const got = await hashPin(pin, salt, stored.iterations ?? LEGACY_KDF_ITERATIONS)

      if (!constantTimeEqual(got, expected)) {
        // С пятой неверной попытки — нарастающая пауза перед следующей.
        const failed = await registerFailedPinAttempt()
        setAttempts(failed.attempts)
        if (failed.lockoutSeconds > 0) setLockoutLeft(failed.lockoutSeconds)
        setError('Неверный PIN')
        setPin('')
        setBusy(false)
        return
      }

      await PinStorage.resetFailedAttempts()

      // PIN верен — разворачиваем DEK из локальной обёртки (envelope).
      const result = await unlockWithPin(pin)
      if (result === 'ok') {
        router.replace('/')
        return
      }
      if (result === 'no_vault') {
        // Локальной обёртки DEK нет. Прежде чем заводить vault — проверяем
        // сервер: если якорь восстановления УЖЕ есть, vault настраивался раньше.
        // Тогда новый DEK генерить нельзя (осиротит E2E-контент) и ключ
        // повторно показывать не нужно — обёртка просто пропала (новое
        // устройство / очищенный стор). Доступ возвращаем по ключу.
        if (await hasRemoteVault()) {
          setBusy(false)
          setStep('recover')
          return
        }
        // Якоря нет — настоящий первый раз (PIN с этапа 0 без envelope). Заводим
        // DEK + recovery-фразу под тем же PIN и показываем ключ РОВНО здесь, один раз.
        const recoveryPhrase = await setupVault(pin)
        setPhrase(recoveryPhrase)
        setBusy(false)
        setStep('recovery')
        return
      }
      // 'wrong': хэш сошёлся, но обёртка не разворачивается (повреждена) —
      // редкий случай рассинхрона хранилищ.
      setError('Не удалось открыть хранилище. Попробуй ещё раз.')
      setBusy(false)
    } catch (e) {
      console.error('PIN unlock failed:', e)
      setError('Что-то пошло не так. Попробуй ещё раз.')
      setBusy(false)
    }
  }

  /**
   * Кнопка биометрии. Вызывается строго из обработчика тапа (user gesture —
   * требование WebAuthn). forNewPin=true — режим «не помню PIN»: вместо входа
   * оставляем развёрнутый DEK и ведём задавать новый PIN.
   */
  async function onBioUnlock(forNewPin: boolean) {
    setBioNotice(null)
    setBusy(true)
    try {
      const result = await unlockWithBiometric()
      if (result.status === 'ok') {
        if (forNewPin) {
          setBioDek(result.dek)
          setBusy(false)
          setStep('bio-newpin')
          return
        }
        // Владелец подтверждён биометрией — счётчик неверных PIN обнуляем,
        // как при успешном входе по PIN.
        await PinStorage.resetFailedAttempts()
        router.replace('/')
        return
      }
      setBusy(false)
      if (result.status === 'failed') {
        // Например, passkey удалили из системных настроек. PIN всегда есть,
        // поэтому предлагаем настроить заново прямо здесь, а не отсылаем в
        // настройки.
        setBioNotice({
          text: 'Не получилось войти по Face ID. Войди по PIN или настрой Face ID заново.',
          cta: 'Настроить заново',
          tone: 'error',
        })
      } else if (result.status === 'no_bio') {
        // Набор пропал между рендером и тапом — прячем кнопку, но НЕ молчим.
        setBioAvailable(false)
        setBioNotice({ text: 'Face ID не настроен', cta: 'Настроить', tone: 'info' })
      }
      // 'cancelled' — юзер закрыл системный шит, молчим.
    } catch (e) {
      console.error('biometric unlock failed:', e)
      setBusy(false)
      setBioNotice({ text: 'Что-то пошло не так. Войди по PIN.', cta: null, tone: 'error' })
    }
  }

  async function finishRecovery(acknowledged: boolean) {
    await PinStorage.setRecoveryAck(acknowledged)
    router.replace('/')
  }

  async function onForgot() {
    // ЗАПАСНОЙ выход для тех, у кого НЕТ ключа восстановления. Главный путь —
    // «Ввести ключ восстановления» (step 'recover', RecoveryEntryForm), он
    // данные сохраняет. Этот сброс — разрушающий, поэтому за подтверждением.
    // В будущем заменим confirm() на красивый модальный диалог.
    const ok = window.confirm(
      'Сброс на этом устройстве: PIN удалится, и ты выйдешь из аккаунта. ' +
        'Делай это, только если нет ключа восстановления — без него после ' +
        'сброса зашифрованные записи открыть не получится. Продолжить?',
    )
    if (!ok) return

    setBusy(true)
    lock()
    await PinStorage.clearPin()
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (!checked) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <span className="text-2xl text-foreground">✦</span>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <main className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/[0.04]">
        <div className="mb-6 flex items-center gap-2 text-foreground">
          <span className="text-2xl">✦</span>
          <span className="text-sm uppercase tracking-widest">Numia</span>
        </div>

        {step === 'bio-newpin' && bioDek ? (
          <NewPinForm dek={bioDek} onSaved={() => setStep('bio-done')} />
        ) : step === 'bio-done' ? (
          <>
            <h1 className="mb-1 text-2xl font-medium text-foreground">
              Новый PIN сохранён ✦
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Записи на месте. Дальше входи по биометрии или новому PIN.
            </p>
            <button
              type="button"
              onClick={() => router.replace('/')}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring/60"
            >
              Войти
            </button>
          </>
        ) : step === 'recovery' ? (
          <RecoveryKeyCard
            phrase={phrase}
            onDone={() => finishRecovery(true)}
            onRemindLater={() => finishRecovery(false)}
          />
        ) : step === 'recover' ? (
          <RecoveryEntryForm
            onSuccess={() => router.replace('/')}
            onBack={() => setStep('forgot')}
          />
        ) : step === 'forgot' ? (
          <>
            <h1 className="mb-1 text-2xl font-medium text-foreground">
              Не помнишь PIN?
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Ничего страшного.{' '}
              {bioAvailable
                ? 'Биометрия открывает те же записи — войди по ней и задай новый PIN.'
                : 'Если сохранён ключ восстановления — вернём доступ к записям без потерь.'}
            </p>

            {/* Биометрия — самый лёгкий путь: без фразы, данные целы. */}
            {bioAvailable && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onBioUnlock(true)}
                  className="mb-3 w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
                >
                  Войти по Face ID и задать новый PIN
                </button>
              </>
            )}

            {/* Вне блока bioAvailable: если набор пропал между рендером и тапом,
                блок выше исчезает — сообщение должно остаться. Кнопки-действия
                здесь нет: настройка Face ID требует PIN, а на этом экране юзер
                как раз потому, что PIN не помнит. */}
            {bioNotice && (
              <p
                className={
                  bioNotice.tone === 'error'
                    ? 'mb-3 text-sm text-rose-600'
                    : 'mb-3 text-sm text-muted-foreground'
                }
              >
                {bioNotice.text}
              </p>
            )}

            <button
              type="button"
              onClick={() => setStep('recover')}
              className={
                bioAvailable
                  ? 'w-full rounded-xl border border-primary bg-white px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-ring/60'
                  : 'w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring/60'
              }
            >
              Ввести ключ восстановления
            </button>

            {/* Запасной, неприметный выход — для тех, у кого ключа нет. */}
            <div className="mt-8 border-t border-border pt-5">
              <button
                type="button"
                disabled={busy}
                onClick={onForgot}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-rose-600 hover:underline disabled:opacity-50"
              >
                Сбросить всё
              </button>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Удалит PIN и выйдет из аккаунта. Без ключа восстановления
                зашифрованные записи после сброса не вернуть.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setBioNotice(null)
                setStep('unlock')
              }}
              className="mt-6 block w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ← Назад
            </button>
          </>
        ) : (
          <>
        <h1 className="mb-1 text-2xl font-medium text-foreground">
          {bioAvailable ? 'С возвращением ✦' : 'Введи PIN'}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {bioAvailable
            ? 'Войди по биометрии или введи PIN.'
            : 'Те же 6 цифр, что и при первом входе.'}
        </p>

        {/* Биометрия отвалилась прямо в этой сессии (или её тут и не было):
            кнопки Face ID уже нет, поэтому сообщение с действием живёт
            отдельно — иначе экран молча гасит кнопку. */}
        {!bioAvailable && bioNotice && (
          <div className="mb-5">
            <BioNoticeBlock notice={bioNotice} onEnroll={() => setEnrollOpen(true)} />
          </div>
        )}

        {/* Кнопка, не авто-вызов: WebAuthn требует user gesture, а внезапный
            системный шит при каждом развороте приложения раздражал бы. */}
        {bioAvailable && (
          <div className="mb-5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onBioUnlock(false)}
              className="w-full rounded-xl border border-primary bg-white px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-primary/5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
            >
              Войти по Face ID / Touch ID
            </button>
            <BioNoticeBlock notice={bioNotice} onEnroll={() => setEnrollOpen(true)} />
            <div className="mt-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              или PIN
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onUnlock()
          }}
        >
          <PinInput
            value={pin}
            onChange={setPin}
            autoFocus
            disabled={busy || lockoutLeft > 0}
          />
          {lockoutLeft > 0 ? (
            // Пауза после серии неверных попыток. Тон спокойный: это защита,
            // не наказание — настоящий владелец просто подождёт и попробует.
            <p className="text-sm text-muted-foreground">
              Слишком много попыток подряд. Пауза {lockoutLeft}{' '}
              {lockoutLeft % 10 === 1 && lockoutLeft % 100 !== 11
                ? 'секунду'
                : [2, 3, 4].includes(lockoutLeft % 10) &&
                    ![12, 13, 14].includes(lockoutLeft % 100)
                  ? 'секунды'
                  : 'секунд'}{' '}
              — а если PIN не вспоминается, ниже есть выход ✦
            </p>
          ) : (
            error && <p className="text-sm text-rose-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={pin.length !== 6 || busy || lockoutLeft > 0}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring/60"
          >
            {busy ? 'Проверяем…' : lockoutLeft > 0 ? `Подожди ${lockoutLeft} c` : 'Войти'}
          </button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBioNotice(null)
              setStep('forgot')
            }}
            className={
              attempts >= SOFT_LOCKOUT_AFTER
                ? 'text-rose-600 underline-offset-4 hover:underline disabled:opacity-50'
                : 'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50'
            }
          >
            Не помню PIN
          </button>

          {/* Предложение настроить биометрию — живёт там, где боль: прямо у
              ввода PIN. Видно, пока биометрия не включена (после включения его
              место занимает кнопка «Войти по Face ID» выше).
              'unknown' тоже показываем: 'no' мы уже отсеяли честной проверкой
              платформенного аутентификатора, а 'unknown' значит лишь «браузер
              не сказал про PRF». Раньше здесь стояло строгое 'yes' — и на
              устройствах без getClientCapabilities экран не предлагал ничего
              вообще. Если PRF всё-таки не окажется, это корректно отработает
              BiometricEnrollDialog ('prf_unsupported'). */}
          {!bioAvailable && bioSupport !== 'no' && bioSupport !== 'pending' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setEnrollOpen(true)}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Настроить вход по Face ID ✦
            </button>
          )}
        </div>

          </>
        )}

        {/* Тот же enroll-флоу с PIN-диалогом, что у тумблера в настройках.
            Работает и на запертом экране: enrollBiometric разворачивает DEK
            введённым в диалоге PIN, сессия ему не нужна. */}
        <BiometricEnrollDialog
          open={enrollOpen}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={() => {
            setBioAvailable(true)
            setBioNotice(null) // «не настроен» больше не про нас
          }}
        />

      </main>
    </div>
  )
}

// Сообщение о состоянии биометрии + действие рядом.
//   info  — «Face ID не настроен» (констатация, не ошибка)
//   error — попытка входа не удалась
// Кнопка открывает тот же BiometricEnrollDialog, что и предложение под
// PIN-падом: настройка требует PIN, который на экране входа юзер и вводит.
interface BioNotice {
  text: string
  cta: string | null
  tone: 'info' | 'error'
}

function BioNoticeBlock({
  notice,
  onEnroll,
}: {
  notice: BioNotice | null
  onEnroll: () => void
}) {
  if (!notice) return null
  return (
    <div className="mt-2">
      <p
        className={
          notice.tone === 'error'
            ? 'text-sm text-rose-600'
            : 'text-sm text-muted-foreground'
        }
      >
        {notice.text}
      </p>
      {notice.cta && (
        <button
          type="button"
          onClick={onEnroll}
          className="mt-1 text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          {notice.cta}
        </button>
      )}
    </div>
  )
}
