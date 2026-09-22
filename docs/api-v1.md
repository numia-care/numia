# Numia BFF — API v1 contract

Status: **draft for review**. Implemented: `/health`, `/auth/*`, `/me`
(including `DELETE`) and `/e2e/recovery`.

**Machine-readable version — OpenAPI 3.1:** `GET /api/v1/openapi.json`, with a copy in
[openapi.json](./openapi.json). It is generated from the zod schemas the server uses
to validate requests (`lib/api/schemas.ts`), so for the fields and response codes of
implemented endpoints **the spec is the source of truth**. This document
describes what OpenAPI cannot express: the versioning rules, the sign-in model,
the encryption boundary and the endpoints that have not been written yet.

This document describes the HTTP contract between the iOS app and the BFF. The web app
still talks to Supabase directly — the BFF exists for the mobile client, whose
installed build cannot be updated.

---

## 1. Why a BFF, and what follows from it

There is exactly one reason, and it shapes the whole design: **App Store builds are not
updated on command**. The web serves a fresh client on every load, but some
users will keep an old iOS app forever. If the app talks
to Supabase directly, any DB migration — renaming a column, changing the
`schedule` format, moving to a different backend — breaks those builds with no way to
fix them.

The BFF is a layer behind which the data source can be changed while the contract is kept.

Hence three rules that matter more than any single endpoint:

**Rule 1. Within `v1` only additive changes are allowed.** Adding an
optional field to a response, adding a new endpoint, adding a new value
to an enum — allowed (the client must survive unfamiliar ones, rule 3). Removing
a field, renaming it, changing its type, making an optional field required —
not allowed. A breaking change = `/api/v2`, and `v1` keeps running in parallel for at
least another 6 months.

**Rule 2. The contract does not mirror the DB schema.** API field names and
Postgres column names match where that is convenient today, but that is a coincidence, not
a commitment. The BFF must be able to serve `v1` after a migration that
renamed a column.

**Rule 3. The client survives the unfamiliar: fields and enum values.** In
Swift this means: not `try container.decode` over every key in turn, but models
tolerant of new keys, and enums with a fallback case for an unknown
value. Otherwise an additive change will still crash old builds, and rule 1
becomes pointless.

That is why enums that appear in responses are published in OpenAPI as
`type: string` with the list of known values in `x-enum-values`, not as `enum`.
`swift-openapi-generator` turns an `enum` into a closed Swift enum with no fallback
case: a new error code on the server would break decoding of any error in
every installed build. Enums that appear only in requests stay closed.

### What the BFF does for the client

This is the second reason it exists. The web has about 3700 lines of domain
logic in TypeScript that are not in the database. There is no need to duplicate them in Swift:

| Logic | Where it lives now | How the API serves it |
|---|---|---|
| Expanding `schedule` into concrete intakes, accounting for time zones and DST | `lib/tracker/schedule.ts`, `slot-generator.ts` | `GET /intakes` returns ready-made slots |
| Adherence statistics | `lib/tracker/stats.ts` | `GET /stats/adherence` |
| Catalog of medications, forms, units | `lib/tracker/catalog.ts` | `GET /catalog/medications` |
| Catalog of analytes and reference values | `lib/labs/catalog.ts` | `GET /catalog/analytes` |

The raw `schedule` is present in responses (the edit screen needs it), but
**there is no need to expand it on the client** — that is what `GET /intakes` is for.

---

## 2. What does NOT go through the BFF

| What | Where it goes | Why |
|---|---|---|
| Files: photos, voice notes, report scans | To the address the BFF issued (currently Supabase Storage) | A blob is opaque to the BFF; pushing megabytes through a proxy is pointless and slow |
| Decryption of any E2E content | Only on the device | The server has no keys — that is the whole point |

Meanwhile the BFF **issues file tickets** (`/media/upload-ticket`,
`/media/download-ticket`), so the abstraction does not leak: the app gets an
address, a method and headers and does not know what is behind them. If Storage changes,
the ticket-issuing implementation changes, not the contract.

**The app knows nothing about Supabase at all.** No SDK, no addresses, no token
format. Everything, including sign-in, goes through the BFF — that is what makes the backend replaceable.

---

## 3. Authentication

Sign-in is by a 6-digit code from an email; there are no passwords or links. Exactly the way
the web already works. All of sign-in goes through the BFF:

```
iOS ── POST /auth/otp {email} ──────────► BFF ──► Supabase Auth: email with the code
iOS ── POST /auth/verify {email, code} ─► BFF ──► Supabase Auth ──► tokens
iOS ── Authorization: Bearer <access> ──► BFF ──(same token)──► Supabase, RLS
```

| Method | Path | What it does |
|---|---|---|
| `POST` | `/auth/otp` | Send a code by email. For a new address, an account is created along the way |
| `POST` | `/auth/verify` | Exchange the code for tokens |
| `POST` | `/auth/refresh` | Exchange a refresh token for a new pair |
| `POST` | `/auth/logout` | Sign out on this device |

### Sending the code

```
POST /auth/otp
{ "email": "person@example.com" }
```

The response is **always `204`**, whether such an account exists or not. Otherwise this
endpoint could be used to find out who uses the app — and for this audience
the mere fact of having an account is already sensitive information. Exceptions: `400` for an
invalid email, `429` when the limit is exceeded, `503` when the server is unavailable.

`429` on a repeat request shortly after the first one is a normal situation: a code is sent to one
address at most once a minute. The code is most likely already in the inbox,
so the client moves the person to the code entry screen and disables the
«отправить снова» ("send again") button for `Retry-After` seconds. The web does the same.

### Verifying the code

```
POST /auth/verify
{ "email": "person@example.com", "code": "123456" }
```

```json
{
  "access_token": "…",
  "refresh_token": "…",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

`code` is exactly 6 digits, no spaces. A wrong code and an expired code are not
distinguished: both give `400 invalid_code`.

### Refresh and sign-out

```
POST /auth/refresh
{ "refresh_token": "…" }
```

The response has the same shape as `/auth/verify`. **Every exchange issues a new
refresh token, and that is the one to store.** The old one is still accepted for a short time —
until the new one is used and for about 10 seconds after — so that a client that lost the
response to a network drop can retry the request. As soon as the new token is put to
use, the old one gives `401`. Do not rely on this window: it is for failures, not for
normal operation. `401` here means "the session has ended, sign in again".

Two parallel `/auth/refresh` calls with the same token are a common client mistake when
several requests got `401` at the same time. There must be a single refresh for
the whole app: the other requests wait for its result.

```
POST /auth/logout
Authorization: Bearer <access_token>
```

Always `204`, including for a token that is already invalid. It revokes the session only
on this device. The access token lives on until it expires — it cannot be
revoked instantly, so the client wipes both tokens on its side right away, without
waiting for the response.

### Rule: tokens are opaque

The app **does not decode tokens or read fields from them**. `user_id` comes
only from `GET /me`, the lifetime from `expires_in`.

If you start parsing the JWT, the coupling to Supabase simply moves from the SDK into
token parsing, and the backend stops being replaceable. When the backend changes, the token
format will change, old builds will get `401` on refresh and will ask to sign in again
once. The contract does not break.

### How the BFF handles the token

The BFF verifies the token with Supabase Auth and **passes it on** to Supabase.
It does not use `service_role`.

This is critical. `service_role` bypasses Row Level Security entirely: with it, the
database of every user is visible. As long as the BFF goes in with the user's token, RLS in Postgres
filters rows by `user_id = auth.uid()`, and a bug in the BFF costs one user,
not all of them. The security boundary stays in the database, not in the proxy code.

The BFF stores neither tokens nor state between requests: the code is verified without
PKCE, so "send" and "verify" can be handled by any instance.

### Rate limits

Supabase limits sign-in attempts per IP. Through the BFF, all requests reach
it from a single address, so the BFF does its own counting:

| Endpoint | Per email / token | Per client IP |
|---|---|---|
| `/auth/otp` | 3 per 15 minutes | 20 per 15 minutes |
| `/auth/verify` | 5 per 15 minutes | 30 per 15 minutes |
| `/auth/refresh` | 10 per 15 minutes per token | 60 per 15 minutes |

The per-email limit is the main protection against brute-forcing the code: a million combinations with five
attempts per 15 minutes. Exceeding it gives `429` with a `Retry-After` header in seconds.

The per-IP limit only works behind a reverse proxy that **overwrites**
`X-Forwarded-For`. Without one, the client can forge the header. The counters live in
the memory of a single process — with several BFF instances they have to be moved to
shared storage.

### Response codes that must be told apart

`401` — the token has expired or was not accepted. For regular requests: call
`/auth/refresh` and retry. If refresh also returned `401`, sign in again.

`503` — the BFF is alive but could not reach Supabase. The token may be
perfectly valid, so **the session must not be dropped** — only retry with
increasing delay. Treating server unavailability as "sign out"
would be lying to the user.

A separate layer on top of sign-in is the local PIN on the device; it has nothing to do with server
authentication (see §12).

---

## 4. General conventions

**Base URL:** `https://<host>/api/v1`

**Format:** JSON, `Content-Type: application/json; charset=utf-8`.

**Field naming:** `snake_case` — as in the database and as PostgREST returns it. In Swift
it is enabled with one line:

```swift
decoder.keyDecodingStrategy = .convertFromSnakeCase
```

**Value formats:**

| Type | Format | Example |
|---|---|---|
| Point in time | ISO 8601, always UTC, with `Z`, no fractional seconds | `2026-08-31T07:00:00Z` |
| Calendar date | `YYYY-MM-DD` | `2026-08-31` |
| Time of day | `HH:mm`, wall-clock in the user's time zone | `09:00` |
| Identifier | UUID v4 as a string | `3f2b…` |
| Binary data (ciphertext, IV, salt) | base64 as a string | `q1v…==` |

There are no fractional seconds on purpose: standard ISO 8601 parsing in Swift and
`swift-openapi-generator` do not accept them by default, and then the whole response fails to
decode. The database returns times with microseconds — the server truncates them itself.

Intake times are stored as `HH:mm` strings on purpose: when moving to another
time zone, an intake stays "at nine in the morning" instead of shifting. Conversion to UTC
happens only when slots are expanded, on the server side.

**Errors** — a single envelope:

```json
{
  "error": {
    "code": "invalid_input",
    "message": "schedule: times must be HH:mm",
    "field": "schedule.times[0]"
  }
}
```

`code` is a stable string you can branch on. `message` is for logs and
debugging, **do not show it to the user**: interface texts are localized on
the client. `field` is optional.

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_input` | Failed validation |
| 400 | `invalid_code` | Wrong or expired sign-in code |
| 401 | `unauthenticated` | No token, token expired, signature did not match |
| 403 | `forbidden` | The token is valid, but access is denied |
| 404 | `not_found` | No such record (or it belongs to someone else — RLS does not distinguish) |
| 409 | `conflict` | A unique index was violated |
| 422 | `unprocessable` | Valid in form but meaningless in substance (`taken_at` in the future, an empty lab entry) |
| 429 | `rate_limited` | Too frequent; `Retry-After` header |
| 500 | `internal` | Everything else |
| 503 | `service_unavailable` | Could not reach Supabase. **Not** a reason to discard the session — the token may be fine; retry with backoff |

**Lists** are returned in an envelope, not as a bare array — so that pagination
can be added later without breaking the contract:

```json
{ "items": [ … ], "next_cursor": null }
```

**Health:** `GET /api/v1/health` → `{"status":"ok","version":"1.0.0"}`, no
authorization. Useful to tell "the server is down" apart from a request error.

---

## 5. Profile

### `GET /me`

```json
{
  "user_id": "…",
  "timezone": "Europe/Madrid",
  "profile_ciphertext": "base64…",
  "e2e": {
    "has_recovery_anchor": true
  },
  "created_at": "2026-05-19T10:00:00Z"
}
```

`profile_ciphertext` is an E2E blob with the name and form of address. The BFF returns it as
is; decryption happens on the device. `timezone` is in the clear: the server needs it to
compute slots and send reminders.

`has_recovery_anchor` is derived from the presence of `dek_wrapped_recovery`; the wrap
itself is served separately (§ 12). There is no "user saved the recovery key" flag
here: it is **device-local**, lives in device storage
(IndexedDB on the web, Keychain on iOS) and is not synced to the server.

### `PATCH /me`

The body is any subset of `{ "timezone": "…", "profile_ciphertext": "…" }`.
The response is the same as for `GET /me`.

The app must send the time zone on first sign-in and whenever it changes:
server-side slot generation relies on it.

### `DELETE /me`

Deletes the account entirely: all data, files in Storage, sessions on all
devices. Irreversible. App Store requirement 5.1.1(v). No body.

| Response | What it means | What the client does |
|---|---|---|
| `204` | Account deleted | Wipe the tokens, Keychain (the PIN wrap of the DEK) and the local cache |
| `401` | Token not accepted | If this is a retry after a lost `204`, the account is already gone; act as after `204`. Otherwise, the usual `/auth/refresh` |
| `503` | Storage unavailable. The account is **not** deleted; some files may have been deleted | Retry later. The retry cleans up the leftovers |
| `500` | Server error, account not deleted | Retry later |

**There is no re-verification of the code before deletion** (decision of 2026-09-15). The cost
of that decision: anyone holding an unlocked phone with the app open
can irreversibly wipe the entire history and E2E data with a single request.
The mitigation is on the client: a confirmation screen and PIN before the call. If we decide to
require a fresh sign-in, it will be added additively: `422` with a dedicated error code,
the client goes through `/auth/otp` + `/auth/verify` and repeats the `DELETE`.

How it works. The BFF does **not** get `service_role` here either: files are deleted through
the Storage API with the user's token, then the account is deleted by the Postgres function
`delete_my_account()`, which deletes only `auth.uid()`; tables and sessions
go by cascade. Files go first, so the operation is idempotent: after a failure,
a retry simply continues.

---

## 6. Catalogs

Served by the server, **not baked into the app** — otherwise they would drift apart from the web.
They change rarely; the response can be cached by `ETag`.

### `GET /catalog/medications`

```json
{
  "kinds":  [{ "code": "estrogen", "label_ru": "эстроген" }, …],
  "forms":  [{ "code": "injection", "label_ru": "инъекция" }, …],
  "units":  [{ "code": "mg", "label_ru": "мг" }, …],
  "popular": [{ "name": "Эстрадиола валерат", "kind": "estrogen", "form": "tablet" }, …]
}
```

`popular` is autocomplete suggestions while typing a name, not a restriction:
the medication name is entered as free text.

### `GET /catalog/analytes`

```json
{
  "items": [
    {
      "code": "estradiol",
      "name": "Эстрадиол (E2)",
      "units": [
        { "code": "pmol_l", "label": "пмоль/л", "to_base": 1 },
        { "code": "pg_ml",  "label": "пг/мл",   "to_base": 3.67 }
      ],
      "allow_custom": false
    },
    { "code": "other", "name": "Другой показатель", "units": [], "allow_custom": true }
  ]
}
```

`units[0]` is the base unit and the default unit in the form. `to_base` is
the multiplier that converts a value from this unit to the base one: `base = value × to_base`.
Conversion is needed only for display: the value is written to the database exactly as
the user entered it. `other` is an analyte outside the catalog; the user
writes in the name and unit themselves.

**The catalog does not serve medical norms — on purpose.** The «моё обычное» ("my usual") range
is set by the person themselves as prescribed by their doctor (§8, ranges). A norm baked into
the app or computed from history is indistinguishable on screen from a medical
recommendation, but it is not one.

---

## 7. Tracker

### 7.1 Medications

| Method | Path | What it does |
|---|---|---|
| `GET` | `/medications` | Active medications |
| `GET` | `/medications?include_stopped=true` | Plus stopped ones (`end_date` set) |
| `POST` | `/medications` | Create |
| `GET` | `/medications/{id}` | A single one |
| `PATCH` | `/medications/{id}` | Partial update |
| `DELETE` | `/medications/{id}` | Soft delete |
| `POST` | `/medications/{id}/stop` | Stop the therapy (`{"end_date":"2026-09-01"}`) |

Deleted ones (`deleted_at`) are never returned. Stopped ones only with an
explicit flag: their intake history remains.

Medication object:

```json
{
  "id": "…",
  "name": "Эстрадиола валерат",
  "kind": "estrogen",
  "form": "injection",
  "dose_amount": 5,
  "dose_unit": "mg",
  "schedule": { "kind": "interval", "every_days": 7, "time": "10:00", "anchor_date": "2026-05-19" },
  "start_date": "2026-05-19",
  "end_date": null,
  "notes": null,
  "created_at": "2026-05-19T10:00:00Z"
}
```

`kind` ∈ `estrogen | antiandrogen | progesterone | testosterone | other`
`form` ∈ `tablet | capsule | injection | gel | patch | drops | spray | other`
`dose_unit` ∈ `mg | mcg | ml | iu | drop | puff | tablet`

`schedule` is a tagged union on `kind`:

```json
{ "kind": "daily", "times": ["09:00", "21:00"] }
```
from 1 to 12 times, no duplicates.

```json
{ "kind": "interval", "every_days": 7, "time": "10:00", "anchor_date": "2026-05-19" }
```
`every_days` is an integer 1…180. Slots are computed as `anchor_date + N × every_days`.

Not supported in v1 and will not be added to it: specific days of the week,
different doses on different days, intake windows. That is `v2`.

The body of `POST /medications` is the fields `name`, `kind`, `form`, `dose_amount`,
`dose_unit`, `schedule`, `start_date`, and optionally `notes`. The response is the created
object in full, `201`.

After creation and after a schedule change, the server regenerates slots **itself**
for the next three days. The client does not need to do anything for this.

### 7.2 Intakes

| Method | Path | What it does |
|---|---|---|
| `GET` | `/intakes?from=&to=&order=asc` | Slots for a period |
| `GET` | `/intakes/today` | Today's slots in the user's time zone |
| `POST` | `/intakes/{id}/taken` | Mark as taken |
| `POST` | `/intakes/{id}/skipped` | Mark as deliberately skipped |
| `POST` | `/intakes/{id}/reset` | Return to `upcoming` (undo) |

`from` and `to` are ISO UTC, a half-open interval `[from, to)`. `order` ∈ `asc | desc`,
`asc` by default. The range is limited to 366 days, otherwise `422`.

This is the main endpoint: it returns **already expanded slots**; there is no need to parse
`schedule` on the client.

```json
{
  "items": [
    {
      "id": "…",
      "medication_id": "…",
      "scheduled_at": "2026-08-31T07:00:00Z",
      "taken_at": null,
      "status": "upcoming",
      "dose_actual": null,
      "medication": {
        "name": "Эстрадиола валерат",
        "kind": "estrogen",
        "form": "injection",
        "dose_amount": 5,
        "dose_unit": "mg"
      }
    }
  ],
  "next_cursor": null
}
```

`status` ∈ `upcoming | taken | skipped | missed`.

`medication` can be `null` — the medication was hard-deleted, but the history remained.
Show such slots as «удалённый препарат» ("deleted medication"), do not hide them: the adherence
history belongs to the user.

The meaning of the statuses, which matters for the interface:

- `upcoming` whose time has already passed is **not** a failure. During the day such slots
  are normal; they can still be checked off. A background job moves them to `missed`
  only once the user's day has ended in their time zone.
- `skipped` is a deliberate skip. It is presented neutrally, with no negative connotation,
  and is not counted in the adherence denominator.

**Checking off an intake:**

```
POST /intakes/{id}/taken
{ "taken_at": "2026-08-30T21:00:00Z" }   // optional
```

Without a body, `taken_at` is set to the moment of the request. With a body, it is a backdated
check-off ("took it yesterday at nine"). A time in the future is rejected with `422`
(`taken_at_in_future`); the allowance for clock skew is 60 seconds.

All three operations are idempotent: a repeated call leads to the same state.
The response is the updated slot object.

### 7.3 Statistics

### `GET /stats/adherence?from=&to=`

```json
{
  "taken": 24, "missed": 3, "skipped": 1,
  "pending": 1, "upcoming": 5,
  "due": 28,
  "adherence": 0.888
}
```

`adherence = taken / (taken + missed)`, a fraction 0…1, formatted by the client.
**`null` when the denominator is zero** — this is not "0 %", it is "nothing to show".

`due = taken + missed + skipped` is the denominator for «принято X из Y» ("X of Y taken"). `pending`
is left out of it on purpose: otherwise the number would jump around during the day.

There are no breakdowns by medication name or sums by dose here, and there will not be: that
would tie the statistics to the plaintext of the names, and those are candidates for
moving to E2E.

---

## 8. Labs

They are organized as **lab sessions**. A lab session is one visit to the lab: one date, one
report, one note and any number of analytes inside. Physically there is one report,
with all the values on it at once — so the shared fields belong to the lab session, not to the
analyte.

| Entity | Fields | Boundary |
|---|---|---|
| Lab session | `measured_at`, `note_ciphertext`, `blank_photo_path` + `blank_photo_iv` | date in the clear; note and report — **E2E** |
| Analyte | `analyte`, `analyte_custom_name`, `value`, `unit` | in the clear |
| Range | `analyte`, `min`, `max`, `unit` | in the clear |

Data in the clear is protected by RLS, like the whole tracker. The server does not read the note or the report.

### Lab sessions

| Method | Path | What it does |
|---|---|---|
| `GET` | `/labs/sessions` | All lab sessions with their analytes, newest first |
| `GET` | `/labs/sessions/{id}` | A single lab session |
| `POST` | `/labs/sessions` | Create |
| `PUT` | `/labs/sessions/{id}` | Replace the lab session entirely |
| `DELETE` | `/labs/sessions/{id}` | Delete together with its analytes and report |

```json
{
  "id": "…",
  "measured_at": "2026-08-15",
  "note_ciphertext": "base64…",
  "blank_photo_path": "…",
  "blank_photo_iv": "base64…",
  "results": [
    { "id": "…", "analyte": "estradiol", "analyte_custom_name": null, "value": 420, "unit": "pmol_l" },
    { "id": "…", "analyte": "other", "analyte_custom_name": "Ферритин", "value": 38, "unit": "нг/мл" }
  ],
  "created_at": "2026-08-15T12:00:00Z"
}
```

The list is sorted by `measured_at`, lab sessions without a date go last, then by
`created_at`. `measured_at` can be `null`: if the person does not remember the date, we do not force them.

`results` can be an empty array — that is a "photographed the report, will sort it out
later" lab session. A legitimate state, not an error.

The note and the report arrive as ciphertext right inside the lab session: only the device can
decrypt them, and no separate request is needed for that. The report is downloaded by
ticket (§10) and decrypted with the user's data key, using the IV from
`blank_photo_iv`.

**Creation:**

```
POST /labs/sessions
{
  "measured_at": "2026-08-15",
  "note_ciphertext": "base64…",
  "blank_photo_path": "…",
  "blank_photo_iv": "base64…",
  "results": [ { "analyte": "estradiol", "value": 420, "unit": "pmol_l" } ]
}
```

The response is the created lab session in full, `201`.

**Replacement** (`PUT`) takes the same body and describes the **final** state of the lab session:

- an analyte with an `id` is updated;
- an analyte without an `id` is added;
- an analyte that is not in the list is deleted;
- a field that is not sent becomes `null`. To keep the report, its
  `blank_photo_path` and `blank_photo_iv` must be sent as they were.

If the report was changed or removed, the server deletes the old file itself.

Validation rules for both requests:

| Rule | Error |
|---|---|
| A lab session with no analytes and no report | `422 unprocessable` |
| `analyte`, `value`, `unit` are required for an analyte, `value ≥ 0` | `400 invalid_input` |
| `analyte_custom_name` only with `analyte: "other"` | `400 invalid_input` |
| `blank_photo_path` and `blank_photo_iv` only as a pair | `400 invalid_input` |
| `blank_photo_path` was not issued to this user via `/media/upload-ticket` | `403 forbidden` |

The order with a scan: compress → encrypt → get an upload ticket → upload →
create the lab session with the returned `path`. If creation fails, the file is left
orphaned — it is encrypted and harmless, and the server will clean it up.

### Analyte series

### `GET /labs/analytes/{code}/series?unit=pmol_l`

Everything the chart and the analyte card need, already computed on the server.
Without this, Swift would have to repeat the unit conversion, delta and trend from
`lib/labs/stats.ts`.

```json
{
  "analyte": "estradiol",
  "unit": "pmol_l",
  "points": [
    { "session_id": "…", "measured_at": "2026-06-10", "value": 310, "source_value": 84.5, "source_unit": "pg_ml" },
    { "session_id": "…", "measured_at": "2026-08-15", "value": 420, "source_value": 420,  "source_unit": "pmol_l" }
  ],
  "latest": {
    "delta": 110,
    "trend": { "direction": "up", "streak": 1 },
    "range_position": "inside"
  },
  "range": { "min": 350, "max": 750, "unit": "pmol_l" }
}
```

`unit` is optional; it defaults to the analyte's base unit. `value` is in the
requested unit, `source_value` and `source_unit` are as the user entered them.

What is deliberately left out of the calculation:

- **Measurements without a date.** They cannot be placed on the time axis. They are in
  `/labs/sessions`, but not in the series.
- **Values that cannot be honestly converted** to the requested unit. The server skips such a
  point rather than substituting the number "as is": incomparable values must not be
  compared, even at the cost of a gap in the chart.

`latest.delta` is the difference between the latest measurement and the previous one, in the requested unit.
`trend.streak` is how many consecutive transitions point in the same direction, counting from
the latest one. For `flat` it is always `1`. `range_position` ∈ `below | inside | above`.
Any of these fields can be `null`: a single measurement, no range set, the unit cannot be
converted.

### Ranges

| Method | Path | What it does |
|---|---|---|
| `GET` | `/labs/ranges` | All of the user's ranges |
| `PUT` | `/labs/ranges/{analyte}` | Set or adjust |
| `DELETE` | `/labs/ranges/{analyte}` | Remove |

```json
{ "items": [ { "analyte": "estradiol", "min": 350, "max": 750, "unit": "pmol_l", "updated_at": "2026-08-10T09:00:00Z" } ] }
```

```
PUT /labs/ranges/estradiol
{ "min": 350, "max": 750, "unit": "pmol_l" }
```

The range is set by **the person, as prescribed by their doctor**. The server does not compute it — neither from
the measurement history nor from the catalog — and stores exactly what was sent. `unit` is
the unit in which the person entered the bounds, not the chart's current unit.

One analyte has one range, so it is addressed by the analyte code, not by an
identifier. Ranges are not supported for `other` (`422`): different
arbitrary analytes would be lumped into one. `min ≤ max`, both bounds `≥ 0`.

A failure to read the ranges is always an error, not an empty response. An empty response
would mean "no range set", the editor would show empty fields, and the next
save would overwrite the bounds the doctor prescribed.

---

## 9. Path and Diary

The transition feed: photos, voice notes, notes, the mood diary. This is where E2E is applied
most strictly.

**In the clear:** `id`, `entry_type`, `occurred_at`, `mood`, `created_at`.
**Encrypted:** the photo caption, the note text, the file itself.

The metadata is left in the clear deliberately: without it the server cannot build the feed or
sort it without decrypting. The entry type and date are visible, the content is
not.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/path/entries?from=&to=` | The feed, newest first |
| `POST` | `/path/entries` | Create |
| `PATCH` | `/path/entries/{id}` | Edit (for example, the diary text) |
| `DELETE` | `/path/entries/{id}` | Delete together with the file |

```json
{
  "items": [
    {
      "id": "…",
      "entry_type": "diary",
      "occurred_at": "2026-08-30T18:00:00Z",
      "media_path": null,
      "media_iv": null,
      "encrypted_content": null,
      "mood": 4,
      "note_ciphertext": "base64…",
      "created_at": "2026-08-30T18:01:00Z"
    }
  ],
  "next_cursor": null
}
```

`entry_type` ∈ `photo | voice | note | diary | lab_result | milestone`.

`mood` is 1…5 and **is not encrypted**: it is needed for the mood chart and reveals
nothing on its own. The note text next to it is encrypted.

`media_path` is the path issued by `/media/upload-ticket` (§10). `media_iv` is a
separate field rather than inside the ciphertext, because the file itself is stored separately
from the database. For text fields (`encrypted_content`,
`note_ciphertext`) the IV is packed inside: the format is `base64(iv ‖ ciphertext)`.

The BFF does not look at the contents of these fields or validate them — to it they are
opaque strings.

---

## 10. File tickets

Files do not pass through the BFF. It issues a temporary address; the client works with it
directly and does not know what is behind it.

### `POST /media/upload-ticket`

```json
{ "purpose": "lab_blank", "content_length": 1048576 }
```

`purpose` ∈ `path_photo | path_voice | lab_blank`.

```json
{
  "path": "…",
  "url": "https://…",
  "method": "PUT",
  "headers": { "Content-Type": "application/octet-stream" },
  "expires_at": "2026-08-31T08:05:00Z"
}
```

**The server issues the path**; the client does not build it. There are two reasons:

- the app must not know how the storage is organized — otherwise a Storage change
  would break installed builds;
- the file is uploaded **before** the entry that references it
  is created — there is no entry ID yet.

`path` is an opaque string. The client passes it on unchanged: into a lab session's
`blank_photo_path` or a Path entry's `media_path`. The server accepts
only paths it issued to that same user.

### `POST /media/download-ticket`

```json
{ "path": "…" }
```

The response has the same shape, `method: "GET"`. Someone else's path gives `403`.

What you upload and download must be **ciphertext**. The order for a photo: compress → encrypt
→ get a ticket → upload → create the entry. Compression must happen before encryption:
an encrypted blob does not compress, either on the server or in transport.

---

## 11. Push notifications

| Method | Path | What it does |
|---|---|---|
| `POST` | `/push/subscriptions` | Register a device |
| `DELETE` | `/push/subscriptions/{id}` | Unsubscribe |
| `GET` | `/push/subscriptions` | List of devices for the settings screen |

The web uses Web Push (VAPID). For native iOS it is APNs, i.e. a **different
transport**, and the current `push_subscriptions` table does not fit it: its
fields `endpoint`, `p256dh`, `auth` come from the Web Push spec.

This is an open question, flagged in §13. We design the endpoint contract to be
transport-neutral from the start:

```json
{ "transport": "apns", "token": "…", "environment": "sandbox", "device_label": "iPhone" }
```

The notification text never contains specifics — ever. Not
«пора принять эстрадиол» ("time to take estradiol"), but «напоминание ✦» ("reminder ✦").
Details are visible only after opening the app and unlocking it. This is a product
requirement, not a wish.

---

## 12. E2E: key material

The endpoints return **key wraps**, not the key. The server never sees secrets.

### The main risk

There is one anchor per user, and it must not be overwritten blindly. Two devices
go through first-time setup at the same time, each generates its own DEK and
writes the anchor — the last one wins, and data already encrypted with the first
DEK becomes unreadable forever. The same goes for changing the phrase: the person wrote down
phrase A, meanwhile another device wrote B, and A silently stopped
working.

That is why the anchor has a **version**, and the write is **conditional**: it succeeds only if the
version is still the one the client saw. The check and the write are a single statement in
Postgres; of two simultaneous writes exactly one succeeds. The version is maintained by a
DB trigger, so an anchor write from the web bumps it too.

### `GET /e2e/recovery`

```json
{
  "dek_wrapped_recovery": "base64…",
  "recovery_salt": "base64…",
  "recovery_kdf_iterations": 600000,
  "anchor_version": 3
}
```

| Response | What it means |
|---|---|
| `200` | The anchor exists |
| `404 not_found` | There is no anchor — a new DEK may be created |
| `401` | Same as everywhere |
| `500`, `503` | Could not read. **This is not "no anchor"** |

**A read failure is never returned as `404`.** On `404` the client generates a new
DEK, and a false `404` caused by the network would destroy data. The client must behave
the same way: a timeout, `5xx`, a dropped connection mean "don't know", not "no". In this
state, do not generate a new DEK, only retry.

`recovery_kdf_iterations` may come back `null` — these are legacy records with
210 000 iterations. The current value is 600 000. **Always take the number from the
response, not from a constant in the code**: otherwise old accounts will not unwrap.

On a new device: the user enters the 12-word phrase → the app derives
a KEK from it → unwraps `dek_wrapped_recovery` with it → gets the same DEK
that all the content is encrypted with → sets a new local PIN and puts a second
wrap into Keychain.

### `PUT /e2e/recovery`

```json
{
  "dek_wrapped_recovery": "base64…",
  "recovery_salt": "base64…",
  "recovery_kdf_iterations": 600000,
  "expected_anchor_version": 0
}
```

- `expected_anchor_version: 0` — **create**: succeeds only if there is no anchor.
- `expected_anchor_version: N` — **change the phrase**: succeeds only if the current
  version equals `N` (from the latest `GET`).

| Response | What it means |
|---|---|
| `200` | Written. Body as for `GET`, with the new `anchor_version` |
| `409 conflict` | The version did not match: the anchor was created or changed from another device in the meantime. **Nothing was written** |
| `400 invalid_input` | Validation failed; the field is in `field` |
| `401`, `500`, `503` | Same as everywhere. On `5xx` the write may have gone through — see below about retries |

Validation:

| Field | Rule |
|---|---|
| `dek_wrapped_recovery` | Standard base64 with padding, exactly **60 bytes**: IV 12 + DEK 32 + GCM tag 16 |
| `recovery_salt` | Standard base64 with padding, exactly **16 bytes** |
| `recovery_kdf_iterations` | Integer, from 600 000 to 10 000 000. Legacy 210 000 is not accepted for new anchors |
| `expected_anchor_version` | Integer `>= 0`, required |

**Retrying the same body is safe.** Writing the same three values does not change the anchor,
and the version does not increase. So if the response was lost (timeout, `5xx`), the client
retries the `PUT` with the same body and the same `expected_anchor_version`: if the write
went through — `200` again with the same version; if it did not — it goes through now; if the
anchor was changed in the meantime — `409`.

The phrase and the DEK never reach the server. The server does not log the request body.

### What the client does

**First-time setup.** `GET` → `404` → generate a DEK and a phrase → `PUT` with
`expected_anchor_version: 0` → on `200`, save the PIN wrap in Keychain and
show the phrase. On `409`, another device has just created the anchor:
**discard your own DEK** (nothing has been encrypted with it yet), do not show the phrase,
switch to recovery via the phrase. The order matters: first the anchor on the server,
then the local wrap and content encryption.

**Changing the phrase.** `GET` → unwrap the DEK with the old phrase or take it from the session →
wrap it with the new one → `PUT` with the `anchor_version` from `GET` → on `409`, re-read with
`GET`: the phrase was changed from another device, and this device's new phrase was not
written.

### What is not here

There is **no PIN wrap on the server, and there never will be**. A PIN is six digits, a million
combinations: if the database leaks, such a wrap is brute-forced offline in minutes.
The PIN wrap lives only on the device, in Keychain. A 12-word phrase gives
128 bits of entropy, so keeping its wrap on the server is safe.

The phrase itself is never sent to the server.

### What iOS must implement itself

| What | Parameters |
|---|---|
| Key derivation | PBKDF2-HMAC-SHA256, 16-byte salt, 256-bit output, iteration count from the server response |
| KDF input | `secret + info tag`, string concatenation. Tag for the wrapping key: `numia-kek-v1`. Tag for PIN verification: `numia-pin-verify-v1` |
| Cipher | AES-256-GCM, 12-byte IV, 128-bit tag |
| Packing of text and DEK wraps | `base64(iv ‖ ciphertext ‖ tag)` as a single string |
| Packing of files | `ciphertext ‖ tag` as the file, IV as a separate field in the database |
| Phrase | BIP39, 12 words, English wordlist |
| Phrase normalization | `trim`, lowercase, collapse repeated spaces into one |

Pitfalls where a port breaks silently:

1. WebCrypto puts the GCM tag (16 bytes) at the **end of the ciphertext**; there is no separate
   field for it. For text and DEK wraps this is exactly the
   `AES.GCM.SealedBox(combined:)` format: 12-byte nonce ‖ ciphertext ‖ tag, nothing
   needs to be cut. For files the IV is stored separately: either concatenate `iv ‖ file`
   (IV and file) and pass it to `combined:`, or cut off the last 16 bytes as the tag and build
   `SealedBox(nonce:ciphertext:tag:)`.
2. The `info` tag is appended **to the secret before PBKDF2**, not after. Swap them
   and you get a different key without a single runtime error.
3. Normalizing the phrase is mandatory before deriving the key. An extra space from
   the clipboard gives a different key.
4. `recovery_kdf_iterations` from the response, not from a constant.
5. What goes into PBKDF2 is **the phrase string itself** after normalization, not the BIP39 seed.
   BIP39 libraries offer to derive a seed from the phrase (`seed(from:)`, `toSeed()`
   and the like) — it is not used here: the seed is derived by its own PBKDF2 with
   its own salt `"mnemonic"` and would give a different key. BIP39 is needed only to
   generate the phrase and to verify its checksum on entry.

None of these points produces a meaningful error: decryption simply fails
the tag check.

---

## 13. Open questions

1. **APNs vs Web Push.** The `push_subscriptions` table is designed for
   Web Push. Native notifications need a migration: a `transport` column,
   APNs token fields, and sending via APNs in the background job. The effort has not been estimated.

2. **PIN verification on the device.** On the web the salt and hash live in IndexedDB; on iOS
   that is Keychain. The mechanism is local and needs no server contract, but
   the behavior must match: the same limits on the number of attempts and on
   lockout. Worth describing separately.

3. **Offline.** The contract is synchronous; it has no cache and no change queue.
   Checking off an intake without a network is a common scenario, but designing sync
   before a working online path exists is premature. A candidate for `v1.1`,
   additively: idempotency keys on mutations.

4. **Rate limiting.** The home server has no protection during development.
   Before release — mandatory.

5. **There are three environments: prod, staging and local** (decision of 2026-09-22).
   Staging is separate Supabase and Vercel projects, deployed on push to the
   `staging` branch (`docs/bff-deploy.md`, "Staging"). Staging and the local stack
   work only with synthetic data. A build in the Release configuration must not compile with
   a local address — this is checked at compile time.

---

## 14. iOS development environment

Answers to the iOS client's questions (2026-09-15).

1. **Base URL.** There are three environments.
   - **Local:** the BFF in Docker on the developer's machine, `http://localhost:3000/api/v1`,
     Supabase via `supabase start` (see `docs/bff-deploy.md`). In the simulator
     `localhost` is the Mac. On a physical phone, it is the Mac's IP on the local network.
     This is HTTP, so the ATS exception for the local network
     (`NSAllowsLocalNetworking`) goes **only** in the Debug configuration; it must not
     be there in Release.
   - **Staging:** HTTPS on the domain of the staging Vercel project, ATS with no
     exceptions. Sign-in only for manually added testers; emails with
     the code arrive at a real inbox.
   - **Prod:** `https://numia.care/api/v1` — the BFF lives inside the site. ATS with no
     exceptions.

2. **OTP code without a real mailbox.** Emails from the local Supabase do not go out;
   they land in Mailpit: web UI at `http://127.0.0.1:54324`, API
   `GET /api/v1/search?query=to:<email>`. Test accounts with a fixed
   code **do not exist and never will**: such a sign-in in a prod build is a hole. In the server's
   automated tests the code is provided by the local stack's admin API
   (`lib/api/test-support/local-supabase.ts`); it is not available to the app.

3. **A separate dev Supabase project.** Staging plays its role (§ 13, item 5).
   Real data exists only in prod.
