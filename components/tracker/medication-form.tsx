'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  FORMS_ORDERED,
  KINDS_ORDERED,
  UNITS_ORDERED,
  findCatalogDefaults,
  type MedicationCatalogEntry,
} from '@/lib/tracker/catalog'
import { MedicationInputSchema } from '@/lib/tracker/medication-schema'
import { createMedication, updateMedication } from '@/lib/tracker/medications'

import { DatePicker } from './date-picker'
import type { MedicationFormValues } from './medication-form-schema'
import { MedicationNameInput } from './medication-name-input'
import { ScheduleInput } from './schedule-input'
import { TimeSelect } from './time-select'

interface MedicationFormProps {
  /** edit: pre-fill из initialValues, submit → updateMedication */
  mode?: 'create' | 'edit'
  editId?: string
  initialValues?: MedicationFormValues
}

export function MedicationForm({
  mode = 'create',
  editId,
  initialValues,
}: MedicationFormProps = {}) {
  const t = useTranslations('tracker.form')
  const tKind = useTranslations('tracker.kind')
  const tMedForm = useTranslations('tracker.medForm')
  const tUnit = useTranslations('tracker.unit')
  const tc = useTranslations('common')

  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)
  // В edit-режиме сразу открываем детали — юзер пришёл редактировать.
  const [detailsOpen, setDetailsOpen] = useState(mode === 'edit')
  const [fromCatalog, setFromCatalog] = useState(false)

  const form = useForm<MedicationFormValues>({
    resolver: zodResolver(MedicationInputSchema),
    defaultValues: initialValues ?? {
      name: '',
      kind: 'estrogen',
      form: 'tablet',
      dose_amount: undefined as unknown as number,
      dose_unit: 'mg',
      schedule: { kind: 'daily', times: ['09:00'] },
      start_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    },
  })

  const handleCatalogSelect = (entry: MedicationCatalogEntry) => {
    form.setValue('kind', entry.kind, { shouldDirty: true })
    form.setValue('form', entry.form, { shouldDirty: true })
    form.setValue('dose_amount', entry.dose_default, { shouldDirty: true })
    form.setValue('dose_unit', entry.dose_unit, { shouldDirty: true })
    setFromCatalog(true)
  }

  const handleNameChange = (name: string) => {
    form.setValue('name', name, { shouldDirty: true, shouldValidate: name.length > 0 })
    const match = findCatalogDefaults(name)
    if (!match && name.trim().length > 0) {
      setDetailsOpen(true)
      setFromCatalog(false)
    }
  }

  // Время для быстрого поля (показывается только когда детали свёрнуты).
  // Зависит от вида расписания: у daily время лежит в times[], у interval —
  // в одиночном time. Без ветки на interval поле всегда показывало бы 09:00
  // (times[] у interval пустой) и не отражало реальное schedule.time.
  const quickScheduleKind = form.watch('schedule.kind')
  const currentTime =
    quickScheduleKind === 'interval'
      ? ((form.watch('schedule.time') as string | undefined) ?? '09:00')
      : ((form.watch('schedule.times') as string[] | undefined)?.[0] ?? '09:00')

  const handleTimeChange = (value: string) => {
    const scheduleKind = form.watch('schedule.kind')
    if (scheduleKind === 'daily') {
      const times = (form.watch('schedule.times') as string[]) ?? ['09:00']
      const next = [...times]
      next[0] = value
      form.setValue('schedule.times', next, { shouldDirty: true })
    } else {
      form.setValue('schedule.time', value, { shouldDirty: true })
    }
  }

  const onSubmit = (values: MedicationFormValues) => {
    setSubmitError(null)
    startTransition(async () => {
      const result =
        mode === 'edit' && editId
          ? await updateMedication(editId, values)
          : await createMedication(values)
      if (result.ok) {
        toast.success(
          mode === 'edit' ? t('updateSuccess') : t('submitSuccess'),
        )
        router.push('/tracker')
        router.refresh()
      } else {
        setSubmitError(result.error)
      }
    })
  }

  const nameValue = form.watch('name')
  const canSave = nameValue.trim().length > 0

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={() => (
            <FormItem>
              <FormLabel>{t('nameLabel')}</FormLabel>
              <FormControl>
                <MedicationNameInput
                  value={nameValue}
                  onChange={handleNameChange}
                  onSelectFromCatalog={handleCatalogSelect}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Быстрое поле времени — единственный контрол, пока детали свёрнуты.
            Когда детали открыты (всегда в edit-режиме), время редактируется
            в ScheduleInput, и дублировать его здесь нельзя: два контрола на
            одном поле schedule перетирали друг друга (отсюда был баг
            «изменённое время не сохраняется»). */}
        {!detailsOpen && (
          <div>
            <Label>{t('timeLabel')}</Label>
            <div className="mt-2">
              <TimeSelect value={currentTime} onChange={handleTimeChange} />
            </div>
          </div>
        )}

        <Button type="submit" size="lg" disabled={!canSave || isPending} className="w-full">
          {isPending ? tc('saving') : tc('save')}
        </Button>

        {submitError && (
          <p className="text-sm text-destructive">
            {t('submitError', { error: submitError })}
          </p>
        )}

        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {detailsOpen ? (
            <>
              {t('detailsCollapse')} <ChevronUpIcon className="size-4" />
            </>
          ) : (
            <>
              {t('detailsExpand')} <ChevronDownIcon className="size-4" />
            </>
          )}
        </button>

        {detailsOpen && (
          <div className="space-y-6 rounded-xl border border-border bg-card/50 p-5">
            {fromCatalog && (
              <p className="text-xs text-muted-foreground">
                {t('catalogHint')}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('kindLabel')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(v) => v ? tKind(v as 'estrogen') : ''}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {KINDS_ORDERED.map((k) => (
                          <SelectItem key={k} value={k}>
                            {tKind(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="form"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('formLabel')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(v) => v ? tMedForm(v as 'tablet') : ''}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FORMS_ORDERED.map((f) => (
                          <SelectItem key={f} value={f}>
                            {tMedForm(f)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="dose_amount"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{t('doseLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        placeholder={t('dosePlaceholder')}
                        value={field.value === undefined ? '' : String(field.value)}
                        onChange={(e) => {
                          const raw = e.target.value
                          field.onChange(raw === '' ? undefined : Number(raw))
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dose_unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('unitLabel')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(v) => v ? tUnit(v as 'mg') : ''}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {UNITS_ORDERED.map((u) => (
                          <SelectItem key={u} value={u}>
                            {tUnit(u)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <ScheduleInput />

            <FormField
              control={form.control}
              name="start_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('startDateLabel')}</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('notesLabel')}{' '}
                    <span className="font-normal text-muted-foreground">
                      {t('notesOptional')}
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      rows={3}
                      placeholder={t('notesPlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </form>
    </Form>
  )
}
