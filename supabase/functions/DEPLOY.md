# Deploying Edge Functions by hand through the Dashboard (stage 1b step 2)

We don't have the Supabase CLI, so everything goes through the browser. Order matters:
secrets and functions before the cron jobs, otherwise cron will be poking at nothing.

## 0. Generate CRON_SECRET

A single random secret known only to the Edge Functions (env) and
pg_cron (Vault). In PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Save the output in a temporary notepad — you'll need it twice (step 2 and step 4).
It should NOT go into git or `.env.local` — Next.js doesn't use this secret.

## 1. Apply the notified_at migration

Dashboard → **SQL Editor** → New query → paste the whole of
`supabase/migrations/20260612120000_etap1b_notified_at.sql` → Run.

Check: Table Editor → `intake_events` → the `notified_at` column has appeared.

## 2. Edge Functions secrets

Dashboard → **Edge Functions** → **Secrets** → add four:

| Name | Value |
|---|---|
| `CRON_SECRET` | the secret from step 0 |
| `VAPID_PUBLIC_KEY` | the same value as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.local` |
| `VAPID_PRIVATE_KEY` | the private key of the same VAPID pair (from `.env.local`) |
| `VAPID_SUBJECT` | `mailto:<contact email>` — sent to the push services (Google/Mozilla/Apple) as the key owner's contact; users don't see it |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` don't need to be added —
Supabase injects them into the functions automatically.

## 3. Deploy both functions

Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**:

1. Name: `send-reminders` (exactly that — the name becomes part of the URL).
   Paste the contents of `supabase/functions/send-reminders/index.ts` → Deploy.
2. The same for `generate-upcoming` from
   `supabase/functions/generate-upcoming/index.ts`.

**Required for both:** open the function → Details → turn off
**Verify JWT** (Enforce JWT verification). Instead of JWT, access is guarded by
the `x-cron-secret` header — without it the function returns 403.

## 4. Enable the extensions and cron jobs

1. Dashboard → **Database** → **Extensions** → enable `pg_cron` and `pg_net`
   (if they're already enabled, skip this; the SQL below can no-op too).
2. SQL Editor → paste `supabase/migrations/20260612130000_etap1b_cron_jobs.sql`
   → **right in the editor** replace `__PROJECT_REF__` (the project ref from the
   dashboard URL) and `__CRON_SECRET__` (from step 0) → Run.

   We replace the placeholders in the SQL Editor, not in the file, so that the
   secret doesn't end up in git.

## 5. Check that everything is alive

**The functions respond** (PowerShell; substitute the ref and the secret):

```powershell
curl.exe -X POST "https://__PROJECT_REF__.supabase.co/functions/v1/generate-upcoming" -H "x-cron-secret: __CRON_SECRET__"
# expect JSON like {"medications":N,"slotsComputed":M,"inserted":K,"skippedInvalid":0}

curl.exe -X POST "https://__PROJECT_REF__.supabase.co/functions/v1/send-reminders" -H "x-cron-secret: __CRON_SECRET__"
# expect {"events":0,"sent":0} if there are no slots in the next 5 minutes

# without the secret it must be 403:
curl.exe -X POST "https://__PROJECT_REF__.supabase.co/functions/v1/send-reminders"
```

**Cron is running** (SQL Editor, 5–10 minutes after step 4):

```sql
select jobname, schedule, active from cron.job;
select jobname, status, return_message, start_time
from cron.job_run_details d join cron.job j using (jobid)
order by start_time desc limit 10;
-- function responses (kept for ~6 hours):
select status_code, content, created from net._http_response
order by created desc limit 10;
```

**End-to-end push test** (the most important part):

1. On a phone/in a browser with pushes enabled, create a test medication
   with an intake ~10 minutes from the current time.
2. Open /tracker once (or poke generate-upcoming with curl)
   so that the slot appears in the DB.
3. **Close the app completely** and wait. Within 5 minutes before the slot
   time, a «напоминание ✦» ("reminder ✦") push should arrive.
4. After the push, check in Table Editor that the event's
   `notified_at` is filled in. Delete the test medication afterwards.

## If something is wrong

- Function logs: Dashboard → Edge Functions → the function → **Logs**.
- `403` in net._http_response → the secret in Vault doesn't match CRON_SECRET
  in the functions' env.
- `401` → you forgot to turn off Verify JWT (step 3).
- The push doesn't arrive, but `sent` > 0 → the problem is on the device side
  (permission; iOS requires an installed PWA), not the server.
