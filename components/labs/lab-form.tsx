'use client'

import { format } from 'date-fns'
import { ImageIcon, LineChartIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ANALYTES, defaultUnitCode, getAnalyte } from '@/lib/labs/catalog'
import { decryptLabNote } from '@/lib/labs/notes'
import { loadBlankPhotoUrl } from '@/lib/labs/photo'
import {
  addLabSession,
  updateLabSession,
  type UpdateLabSessionRow,
} from '@/lib/labs/records'
import { PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Форма анализа. Единица ввода — СДАЧА: одна дата, один бланк, одна заметка
// и сколько угодно показателей за эту дату (запрос тестеров: сдали эстрадиол,
// тестостерон и пролактин в один день — не вводить дату трижды).
//
// Два режима:
//   'values' — список показателей (число + единица + показатель), даёт графики.
//   'photo'  — только снимок бланка, без чисел: внести их можно потом.
//
// Числа уходят открыто (lab_results под RLS — нужны для графика), заметка и
// фото бланка шифруются на устройстве. Дата опциональна: если не помнит,
// «не указана» (measured_at = null).
//
// Создание и правка — ОДНА структура: список показателей, «+» и «×» работают
// в обоих режимах. Отличий ровно два: initialValues (при создании их нет) и
// какая функция вызывается на сохранении (addLabSession / updateLabSession).

const selectClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'
const inputClass = selectClass

// Свободная единица для «другое»: реальные единицы короткие («ммоль/л», «мкМЕ/мл»).
const UNIT_MAX_LEN = 20

type Mode = 'values' | 'photo'

/**
 * Одна строка списка показателей. key — только для React: при удалении из
 * середины индекс съезжает, и без стабильного ключа React переиспользовал бы
 * DOM не тех строк (введённые значения перескочили бы на соседей).
 */
interface AnalyteRow {
  key: string
  /**
   * id строки lab_results. Есть у существующего показателя, нет у только что
   * добавленного — по этому признаку updateLabSession решает, обновить строку
   * или вставить новую.
   */
  id?: string
  analyteCode: string
  customName: string
  value: string
  unitCode: string
  customUnit: string
}

function makeEmptyRow(): AnalyteRow {
  return {
    key: crypto.randomUUID(),
    analyteCode: ANALYTES[0].code,
    customName: '',
    value: '',
    unitCode: defaultUnitCode(ANALYTES[0]) ?? '',
    customUnit: '',
  }
}

function rowFromValues(v: LabFormRow): AnalyteRow {
  return {
    key: crypto.randomUUID(),
    id: v.id,
    analyteCode: v.analyteCode,
    customName: v.customName,
    value: v.value,
    unitCode: v.unitCode,
    customUnit: v.customUnit,
  }
}

/** Показатель строки с подстановкой первого из каталога, если код неизвестен. */
function rowAnalyte(row: AnalyteRow) {
  return getAnalyte(row.analyteCode) ?? ANALYTES[0]
}

/** Один показатель в префилле. id есть всегда — строка уже существует в БД. */
export interface LabFormRow {
  id: string
  analyteCode: string
  customName: string
  value: string
  unitCode: string
  customUnit: string
}

/**
 * Префилл для режима правки — состояние СДАЧИ целиком. Заметка приходит
 * ШИФРОТЕКСТОМ: сервер её расшифровать не может, это делает форма при
 * монтировании (см. эффект ниже). То же с фото.
 */
export interface LabFormValues {
  formMode: Mode
  /** Все показатели сдачи. Пустой массив = сдача «только бланк». */
  rows: LabFormRow[]
  // ── общие поля сдачи ──
  date: string
  noDate: boolean
  noteCiphertext: string | null
  /** Путь шифроблоба фото бланка в Storage; null — фото нет. */
  blankPhotoPath: string | null
  /** base64 nonce для расшифровки блоба; ходит парой с путём. */
  blankPhotoIv: string | null
}

export function LabForm({
  initialMode = 'values',
  mode: formMode = 'create',
  sessionId,
  initialValues,
}: {
  initialMode?: Mode
  mode?: 'create' | 'edit'
  /** id правимой сдачи. Обязателен при mode='edit'. */
  sessionId?: string
  initialValues?: LabFormValues
}) {
  const t = useTranslations('labs.new')
  const tEdit = useTranslations('labs.edit')
  const router = useRouter()

  const isEdit = formMode === 'edit'

  const [mode, setMode] = useState<Mode>(initialValues?.formMode ?? initialMode)

  // Показатели сдачи. При создании — одна пустая строка, при правке все,
  // какие есть. У сдачи «только бланк» список пуст — это законное состояние.
  const [rows, setRows] = useState<AnalyteRow[]>(() => {
    if (!initialValues) return [makeEmptyRow()]
    return initialValues.rows.map(rowFromValues)
  })
  const [date, setDate] = useState(
    initialValues?.date ?? (() => format(new Date(), 'yyyy-MM-dd')),
  )
  // Дату можно не указывать — не заставляем выдумывать.
  const [noDate, setNoDate] = useState(initialValues?.noDate ?? false)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Заметка расшифровывается на клиенте — до этого поле нельзя показывать
  // пустым, иначе сохранение затёрло бы существующий текст.
  const hasEncryptedNote = Boolean(initialValues?.noteCiphertext)
  const [noteLoading, setNoteLoading] = useState(hasEncryptedNote)
  const [noteFailed, setNoteFailed] = useState(false)

  // Существующее фото бланка: путь и IV приходят из ряда, сама картинка
  // скачивается и расшифровывается на клиенте.
  const storedPhotoPath = initialValues?.blankPhotoPath ?? null
  const storedPhotoIv = initialValues?.blankPhotoIv ?? null
  const [storedPhotoUrl, setStoredPhotoUrl] = useState<string | null>(null)
  const [photoLoading, setPhotoLoading] = useState(Boolean(storedPhotoPath))
  const [photoFailed, setPhotoFailed] = useState(false)
  const [photoNeedsPin, setPhotoNeedsPin] = useState(false)
  // Юзер нажал «убрать фото». Отдельный флаг, потому что «фото не выбрано»
  // и «фото надо удалить» — разные намерения.
  const [photoRemoved, setPhotoRemoved] = useState(false)

  // Существующее фото считается имеющимся, пока его не убрали и не заменили.
  const hasStoredPhoto = Boolean(storedPhotoPath) && !photoRemoved

  const isPhotoMode = mode === 'photo'

  // Переключатель «по значениям / фото бланка» прячем, когда правим сдачу, у
  // которой показатели уже есть: один тап означал бы «снести их все». Убрать
  // показатели можно «×» по одному, и когда не останется ни одного, сдача
  // сама станет «только бланк». При создании и при правке сдачи БЕЗ
  // показателей переключатель нужен и показывается.
  const showModeTabs = !isEdit || (initialValues?.rows.length ?? 0) === 0

  /**
   * ПИН-ГЕЙТ НА ВХОДЕ. Заметку надо расшифровать для префилла, а ключ живёт
   * только в памяти вкладки. Нет ключа — форму открыть нечем: показать поле
   * пустым значило бы предложить сохранить и стереть текст, которого юзер не
   * видел. Поэтому уводим на /pin.
   *
   * У записи без заметки расшифровывать нечего — PIN на входе не нужен, и
   * редактировать числа можно с истёкшей сессией.
   */
  useEffect(() => {
    const ciphertext = initialValues?.noteCiphertext
    if (!ciphertext) return

    let active = true
    async function load() {
      try {
        const text = await decryptLabNote(ciphertext!)
        if (!active) return
        setNote(text ?? '')
        setNoteLoading(false)
      } catch (err) {
        if (!active) return
        if (err instanceof PinRequiredError) {
          toast(t('pinNeeded'))
          router.push('/pin')
          return
        }
        setNoteFailed(true)
        setNoteLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
    // initialValues приходит из серверного рендера и за жизнь формы не меняется.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Показ существующего фото: скачать шифроблоб, расшифровать, отдать object URL.
   *
   * PIN здесь МЯГКИЙ, в отличие от заметки: нет ключа — показываем строчку
   * «нужен PIN, чтобы открыть фото», а форму не бросаем. У заметки жёсткий
   * редирект нужен потому, что пустое поле при сохранении стёрло бы текст;
   * у фото такого риска нет — колонки blank_photo_* меняются только по явному
   * действию. Иначе запись с фото, но без заметки, стала бы нередактируемой
   * по дате из-за истёкшей сессии, без всякого выигрыша в безопасности.
   */
  useEffect(() => {
    if (!storedPhotoPath || !storedPhotoIv) return

    let active = true
    let created: string | null = null

    async function load() {
      try {
        const url = await loadBlankPhotoUrl(storedPhotoPath!, storedPhotoIv!)
        if (!active) {
          // Размонтировались, пока расшифровывали — блоб всё равно надо отпустить.
          URL.revokeObjectURL(url)
          return
        }
        created = url
        setStoredPhotoUrl(url)
        setPhotoLoading(false)
      } catch (err) {
        if (!active) return
        if (err instanceof PinRequiredError) setPhotoNeedsPin(true)
        else setPhotoFailed(true)
        setPhotoLoading(false)
      }
    }
    load()

    return () => {
      active = false
      // Расшифрованный блоб не должен пережить компонент: это и утечка памяти,
      // и лишнее время жизни открытых данных в памяти вкладки.
      if (created) URL.revokeObjectURL(created)
    }
  }, [storedPhotoPath, storedPhotoIv])

  // Превью фото бланка — отзываем при смене/размонтировании.
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function updateRow(key: string, patch: Partial<AnalyteRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  // Смена показателя сбрасывает единицу на дефолтную для нового: у эстрадиола
  // и тестостерона наборы единиц разные, оставлять чужую нельзя.
  function onAnalyteChange(key: string, code: string) {
    updateRow(key, {
      analyteCode: code,
      unitCode: defaultUnitCode(getAnalyte(code) ?? ANALYTES[0]) ?? '',
    })
  }

  function addRow() {
    setRows((prev) => [...prev, makeEmptyRow()])
  }

  function removeRow(key: string) {
    // Минимум одна строка: пустой список нечего было бы сохранять.
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }

  /**
   * Проверка одной строки. Возвращает готовое сообщение или null.
   * Когда строк несколько, к сообщению спереди клеится «Показатель N» —
   * иначе при пяти показателях «Введи число больше нуля» не говорит, где.
   */
  function validateRow(row: AnalyteRow, index: number, total: number): string | null {
    const isOther = Boolean(rowAnalyte(row).allowCustom)
    const prefix = (msg: string) =>
      total > 1 ? `${t('rowPrefix', { n: index + 1 })}${msg}` : msg

    const num = parseFloat(row.value.replace(',', '.'))
    if (!isFinite(num) || num <= 0) return prefix(t('valueInvalid'))
    if (isOther && !row.customName.trim()) return prefix(t('customNameRequired'))

    const unit = isOther ? row.customUnit.trim() : row.unitCode
    if (!unit) return prefix(t('unitRequired'))
    if (isOther && unit.length > UNIT_MAX_LEN) return prefix(t('unitInvalid'))

    return null
  }

  /** Строка формы → показатель для addLabSession. Вызывать после validateRow. */
  /**
   * Строка формы → показатель для слоя данных. Вызывать после validateRow.
   *
   * id пробрасывается как есть: у существующей строки он есть и
   * updateLabSession её обновит, у только что добавленной его нет и строка
   * вставится. При создании id нет ни у кого, и addLabSession его игнорирует.
   */
  function toSessionRow(row: AnalyteRow): UpdateLabSessionRow {
    const isOther = Boolean(rowAnalyte(row).allowCustom)
    return {
      id: row.id,
      analyte: row.analyteCode,
      analyteCustomName: isOther ? row.customName.trim() : undefined,
      value: parseFloat(row.value.replace(',', '.')),
      unit: isOther ? row.customUnit.trim() : row.unitCode,
    }
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setPhoto(picked)
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null)
    // Выбрали файл — значит не «убрать», а «заменить»: снимаем флаг удаления.
    if (picked) setPhotoRemoved(false)
  }

  function onRemovePhoto() {
    // Свежевыбранный файл просто отменяем; существующее помечаем к удалению —
    // фактически оно снесётся при сохранении, а не сейчас.
    setPhoto(null)
    setPreviewUrl(null)
    if (storedPhotoPath) setPhotoRemoved(true)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)

    // Дата (если указана) не может быть в будущем.
    if (!noDate && date > format(new Date(), 'yyyy-MM-dd')) {
      setError(t('dateFuture'))
      return
    }
    const measuredAt = noDate ? null : date

    // Пока заметка не расшифровалась — сохранять нельзя: в поле пусто не
    // потому что юзер стёр текст, а потому что мы его ещё не показали.
    if (noteLoading) {
      setError(tEdit('noteStillLoading'))
      return
    }
    if (noteFailed) {
      setError(tEdit('noteBroken'))
      return
    }

    if (isPhotoMode) {
      // Сдача «только бланк» обязана иметь фото. В правке засчитывается и
      // существующее — если его не убрали и не заменили.
      if (!photo && !hasStoredPhoto) {
        setError(t('photoRequired'))
        return
      }
    } else {
      // Проверяем ВСЕ строки и сообщаем о первой сломанной.
      for (let i = 0; i < rows.length; i += 1) {
        const rowError = validateRow(rows[i], i, rows.length)
        if (rowError) {
          setError(rowError)
          return
        }
      }
    }

    const noteText = note.trim() || undefined

    setSaving(true)
    try {
      if (isEdit && sessionId) {
        // Правка сдачи целиком. Отдаём ИТОГОВЫЙ список показателей: строки с
        // id обновятся, без id вставятся, а те, что юзер убрал «×», в список
        // просто не попадут — updateLabSession снесёт их через delete not in.
        await updateLabSession(sessionId, {
          measuredAt,
          note: noteText,
          // Фото: выбран файл → заменить; нажали «убрать» → удалить;
          // ни того, ни другого → колонки не тронутся.
          photo: photo ?? undefined,
          removePhoto: photoRemoved && !photo,
          rows: isPhotoMode ? [] : rows.map(toSessionRow),
        })
        toast.success(tEdit('success'))
      } else {
        // Создание идёт через сдачу: одна дата, одна заметка, один бланк и
        // N показателей. В режиме «фото бланка» показателей нет вовсе —
        // rows уходит пустым, addLabSession знает, что с этим делать.
        await addLabSession({
          measuredAt,
          note: noteText,
          photo: photo ?? undefined,
          rows: isPhotoMode ? [] : rows.map(toSessionRow),
        })
        toast.success(t('success'))
      }
      router.push('/tracker?tab=analyses')
      router.refresh()
    } catch (err) {
      if (err instanceof PinRequiredError) {
        toast(t('pinNeeded'))
        router.push('/pin')
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('error', { error: msg }))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Переключатель «по значениям / фото бланка». Скрыт при правке сдачи,
          у которой показатели уже есть: один тап означал бы «снести их все».
          Убрать показатели можно «×» по одному — когда не останется ни
          одного, сдача сама станет «только бланк». */}
      {showModeTabs && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1">
          <ModeTab
            active={!isPhotoMode}
            onClick={() => setMode('values')}
            icon={LineChartIcon}
            label={t('modeValues')}
          />
          <ModeTab
            active={isPhotoMode}
            onClick={() => setMode('photo')}
            icon={ImageIcon}
            label={t('modePhoto')}
          />
        </div>
      )}

      {isPhotoMode && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('photoModeHint')}
        </p>
      )}

      {/* ── Показатели: список строк за одну дату ── */}
      {!isPhotoMode && (
        <div className="space-y-4">
          {rows.map((row, index) => (
            <AnalyteRowFields
              key={row.key}
              row={row}
              index={index}
              total={rows.length}
              disabled={saving}
              canRemove={rows.length > 1}
              onChange={(patch) => updateRow(row.key, patch)}
              onAnalyteChange={(code) => onAnalyteChange(row.key, code)}
              onRemove={() => removeRow(row.key)}
            />
          ))}

          {(
            <button
              type="button"
              onClick={addRow}
              disabled={saving}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'w-full gap-2',
              )}
            >
              <PlusIcon className="size-4" />
              {t('addRow')}
            </button>
          )}
        </div>
      )}

      {/* ── Дата (опциональна в обоих режимах) ── */}
      <div className="space-y-1.5">
        <Label htmlFor="measured-at">
          {t('dateLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {t('dateOptional')}
          </span>
        </Label>
        {noDate ? (
          <p className="text-sm text-muted-foreground">{t('noDateActive')}</p>
        ) : (
          <div>
            <DatePicker value={date} onChange={setDate} disableFuture />
          </div>
        )}
        <label className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={noDate}
            onChange={(e) => setNoDate(e.target.checked)}
            disabled={saving}
            className="size-4 accent-primary"
          />
          {t('noDateToggle')}
        </label>
      </div>

      {/* ── Заметка (E2E, опц.) ── */}
      <div className="space-y-1.5">
        <Label htmlFor="note">
          {t('noteLabel')}{' '}
          <span className="font-normal text-muted-foreground">{t('noteOptional')}</span>
        </Label>
        {noteLoading ? (
          // Пока не расшифровали — поле не показываем: пустая textarea
          // прочиталась бы как «заметки нет», и сохранение стёрло бы текст.
          <div
            className="h-[62px] animate-pulse rounded-lg bg-foreground/5"
            aria-label={tEdit('noteLoading')}
          />
        ) : noteFailed ? (
          <p className="text-sm text-rose-600">{tEdit('noteBroken')}</p>
        ) : (
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            rows={2}
            disabled={saving}
          />
        )}
      </div>

      {/* ── Фото бланка (E2E). В фото-режиме обязательно, иначе опц. ── */}
      <div className="space-y-2">
        <Label>
          {t('photoLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {isPhotoMode ? t('photoEncrypted') : t('photoOptional')}
          </span>
        </Label>
        {/* Свежевыбранный файл показывается вместо существующего: он и
            заменит его при сохранении. */}
        {previewUrl ? (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {/* object URL выбранного файла — next/image не применим (не http). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="block max-h-[40vh] w-full object-contain" />
          </div>
        ) : hasStoredPhoto ? (
          photoLoading ? (
            <div
              className="h-40 animate-pulse rounded-2xl bg-foreground/5"
              aria-label={tEdit('photoLoading')}
            />
          ) : photoNeedsPin ? (
            <p className="text-sm text-muted-foreground">
              {tEdit('photoNeedsPin')}{' '}
              <Link href="/pin" className="underline">
                {tEdit('photoNeedsPinLink')}
              </Link>
            </p>
          ) : photoFailed ? (
            <p className="text-sm text-rose-600">{tEdit('photoBroken')}</p>
          ) : storedPhotoUrl ? (
            <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={storedPhotoUrl}
                alt=""
                className="block max-h-[40vh] w-full object-contain"
              />
            </div>
          ) : null
        ) : null}

        <div className="flex flex-wrap gap-2">
          <label
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'cursor-pointer')}
          >
            {photo || hasStoredPhoto ? t('changePhoto') : t('pickPhoto')}
            <input
              type="file"
              accept="image/*"
              onChange={onPickPhoto}
              disabled={saving}
              className="sr-only"
            />
          </label>

          {/* Убрать фото можно только когда оно есть — существующее или
              только что выбранное. */}
          {(hasStoredPhoto || photo) && (
            <button
              type="button"
              onClick={onRemovePhoto}
              disabled={saving}
              className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }))}
            >
              {tEdit('photoRemove')}
            </button>
          )}
        </div>

        {photoRemoved && !photo && (
          <p className="text-sm text-muted-foreground">{tEdit('photoWillRemove')}</p>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        disabled={saving || noteLoading}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
      >
        {saving
          ? isEdit
            ? tEdit('saving')
            : t('saving')
          : isEdit
            ? tEdit('submit')
            : t('submit')}
      </button>
    </form>
  )
}

/**
 * Поля одного показателя. Вынесены из формы, чтобы их можно было повторять.
 *
 * Все id полей получают суффикс из row.key: при нескольких строках
 * захардкоженные id задублировались бы, а дубликаты ломают связь
 * <Label htmlFor> — скринридер и клик по подписи уводили бы на первую строку.
 */
function AnalyteRowFields({
  row,
  index,
  total,
  disabled,
  canRemove,
  onChange,
  onAnalyteChange,
  onRemove,
}: {
  row: AnalyteRow
  index: number
  total: number
  disabled: boolean
  canRemove: boolean
  onChange: (patch: Partial<AnalyteRow>) => void
  onAnalyteChange: (code: string) => void
  onRemove: () => void
}) {
  const t = useTranslations('labs.new')
  const analyte = rowAnalyte(row)
  const isOther = Boolean(analyte.allowCustom)
  const uid = row.key

  return (
    <div
      className={cn(
        'space-y-4',
        // Разделитель между показателями — только когда их несколько.
        total > 1 && 'rounded-2xl bg-muted/30 p-4',
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`analyte-${uid}`}>
            {total > 1 ? t('rowPrefix', { n: index + 1 }) : t('analyteLabel')}
          </Label>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              aria-label={t('removeRow')}
              title={t('removeRow')}
              className="-m-2 flex size-8 items-center justify-center p-2 text-foreground/40 transition-colors hover:text-foreground/80"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <select
          id={`analyte-${uid}`}
          value={row.analyteCode}
          onChange={(e) => onAnalyteChange(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          {ANALYTES.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {isOther && (
        <div className="space-y-1.5">
          <Label htmlFor={`custom-name-${uid}`}>{t('customNameLabel')}</Label>
          <input
            id={`custom-name-${uid}`}
            type="text"
            value={row.customName}
            onChange={(e) => onChange({ customName: e.target.value })}
            placeholder={t('customNamePlaceholder')}
            maxLength={60}
            disabled={disabled}
            className={inputClass}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`value-${uid}`}>{t('valueLabel')}</Label>
          <input
            id={`value-${uid}`}
            type="text"
            inputMode="decimal"
            value={row.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={t('valuePlaceholder')}
            disabled={disabled}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`unit-${uid}`}>{t('unitLabel')}</Label>
          {isOther ? (
            <input
              id={`unit-${uid}`}
              type="text"
              value={row.customUnit}
              onChange={(e) => onChange({ customUnit: e.target.value })}
              placeholder={t('unitPlaceholder')}
              maxLength={UNIT_MAX_LEN}
              disabled={disabled}
              className={inputClass}
            />
          ) : analyte.units.length > 1 ? (
            <select
              id={`unit-${uid}`}
              value={row.unitCode}
              onChange={(e) => onChange({ unitCode: e.target.value })}
              disabled={disabled}
              className={selectClass}
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
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof ImageIcon
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-card text-foreground ring-1 ring-border'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
