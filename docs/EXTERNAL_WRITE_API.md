# External Write API (`/connector/zinspireWrite`)

zotero-inspire registers an authenticated HTTP endpoint on Zotero's built-in
connector server so that **trusted local tools can perform writes that Zotero's
native Local API cannot** — attaching a local file to an item, adding an item
from an INSPIRE record into a target chosen in the plugin's picker, and trashing
or erasing items.

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
  pref `extensions.zotero.inspiremeta.external_token`. The token is generated
  with a Web Crypto CSPRNG and persisted automatically the first time the plugin
  runs. Legacy tokens that do not have the secure 43-character base64url format
  are rotated before they can authorize a request. A missing/incorrect token
  returns `403 {"ok":false,"error":"FORBIDDEN"}`. If no CSPRNG is available and
  no compliant token already exists, the endpoint fails closed with
  `503 {"ok":false,"error":"TOKEN_UNAVAILABLE"}`.
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
{
  "ok": true,
  "op": "ping",
  "addon": "...",
  "addon_id": "...",
  "version": "3.0.3",
  "capabilities": [
    "ping",
    "attach_file",
    "trash_item",
    "erase_item",
    "add_item",
    "pick_save_target"
  ]
}
```

### `attach_file`

Attach a local file to an existing regular item.

| field             | required | notes                                                                                                                                                                                                                                     |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parent_item_key` | yes      | key of the regular (top-level) item to attach to                                                                                                                                                                                          |
| `file_path`       | yes      | absolute path to an existing regular file                                                                                                                                                                                                 |
| `mode`            | no       | `"import"` or `"link"`; defaults to `"link"` when omitted, while any other explicit value is rejected. `import` copies the file into Zotero storage (`importFromFile`, source untouched); `link` references it in place (`linkFromFile`). |
| `content_type`    | no       | MIME type override; otherwise sniffed                                                                                                                                                                                                     |
| `title`           | no       | attachment title override                                                                                                                                                                                                                 |
| `library_id`      | no       | defaults to the user library                                                                                                                                                                                                              |

Response:

```json
{
  "ok": true,
  "op": "attach_file",
  "mode": "import",
  "library_id": 1,
  "parent_item_key": "ABCD1234",
  "attachment_key": "WXYZ5678",
  "attachment_id": 42,
  "link_mode": 0,
  "link_mode_label": "imported_file",
  "path": "/abs/path.pdf"
}
```

File name: the file is named as Zotero names a single file added to an item
from disk (Add Attachment → File, drag and drop). When Zotero's "Automatically
rename files" setting is on, the file is of a type Zotero renames, and the parent
has no other non-HTML file attachment, it takes the parent's name from the rename
template: with `import` the copy in Zotero storage gets that name; with `link`
the source file itself is renamed in place (a number is added when the name is
taken), and only when "Rename linked files" is also on. Otherwise the file keeps
its name. `path` is the source path for `import` (the stored copy's path is not
returned), and the linked file's path for `link` (the renamed path when it was
renamed).

> ⚠️ With `mode:"link"`, the source file on disk may be renamed (see above), and
> file-management plugins (e.g. **Attanger**, ZotFile) may rename/move it based
> on the parent item's metadata. Prefer `import` when the source file must not be
> mutated.

### `add_item`

> `add_item` and `pick_save_target` are advertised by newer plugin builds.
> Clients must check the `capabilities` array from `ping`; do not infer support
> from the plugin version alone.

Create a new library item from an INSPIRE record. The target is normally chosen
with the plugin's own save-target picker first (see
[`/connector/zinspirePickSaveTarget`](#choosing-a-target-connectorzinspirepicksavetarget));
this operation only performs the create and the duplicate check.

| field            | required | notes                                                     |
| ---------------- | -------- | --------------------------------------------------------- |
| `recid`          | yes      | positive INSPIRE record id                                |
| `library_id`     | no       | defaults to the user library; must be an editable library |
| `collection_ids` | no       | collection ids in that library; at most 100               |
| `tags`           | no       | tag strings; at most 100, each at most 200 characters     |
| `note`           | no       | child note text; at most 20000 characters                 |

Request:

```json
{
  "op": "add_item",
  "recid": "1234567",
  "library_id": 1,
  "collection_ids": [42],
  "tags": ["test"],
  "note": "imported from Particle Library"
}
```

Response when a new item is created:

```json
{
  "ok": true,
  "op": "add_item",
  "status": "added",
  "item_key": "ABCD1234",
  "item_id": 101,
  "library_id": 1,
  "collection_ids": [42]
}
```

If any accessible library already has an item for the recid, nothing is created:

```json
{
  "ok": true,
  "op": "add_item",
  "status": "existing",
  "item_key": "OLDITEM1",
  "item_id": 55,
  "library_id": 1
}
```

The duplicate check fails closed: if the library index cannot be read, the
operation returns `503 LIBRARY_UNAVAILABLE` and adds nothing.

### Choosing a target (`/connector/zinspirePickSaveTarget`)

The plugin's own save-target picker is exposed on the same connector server, with
the same `x-zinspire-token` authentication. Start a picker with `wait:false`, then
poll with the returned `requestID`:

```json
{ "wait": false, "multi": true, "includeTagsNote": true }
```

```json
{ "requestID": "..." }
```

The poll response is `status: "pending"` until the user finishes, then either:

```json
{
  "ok": true,
  "requestID": "...",
  "status": "done",
  "libraryID": 1,
  "collectionIDs": [42],
  "collectionKeys": ["COLL0001"],
  "selectedPath": "My Library / Collection",
  "tags": [],
  "note": ""
}
```

or `status: "cancelled"` / `"expired"` / `"error"`. A `409 BUSY` means another
picker is already open. Pass the returned `libraryID`, `collectionIDs`, `tags`
and `note` to `add_item`; the App does not need its own collection picker.

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

Failures return a non-2xx status with `{"ok": false, "code": "...", "error": "..."}`.
Recognized operations may also be named in `op`; unsupported operation text and
unexpected internal exception messages are never reflected to the client. JSON
responses are capped at 1 MiB.

| status | `code`                                                                                     | meaning                                             |
| ------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 403    | —                                                                                          | bad/missing `x-zinspire-token`                      |
| 503    | —                                                                                          | no secure authentication token is available         |
| 404    | —                                                                                          | endpoint not registered (plugin < 3.0.3 / disabled) |
| 400    | `INVALID_OP`                                                                               | missing or unsupported operation                    |
| 400    | `INVALID_PARAMS` / `INVALID_LIBRARY_ID` / `INVALID_PATH` / `INVALID_PARENT` / `NOT_A_FILE` | bad request                                         |
| 400    | `INVALID_RECID` / `INVALID_COLLECTION_ID`                                                  | bad INSPIRE/collection identifier                   |
| 404    | `ITEM_NOT_FOUND` / `FILE_NOT_FOUND` / `INSPIRE_RECORD_NOT_FOUND`                           | target item, file or INSPIRE record does not exist  |
| 502    | `INSPIRE_LOOKUP_FAILED`                                                                    | the INSPIRE record could not be fetched             |
| 503    | `LIBRARY_UNAVAILABLE`                                                                      | the Zotero library index could not be read          |
| 413    | `RESPONSE_TOO_LARGE`                                                                       | response would exceed the 1 MiB JSON limit          |
| 500    | `INTERNAL_ERROR`                                                                           | unexpected failure                                  |

## Consumers / dependency note

This endpoint is consumed by the
**[nullius](https://github.com/fkguo/nullius) `zotero-mcp` package** (and by
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
