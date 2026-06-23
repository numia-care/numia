'use client'

import { useState } from 'react'

// Экран «Ключ восстановления» — показывается ОДИН раз при создании PIN
// (и при ленивом бэкфилле старого PIN). Задача: дать сохранить 12 слов без
// ручного переписывания и без крипто-жаргона. Тон тёплый, не пугающий.
//
// Опциональность намеренная: не блокируем намертво. Юзер может «Напомнить
// позже» — но с явным предупреждением. Свой выбор уровня риска (см. твои
// требования к фиче «Путь»).

interface Props {
  phrase: string
  // Юзер подтвердил, что сохранил ключ → ack=true, идём дальше.
  onDone: () => void
  // «Напомнить позже» → ack остаётся false, баннер-напоминание покажем потом.
  onRemindLater: () => void
}

export function RecoveryKeyCard({ phrase, onDone, onRemindLater }: Props) {
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  const words = phrase.split(' ')

  async function copy() {
    try {
      await navigator.clipboard.writeText(phrase)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard может быть недоступен (нет https / отказ в правах) — тогда
      // юзер всё равно видит слова на экране и может переписать/скачать.
    }
  }

  function download() {
    // Файл формируется и скачивается целиком на клиенте — ключ никуда не
    // отправляется. Нейтральное имя, без слова «recovery» в открытом виде.
    const blob = new Blob(
      [
        'Numia ✦ ключ восстановления\n\n',
        phrase,
        '\n\nХрани это в надёжном месте. Этим ключом восстанавливаются ',
        'зашифрованные данные, если забудешь PIN. Никому не показывай.\n',
      ],
      { type: 'text/plain;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'numia-kluch.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function mailToSelf() {
    // mailto открывает почтовый клиент юзера локально — наш сервер ключ не
    // видит. Опция на усмотрение юзера (почта обычно в облаке, чуть слабее).
    const subject = encodeURIComponent('Numia ✦')
    const body = encodeURIComponent(
      `Ключ восстановления Numia:\n\n${phrase}\n\nХрани надёжно, никому не показывай.`,
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <>
      <h1 className="mb-1 text-2xl font-medium text-[#3A3A3A]">
        Ключ восстановления ✦
      </h1>
      <p className="mb-5 text-sm leading-relaxed text-[#7A7A7A]">
        Если потеряешь телефон или забудешь PIN — этот ключ вернёт твои фото и
        записи. Сохрани его надёжно: в заметках, менеджере паролей. Мы не сможем
        восстановить его за тебя — так твои данные защищены даже от нас ✦
      </p>

      {/* 12 слов, пронумерованы — читаемо и для переписывания, и для проверки */}
      <ol className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-[#FAF6F0] p-4 ring-1 ring-black/[0.04]">
        {words.map((w, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm">
            <span className="w-5 shrink-0 text-right text-xs text-[#B8A5C4]">
              {i + 1}
            </span>
            <span className="font-mono text-[#3A3A3A]">{w}</span>
          </li>
        ))}
      </ol>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-[#9CAF88]/20 px-3 py-2 text-sm text-[#5A6B4A] transition-colors hover:bg-[#9CAF88]/30"
        >
          {copied ? 'Скопировано ✓' : 'Скопировать'}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-lg bg-[#9CAF88]/20 px-3 py-2 text-sm text-[#5A6B4A] transition-colors hover:bg-[#9CAF88]/30"
        >
          Скачать файлом
        </button>
        <button
          type="button"
          onClick={mailToSelf}
          className="rounded-lg bg-[#9CAF88]/20 px-3 py-2 text-sm text-[#5A6B4A] transition-colors hover:bg-[#9CAF88]/30"
        >
          Отправить себе
        </button>
      </div>

      <label className="mb-4 flex cursor-pointer items-start gap-3 text-sm text-[#3A3A3A]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#5A6B4A]"
        />
        <span>Я сохранила ключ в надёжном месте</span>
      </label>

      <button
        type="button"
        disabled={!confirmed}
        onClick={onDone}
        className="w-full rounded-xl bg-[#5A6B4A] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#4A5A3A] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#C9B6E4]/60"
      >
        Готово
      </button>

      <button
        type="button"
        onClick={onRemindLater}
        className="mt-3 block w-full text-center text-sm text-[#7A7A7A] underline-offset-4 hover:text-[#5A6B4A] hover:underline"
      >
        Напомнить позже
      </button>
      <p className="mt-2 text-center text-xs text-[#7A7A7A]">
        Без сохранённого ключа забытый PIN означает потерю зашифрованных записей.
      </p>
    </>
  )
}
