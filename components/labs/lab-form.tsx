'use client'

import { format } from 'date-fns'
import { ImageIcon, LineChartIcon } from 'lucide-react'
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
  addLabResult,
  updateLabResult,
  type NewLabResult,
} from '@/lib/labs/records'
import { PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Форма добавления анализа. Два режима (фидбек тестера):
//   'values' — внести показателями (число + единица + показатель), график.
//   'photo'  — загрузить фото бланка без ручного ввода чисел (снимок на потом).
// Числа уходят открыто (lab_results под RLS — нужны для графика), заметка и
// фото бланка шифруются на устройстве (addLabResult). Дата опциональна: если
// не помнит, «не указана» (measured_at = null).

const selectClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'
const inputClass = selectClass

// Свободная единица для «другое»: реальные единицы короткие («ммоль/л», «мкМЕ/мл»).
const UNIT_MAX_LEN = 20

type Mode = 'values' | 'photo'

/**
 * Значения для префилла в режиме редактирования. Заметка приходит
 * ШИФРОТЕКСТОМ: сервер её расшифровать не может, это делает форма при
 * монтировании (см. эффект ниже).
 */
export interface LabFormValues {
  formMode: Mode
  analyteCode: string
  customName: string
  value: string
  unitCode: string
  customUnit: string
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
  editId,
  initialValues,
}: {
  initialMode?: Mode
  mode?: 'create' | 'edit'
  editId?: string
  initialValues?: LabFormValues
}) {
  const t = useTranslations('labs.new')
  const tEdit = useTranslations('labs.edit')
  const router = useRouter()

  const isEdit = formMode === 'edit'

  const [mode, setMode] = useState<Mode>(initialValues?.formMode ?? initialMode)

  const [analyteCode, setAnalyteCode] = useState(
    initialValues?.analyteCode ?? ANALYTES[0].code,
  )
  const [customName, setCustomName] = useState(initialValues?.customName ?? '')
  const [value, setValue] = useState(initialValues?.value ?? '')
  const [unitCode, setUnitCode] = useState(
    initialValues?.unitCode ?? defaultUnitCode(ANALYTES[0]) ?? '',
  )
  const [customUnit, setCustomUnit] = useState(initialValues?.customUnit ?? '')
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

  // Каталог мог измениться (или в ряду лежит код, которого уже нет) —
  // не роняем форму на non-null assertion, а откатываемся к первому показателю.
  const analyte = getAnalyte(analyteCode) ?? ANALYTES[0]
  const isOther = Boolean(analyte.allowCustom)
  const isPhotoMode = mode === 'photo'

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

  function onAnalyteChange(code: string) {
    setAnalyteCode(code)
    setUnitCode(defaultUnitCode(getAnalyte(code)!) ?? '')
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

    // Собираем ввод в зависимости от режима. Тип объявлен явно: без него TS
    // выводит объединение двух литералов, и до payload.analyte не дотянуться.
    let payload: NewLabResult
    if (isPhotoMode) {
      // Запись «только фото» обязана иметь фото. В правке засчитывается и
      // существующее — если его не убрали и не заменили.
      if (!photo && !hasStoredPhoto) {
        setError(t('photoRequired'))
        return
      }
      // photo ?? undefined — как в числовой ветке ниже: NewLabResult ждёт
      // File | undefined, а состояние формы держит null для «не выбрано».
      payload = {
        measuredAt,
        note: note.trim() || undefined,
        photo: photo ?? undefined,
      }
    } else {
      const num = parseFloat(value.replace(',', '.'))
      if (!isFinite(num) || num <= 0) {
        setError(t('valueInvalid'))
        return
      }
      if (isOther && !customName.trim()) {
        setError(t('customNameRequired'))
        return
      }
      const unit = isOther ? customUnit.trim() : unitCode
      if (!unit) {
        setError(t('unitRequired'))
        return
      }
      if (isOther && unit.length > UNIT_MAX_LEN) {
        setError(t('unitInvalid'))
        return
      }
      payload = {
        analyte: analyteCode,
        analyteCustomName: isOther ? customName : undefined,
        value: num,
        unit,
        measuredAt,
        note: note.trim() || undefined,
        photo: photo ?? undefined,
      }
    }

    setSaving(true)
    try {
      if (isEdit && editId) {
        await updateLabResult(editId, {
          analyte: payload.analyte,
          analyteCustomName: payload.analyteCustomName,
          value: payload.value,
          unit: payload.unit,
          measuredAt: payload.measuredAt,
          note: payload.note,
          // Фото: выбран файл → заменить; нажали «убрать» → удалить;
          // ни того, ни другого → колонки не тронутся.
          photo: photo ?? undefined,
          removePhoto: photoRemoved && !photo,
          currentPhotoPath: storedPhotoPath,
        })
        toast.success(tEdit('success'))
      } else {
        await addLabResult(payload)
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
      {/* Переключатель режима: показателями / фото бланка. В правке снова
          рабочий — природу записи (числовая ↔ только фото) теперь есть чем
          менять. */}
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

      {isPhotoMode && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('photoModeHint')}
        </p>
      )}

      {/* ── Поля числового режима ── */}
      {!isPhotoMode && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="analyte">{t('analyteLabel')}</Label>
            <select
              id="analyte"
              value={analyteCode}
              onChange={(e) => onAnalyteChange(e.target.value)}
              disabled={saving}
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
              <Label htmlFor="custom-name">{t('customNameLabel')}</Label>
              <input
                id="custom-name"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t('customNamePlaceholder')}
                maxLength={60}
                disabled={saving}
                className={inputClass}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">{t('valueLabel')}</Label>
              <input
                id="value"
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('valuePlaceholder')}
                disabled={saving}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unit">{t('unitLabel')}</Label>
              {isOther ? (
                <input
                  id="unit"
                  type="text"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                  placeholder={t('unitPlaceholder')}
                  maxLength={UNIT_MAX_LEN}
                  disabled={saving}
                  className={inputClass}
                />
              ) : analyte.units.length > 1 ? (
                <select
                  id="unit"
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  disabled={saving}
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
        </>
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
