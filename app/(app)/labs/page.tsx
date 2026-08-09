import { getTranslations } from 'next-intl/server'

// ВРЕМЕННО: раздел закрыт на техработы.
//
// Схема анализов переехала на сдачи (lab_sessions) — дата, заметка и снимок
// бланка больше не лежат в lab_results. Код этой ветки про сдачи не знает и
// падал на запросе к снесённым колонкам.
//
// Здесь СОЗНАТЕЛЬНО нет ни одного обращения к БД: страница не может упасть
// из-за схемы, потому что ничего не спрашивает. Данные целы и лежат в
// lab_sessions — читать их умеет ветка hotfix/lab-sessions, она и вернёт
// раздел. Снять заглушку = откатить один коммит.
export default async function LabsPage() {
  const t = await getTranslations('labs')

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          {t('title')}
        </h1>
      </header>

      <div className="rounded-2xl bg-card px-6 py-8 text-center ring-1 ring-border">
        <RepairCat />

        <h2 className="mt-6 font-heading text-2xl text-foreground">
          {t('maintenanceTitle')}
        </h2>
        <p className="mx-auto mt-2 max-w-md leading-relaxed text-foreground/80">
          {t('maintenanceText')}
        </p>
      </div>
    </div>
  )
}

// ── Котька с гаечным ключом ──────────────────────────────────────────────────
//
// Четыре кадра ASCII-арта, наложены друг на друга и по очереди проявляются —
// получается зацикленная «гифка» без единого килобайта картинки и без JS.
//
// Почему CSS, а не useState + setInterval: страница остаётся серверным
// компонентом, ничего не гидрируется, анимация крутится даже до того, как
// доедет JS. Плюс её умеет выключить сама система — см. prefers-reduced-motion
// ниже: тем, кто просил меньше движения, показываем один статичный кадр.
//
// Отрицательные animation-delay нужны, чтобы все четыре анимации уже шли с
// момента загрузки: положительная задержка сначала показала бы все кадры
// разом. Каждый кадр видим четверть цикла — 0.45 с из 1.8 с.
function RepairCat() {
  return (
    <div
      role="img"
      aria-label="Котька чинит раздел гаечным ключом"
      className="relative mx-auto h-[6.5rem] w-fit select-none"
    >
      <style>{`
        .numia-cat-frame {
          opacity: 0;
          animation: numia-cat 1.8s steps(1, end) infinite;
        }
        .numia-cat-frame:nth-child(1) { animation-delay: 0s; }
        .numia-cat-frame:nth-child(2) { animation-delay: -1.35s; }
        .numia-cat-frame:nth-child(3) { animation-delay: -0.9s; }
        .numia-cat-frame:nth-child(4) { animation-delay: -0.45s; }
        @keyframes numia-cat {
          0%, 24.99% { opacity: 1; }
          25%, 100%  { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .numia-cat-frame { animation: none; opacity: 0; }
          .numia-cat-frame:nth-child(1) { opacity: 1; }
        }
      `}</style>

      {CAT_FRAMES.map((frame, i) => (
        <pre
          key={i}
          aria-hidden
          className="numia-cat-frame absolute left-0 top-0 whitespace-pre text-left font-mono text-[0.7rem] leading-[1.35] text-moss sm:text-xs"
        >
          {frame}
        </pre>
      ))}
    </div>
  )
}

// Ключ опускается на гайку [#] и отскакивает. Глаза моргают на третьем кадре,
// на последних двух — искорка от закрученной гайки.
//
// Все кадры одной высоты (5 строк) и ширины, иначе блок дёргался бы при смене.
// Обратные слэши удвоены: это шаблонные строки, одиночный `\` съедается.
const CAT_FRAMES = [
  `   /\\_/\\      __
  ( o.o )    (__)
   > ^ <      ||
  /|   |\\     ||
 (_|___|_)   [#]`,

  `   /\\_/\\
  ( o.o )     __
   > ^ <     (__)
  /|   |\\    //
 (_|___|_)  [#]`,

  `   /\\_/\\
  ( -.- )
   > ^ <   __
  /|   |\\ (__)==
 (_|___|_)  [#]  .`,

  `   /\\_/\\
  ( o.o )     __
   > ^ <     (__)
  /|   |\\    \\\\
 (_|___|_)  [#]  *`,
]
