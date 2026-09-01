# External INSPIRE BibTeX API (`/connector/zinspireBibtex`)

zotero-inspire exposes a versioned, read-only HTTP endpoint on Zotero's built-in
Connector server for trusted local clients such as `zotero-cite`. Given one or
more citation keys (normally selected through Better BibTeX CAYW), the endpoint
locates the corresponding Zotero items across the personal and group libraries,
tries to retrieve BibTeX from INSPIRE-HEP, and rewrites each BibTeX entry key to
the requested citation key. The endpoint trusts only the INSPIRE recid stored by
zotero-inspire as `archive = "INSPIRE"` plus a numeric `archiveLocation`; it
does not use DOI, arXiv, URL, or Extra to discover an INSPIRE record. A narrowly
gated Better BibTeX export of the same matched item is available only when that
canonical recid is absent or its direct INSPIRE request returns `404`. Provider
and field provenance are reported for every successful result.

The API is supported on Zotero 7 through 10. Clients should probe `op: "ping"`
instead of inferring availability from the plugin version. A `404` for the path
means that the endpoint is not registered (for example, because the plugin is
disabled or the installed build predates this API).

## Endpoint and authentication

```text
POST http://127.0.0.1:23119/connector/zinspireBibtex
Content-Type: application/json
x-zinspire-read-token: <read-token>
zotero-allowed-request: true
```

The request body must be a JSON object containing an `op` field. No other host,
path, method, or content type is part of this contract.

The read token is stored in the dedicated preference
`extensions.zotero.inspiremeta.external_read_token`. It is generated when the
plugin starts. A trusted local client can obtain it either by reading the active
Zotero profile's `prefs.js`, or from Zotero's JavaScript environment:

```js
Zotero.ZoteroInspire.getExternalReadToken();
```

This token is deliberately separate from the write API token in
`extensions.zotero.inspiremeta.external_token`. Clients **must not** reuse the
write token or send it in `x-zinspire-read-token`. A missing or incorrect read
token returns `403 FORBIDDEN`; failure to initialize the dedicated read token
returns `503 TOKEN_UNAVAILABLE`. Tokens outside the secure 43-character
base64url format are not accepted and are rotated when a Web Crypto CSPRNG is
available.

## Versioning and forward compatibility

`api_version` is the string `"1"`. Within version 1, response objects may gain
fields and enum members. Clients should ignore unknown fields, branch on the
documented `code` values rather than the human-readable `error` text, and reject
an unsupported `api_version`.

## Probe: `ping`

`ping` performs no Zotero or INSPIRE lookup.

Request:

```json
{ "op": "ping" }
```

Response (`200`):

```json
{
  "ok": true,
  "op": "ping",
  "api_version": "1",
  "addon": "zotero-inspire",
  "addon_id": "zoteroinspire@itp.ac.cn",
  "plugin_version": "3.x.y",
  "capabilities": {
    "operations": ["ping", "fetch"],
    "resolver_priority": ["better-bibtex-key-manager", "zotero-fields"],
    "provider_priority": ["INSPIRE-HEP", "Better BibTeX"],
    "fallback_provider": "Better BibTeX",
    "entry_key_rewrite": true,
    "partial_results": true
  },
  "limits": {
    "max_citation_keys": 20,
    "max_citation_key_length": 200,
    "better_bibtex_ready_timeout_ms": 2000,
    "better_bibtex_export_timeout_ms": 5000,
    "better_bibtex_export_concurrency": 1,
    "network_timeout_ms": 10000,
    "network_concurrency": 4,
    "max_recid_field_length": 64,
    "max_bibtex_entry_bytes": 131072,
    "max_merged_bibtex_bytes": 393216,
    "max_response_bytes": 1048576
  },
  "security": {
    "read_only": true,
    "connector_loopback": true,
    "unsafe_web_content_allowed": false,
    "auth_header": "x-zinspire-read-token"
  }
}
```

`max_citation_key_length` counts UTF-16 code units, matching JavaScript
`String.length`. The byte limits are UTF-8 sizes. `network_timeout_ms` is the
total INSPIRE network budget for one item, including time waiting for a network
slot. At most `network_concurrency` item lookup pipelines run concurrently
across all endpoint requests. `better_bibtex_export_timeout_ms` is the total
Better BibTeX fallback budget for one item, including time waiting for its
global export slot; at most `better_bibtex_export_concurrency` fallback export
runs across all endpoint requests. The limits advertised by `ping` are
authoritative for the running plugin and should be preferred over copied
constants. `max_recid_field_length` bounds the raw `archive` and
`archiveLocation` values read for the canonical recid pair.

## Fetch BibTeX: `fetch`

Request:

```json
{
  "op": "fetch",
  "citation_keys": ["Smith:2024abc", "Doe:2025xyz"]
}
```

### Citation-key validation

`citation_keys` must contain 1 to 20 unique strings. Each key:

- is matched exactly and is preserved as supplied;
- is at most 200 UTF-16 code units long;
- contains no whitespace or control character;
- contains no backslash; and
- contains none of the BibTeX/Better BibTeX unsafe characters `"`, `#`, `%`,
  `'`, `(`, `)`, `,`, `=`, `{`, `}`, or `~`.

The server does not trim, normalize, or case-fold citation keys. An invalid
array rejects the whole request; it is not treated as a per-item failure.

### Citation-key resolution

Resolution includes every accessible personal or group library, but only
regular, non-deleted, non-feed items. Attachments, notes, annotations, and feed
items are excluded.

The server waits up to 2 seconds for Better BibTeX readiness. If the Better
BibTeX KeyManager adapter is ready and callable, `KeyManager.all` is the sole
authoritative index for that request. Native Zotero and Extra values are not
unioned into those results, because stale fields could otherwise create false
ambiguities.

Only when the Better BibTeX adapter is unavailable does the server fall back to
Zotero fields: the native `citationKey` field on Zotero 8 and later, plus the
Extra citation-key forms used by Zotero 7. The Extra fallback recognizes the
Better BibTeX-compatible `Citation Key`, `Citation-Key`, `CitationKey`, and
`BibTeX` labels; if more than one supported label occurs in one item, the last
one wins. When a Zotero 8+ native-field query succeeds, native matches are
authoritative: an Extra value may corroborate the same item but an Extra-only,
potentially stale key cannot create a match.

The response reports the resolver used for the complete batch:

```json
{
  "source": "better-bibtex-key-manager",
  "coverage": "complete"
}
```

or:

```json
{
  "source": "zotero-fields",
  "coverage": "complete"
}
```

`resolver.source` is `better-bibtex-key-manager` or `zotero-fields`.
`resolver.coverage` is `complete` or `degraded`. A successful Better BibTeX
KeyManager query provides complete CAYW coverage. When Better BibTeX is not
installed, a successfully queried native Zotero 8+ `citationKey` field also
provides complete native-key coverage. If Better BibTeX is installed but its
adapter is unavailable, the native field is not treated as complete because
read-only-library keys may exist only in Better BibTeX's shadow index. An
unavailable or structurally incompatible adapter, a missing native field, and
Zotero 7 field fallback are therefore reported as `degraded`. With degraded
coverage, zero or one visible field candidate cannot establish a
unique cross-library match and returns `CITATION_KEY_LOOKUP_UNAVAILABLE`; a
visible candidate is included in `candidates`. Two or more visible candidates
are sufficient to return `CITATION_KEY_AMBIGUOUS`.

With complete coverage, exactly one matching item is required. Zero matches
produce `CITATION_KEY_NOT_FOUND`; two or more matches across or within libraries
produce `CITATION_KEY_AMBIGUOUS`. Ambiguity always fails closed: the server
never chooses the first match.

### INSPIRE lookup, narrow Better BibTeX fallback, and entry-key rewrite

After locating one Zotero item, the endpoint recognizes exactly one canonical
INSPIRE identity written by zotero-inspire: `archive = "INSPIRE"` together with
a nonzero numeric `archiveLocation` recid. With this pair, it makes one direct
BibTeX request by recid. It does not inspect DOI, arXiv, URL, or Extra for record
discovery. The response records `archiveLocation` as the local lookup field.
The requested citation key is **never** used to search INSPIRE: it is used only
to locate the Zotero item and as the final BibTeX entry key.

INSPIRE-HEP always has first priority. The server exports the same uniquely
matched item through Better BibTeX only in either of these cases:

- the item has no canonical recid pair, reported as
  `source.fallback_reason: "INSPIRE_RECID_MISSING"`; or
- the direct request for that recid returns `404`, reported as
  `source.fallback_reason: "INSPIRE_RECORD_NOT_FOUND"`.

If `archive` claims `INSPIRE` but `archiveLocation` is nonempty and malformed,
the item fails closed rather than being treated as absent. Better BibTeX is also
not used after HTTP `400`, `429`, or `5xx`, a network failure, timeout, malformed
or oversized BibTeX, unavailable bounded-I/O support, or a recid/resource-limit
failure. These rules prevent a transient or internally inconsistent INSPIRE
failure from being silently presented as a genuine absence.

Both providers must produce exactly one recognizable BibTeX data entry within
the advertised per-entry byte limit. The server safely replaces that entry's
key with the requested citation key; it does not claim to be a complete BibTeX
parser. `bibtex.original_entry_key` records the selected provider's key,
`bibtex.entry_key` is the requested and final key, and
`bibtex.entry_key_rewritten` says whether the two differed. Other BibTeX fields
are never combined across providers.

### Accepted-batch response

A syntactically valid `fetch` request returns HTTP `200` even when some or all
items fail. Results remain in input order, and one item's failure does not stop
the rest of the batch.

```json
{
  "ok": false,
  "op": "fetch",
  "outcome": "partial",
  "api_version": "1",
  "resolver": {
    "source": "better-bibtex-key-manager",
    "coverage": "complete"
  },
  "summary": {
    "requested": 2,
    "succeeded": 1,
    "failed": 1
  },
  "results": [
    {
      "citation_key": "Smith:2024abc",
      "status": "ok",
      "item": {
        "library_id": 1,
        "library_type": "user",
        "library_name": "My Library",
        "zotero_item_key": "ABCD1234",
        "citation_key_sources": ["better-bibtex-key-manager"]
      },
      "source": {
        "provider": "INSPIRE-HEP",
        "record_id": "1234567",
        "url": "https://inspirehep.net/api/literature/1234567?format=bibtex",
        "lookup": {
          "type": "inspire-record-id",
          "value": "1234567",
          "local_field": "archiveLocation"
        }
      },
      "bibtex": {
        "text": "@article{Smith:2024abc,\n  author = {Smith, A.},\n  title = {Example}\n}",
        "original_entry_key": "Smith:2024inspire",
        "entry_key": "Smith:2024abc",
        "entry_key_rewritten": true
      },
      "field_provenance": {
        "citation_key": "request",
        "item": "zotero-item",
        "source.lookup": "zotero-item",
        "source.record_id": "zotero-item",
        "bibtex.original_entry_key": "INSPIRE-HEP",
        "bibtex.entry_key": "request",
        "bibtex.text_except_entry_key": "INSPIRE-HEP"
      },
      "fields_from_inspire": [
        "bibtex.original_entry_key",
        "bibtex.text_except_entry_key"
      ],
      "fields_from_better_bibtex": []
    },
    {
      "citation_key": "Doe:2025xyz",
      "status": "error",
      "code": "CITATION_KEY_NOT_FOUND",
      "error": "No regular, non-deleted Zotero item has this citation key"
    }
  ],
  "bibtex": "@article{Smith:2024abc,\n  author = {Smith, A.},\n  title = {Example}\n}"
}
```

For the Better BibTeX fallback branch, a successful result uses this provider
and provenance shape (the enclosing batch fields are unchanged):

```json
{
  "citation_key": "LocalOnly:2026abc",
  "status": "ok",
  "item": {
    "library_id": 1,
    "library_type": "user",
    "library_name": "My Library",
    "zotero_item_key": "EFGH5678",
    "citation_key_sources": ["better-bibtex-key-manager"]
  },
  "source": {
    "provider": "Better BibTeX",
    "fallback_reason": "INSPIRE_RECID_MISSING",
    "lookup": {
      "type": "better-bibtex-export",
      "value": "EFGH5678",
      "local_field": "zotero-item"
    }
  },
  "bibtex": {
    "text": "@article{LocalOnly:2026abc,\n  author = {Local, A.},\n  title = {Example}\n}",
    "original_entry_key": "Local:2026generated",
    "entry_key": "LocalOnly:2026abc",
    "entry_key_rewritten": true
  },
  "field_provenance": {
    "citation_key": "request",
    "item": "zotero-item",
    "source.lookup": "zotero-item",
    "source.fallback_reason": "zotero-inspire",
    "bibtex.original_entry_key": "Better BibTeX",
    "bibtex.entry_key": "request",
    "bibtex.text_except_entry_key": "Better BibTeX"
  },
  "fields_from_inspire": [],
  "fields_from_better_bibtex": [
    "bibtex.original_entry_key",
    "bibtex.text_except_entry_key"
  ]
}
```

Top-level fields have these semantics:

| Field      | Meaning                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ok`       | `true` only when every requested item succeeds                                                                                |
| `outcome`  | `ok` if all succeed, `partial` if some succeed, `error` if none succeed                                                       |
| `resolver` | The one citation-key resolver and its coverage for this request                                                               |
| `summary`  | Counts for the accepted input; `requested = succeeded + failed`                                                               |
| `results`  | One discriminated result per input key, in the same order                                                                     |
| `bibtex`   | Successful, rewritten `bibtex.text` values joined in input order with exactly two newline characters; empty when none succeed |

A successful result has the following stable shape:

- `citation_key`: the requested key.
- `status`: `"ok"`.
- `item`: the matched Zotero library and item identity.
  `citation_key_sources` contains `better-bibtex-key-manager`, `zotero-native`,
  or `zotero-extra`. When KeyManager is authoritative it is the only source.
- `source.provider`: `"INSPIRE-HEP"` or `"Better BibTeX"`; clients must branch
  on this field rather than assume where the BibTeX came from.
- For `INSPIRE-HEP`, `source.record_id` is the recid from `archiveLocation` and
  `source.url` is the actual API URL used to retrieve its BibTeX.
  `source.lookup.type` is always `inspire-record-id`,
  `source.lookup.value` is that recid, and `source.lookup.local_field` is always
  `archiveLocation`.
- For `Better BibTeX`, `source.lookup.type` is `better-bibtex-export`, its
  `value` is the matched Zotero item key, and `local_field` is `zotero-item`.
  `source.fallback_reason` is `INSPIRE_RECID_MISSING` or
  `INSPIRE_RECORD_NOT_FOUND`. This branch has no `record_id` or INSPIRE URL.
- `bibtex.text`: the selected provider's BibTeX after entry-key rewriting.
- `field_provenance`: the exact origin of each mixed-source result component.
  `citation_key` and `bibtex.entry_key` come from `request`; `item` and
  `source.lookup` come from `zotero-item`; and the original entry key and all
  BibTeX text other than the rewritten key come from the named provider.
  For an INSPIRE result, `source.record_id` is always `zotero-item`. For a
  fallback result, `source.fallback_reason` comes from `zotero-inspire`'s
  routing decision.
- `fields_from_inspire`: the `field_provenance` keys whose value is
  `INSPIRE-HEP`. For an INSPIRE result it contains
  `bibtex.original_entry_key` and `bibtex.text_except_entry_key`.
- `fields_from_better_bibtex`: the `field_provenance` keys whose value is
  `Better BibTeX`. For a fallback result it contains
  `bibtex.original_entry_key` and `bibtex.text_except_entry_key`.
  `fields_from_inspire` and `fields_from_better_bibtex` are both always present;
  the inactive provider's array is empty, and the rewritten entry key is in
  neither array.

An error result always contains `citation_key`, `status: "error"`, `code`, and a
human-readable `error`. When known, it may also contain the matched `item`, the
provider `source`, `attempted_lookups`, or `candidates`.
`attempted_lookups` contains at most the one canonical recid lookup descriptor.
`candidates` is an array of the same library/item identity objects used by the
success `item` field. For example, an ambiguity result can be presented without
discarding either candidate:

```json
{
  "citation_key": "Duplicate:2024key",
  "status": "error",
  "code": "CITATION_KEY_AMBIGUOUS",
  "error": "The citation key identifies more than one Zotero item",
  "candidates": [
    {
      "library_id": 1,
      "library_type": "user",
      "library_name": "My Library",
      "zotero_item_key": "ABCD1234",
      "citation_key_sources": ["zotero-native"]
    },
    {
      "library_id": 12,
      "library_type": "group",
      "library_name": "Collaboration",
      "zotero_item_key": "WXYZ5678",
      "citation_key_sources": ["zotero-native"]
    }
  ]
}
```

## Errors

### Request-level errors

Request-level failures return a non-2xx status and do not constitute an accepted
batch. The body has at least this shape; some errors also include a
machine-readable `details` object:

```json
{
  "ok": false,
  "api_version": "1",
  "code": "INVALID_REQUEST",
  "error": "Human-readable diagnostic"
}
```

| HTTP | `code`                   | Meaning                                                                                            |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| 400  | `INVALID_REQUEST`        | The body delivered to the endpoint is not a JSON object, or `op` is missing/blank                  |
| 400  | `INVALID_OP`             | A non-empty `op` is unsupported                                                                    |
| 400  | `INVALID_CITATION_KEYS`  | Missing/non-array/empty key list, non-string key, or a key violating the character or length rules |
| 400  | `TOO_MANY_CITATION_KEYS` | More than 20 keys                                                                                  |
| 400  | `DUPLICATE_CITATION_KEY` | Duplicate key in one request                                                                       |
| 403  | `FORBIDDEN`              | Missing or incorrect dedicated read token                                                          |
| 503  | `TOKEN_UNAVAILABLE`      | The plugin could not initialize its dedicated read token                                           |
| 413  | `RESPONSE_TOO_LARGE`     | The serialized response cannot be returned within the 1 MiB absolute limit                         |
| 500  | `INTERNAL_ERROR`         | Unexpected endpoint failure                                                                        |

Connector-server rejection can happen before the endpoint runs, so it need not
use this JSON shape. In particular, syntactically malformed JSON, web-origin
requests, and requests to an unregistered endpoint may be rejected by Zotero
outside the accepted API response contract.

### Per-item errors

These codes appear in a `status: "error"` result inside an accepted HTTP `200`
batch:

| `code`                               | Meaning                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `CITATION_KEY_NOT_FOUND`             | An authoritative citation-key lookup found no eligible Zotero item                                                  |
| `CITATION_KEY_AMBIGUOUS`             | More than one eligible item matched; `candidates` identifies them                                                   |
| `CITATION_KEY_LOOKUP_UNAVAILABLE`    | The authoritative Better BibTeX index was unavailable and degraded fallback could not establish a unique match      |
| `INSPIRE_RECID_FIELD_TOO_LARGE`      | `archive` or `archiveLocation` exceeds the 64-code-unit read limit; no network request was started                  |
| `INSPIRE_RECID_READ_ERROR`           | A canonical recid field could not be read safely; absence is not inferred and fallback is not attempted             |
| `INSPIRE_RECID_INVALID`              | `archive` claims INSPIRE but its nonempty `archiveLocation` is not a valid nonzero numeric recid                    |
| `INSPIRE_ABORT_UNAVAILABLE`          | The runtime cannot cancel a bounded INSPIRE request, so no network request was started                              |
| `INSPIRE_TIMEOUT`                    | The item's total INSPIRE network budget expired                                                                     |
| `INSPIRE_NETWORK_UNAVAILABLE`        | New INSPIRE work is blocked while an earlier operation or response cleanup is still running                         |
| `INSPIRE_RATE_LIMITED`               | INSPIRE returned HTTP 429; the caller may retry the item later                                                      |
| `INSPIRE_HTTP_ERROR`                 | INSPIRE returned another non-success HTTP response                                                                  |
| `INSPIRE_NETWORK_ERROR`              | DNS, connection, TLS, or another network failure prevented a response                                               |
| `INSPIRE_RESPONSE_LIMIT_UNAVAILABLE` | The runtime cannot enforce the configured response-byte limit; unbounded fallback reading is refused                |
| `INSPIRE_BIBTEX_TOO_LARGE`           | One BibTeX entry exceeds 128 KiB                                                                                    |
| `INSPIRE_BIBTEX_INVALID`             | BibTeX is empty, invalid UTF-8, lacks exactly one recognizable data-entry header, or cannot be rewritten safely     |
| `BETTER_BIBTEX_FALLBACK_UNAVAILABLE` | The narrow fallback was eligible, but a usable Better BibTeX exporter or translator was unavailable                 |
| `BETTER_BIBTEX_FALLBACK_TIMEOUT`     | The 5-second Better BibTeX budget, including its global export-slot wait, expired                                   |
| `BETTER_BIBTEX_FALLBACK_TOO_LARGE`   | The single Better BibTeX export exceeds 128 KiB                                                                     |
| `BETTER_BIBTEX_FALLBACK_INVALID`     | Better BibTeX returned empty output, multiple entries, or an entry whose key could not be rewritten safely          |
| `BETTER_BIBTEX_FALLBACK_ERROR`       | Better BibTeX failed while exporting the matched item                                                               |
| `RESPONSE_LIMIT_EXCEEDED`            | Including this otherwise valid item would exceed the 384 KiB merged-BibTeX budget                                   |
| `INTERNAL_ERROR`                     | An unexpected per-item failure occurred; unlike request-level `INTERNAL_ERROR`, the accepted batch remains HTTP 200 |

`INSPIRE_RECID_MISSING` and `INSPIRE_RECORD_NOT_FOUND` are successful
fallback reasons, not final error codes, when Better BibTeX can produce a valid
entry. A failure of the eligible fallback is reported with the corresponding
`BETTER_BIBTEX_FALLBACK_*` code while retaining the matched `item`.
Because Better BibTeX export has no reliable cancellation API, an active export
that exceeds the deadline opens a fail-closed circuit: queued attempts and new
fallback attempts return `BETTER_BIBTEX_FALLBACK_UNAVAILABLE` without starting
another export. The circuit closes and resets only after the original export
settles, preventing repeated requests from accumulating unbounded orphan work.
INSPIRE network work has the same fail-closed resource guarantee: if an
operation or response-body cancellation outlives the request that initiated it,
queued and new lookups return `INSPIRE_NETWORK_UNAVAILABLE`. The network circuit
closes only after every retained operation and cleanup settles.

## Size and partial-failure rules

- A single accepted BibTeX entry from either provider is limited to 128 KiB and
  must contain exactly one recognizable data entry.
- The top-level merged `bibtex` is limited to 384 KiB.
- The final serialized JSON response is limited to 1 MiB.
- An oversized entry fails only that item when a bounded response can still be
  produced. A response that cannot itself fit the absolute limit is rejected as
  request-level `413 RESPONSE_TOO_LARGE`.
- INSPIRE response bodies are consumed only through a bounded streaming reader.
  A runtime without that capability fails the item instead of buffering the
  entire response first.
- INSPIRE bytes must be valid UTF-8. Apart from replacing the single BibTeX
  entry key, the response text, including a leading UTF-8 BOM and leading or
  trailing whitespace, is preserved.
- Successful entries are merged in input order with `"\n\n"`. Failed entries
  contribute no text and leave no placeholder.

## Security and read-only boundary

- The endpoint is registered only on Zotero's loopback Connector server and is
  intended for trusted native clients on the same machine.
- It accepts only authenticated JSON `POST` requests. Keep the read token out of
  logs and do not expose it to browser content. New read tokens require a Web
  Crypto CSPRNG; token initialization fails closed when none is available.
- Unsafe web content remains blocked by Zotero's Connector-server origin checks;
  the endpoint does not enable `allowRequestsFromUnsafeWebContent` and is not a
  browser-facing CORS API.
- zotero-inspire request handling does not create, update, move, trash, or erase
  Zotero items, collections, tags, attachments, or preferences. Startup
  initialization of the dedicated read-token preference is separate from
  request handling.
- The only remote bibliographic service contacted by the endpoint is
  INSPIRE-HEP. It does not accept a caller-supplied URL. Better BibTeX fallback
  export is local and receives exactly the same one item already selected by
  the citation-key resolver.
- Better BibTeX is a separate extension and may maintain its own internal caches
  as part of a normal export; this API does not promise that Better BibTeX's
  internal state is immutable.

Possession of the read token grants access to the matched items' library
identity and returned bibliography. It is an authentication secret even though
the endpoint cannot mutate Zotero data.

## Client integration guidance

A `zotero-cite` client can use the API as follows:

1. Obtain one or more citation keys from Better BibTeX CAYW.
2. Probe `ping`, require `api_version: "1"`, and honor the advertised limits.
3. De-duplicate keys without changing their spelling or order, then submit one
   `fetch` request.
4. Treat HTTP `200` as an accepted batch, not as proof that every item succeeded.
   Check `outcome`, `summary`, and every `results` member.
5. Insert only successful `citation_key` values into LaTeX. Write either each
   successful `bibtex.text` or the top-level merged `bibtex` to the bibliography.
   In both cases the entry key is guaranteed to equal the requested citation key.
   Inspect `source.provider` and the two `fields_from_*` arrays when provenance
   matters.
6. Surface per-item failures to the user. In particular, do not silently choose
   an ambiguous candidate or independently invoke a broader Better BibTeX
   fallback after a network, protocol, recid-validation, or resource-limit
   failure.

## Verification scope

The automated coverage for this API uses mocked module integration tests. Those
tests exercise validation, resolution, INSPIRE outcomes, guarded Better BibTeX
fallback, entry-key rewriting, limits, and batch semantics without claiming to
exercise a live Zotero server, live INSPIRE service, or installed Better BibTeX
translator. Before relying on a new build, perform an installed-Zotero smoke
test of Connector endpoint registration, loopback delivery, required headers,
token authentication, Better BibTeX integration, and rejection of unsafe web
origins.

## Source

- Implementation: `src/modules/inspireBibtexApi.ts`
- Connector endpoint: `src/modules/connectorInspireBibtexApi.ts`
- Registration: `src/hooks.ts`
- Tests: `test/connectorInspireBibtexApi.test.ts`,
  `test/externalToken.test.ts`
