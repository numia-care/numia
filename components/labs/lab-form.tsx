'use client'

import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { DatePicker } from '@/components/tracker/date-picker'
import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ANALYTES,
  defaultUnitCode,
  getAnalyte,
} from '@/lib/labs/catalog'
import { addLabResult } from '@/lib/labs/records'
import { PinRequiredError } from '@/lib/path/entries'
import { cn } from '@/lib/utils'

// Форма добавления лабораторного показателя. Числа уходят открыто (lab_results
// под RLS — нужны для графика), заметка и фото бланка шифруются на устройстве
// (addLabResult). Выбор показателя из каталога (lib/labs/catalog) или «другое».

const selectClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'
const inputClass = selectClass

// Свободная единица для «другое»: реальные единицы короткие («ммоль/л», «мкМЕ/мл»).
const UNIT_MAX_LEN = 20

export function LabForm() {
  const t = useTranslations('labs.new')
  const router = useRouter()

  const [analyteCode, setAnalyteCode] = useState(ANALYTES[0].code)
  const [customName, setCustomName] = useState('')
  const [value, setValue] = useState('')
  const [unitCode, setUnitCode] = useState(defaultUnitCode(ANALYTES[0]) ?? '')
  const [customUnit, setCustomUnit] = useState('')
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyte = getAnalyte(analyteCode)!
  const isOther = Boolean(analyte.allowCustom)

  // Превью фото бланка — отзываем при смене/размонтировании.
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function onAnalyteChange(code: string) {
    setAnalyteCode(code)
    // Единица сбрасывается на дефолтную нового показателя (для 'other' — пусто,
    // единицу впишут вручную).
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

    // value: принимаем запятую как разделитель.
    const num = parseFloat(value.replace(',', '.'))
    if (!isFinite(num) || num <= 0) {
      setError(t('valueInvalid'))
      return
    }
    // Будущая дата недопустима (датапикер её и не даёт — это защита на сабмите).
    if (date > format(new Date(), 'yyyy-MM-dd')) {
      setError(t('dateFuture'))
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
    // Свободная единица «другого» — базовая проверка длины (непустая уже выше).
    if (isOther && unit.length > UNIT_MAX_LEN) {
      setError(t('unitInvalid'))
      return
    }

    setSaving(true)
    try {
      await addLabResult({
        analyte: analyteCode,
        analyteCustomName: isOther ? customName : undefined,
        value: num,
        unit,
        measuredAt: date,
        note: note.trim() || undefined,
        photo: photo ?? undefined,
      })
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
      {/* Показатель */}
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

      {/* Название — только для «другое» */}
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

      {/* Значение + единица */}
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
            // Единственная единица — показываем статично.
            <div className="flex h-[38px] items-center px-2.5 text-sm text-muted-foreground">
              {analyte.units[0]?.label}
            </div>
          )}
        </div>
      </div>

      {/* Дата */}
      <div className="space-y-1.5">
        <Label htmlFor="measured-at">{t('dateLabel')}</Label>
        <div>
          {/* Будущие даты запрещены: анализа из будущего не существует. */}
          <DatePicker value={date} onChange={setDate} disableFuture />
        </div>
      </div>

      {/* Заметка — E2E */}
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

      {/* Фото бланка — E2E */}
      <div className="space-y-2">
        <Label>
          {t('photoLabel')}{' '}
          <span className="font-normal text-muted-foreground">{t('photoOptional')}</span>
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
