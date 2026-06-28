// Квир-история дня — выверяемый хардкод-массив фактов для карточки на дашборде.
//
// ⚠️ ВАЖНО: перед ПУБЛИЧНЫМ запуском факты обязательно сверить по источникам
// (даты, формулировки, контекст). Сейчас — стартовый набор; легко расширять,
// просто добавив запись в FACTS.
//
// Структура факта:
//   label  — отображаемая дата/год («28 июня 1969», «1919», «20 ноября»)
//   day/month — числовые поля ТОЛЬКО для совпадения с сегодняшней датой
//   kind   — опц. примета: 'memorial' (памятная дата) | 'event' (событие года)
//   text   — текст без ведущей даты (её показываем из label)
//
// Тон тёплый, уважительный. Тексты гендерно-нейтральные.

export interface QueerFact {
  label: string
  day?: number // 1–31, для совпадения с сегодняшним днём
  month?: number // 1–12
  kind?: 'memorial' | 'event'
  text: string
}

const FACTS: QueerFact[] = [
  {
    label: '28 июня 1969',
    day: 28,
    month: 6,
    kind: 'event',
    text: 'начало Стоунволлского восстания в Нью-Йорке — переломный момент движения за права ЛГБТК+.',
  },
  {
    label: '1919',
    kind: 'event',
    text: 'Магнус Хиршфельд основал в Берлине Институт сексологии — одну из первых научных институций, изучавших трансгендерность (разгромлен нацистами в 1933).',
  },
  {
    label: '17 мая 1990',
    day: 17,
    month: 5,
    kind: 'memorial',
    text: 'ВОЗ исключила гомосексуальность из списка психических расстройств — Международный день против гомофобии, трансфобии и бифобии.',
  },
  {
    label: '20 ноября',
    day: 20,
    month: 11,
    kind: 'memorial',
    text: 'Международный день памяти трансгендерных людей (Transgender Day of Remembrance).',
  },
  {
    label: '31 марта',
    day: 31,
    month: 3,
    kind: 'memorial',
    text: 'Международный день видимости трансгендерных людей (отмечается с 2009).',
  },
  {
    label: '11 октября',
    day: 11,
    month: 10,
    kind: 'memorial',
    text: 'Национальный день каминг-аута (отмечается с 1988).',
  },
  {
    label: '1 декабря',
    day: 1,
    month: 12,
    kind: 'memorial',
    text: 'Всемирный день борьбы со СПИДом — день памяти и солидарности для квир-сообщества.',
  },
  {
    label: '1978',
    kind: 'event',
    text: 'художник Гилберт Бейкер создал радужный флаг как символ ЛГБТК+ сообщества.',
  },
  {
    label: 'август 1966',
    month: 8,
    kind: 'event',
    text: 'восстание в кафетерии Комптона в Сан-Франциско — одно из первых выступлений трансгендерных людей против полицейского произвола, за три года до Стоунволла.',
  },
  {
    label: '1972',
    kind: 'event',
    text: 'Швеция стала первой страной, разрешившей юридическую смену гендерного маркера.',
  },
]

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1)
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((today - start) / 86_400_000)
}

/**
 * Факт дня: если на сегодняшний день/месяц есть памятная дата/событие —
 * показываем его (onThisDay=true), иначе ротируем по дню года.
 */
export function pickQueerFact(date: Date = new Date()): {
  fact: QueerFact
  onThisDay: boolean
} {
  const d = date.getDate()
  const m = date.getMonth() + 1
  const match = FACTS.find((f) => f.day === d && f.month === m)
  if (match) return { fact: match, onThisDay: true }
  return { fact: FACTS[dayOfYear(date) % FACTS.length], onThisDay: false }
}
