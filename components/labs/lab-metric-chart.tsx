'use client'

import { format, parse, subMonths } from 'date-fns'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import { LabChart } from '@/components/labs/lab-chart'
import type { UserRange } from '@/lib/labs/stats'
import { cn } from '@/lib/utils'

/**
 * Окно просмотра графика: 3 месяца, 6 месяцев, год.
 *
 * 🔴 ПЕРИОД ТРОГАЕТ ТОЛЬКО ГРАФИК. Это не стилистика, а требование к данным.
 *
 * Крупное значение, пилюля положения, дельта и тренд считаются в
 * MetricSummary по ПОЛНЫМ данным группы — и обязаны считаться там. «Растёт
 * третий замер подряд» — факт о ряде, а не о выбранном окне: если бы фраза
 * пересчитывалась под период, сужение окна до «3м» превращало бы её в
 * «растёт второй замер подряд» не потому, что что-то изменилось, а потому что
 * человек подвинул ползунок. Число выглядело бы фактом, а зависело бы от
 * настройки экрана. Для медданных это недопустимо.
 *
 * Гарантия здесь СТРУКТУРНАЯ, а не договорённость: обрезанный массив
 * (`windowed` ниже) не существует нигде, кроме этого компонента, и наружу не
 * отдаётся. MetricSummary фильтрует свои точки сам, отдельным выражением.
 * Свести их в общий helper нельзя — период тут же протёк бы в карточку.
 *
 * Список замеров период тоже не фильтрует (README:69).
 *
 * Почему обёртка, а не состояние внутри LabChart: переключатель по макету
 * стоит НАД графиком, между карточкой показателя и полотном. Плюс так
 * ChartFromRows остаётся серверным и просто передаёт полные точки вниз.
 */

export interface MetricChartRow {
  value: number
  unit: string
  measuredAt: string // 'yyyy-MM-dd'
}

type Period = '3m' | '6m' | '1y'

const PERIOD_MONTHS: Record<Period, number> = { '3m': 3, '6m': 6, '1y': 12 }
const PERIODS: Period[] = ['3m', '6m', '1y']
const PERIOD_LABEL: Record<Period, string> = { '3m': 'm3', '6m': 'm6', '1y': 'y1' }

export function LabMetricChart({
  analyteCode,
  rows,
  range = null,
  today,
}: {
  analyteCode: string
  /** ВСЕ датированные точки показателя. Обрезка происходит здесь, не выше. */
  rows: MetricChartRow[]
  range?: UserRange | null
  /**
   * Сегодняшняя дата 'yyyy-MM-dd', посчитанная на сервере.
   *
   * Пропсом, а не new Date() внутри: компонент рендерится и на сервере (SSR),
   * и на клиенте, а таймзоны у них разные — расхождение на день дало бы
   * рассинхрон гидратации. Одно значение сверху делает обе отрисовки
   * одинаковыми.
   */
  today: string
}) {
  const t = useTranslations('labs.period')
  const [period, setPeriod] = useState<Period>('6m')

  // Граница окна — от СЕГОДНЯ, а не от последнего замера: «за 3 месяца»
  // означает календарные три месяца назад, иначе окно ездило бы вместе с
  // данными и «3м» у одного человека значило бы не то же, что у другого.
  const cutoff = useMemo(
    () =>
      format(
        subMonths(parse(today, 'yyyy-MM-dd', new Date()), PERIOD_MONTHS[period]),
        'yyyy-MM-dd',
      ),
    [today, period],
  )

  // Даты в 'yyyy-MM-dd' сравнимы как строки — лексикографический порядок
  // совпадает с хронологическим.
  const windowed = useMemo(
    () => rows.filter((r) => r.measuredAt >= cutoff),
    [rows, cutoff],
  )

  // Датированных точек нет вовсе — период здесь ни при чём, и говорить «нет
  // замеров за этот период» было бы неправдой. Отдаём график как есть: при
  // заданном коридоре он нарисует полосу (решение шага 2d — коридор от числа
  // замеров не зависит). Переключатель при этом не показываем, фильтровать
  // нечего.
  if (rows.length === 0) {
    return <LabChart analyteCode={analyteCode} range={range} rows={rows} />
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex justify-end gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              period === p
                ? 'bg-lavender-soft text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(PERIOD_LABEL[p])}
          </button>
        ))}
      </div>

      {windowed.length === 0 ? (
        // Констатация, без оценки и без совета «внеси замер». Коридор тут не
        // рисуем: полосы без полотна не бывает, а разворачивать пустой график
        // ради неё незачем — границы видно в карточке выше.
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground ring-1 ring-border">
          {t('empty')}
        </p>
      ) : (
        <LabChart analyteCode={analyteCode} range={range} rows={windowed} />
      )}
    </div>
  )
}
