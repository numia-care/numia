// Микро-вспышка ✦ при отметке приёма «Принято».
//
// По фидбеку бета-людей: «приём — это событие, вспышка, мерцание». Из точки
// тапа разлетаются несколько маленьких ✦ (розово-лавандовая пастель), мерцают и
// растворяются ~600мс.
//
// Почему императивный DOM, а не React-компонент: эффект «выстрелил и забыл».
// После отметки идёт router.refresh() — карточка перерисовывается (upcoming →
// taken), и React-оверлей внутри неё размонтировался бы на полпути. Узлы в
// body, живущие своей CSS-анимацией и сами себя удаляющие, от этой перерисовки
// не зависят и не добавляют ре-рендеров (важно для слабых телефонов).

const SPARK_COLORS = ['#E79EC6', '#C9B6E4', '#B8A5C4'] // розово-лавандовая пастель

/**
 * Пустить вспышку ✦ из точки (x, y) в координатах вьюпорта (position: fixed).
 * generous — чуть щедрее (последний приём дня). Уважает prefers-reduced-motion:
 * при «меньше движения» ничего не рисуем.
 */
export function playIntakeSparks(x: number, y: number, generous = false): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const count = generous ? 9 : 6
  const container = document.createElement('div')
  container.className = 'intake-sparks'
  container.style.left = `${x}px`
  container.style.top = `${y}px`

  for (let i = 0; i < count; i++) {
    const spark = document.createElement('span')
    spark.className = 'intake-spark'
    spark.textContent = '✦'

    // Разлёт по кругу: равномерный угол + лёгкий джиттер, случайная дистанция.
    // Передаём смещение/поворот в CSS через переменные — сама анимация в globals.
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
    const dist = (generous ? 46 : 34) + Math.random() * 18
    spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`)
    spark.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 40}deg`)
    spark.style.color = SPARK_COLORS[i % SPARK_COLORS.length]
    spark.style.fontSize = `${(generous ? 13 : 11) + Math.random() * 6}px`
    spark.style.animationDelay = `${Math.random() * 60}ms`
    container.appendChild(spark)
  }

  document.body.appendChild(container)
  // Убрать узел после завершения анимации (макс длительность + запас).
  window.setTimeout(() => container.remove(), 800)
}
