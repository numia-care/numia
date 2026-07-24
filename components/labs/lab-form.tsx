'use client'

import { format } from 'date-fns'
import { ImageIcon, LineChartIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ANALYTES, defaultUnitCode, getAnalyte } from '@/lib/labs/catalog'
import { addLabResult } from '@/lib/labs/records'
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

export function LabForm({ initialMode = 'values' }: { initialMode?: Mode }) {
  const t = useTranslations('labs.new')
  const router = useRouter()

  const [mode, setMode] = useState<Mode>(initialMode)

  const [analyteCode, setAnalyteCode] = useState(ANALYTES[0].code)
  const [customName, setCustomName] = useState('')
  const [value, setValue] = useState('')
  const [unitCode, setUnitCode] = useState(defaultUnitCode(ANALYTES[0]) ?? '')
  const [customUnit, setCustomUnit] = useState('')
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  // Дату можно не указывать — не заставляем выдумывать.
  const [noDate, setNoDate] = useState(false)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyte = getAnalyte(analyteCode)!
  const isOther = Boolean(analyte.allowCustom)
  const isPhotoMode = mode === 'photo'

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

    // Собираем ввод в зависимости от режима.
    let payload
    if (isPhotoMode) {
      if (!photo) {
        setError(t('photoRequired'))
        return
      }
      payload = { measuredAt, note: note.trim() || undefined, photo }
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
      await addLabResult(payload)
      toast.success(t('success'))
      router.push('/labs')
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
      {/* Переключатель режима: показателями / фото бланка. */}
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
            className="size-4 accent-[#5A6B4A]"
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
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          rows={2}
          disabled={saving}
        />
      </div>

      {/* ── Фото бланка (E2E). В фото-режиме обязательно, иначе опц. ── */}
      <div className="space-y-2">
        <Label>
          {t('photoLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {isPhotoMode ? t('photoEncrypted') : t('photoOptional')}
          </span>
        </Label>
        {previewUrl && (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {/* object URL выбранного файла — next/image не применим (не http). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="block max-h-[40vh] w-full object-contain" />
          </div>
        )}
        <label
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'cursor-pointer')}
        >
          {photo ? t('changePhoto') : t('pickPhoto')}
          <input
            type="file"
            accept="image/*"
            onChange={onPickPhoto}
            disabled={saving}
            className="sr-only"
          />
        </label>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
      >
        {saving ? t('saving') : t('submit')}
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
