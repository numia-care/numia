# Security Policy

Numia holds data that can put people at risk: HRT schedules, lab results,
diary entries, progress photos. We take reports seriously and we would much
rather hear from you than not.

## Reporting a vulnerability

Please report privately through GitHub, not in a public issue:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe what you found.

This opens a private advisory visible only to you and the maintainers. You
need a GitHub account, but nothing else — no special access.

Helpful things to include, as much as you have:

- what the problem is and roughly how severe you think it is
- steps to reproduce it, or a proof of concept
- the affected area — a URL, a file, an API endpoint, a database policy
- anything you already know about who could exploit it and what they'd get

Partial reports are welcome. A vague "something looks wrong around the PIN
screen" is still worth sending.

## What we ask

**Please don't make it public until it's fixed.** Not to keep it quiet, but
because disclosure before a fix exposes the people using the app, and this
audience can be harmed in ways that go well beyond a leaked account.

While you're investigating, please stay off other people's data: use your own
account, don't run bulk or automated scans against our hosted instance, and
don't modify or delete anything that isn't yours. If you need a realistic
environment, run Numia locally — see the README.

## What you can expect from us

We'll acknowledge your report within a reasonable time and tell you whether
we can reproduce it. After that we'll keep you posted on the fix, and we'll
let you know when it ships.

Numia is maintained by a very small team, so we can't promise a fixed
timetable. We can promise you won't be ignored.

We'll credit you in the advisory if you'd like, or keep you anonymous —
your call. We don't run a paid bug bounty.

## What is in scope

This repository: the web app, the BFF API under `/api/v1`, the Supabase
migrations and Row Level Security policies, the edge functions, and the
cryptography in `lib/crypto`.

Especially interesting to us:

- anything that lets one person read or modify another person's data
- anything that weakens the end-to-end encryption, or that sends plaintext
  or key material to the server
- anything that reveals the existence of an account, or links an account to
  a real identity
- anything in a push notification that discloses more than a neutral reminder

Out of scope: vulnerabilities in third-party infrastructure itself (report
those to Supabase, Vercel or GitHub), and reports produced solely by an
automated scanner with no demonstrated impact.

## A note on our threat model

Our security assumptions, what is encrypted end-to-end and what is not, and
why, are written down in `CLAUDE.md` under "Security" and on the `/safety`
page of the app. Some things are deliberate trade-offs rather than
oversights — the HRT tracker is stored under Row Level Security without
end-to-end encryption, for instance, because reminders and statistics need
the server to read it.

If you think one of those trade-offs is wrong, that's a conversation worth
having, and a regular issue is the right place for it. If you've found
something that breaks an assumption we actually made, that's a vulnerability
— please use the private report.
