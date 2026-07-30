'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { MoodIcon } from '@/components/icons/kai'
import { MoodScale } from '@/components/path/mood-scale'
import { buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  addDiaryEntry,
  getTodayDiaryEntry,
  PinRequiredError,
  updateDiaryNote,
  type MoodLevel,
} from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Карточка «Как ты себя чувствуешь?» на дашборде (концепция Кая): тап по
// ступени настроения СРАЗУ создаёт запись дневника — трение в один тап,
// это опора ежедневной привычки. После тапа мягко предлагаем добавить пару
// слов (текст шифруется; поле можно пропустить — запись уже сохранена).
//
// Если сегодня запись дневника уже есть — показываем её настроение тихим
// «Записано ✦», без повторного ввода (дубли за день не плодим; отредактировать
// можно будет в «Пути», когда появится редактирование).
//
// PIN для одного тапа НЕ нужен: mood — открытое число (by design, для графиков).
// DEK требуется только на шаге текста.

type State =
  | { kind: 'loading' }
  | { kind: 'idle' } // сегодня записи нет — шкала активна
  | { kind: 'note'; entryId: string; mood: MoodLevel } // тап сделан, предлагаем текст
  | { kind: 'done'; mood: MoodLevel | null } // на сегодня записано

export function MoodQuickEntry() {
  const t = useTranslations('dashboard.mood')
  const tMood = useTranslations('path.mood') // подписи ступеней — общие со шкалой
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const today = await getTodayDiaryEntry()
        if (cancelled) return
        setState(
          today
            ? { kind: 'done', mood: (today.mood as MoodLevel | null) ?? null }
            : { kind: 'idle' },
        )
      } catch {
        if (!cancelled) setState({ kind: 'idle' })
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  // Тап по ступени: запись создаётся сразу (mood открытый, PIN не нужен).
  async function onPick(mood: MoodLevel) {
    if (busy) return
    setBusy(true)
    try {
      const entryId = await addDiaryEntry({ mood, occurredAt: new Date() })
      toast.success(t('savedToast'))
      setState({ kind: 'note', entryId, mood })
    } catch {
      toast.error(t('error'))
    } finally {
      setBusy(false)
    }
  }

  // Дописать пару слов к уже созданной записи (текст шифруется → нужен DEK).
  async function onSaveNote() {
    if (state.kind !== 'note' || busy) return
    const trimmed = note.trim()
    if (!trimmed) {
      setState({ kind: 'done', mood: state.mood })
      return
    }
    setBusy(true)
    try {
      await updateDiaryNote(state.entryId, trimmed)
      toast.success(t('noteSavedToast'))
      setState({ kind: 'done', mood: state.mood })
      setNote('')
    } catch (err) {
      if (err instanceof PinRequiredError) {
        // Настроение уже сохранено; за текстом — после PIN (через полную форму).
        toast(t('pinNeeded'))
        router.push('/pin')
        return
      }
      toast.error(t('error'))
      setBusy(false)
    }
  }

  return (
    // ЗАМЕР эталона today.jpg: карточка высотой 134.6, радиус 54
    // (--radius-5xl, в токенах он и подписан «муд-стрип»), заливка — мягкий
    // градиент лаванда → зелень (#EFEDF0 → #F0F6E8, замер по краям внутри).
    // Сверху иконка Кая, под ней вопрос по центру, ниже пять плиток дугой.
    //
    // Ширина — по колонке контента: детектор краёв даёт 25 и 361, то есть
    // ровно колонка. (В первом замере мне показалось, что карточка шире экрана,
    // но маска «не фон» ловила мягкое свечение вокруг, а не саму карточку.)
    //
    // min-h, а не h: 134.6 — это высота в состоянии выбора; на шаге «пара слов»
    // внутри появляется текстовое поле, и карточка обязана расти.
    <div
      // justify-center — содержимое стоит по центру карточки по вертикали
      // (в макете дуга центрирована, а не прижата к нижней кромке).
      className="rounded-5xl shadow-card flex min-h-[135px] flex-col justify-center px-4 py-3.5"
      style={{ backgroundImage: 'var(--kai-grad-mood)' }}
    >
      <MoodIcon className="mx-auto size-[19px] text-foreground" />
      <h2 className="mt-2 text-center text-[15px] text-foreground">{t('title')}</h2>

      {state.kind === 'loading' ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-muted/40" />
      ) : state.kind === 'done' ? (
        <p className="mt-2 text-sm text-foreground/70">
          {state.mood != null ? (
            <>
              {t('doneWithMood')}{' '}
              <span className="text-foreground/90">
                {tMood(`level.${state.mood}`)}
              </span>{' '}
              ✦
            </>
          ) : (
            t('doneNoMood')
          )}
        </p>
      ) : state.kind === 'note' ? (
        <div className="mt-3 space-y-3 animate-in fade-in duration-300">
          <p className="text-sm text-foreground/70">{t('notePrompt')}</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            rows={2}
            disabled={busy}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveNote}
              disabled={busy || note.trim().length === 0}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              {t('noteSave')}
            </button>
            <button
              type="button"
              onClick={() => setState({ kind: 'done', mood: state.mood })}
              disabled={busy}
              className="px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('noteSkip')}
            </button>
          </div>
        </div>
      ) : (
        // Градиентная полоса-подложка из макета (Rectangle 56).
        <div
          className="mt-2.5 rounded-[18px] p-1"
          style={{
            background:
              'linear-gradient(90deg, #B1D7E7 0%, #E6D7F6 50%, #FFB3D9 100%)',
          }}
        >
          <MoodScale value={null} onChange={onPick} disabled={busy} layout="arc" />
        </div>
      )}
    </div>
  )
}
