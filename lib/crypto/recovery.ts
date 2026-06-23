// Recovery-фраза: 12 слов, единственный способ вернуть E2E-данные при забытом
// PIN. Деривация ключа из неё — в envelope.ts (deriveKek), здесь только
// генерация/нормализация/валидация самой фразы.
//
// Почему @scure/bip39, а не свой словарь: хэндроллить 2048-словный список и
// checksum — напрашиваться на ошибки (омонимы, неуникальные префиксы, кривой
// чек-байт). @scure/bip39 — аудированная zero-dep либа (paulmillr/scure).
// Бонус BIP39-checksum: при вводе фразы с опечаткой validate отловит её ДО
// того как мы скажем «не та фраза» — лучше UX, меньше «почему не работает».
//
// Энтропия: 128 бит (12 слов из 2048-словного списка = 12 × 11 бит). Этого
// достаточно, чтобы фраза была невзламываема перебором даже при утечке
// серверной копии wrapped_recovery (в отличие от 6-значного PIN).
//
// Словарь: английский BIP39 (стандартный, вычитанный, короткие слова с
// уникальными 4-буквенными префиксами). Если решим перейти на русский —
// generateMnemonic/validateMnemonic принимают кастомный wordlist-массив,
// меняется только импорт ниже (нужен вычитанный список ровно на 2048 слов).

import { generateMnemonic, validateMnemonic } from '@scure/bip39'
// Путь с .js — так прописан ключ в exports-карте @scure/bip39, а
// moduleResolution:bundler требует точного совпадения.
import { wordlist } from '@scure/bip39/wordlists/english.js'

const STRENGTH_BITS = 128 // → 12 слов

// Новая случайная фраза. Показывается юзеру ОДИН раз при установке PIN.
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, STRENGTH_BITS)
}

// Приводим ввод к канону перед валидацией/деривацией: trim, нижний регистр,
// схлопываем повторные пробелы/переводы строк (юзер мог копипастнуть с
// переносами). ВАЖНО: ровно эта же нормализация должна применяться и при
// деривации KEK, иначе тот же набор слов даст другой ключ.
export function normalizeRecoveryPhrase(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

// true, если фраза — валидная BIP39 (слова из словаря + сходится checksum).
export function isValidRecoveryPhrase(input: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(input), wordlist)
}
