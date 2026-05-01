# CLAUDE.md

This file is read automatically by Claude Code at the start of every session. It holds the working context for development. Product context is in `nurra-context.md`.

---

## What the project is

**Numia** is a PWA companion for trans people on HRT. HRT tracker, mood diary, labs, progress photos/voice.

Product details, audience, motivation, monetization: see `nurra-context.md`. Read it the first time you start a session.

---

## Stack (fixed, we don't change it without discussion)

- **Next.js 16** (App Router) + **React 19**
- **TypeScript** (strict mode)
- **Tailwind CSS 4** — config via `@theme` in `app/globals.css`, **not** via `tailwind.config.ts` (v4 has no such file by default)
- **pnpm** (package manager) — saves disk space through symlinks; all commands go through `pnpm`, not `npm`
- **Supabase** (Postgres + Auth + Storage), region **EU (Frankfurt or Ireland)**
- **PWA** (next-pwa or manual manifest + service worker setup)
- **Vercel** (frontend deploy)
- **GitHub** (private repo)

**Cryptography for E2E fields:**
- **Web Crypto API** (built into the browser, no libraries needed)
- AES-GCM to encrypt content, PBKDF2 to derive the key from a password/PIN

---

## A one-person team

I (Isabel) am a data analyst. Strong in Python, SQL, PySpark. Frontend and TypeScript are not native ground for me — write code clearly, and explain non-obvious React/Next.js patterns when they come up.

**I DON'T want:**
- complex architecture at the start (microservices, monorepo, etc.)
- excess abstraction before it is really needed
- state managers like Redux/Zustand if React state and Supabase are enough
- custom UI components from scratch if ready-made ones exist

**I DO want:**
- simple, clear code that I can read a month later and understand
- comments in Russian in the tricky places
- small commits with clear messages
- explanations of "why this way", not just "what to do"

---

## How to work with me

1. **Don't do more than I asked.** If I ask you to add a button, add a button; don't rewrite the whole component. If you want to suggest an improvement, say it in words first and let me decide.

2. **Ask if something is unclear.** One clarifying question is better than three rounds of edits. Especially about product decisions.

3. **Use Supabase to the full.** RLS for security, Auth for login, Storage for files. Don't write your own backend if Supabase can solve it.

4. **Security from day one.** See the separate section below. This is not optional, it is an architectural requirement.

5. **When something is done, show how to check it.** Not "done" but "run `pnpm dev`, open /tracker, X should appear".

6. **Before non-trivial code for Next.js 16, read `node_modules/next/dist/docs/`.** Next.js 16 has breaking changes relative to the models' training data (routing, server actions, configuration). Don't rely on memory — check against the local docs (which Next.js itself asks you to read via `AGENTS.md` when scaffolding). The same goes for **React 19** (new hooks, Actions API) and **Tailwind 4** (CSS config instead of JS).

---

## Security — critical for this project

### Threat model
The product is for a vulnerable group. Who we protect user data from:
- States with transphobic policies (Russia and others) — HRT data can be used in legal proceedings
- Family / partners with physical access to the phone
- Employers, immigration services
- Hackers, database leaks
- **The development team itself.** The architecture must be such that users' personal entries can't be read even by Isabel with admin access to the DB.

### Mandatory rules (in force since stage 0)

**1. Hosting in the EU.**
We create the Supabase project in the Frankfurt or Ireland region. This gives GDPR protection and independence from requests by Russian authorities.

**2. Row Level Security (RLS) on EVERY table with user data.**
No exceptions. Policies check `auth.uid() = user_id`. No "we'll do it later" — RLS is enabled at the same time the table is created. Claude Code generates RLS policies automatically when creating each table.

**3. Data minimization.**
- We collect nothing that a feature doesn't need
- No Google Analytics / Yandex.Metrika / Facebook Pixel on pages with personal data. If analytics is needed — only Plausible or Umami (privacy-respecting), and only on the landing page, not in the app.
- We don't log IP addresses in the DB
- We don't require a real name — only a pseudonym

**4. Auth.**
- Magic link via email (no passwords by default)
- We support disposable email services (SimpleLogin, AnonAddy) — we don't block by domain
- Optional (a later stage): passkey / WebAuthn

**5. PIN code / biometrics to enter the app.**
Even if the user is signed in, opening the app goes through a second layer:
- a 4-digit PIN or
- Face ID / Touch ID via the Web Authentication API
This protects against the "phone ended up in someone else's hands for 30 seconds" situation.

**6. Neutral pushes and notifications.**
The push text never contains specifics. Not «пора принять эстрадиол» ("time to take estradiol") but «напоминание ✦» ("reminder ✦") or «пора» ("it's time"). Details only after the app is opened and the user has authenticated.

**7. No external trackers and no fonts from third-party CDNs on pages with personal data.**
Fonts are self-hosted via next/font. No Google Fonts from a CDN.

### Encryption levels

**Standard (TLS + Supabase encryption at rest):**
- HRT tracker (medication intakes, schedule)
- Labs (values, charts)
- Metadata (dates, entry types)

Rationale: the app needs this data in the clear to build charts, compute patterns and send reminders. We protect it with RLS and Supabase's standard encryption. That's an acceptable level for this data.

**Client-side encryption (E2E, only the user has the key):**
- Mood / dysphoria diary texts
- Progress photos (uploaded to Storage already encrypted)
- Voice recordings (uploaded to Storage already encrypted)

Rationale: this is the most personal material. We encrypt it on the user's device with a key derived from their password or PIN via PBKDF2. What reaches the database is an already encrypted blob. Neither Supabase nor the development team can decrypt it without the user's key.

**E2E implementation (via the Web Crypto API):**
- The key is derived from the user's password/PIN via PBKDF2 (≥210000 iterations, SHA-256)
- AES-GCM encryption with a unique IV per entry
- The PBKDF2 salt is stored in the user's profile (not a secret)
- On sign-in, the key is derived and kept in session memory (not in localStorage!)
- When the tab is closed, the key is forgotten; on return, the PIN is needed

**Important:** if the user forgets their password/PIN, the encrypted data cannot be recovered. This is by design. The sign-up page says so honestly.

### Transparency

We make a separate `/safety` or `/security` page:
- In plain words, what is protected and how
- What data is stored where
- What we DON'T collect
- Whom to trust (an open source repo if we decide to publish it)

This isn't marketing — it's part of the product. Users in this audience read this kind of thing carefully.

---

## PWA — it must feel like a native app

From day one — no "this is a website in a browser". The user must not see any difference.

**Mandatory:**
- **Manifest.json** set up correctly: `display: "standalone"`, icons in all sizes (192, 512, maskable), theme_color, background_color
- **Service Worker** for offline use (next-pwa or by hand)
- **Splash screen** on launch (for iOS via apple-touch-startup-image, for Android via the manifest)
- **App icon** that is beautiful, in the aesthetic (pastel forest ✦), all sizes including maskable for Android
- **Apple-specific meta** for iOS: apple-mobile-web-app-capable, apple-mobile-web-app-status-bar-style, apple-touch-icon
- **Native feel:**
  - tap-highlight removed
  - overscroll-behavior controlled
  - transitions between screens with animation (as in native apps)
  - haptic feedback where appropriate (via the Vibration API)
- **Push notifications** via the Web Push API (work on iOS 16.4+ and all Android)

**«Как установить» ("How to install") page:**
- A separate `/install` screen with screenshots for iOS and Android
- Step-by-step instructions: «Поделиться → На экран Домой» ("Share → Add to Home Screen") for iOS, «Установить приложение» ("Install app") for Android
- Can be built into onboarding after the first visit

---

## Design system

**Aesthetic:** pastel forest + fairy magic ✦

**Color palette:**
- Cream (background): `#FAF6F0`
- Sage: `#9CAF88`
- Moss: `#5A6B4A`
- Lavender: `#B8A5C4`
- Fairy (light purple accent): `#C9B6E4`
- Primary text: `#3A3A3A`
- Secondary text: `#7A7A7A`

**Fonts (via next/font, self-hosted):**
- Cormorant Garamond — headings (serif)
- DM Sans — body (sans-serif)

**Tone:** warm, caring, no pressure, gender-neutral in wording.

**UI principles:**
- Rounded corners (rounded-xl / rounded-2xl)
- Soft shadows, not hard borders
- Smooth animations, not jerky ones
- Nothing "medical" — no white coats, no clinical sterility
- Light theme as default; dark — a later stage

---

## Project structure

```
/app
  /(auth)
    /login              - sign-in pages (magic link)
    /pin                - PIN setup/entry
  /(app)                - protected pages (need auth + PIN)
    /tracker            - HRT tracker
    /diary              - mood diary
    /labs               - labs
    /progress           - progress photos/voice
    /wiki               - wiki
    /settings           - settings, security
  /install              - how to install the PWA
  /safety               - page about data security
  layout.tsx
/components
  /ui                   - reusable UI components
  /tracker              - tracker components
  /diary                - diary components
/lib
  /supabase             - client and helpers
  /crypto               - E2E encryption (Web Crypto API)
  /utils                - utilities
/types                  - TypeScript types
/public
  manifest.json         - PWA manifest
  /icons                - PWA icons (all sizes)
  /splash               - splash screens for iOS
```

---

## Roadmap by stage

### Stage 0 — skeleton and basic security (1 week)
- Next.js project with TypeScript + Tailwind
- Supabase in an EU region, project created
- Auth via magic link
- Basic PWA layout, manifest, service worker
- Icons in all sizes
- PIN code / biometrics to enter
- E2E encryption skeleton in `/lib/crypto` (ready to use)

### Stage 1 — HRT tracker + reminders (2-3 weeks) ⭐
- Creating a medication (name, type, dosage, schedule)
- Intake check-off
- Local notifications / Web Push
- Intake history
- A simple regularity chart
- RLS policies on all tables

### Stage 2 — mood diary (1-2 weeks)
- Mood entry (scale + tags + text)
- **The text is E2E-encrypted**
- Entry feed
- A simple trend

### Stage 3 — labs (2-3 weeks)
- Uploading lab photos/PDFs to Storage
- Manual entry of values (estradiol, testosterone, prolactin, etc.)
- Charts over time
- Reference values (from the wiki)

### Stage 4 — progress photos and voice (3-4 weeks)
- **Client-side encryption before upload to Storage**
- Photo upload
- Voice recording in the browser
- Comparison over time

### Stage 5 — wiki (background work at any stage)
- Content base (medications, effects, reference values)
- Can be done as plain MDX pages

### Stage 6 — after MVP (in 3-6 months)
- Private beta test with the customer interview (custdev) participants
- Feedback collection → iterations
- **Publishing in the stores:**
  - Google Play via TWA (Trusted Web Activity) — 1-2 days of work, $25 one-off
  - App Store via Capacitor — 1-2 weeks of work, $99/year
- Linking to the personal blog (once the product is stable)
- Applying for grants from LGBT foundations

**We do the stores ONLY after a stable MVP with real users.** Not now. PWA-first approach.

---

## What we are NOT doing now

- Stripe / payments — later, the product is free
- AI features — that's v2, not MVP
- Social features (meetups, chats, following others) — v3
- English version — after the Russian one stabilizes
- Native apps for the App Store / Google Play — after MVP, via TWA/Capacitor
- Dark mode — later
- Complex intake analytics — after the basic tracker

---

## Commands

```bash
pnpm dev             # start the dev server
pnpm build           # production build
pnpm lint            # run the linter (eslint flat config)
pnpm typecheck       # check TypeScript (tsc --noEmit)
```

(update this section when you add your own scripts)

---

## Notes

- When working with dates, take the user's timezone into account (important for HRT reminders). Use `Intl.DateTimeFormat` and `date-fns-tz` if needed.
- All UI texts are in Russian at the start, but structured with i18n in mind (e.g. texts in separate files rather than hardcoded). When we get to English — `next-intl`.
- HRT medication names are neutral, not tied to gender transition as a term. For example «эстрадиол валерат» ("estradiol valerate"), not «женский гормон» ("female hormone"). Icons are neutral too.
- In copy, never use «транс» ("trans") as a noun — only «транс-персона» ("trans person"), «транс-люди» ("trans people"), «транс-комьюнити» ("trans community").
- No emoji that read as medical (💊 ok, 🏥 no).
