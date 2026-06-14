# External Write API (`/connector/zinspireWrite`)

zotero-inspire registers an authenticated HTTP endpoint on Zotero's built-in
connector server so that **trusted local tools can perform writes that Zotero's
native Local API cannot** — attaching a local file to an item, and trashing or
erasing items.

## Why this exists

Zotero 7's native Local API (`http://127.0.0.1:23119/api/...`) is **read-only**:
every `POST`/`PUT`/`DELETE` is rejected at the server layer with
`400 "Endpoint does not support method"`. The Connector save endpoints can create
bare items, but they cannot attach a local file to an existing item nor delete
items. This endpoint fills that gap for local automation.

> **Availability:** registered since zotero-inspire **3.0.3**. Older builds (or a
> disabled plugin) return `404` for this path.

## Endpoint

```
POST http://127.0.0.1:23119/connector/zinspireWrite
Content-Type: application/json
x-zinspire-token: <token>
```

- **Method:** `POST` only (JSON body).
- **Auth:** every request must carry the `x-zinspire-token` header matching the
  pref `extensions.zotero.inspiremeta.external_token`. The token is generated and
  persisted automatically the first time the plugin runs. A missing/incorrect
  token returns `403 {"ok":false,"error":"FORBIDDEN"}`.
- **Web-content protection:** `allowRequestsFromUnsafeWebContent` is intentionally
  not set, so Zotero's server layer keeps blocking requests that look like they
  come from web content (a `Mozilla/...` user agent or an `Origin` header). Native
  callers (e.g. Node `fetch`, curl) are unaffected; callers should also send
  `zotero-allowed-request: true`.

The request body is `{ "op": "<operation>", ... }`.

## Operations

### `ping`
Health/capability probe (no side effects).

Request: `{ "op": "ping" }`
Response:
```json
{ "ok": true, "op": "ping", "addon": "...", "addon_id": "...",
  "version": "3.0.3", "capabilities": ["ping","attach_file","trash_item","erase_item"] }
```

### `attach_file`
Attach a local file to an existing regular item.

| field | required | notes |
|-------|----------|-------|
| `parent_item_key` | yes | key of the regular (top-level) item to attach to |
| `file_path` | yes | absolute path to an existing regular file |
| `mode` | no | `"import"` or `"link"`. Treated as `"link"` unless exactly `"import"`. `import` copies the file into Zotero storage (`importFromFile`, source untouched); `link` references it in place (`linkFromFile`). |
| `content_type` | no | MIME type override; otherwise sniffed |
| `title` | no | attachment title override |
| `library_id` | no | defaults to the user library |

Response:
```json
{ "ok": true, "op": "attach_file", "mode": "import", "library_id": 1,
  "parent_item_key": "ABCD1234", "attachment_key": "WXYZ5678", "attachment_id": 42,
  "link_mode": 0, "link_mode_label": "imported_file", "path": "/abs/path.pdf" }
```

> ⚠️ With `mode:"link"`, file-management plugins (e.g. **Attanger**, ZotFile) may
> rename/move the *source* file on disk based on the parent item's metadata.
> Prefer `import` when the source file must not be mutated.

### `trash_item`
Move an item to the Zotero trash (**recoverable**).

Request: `{ "op": "trash_item", "item_key": "ABCD1234", "library_id": 1 }`
Response: `{ "ok": true, "op": "trash_item", "library_id": 1, "item_key": "ABCD1234", "item_id": 42, "trashed": true }`

### `erase_item`
Permanently delete an item (**NOT recoverable**). A deliberately separate op from
`trash_item` so it can never be triggered by accident.

Request: `{ "op": "erase_item", "item_key": "ABCD1234", "library_id": 1 }`
Response: `{ "ok": true, "op": "erase_item", "library_id": 1, "item_key": "ABCD1234", "item_id": 42, "erased": true }`

## Errors

Failures return a non-2xx status with `{"ok": false, "op": "...", "code": "...", "error": "..."}`:

| status | `code` | meaning |
|--------|--------|---------|
| 403 | — | bad/missing `x-zinspire-token` |
| 404 | — | endpoint not registered (plugin < 3.0.3 / disabled) |
| 400 | `INVALID_PARAMS` / `INVALID_PATH` / `INVALID_PARENT` / `NOT_A_FILE` | bad request |
| 404 | `ITEM_NOT_FOUND` / `FILE_NOT_FOUND` | target item or file does not exist |
| 500 | `INTERNAL_ERROR` | unexpected failure |

## Consumers / dependency note

This endpoint is consumed by the **autoresearch `zotero-mcp` package** (and by
`hep-mcp`, which re-exposes those tools). Because the native Local API is
read-only, the MCP's `zotero_add` file attachment and its `zotero_delete` tool
route through this endpoint:

- The MCP resolves the token from `ZOTERO_WRITE_TOKEN` or, by default, by reading
  the Zotero profile `prefs.js` (`extensions.zotero.inspiremeta.external_token`).
- `zotero_add` attaches with `mode` defaulting to `import` (safe — never mutates
  the source); `link` is opt-in and warned about.
- If this plugin is absent, the MCP still creates the item but reports the
  attachment failure explicitly (`file_attached:false` + `attach_error`) rather
  than dropping it silently.

Keep this endpoint's request/response shape stable, or update the MCP client in
lockstep (`packages/zotero-mcp/src/shared/zotero/writeApi.ts` and
`packages/zotero-mcp/src/zotero/tools.ts`).

## Source

- Implementation: [`src/modules/connectorWriteApi.ts`](../src/modules/connectorWriteApi.ts)
- Registration: `src/hooks.ts` (`registerZInspireWriteEndpoint` on startup)
- Tests: [`test/connectorWriteApi.test.ts`](../test/connectorWriteApi.test.ts)
