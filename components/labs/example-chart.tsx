// Декоративный «пример» графика для пустого экрана Анализов: растущая линия
// (эстрадиол по месяцам), чтобы объяснить ценность — «увидишь динамику».
// Не данные, а иллюстрация: приглушённая, с подписью «пример». Чистый SVG,
// без интерактива — рендерится и в серверном компоненте.

const W = 320
const H = 150
const PAD = { left: 8, right: 8, top: 14, bottom: 22 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

// Условные точки «месяц за месяцем» — плавный рост.
const POINTS = [0.18, 0.34, 0.3, 0.52, 0.68, 0.82]
const MONTHS = ['май', 'июн', 'июл', 'авг', 'сен', 'окт']

export function ExampleChart() {
  const coords = POINTS.map((p, i) => {
    const x = PAD.left + (i / (POINTS.length - 1)) * PLOT_W
    const y = PAD.top + (1 - p) * PLOT_H
    return { x, y }
  })
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const area = `${PAD.left},${PAD.top + PLOT_H} ${line} ${PAD.left + PLOT_W},${PAD.top + PLOT_H}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Пример графика динамики"
    >
      {/* Мягкая заливка под линией */}
      <polygon points={area} fill="var(--chart-1)" opacity={0.12} />

      {/* Тонкая базовая сетка */}
      {[0.25, 0.5, 0.75].map((f) => {
        const y = PAD.top + (1 - f) * PLOT_H
        return (
          <line
            key={f}
            x1={PAD.left}
            y1={y}
            x2={PAD.left + PLOT_W}
            y2={y}
            stroke="var(--border)"
            strokeWidth={1}
          />
        )
      })}

      {/* Линия динамики */}
      <polyline
        points={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Точки */}
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="var(--chart-1)" stroke="var(--background)" strokeWidth={1.5} />
      ))}

      {/* Подписи месяцев */}
      {coords.map((c, i) => (
        <text
          key={i}
          x={c.x}
          y={H - 6}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted-foreground)"
        >
          {MONTHS[i]}
        </text>
      ))}
    </svg>
  )
}
