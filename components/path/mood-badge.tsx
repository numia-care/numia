import type { MoodLevel } from '@/lib/path/entries'
import { MOOD_COLOR, MOOD_MOUTH, MOOD_SHAPE } from '@/lib/path/mood'

// Бейдж настроения по эталонам Кая: цветной «цветок» с ротиком. Ступень
// кодируется и цветом (лаванда→лайм), и силуэтом (звезда → зубчатый цветок →
// круг → цветок → шестерёнка), и ртом (грусть → ровно → улыбка).
// У Кая это растровые рисунки; здесь — процедурный SVG с теми же параметрами
// (см. MOOD_SHAPE/MOOD_MOUTH в lib/path/mood.ts), масштабируется без потерь.

// Волнистый контур: r(θ) = R·(1 − depth + depth·cos(petals·θ)), 72 сэмпла.
function petalPath(petals: number, depth: number): string {
  const cx = 12
  const cy = 12
  const R = 11
  const steps = 72
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2
    const r = R * (1 - depth + depth * Math.cos(petals * theta))
    const x = cx + r * Math.sin(theta)
    const y = cy - r * Math.cos(theta)
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`
}

export function MoodBadge({
  level,
  size = 26,
  className,
}: {
  level: MoodLevel
  size?: number
  className?: string
}) {
  const { petals, depth } = MOOD_SHAPE[level]
  const mouth = MOOD_MOUTH[level]

  // Рот: квадратичная кривая по центру, кривизна по ступени.
  //
  // ВАЖНО про знак: y в SVG растёт ВНИЗ, поэтому улыбка — это контрольная
  // точка НИЖЕ концов рта. Раньше знак был перевёрнут (bend = -mouth·4.5), и
  // ступени читались наоборот: «прекрасно» с грустным ртом, «тяжело» с улыбкой.
  //
  // Квадратичная кривая доходит лишь до середины между концами и контрольной
  // точкой, поэтому для видимой глубины d контрольную уводим на ~1.5d.
  const mouthY = 13
  const bend = mouth * 4.5 // + улыбка, − грусть, 0 — ровная черта

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path d={petalPath(petals, depth)} fill={MOOD_COLOR[level]} />
      <path
        d={`M 8 ${mouthY - bend / 2} Q 12 ${mouthY + bend * 1.5} 16 ${mouthY - bend / 2}`}
        stroke="#1F1F1F"
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
