'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { defaultUnitCode, getAnalyte, unitLabel } from '@/lib/labs/catalog'
import { deleteLabRange, saveLabRange } from '@/lib/labs/ranges'
import type { UserRange } from '@/lib/labs/stats'

/**
 * Персональный коридор показателя: строка-статус в истории плюс редактор.
 *
 * ГРАНИЦЫ ЗАДАЁТ ЧЕЛОВЕК, приложение их не выводит из данных. Здесь нет и не
 * должно появиться ничего, что считает диапазон по замерам: ни перцентилей, ни
 * min/max, ни «появится после трёх замеров». Коридор — это назначение врача, а
 * посчитанный по истории разброс на экране неотличим от медицинской нормы, но
 * ею не является.
 *
 * По той же причине компонент нигде не оценивает значения: ни «в норме», ни
 * «хорошо». Показ положения замера относительно коридора — отдельный кусок
 * (2d), и там это будет описательно: «в коридоре» / «ниже» / «выше».
 *
 * Черновой вид: логика доделана, визуал переработает Кай поверх неё.
 */
export function LabRangeEditor({
  analyteCode,
  range,
  unavailable = false,
}: {
  analyteCode: string
  /** Текущий коридор или null, если не задан. */
  range: UserRange | null
  /**
   * Коридоры не прочитались (серверный запрос упал). Правку в этом состоянии
   * НЕ предлагаем: показав пустые поля, мы бы дали затереть границы, которые
   * на самом деле заданы — просто не доехали.
   */
  unavailable?: boolean
}) {
  const t = useTranslations('labs.range')
  const tc = useTranslations('common')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('edit')
  const [minText, setMinText] = useState('')
  const [maxText, setMaxText] = useState('')
  const [unitCode, setUnitCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const analyte = getAnalyte(analyteCode)

  // 'other' коридор не поддерживает: ключ (user_id, analyte) склеил бы разные
  // кастомные показатели в один. Отбивают и saveLabRange, и CHECK в БД, но до
  // них лучше не доводить — редактор просто не предлагаем.
  if (!analyte || analyte.allowCustom || analyte.units.length === 0) return null

  // Открытие сбрасывает форму к текущему состоянию: иначе «Отмена» оставляла
  // бы недоправленные числа до следующего раза.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setStep('edit')
      setError(null)
      setMinText(range ? String(range.min) : '')
      setMaxText(range ? String(range.max) : '')
      // Единица: та, в которой коридор уже задан, иначе базовая показателя.
      setUnitCode(range?.unitCode ?? defaultUnitCode(analyte) ?? '')
    }
    setOpen(next)
  }

  const onSave = () => {
    const min = parseDecimal(minText)
    const max = parseDecimal(maxText)
    if (min === null || max === null) {
      setError(t('errNotNumber'))
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        await saveLabRange({ analyte: analyteCode, min, max, unitCode })
      } catch (e) {
        setError(t(errorKey(e)))
        return
      }
      setOpen(false)
      toast.success(t('saved'))
      router.refresh()
    })
  }

  const onRemove = () => {
    startTransition(async () => {
      try {
        await deleteLabRange(analyteCode)
      } catch {
        toast.error(t('removeFailed'))
        return
      }
      setOpen(false)
      toast.success(t('removed'))
      router.refresh()
    })
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      {/* Только сами границы, без подписи о происхождении. «Задан по
          назначению врача» отсюда убрано: приложение НЕ знает, откуда взялись
          числа — юзер мог вписать любой ориентир. Это ровно та же ложь, что
          «посчитан по N замерам», только в другую сторону: та приписывала
          границы автоматике, эта приписывала бы их врачу.

          Что приложение действительно знает — что оно их не считает само; об
          этом сказано в диалоге (dialogText), и там это честно. */}
      <p className="text-sm text-foreground/70">
        {range
          ? t('current', {
              min: fmt(range.min),
              max: fmt(range.max),
              unit: unitLabel(analyte, range.unitCode),
            })
          : t('empty')}
      </p>

      {unavailable ? (
        <span className="text-xs text-muted-foreground">{t('unavailable')}</span>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger
            render={
              <button
                type="button"
                className="text-sm text-lavender-deep underline-offset-2 transition-opacity hover:underline hover:opacity-80"
              >
                {range ? t('edit') : t('set')}
              </button>
            }
          />

          <DialogContent>
            {step === 'edit' ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t('dialogTitle')}</DialogTitle>
                  <DialogDescription>{t('dialogText')}</DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`range-min-${analyteCode}`}>
                      {t('minLabel')}
                    </Label>
                    {/* type="text" + inputMode, как во всей форме анализов:
                        type="number" на мобильных режет запятую и даёт
                        спиннеры, которые тут ни к чему. */}
                    <input
                      id={`range-min-${analyteCode}`}
                      type="text"
                      inputMode="decimal"
                      value={minText}
                      onChange={(e) => setMinText(e.target.value)}
                      disabled={isPending}
                      className={inputClass}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`range-max-${analyteCode}`}>
                      {t('maxLabel')}
                    </Label>
                    <input
                      id={`range-max-${analyteCode}`}
                      type="text"
                      inputMode="decimal"
                      value={maxText}
                      onChange={(e) => setMaxText(e.target.value)}
                      disabled={isPending}
                      className={inputClass}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`range-unit-${analyteCode}`}>
                      {t('unitLabel')}
                    </Label>
                    {analyte.units.length > 1 ? (
                      <select
                        id={`range-unit-${analyteCode}`}
                        value={unitCode}
                        onChange={(e) => setUnitCode(e.target.value)}
                        disabled={isPending}
                        className={inputClass}
                      >
                        {analyte.units.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex h-[38px] items-center px-2.5 text-sm text-muted-foreground">
                        {analyte.units[0]?.label}
                      </div>
                    )}
                  </div>
                </div>

                {error && <p className="text-sm text-rose-600">{error}</p>}

                <DialogFooter>
                  {/* «Убрать» слева и ghost'ом: действие редкое и необратимое,
                      оно не должно стоять рядом с «Сохранить» как равное. */}
                  {range && (
                    <Button
                      variant="ghost"
                      onClick={() => setStep('confirm')}
                      disabled={isPending}
                      className="mr-auto text-muted-foreground"
                    >
                      {t('remove')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    disabled={isPending}
                  >
                    {tc('cancel')}
                  </Button>
                  <Button onClick={onSave} disabled={isPending}>
                    {isPending ? tc('saving') : tc('save')}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                {/* Подтверждение — второй шаг ТОГО ЖЕ диалога, не вложенная
                    модалка: на телефоне две наложенные шторки читаются плохо. */}
                <DialogHeader>
                  <DialogTitle>{t('confirmTitle')}</DialogTitle>
                  <DialogDescription>{t('confirmText')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setStep('edit')}
                    disabled={isPending}
                  >
                    {tc('cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={onRemove}
                    disabled={isPending}
                  >
                    {t('confirmAction')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

type Step = 'edit' | 'confirm'

const inputClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const fmt = (v: number) => numberFmt.format(v)

/**
 * Строка поля → число. Принимает и запятую, и точку: на русской раскладке
 * десятичный разделитель — запятая, и требовать точку значило бы ловить
 * «неверное число» на ровном месте.
 *
 * null, если ввели пустоту или не-число. Дальше по цепочке границы проверит
 * validate() в ranges.ts, а за ним CHECK в БД.
 */
function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Код ошибки из ranges.ts → ключ понятного текста.
 *
 * Перевёрнутый коридор показываем ошибкой, а НЕ меняем границы местами молча:
 * решать за человека, что он имел в виду, здесь нельзя. Так же ведёт себя
 * positionInRange — там min > max даёт null, а не догадку.
 */
function errorKey(e: unknown): string {
  const code = e instanceof Error ? e.message : ''
  if (code.startsWith('lab_range_min_gt_max')) return 'errMinGtMax'
  if (code.startsWith('lab_range_bounds_negative')) return 'errNegative'
  if (code.startsWith('lab_range_bounds_not_finite')) return 'errNotNumber'
  if (code.startsWith('lab_range_unit_required')) return 'errUnit'
  return 'errGeneric'
}
