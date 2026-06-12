'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  MEDICATION_CATALOG,
  type MedicationCatalogEntry,
} from '@/lib/tracker/catalog'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (name: string) => void
  onSelectFromCatalog: (entry: MedicationCatalogEntry) => void
}

export function MedicationNameInput({
  value,
  onChange,
  onSelectFromCatalog,
}: Props) {
  const t = useTranslations('tracker.form')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = value.trim().length === 0
    ? MEDICATION_CATALOG
    : MEDICATION_CATALOG.filter((e) =>
        e.name.toLowerCase().includes(value.toLowerCase()),
      )

  return (
    <div ref={containerRef} className="relative">
      <Command shouldFilter={false} className="overflow-visible bg-transparent">
        <CommandInput
          value={value}
          onValueChange={(v) => {
            onChange(v)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150)
          }}
          placeholder={t('namePlaceholder')}
          className="border-input"
        />
        <div className="relative">
          <CommandList
            className={cn(
              'absolute top-1 left-0 z-50 w-full rounded-lg border bg-popover shadow-md',
              open ? 'block' : 'hidden',
            )}
          >
            {filtered.length === 0 ? (
              <CommandEmpty className="px-3 py-4 text-sm text-muted-foreground">
                {t('nameEmpty')}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((entry) => (
                  <CommandItem
                    key={entry.name}
                    value={entry.name}
                    onSelect={() => {
                      onChange(entry.name)
                      onSelectFromCatalog(entry)
                      setOpen(false)
                    }}
                  >
                    {entry.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </div>
      </Command>
    </div>
  )
}
