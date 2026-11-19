# Shareable answer links

A "Share" button appears under each completed chat answer. Clicking it shows a warning, and a second click creates a public link `/a/<id>`. Nothing is sent before that second click.

## What is stored
`POST /shares` stores `{question, events}` in `data/shares.sqlite` and returns `{id}` (`token_urlsafe(9)`, 12 characters). Events are the chat's `text`, `call`, `result` and `error` events (tool results include chart data). Unknown fields are dropped. The provider config and API key are never part of the payload.

`GET /shares/{id}` returns `{id, created_at, question, events, citations, unavailable}`. Citations are not stored: the server rebuilds them from the catalog on every read, from the series ids found in the events.

## Rules
- Payload over `STATMESH_SHARE_MAX_BYTES`: 413. Anything that looks like an API key (sk-..., AIza..., AKIA..., Bearer tokens, private-key blocks and similar): 400.
- `STATMESH_SHARES=0`: both routes return 404.
- `STATMESH_SHARE_TTL_DAYS` (0 = forever): older shares return 404 and are deleted on the next insert.
- Hosted mode: a series the mode cannot serve gets no citation, is listed as "no longer available", and any tool result that mentions it is blanked. The stored text still renders.
- The page is `noindex`. The numbers come from the sharing user's session and can be forged; the banner says so.
- Rate limits live in nginx (`POST /shares`, see docs/hosted.md).
