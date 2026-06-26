import Link from 'next/link'

import { VoiceSmokeTest } from '@/components/path/voice-smoke-test'

// ВРЕМЕННАЯ страница: изолированный смоук-тест записи голоса в iOS PWA.
// Удалить после подтверждения, что запись и воспроизведение работают в
// установленной PWA на iOS. До этого момента шифрование/аплоад/ленту не трогаем.
export default function VoiceTestPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/path"
          className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← к Пути
        </Link>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">
          Тест записи
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Запиши пару секунд и проиграй обратно. Если звук слышен — связка
          MediaRecorder в этой PWA рабочая.
        </p>
      </header>

      <VoiceSmokeTest />
    </div>
  )
}
