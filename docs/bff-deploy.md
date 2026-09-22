# BFF: build and run

How to bring up Numia (web + BFF) in Docker on any machine. API contract:
[api-v1.md](./api-v1.md).

---

## What this image is

The BFF lives **inside the existing Next.js application**, not as a separate service.
The `/api/v1/*` routes are ordinary route handlers that call the same functions from
`lib/` as the web.

This is the key decision, and here is why. The point of the BFF is that the domain logic
(expanding schedules with timezones, statistics, reference data — about 3700 lines)
exists **in a single copy**. A separate service would have to be fed this logic
all over again, and it would drift apart from the web at the very first change. A shared repository
and a shared `lib/` are exactly what the BFF was started for.

A side benefit: the container brings up the web too, so you immediately get
a complete test environment, not just the API.

Vercel pays no attention to any of this: it ignores `output: 'standalone'`, and the web deploy
doesn't change.

---

## What you need on the machine

Docker and the Supabase CLI. Node and pnpm are not needed: they live inside the image.

```bash
brew install supabase/tap/supabase
```

---

## Option A: local Supabase (recommended for development)

The whole stack runs on the machine: Postgres, Auth, PostgREST, Storage, a web UI
and a stub mailbox. No cloud project is needed.

Why this is better: emails with the sign-in code land in the local mailbox, no real
email is required. And most importantly, not a single real record passes through
the server. HRT tracker and Labs data are **not** E2E-encrypted, the server sees them
in plain text, so they must not be run through a developer's machine.

**1. Bring up the stack.**

```bash
supabase start
```

The first run downloads images, which takes a while. Migrations from `supabase/migrations/`
are applied automatically. At the end the CLI prints the addresses and keys.

| What | Address |
|---|---|
| API | `http://127.0.0.1:54321` |
| Database web UI | `http://127.0.0.1:54323` |
| Mailbox (sign-in codes) | `http://127.0.0.1:54324` |

Forgot the values? `supabase status`. To start with a clean database: `supabase db reset`.

**2. Fill in `.env.docker`.**

```bash
cp .env.example .env.docker
```

The key comes from `supabase status`, the `PUBLISHABLE_KEY` field. The addresses, though,
need care: they are **different**:

```
# The browser runs on the host
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321

# The BFF runs inside the container, where 127.0.0.1 is the container itself
SUPABASE_URL=http://host.docker.internal:54321
```

This is the only non-obvious spot in the whole setup. Inside the container
`127.0.0.1` points to the container itself, not to the machine, so it can't reach the local
Supabase that way. `host.docker.internal` is the way to reach the
host.

---

## Option B: a cloud Supabase project

Everything is the same, but the values come from Supabase Dashboard → Project Settings → API,
and the address is the same in both pairs of variables.

---

## Running

```bash
docker compose --env-file .env.docker up --build
```

**The `--env-file` flag is required.** Docker Compose substitutes `${...}` in its
config only from shell variables or from a file named exactly `.env`.
The `env_file` directive doesn't do that: it passes variables into the container,
while `NEXT_PUBLIC_*` are needed earlier, at build time. Forget the flag and the build
will stop with a message saying which variable is missing.

Check:

```bash
curl -s localhost:3000/api/v1/health
```

Expected: `{"status":"ok","api":"v1","version":"local"}`.

Stop:

```bash
docker compose --env-file .env.docker down
```

---

## Variable pairs: why there are two

| Variable | When it is read | Who uses it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | at build time | The browser, baked into the bundle |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | at build time | Same |
| `SUPABASE_URL` | at runtime | `/api/v1` routes |
| `SUPABASE_PUBLISHABLE_KEY` | at runtime | Same |

Next bakes everything prefixed with `NEXT_PUBLIC_` into the browser bundle at build time, and
it can only be changed by rebuilding. Runtime variables change with a container
restart, which is why **one image switches between local Supabase and the
prod project** by editing `.env.docker`.

---

## Checking sign-in

Sign-in goes entirely through the BFF, just as in the app. On the local stack,
code emails land in the stub mailbox: `http://127.0.0.1:54324`.

**1. Request a code.**

```bash
curl -i -s -X POST localhost:3000/api/v1/auth/otp \
  -H "Content-Type: application/json" -d '{"email":"tester@example.com"}'
```

Expected: `204`. Open `http://127.0.0.1:54324`: there is an email «Код для входа» ("Sign-in code").

**2. Exchange the code for tokens.**

```bash
curl -s -X POST localhost:3000/api/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"tester@example.com","code":"123456"}'
```

Substitute the code from the email. The response has `access_token`, `refresh_token`,
`expires_in`, `token_type`. It's handy to save the token into a variable right away:

```bash
export ACCESS_TOKEN=…
```

**3. A request with the token.**

```bash
curl -s localhost:3000/api/v1/me -H "Authorization: Bearer $ACCESS_TOKEN"
```

If there is no email: the local template with the code is set in `supabase/config.toml`
(the `auth.email.template.*` sections) and lives in `supabase/templates/`. Without it,
local Supabase sends only a link. The cloud project's templates live in the
dashboard and are not synced from here.

Changing the timezone:

```bash
curl -s -X PATCH localhost:3000/api/v1/me \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timezone":"Europe/Madrid"}'
```

What you should get:

| Request | Response |
|---|---|
| `/auth/otp` with a new address | `204` |
| `/auth/otp` again within a minute | `429`, `Retry-After` — the code has already been sent |
| `/auth/verify` with a wrong code | `400 invalid_code` |
| `/auth/verify` failing for the sixth time in a row | `429` |
| `/auth/verify` with the correct code | `200`, four token fields |
| `/me` without a token or with a broken one | `401 unauthenticated` |
| `/me` with a token | `200`, this user's profile |
| `/auth/refresh` | `200`, a **new** `refresh_token` |
| `/auth/refresh` after `/auth/logout` | `401` — sign in again |
| `/auth/logout` with any token | `204` |
| `{"timezone":"Mars/Olympus"}` in `PATCH /me` | `400 invalid_input`, field `timezone` |
| Supabase stopped (`supabase stop`) | `503 service_unavailable` — **not** 401 |

The last row matters for the client: on `503` the session must not be reset; the token
is fine, the server just couldn't reach the database.

### Recovery anchor

A walkthrough that must succeed on a fresh user. The bodies are random bytes of
the right length: the server only checks the format and can't decrypt them.

```bash
# Fresh random bytes on every call: repeating THE SAME body doesn't change the anchor,
# the version doesn't grow, and the "409" below would turn into a "200".
# openssl rand -base64 wraps the line after 64 characters, hence base64 | tr.
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
body() { echo "{\"dek_wrapped_recovery\":\"$(b64 60)\",\"recovery_salt\":\"$(b64 16)\",\"recovery_kdf_iterations\":600000,\"expected_anchor_version\":$1}"; }
anchor() { curl -s -o /dev/null -w "%{http_code}\n" -X "$1" localhost:3000/api/v1/e2e/recovery \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" ${2:+-d "$2"}; }

anchor GET              # 404 — no anchor
anchor PUT "$(body 0)"  # 200 — created, anchor_version 1
anchor GET              # 200
anchor PUT "$(body 0)"  # 409 — an anchor already exists, nothing written
anchor PUT "$(body 1)"  # 200 — phrase change, anchor_version 2
anchor PUT "$(body 1)"  # 409 — the version is already 2
```

| Request | Response |
|---|---|
| `dek_wrapped_recovery` is not 60 bytes or `recovery_salt` is not 16 | `400 invalid_input`, the field in `field` |
| `recovery_kdf_iterations: 210000` | `400 invalid_input` — new anchors only at 600 000+ |
| Supabase stopped, `GET` | `503`, **not** `404` |

### Account deletion

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE localhost:3000/api/v1/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Expected: `204`. After that, the same token gets `401` on any request: the account,
data, files in Storage and the sessions of all devices are deleted. A repeated `DELETE`
also gets `401`.

### Automated tests on the local stack

The conditional anchor write, the race between two devices and account deletion are checked by
integration tests. They talk to a running `supabase start` and are skipped
by default:

```bash
NUMIA_INTEGRATION=1 pnpm test
```

---

## OpenAPI specification

The server serves it itself:

```bash
curl -s localhost:3000/api/v1/openapi.json
```

A copy lives in [openapi.json](./openapi.json) — it can be opened without a running
server and imported into any client: Hoppscotch, Postman, RapidAPI, Swagger
UI. For iOS, a Swift client is generated from it with `swift-openapi-generator`.

### Swagger UI

A page with the documentation and a "Try it out" button: http://localhost:3000/api/docs

Enabled by the `API_DOCS=true` variable in `.env.docker`, off by default:
without the flag the page returns `404`. It changes without a rebuild; a container
restart is enough:

```bash
docker compose --env-file .env.docker up -d
```

How to test authorized requests right from Swagger:

1. `POST /auth/otp` → Try it out → your email → Execute.
2. The code from the email is in the local mailbox at http://127.0.0.1:54324.
3. `POST /auth/verify` → email and code → copy `access_token` from the response.
4. The **Authorize** button at the top → paste the token → Authorize.
5. Now `GET /me` and `PATCH /me` are sent with the token.

The token lives only in the tab: the page doesn't save it; close the tab and it's gone.

Why the page is at the same address as the API: "Try it out" sends requests from
the browser, and the BFF doesn't send CORS headers. Swagger UI opened from a different
port or domain couldn't reach the API. The Swagger UI files live in the project
(the `swagger-ui-dist` package) instead of being loaded from a CDN, and the page has its own strict CSP:
a real token is entered in the Authorize field.

**Where it comes from.** Request and response fields come from the zod schemas in
`lib/api/schemas.ts`, the same ones the routes use to validate input. Paths, response
codes and authorization are described in `lib/api/openapi.ts`. `docs/openapi.json`
is not edited by hand.

**How to keep it from drifting away from the code.** The `lib/api/openapi.test.ts` test fails if:

- `docs/openapi.json` doesn't match what is built from the code;
- `app/api/v1` has a route that isn't in the specification, or vice versa.

Changed a schema or added an endpoint? Update the copy and commit it together with the code:

```bash
pnpm test -u
```

A new endpoint takes three steps: schemas in `lib/api/schemas.ts`, a route in
`app/api/v1`, the path description in `lib/api/openapi.ts`. Forget the third and the test
will remind you.

---

## Database migrations

Code and database ship separately: the site build does **not apply** migrations. A new
endpoint that needs a column or a function will respond with `500` until the migration
is applied.

Migrations live in `supabase/migrations/` and are applied in ascending name order.
Locally:

```bash
supabase migration up
```

Cloud projects are handled differently, and the methods must not be mixed up:

| Project | How migrations are applied |
|---|---|
| Prod | Manually, Dashboard → SQL Editor: the contents of the missing files in name order |
| Staging | Automatically on push to the `staging` branch, see the "Staging" section |

**Do not run `supabase db push` against prod.** Prod migrations have always been applied
through the SQL Editor, so its migration history table is empty. The CLI will decide
that nothing has been applied and will try to run all the files starting from the very first one,
on top of the tables that already exist. `db push` is only suitable for a project whose
history the CLI has tracked since the first migration: staging and the local stack.

Order during rollout: **migration first, then code**. The other way round, fresh code
works against the old database for a while and returns `500` on the new endpoints.
That's why migrations are written to be compatible with the old code: add a column with a
default value, add a function. That way the old site keeps working
between the two steps.

---

## Staging

A separate Supabase project and a separate Vercel project for checking changes before
prod. **Synthetic data only.**

| What | Address |
|---|---|
| Site | `https://numia.tr1ckyf0x.dev` (also `numia-staging.vercel.app`) |
| API | `https://numia.tr1ckyf0x.dev/api/v1` |
| Swagger | `https://numia.tr1ckyf0x.dev/api/docs` |

Deploys show up in GitHub as the **Staging** environment. Code emails arrive in
a real mailbox, but only for addresses that the project's email can reach
(see "One-time setup").

### How deployment works

A push to the `staging` branch triggers `.github/workflows/deploy-staging.yml`:

1. `typecheck`, `lint`, `test` — a broken branch doesn't touch the database;
2. `supabase db push` to the staging database — only the missing migrations;
3. `vercel build` and `vercel deploy --prod` to the staging Vercel project.

Vercel doesn't watch the repository: Actions deploys using a token. So the deploy doesn't
depend on who authored the commit. Isabel's Vercel project skips the `staging` branch
(`git.deploymentEnabled` in `vercel.json`).

The cron migration `20260612130000` is applied on staging with placeholders instead of
the functions' address and the secret. The reminder jobs hit a non-existent address;
this is harmless as long as no Edge Functions are deployed to staging.

### One-time setup

**Supabase** (project in the Central EU region, Frankfurt):

- Authentication → Sign In / Providers → turn off "Allow new users to sign up".
- Authentication → Users → Add user → Create new user, with the Auto Confirm checkbox:
  this is how each tester is added. An address that isn't in Users won't get
  an email, yet the BFF will still respond `204`.
- Authentication → Email Templates → Magic Link and Confirm signup: subject
  «Код для входа» ("Sign-in code"), body from `supabase/templates/`. Without this
  a link arrives, not a code.
- Supabase's built-in email sends only to the addresses of organization members, and
  only a few emails per hour. Other testers need their own SMTP.
- Connect → **Session pooler** → the connection string with the database password. This is the
  `STAGING_DB_URL` secret. A direct connection won't do: it is IPv6-only, and
  GitHub runners have no IPv6. Special characters of the password in the string must be percent-encoded.

**Vercel:**

- Create a project and link the repository to it locally: `vercel link`.
  `orgId` and `projectId` will appear in `.vercel/project.json`; they are not secret and
  go into the workflow's `env`.
- In the project, set the Production environment variables: `NEXT_PUBLIC_SUPABASE_URL`
  and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` of the staging project, `API_DOCS=true`.
- Account Settings → Tokens → a token with an expiration date. This is the
  `STAGING_VERCEL_TOKEN` secret.

**GitHub:** both secrets go into Settings → Secrets and variables → Actions.
In a repository on a personal account, only the owner can do this.

---

## Where to deploy

The simplest path is to **deploy nothing separately**. The BFF is the
`app/api/v1` routes inside the same Next.js application, so with the regular
site rollout to Vercel they appear on its domain: `<site>/api/v1/health`.
No separate variables are needed: if `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
are not set, the code takes the values from the `NEXT_PUBLIC_*` pair the site already has.
Swagger is off in that case: `API_DOCS` is not set on Vercel.

Docker is needed only when you want to keep the BFF **separate** from the site, on your own
server or another hosting provider.


The image is a regular one, not tied to any platform. The same `Dockerfile` runs on
Fly.io, Railway, Render, any VPS with Docker.

The port is set by the `PORT` variable (3000 by default), the host by `HOSTNAME`
(already `0.0.0.0` in the image, otherwise the container can't be reached from outside).

Before exposing it publicly you need a reverse proxy with TLS: Caddy or nginx. Without HTTPS,
tokens will travel over the network in plain text.

---

## Limitations of the current state

This is a skeleton, not a finished service. What works now: `/health`, sign-in `/auth/*`,
`/me` (including account deletion) and the recovery anchor `/e2e/recovery`.
The other resources from the [contract](./api-v1.md) are not implemented.

What's still missing and is required before release:

- **Rate limits live in a single process's memory.** `/auth/*` has rate limits, but they live in the container's memory: a restart resets them, and a second instance counts separately. The other endpoints have no rate limits.
- **The per-IP limit works only behind a reverse proxy** that overwrites `X-Forwarded-For`. Without one, the header can be spoofed.
- **TLS.** Only via an external reverse proxy.
- **Token validation cache.** Every request goes to Supabase Auth to validate the
  token, which is an extra round-trip. Tolerable while debugging, worth fixing as
  load grows.
- **There are three environments: prod, staging and local.** Staging and the local
  container work only with synthetic data: the HRT tracker and Labs
  are **not** E2E-encrypted, and real records must end up neither on a
  developer's machine nor in the staging project.
- **Protection against building Release with a local address.** A compile-time
  check in the iOS project.
