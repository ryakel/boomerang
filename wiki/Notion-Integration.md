# Notion Integration Architecture

**Last updated:** 2026-05-23 (Stage 3 hybrid migration)

This page is the single source of truth for how Boomerang talks to Notion. **Update this page every time you change Notion code.** CLAUDE.md references this page — don't duplicate the routing table there.

---

## Auth Model

**Dual-path.** MCP for most operations, REST API for structured reads and block-level writes.

| Path | Auth mechanism | What it covers |
|---|---|---|
| **MCP** | OAuth 2.0 + PKCE + DCR to `mcp.notion.com/mcp` | Search, create/update pages, create database, archive |
| **REST** | `NOTION_INTEGRATION_TOKEN` env var | Database queries, block reads, content updates, file uploads |

**The MCP OAuth token does NOT work as a REST `Authorization: Bearer` token.** MCP tokens work for MCP protocol calls to `mcp.notion.com` but get 401 from `api.notion.com`. This was learned the hard way on 2026-05-23 after multiple failed deploys assumed they were interchangeable.

---

## Operation Routing Table

**Update this table when changing ANY Notion code path.**

| Operation | Path | Why this path over the other |
|---|---|---|
| **Search pages** | MCP `notion-search` | Works well, returns JSON. No REST advantage. |
| **Create database** | MCP `notion-create-database` | Custom tool accepts SQL DDL — much cleaner than raw API property schema objects. |
| **Create page** | MCP `notion-create-pages` | Maps to `POST /v1/pages`. Properties are Notion API objects, children are string array. |
| **Create page in DB** | MCP `notion-create-pages` | Same tool, parent is `{ database_id }` instead of `{ page_id }`. |
| **Update page props** | MCP `notion-update-page` | Maps to `PATCH /v1/pages/{id}`. Properties + archived only — NO children/content. |
| **Archive/restore** | MCP `notion-update-page` | `{ page_id, archived: true/false }` |
| **Get page** | REST first, MCP fallback | REST returns structured JSON properties. MCP `notion-fetch` is fallback if no REST token. |
| **Get child pages** | REST first, MCP fallback | REST `GET /v1/blocks/{id}/children` gives structured block objects with `child_page` type. |
| **Get block content** | REST first, MCP fallback | REST returns structured blocks with `rich_text` arrays → clean plaintext conversion. |
| **Query database** | REST first, MCP fallback | REST `POST /v1/databases/{id}/query` returns paginated rows with full properties. No MCP query tool with filter/sort exists. |
| **Get database** | REST first, MCP fallback | REST returns clean JSON with `archived` flag. |
| **Update page content** | **REST only** | MCP `patch-page` doesn't take children. REST uses delete-blocks + append-blocks pattern. |
| **File uploads** | **REST only** | `POST /v1/file_uploads` + send. No MCP equivalent exists in the 14 available tools. |
| **Append blocks** | **REST only** | `PATCH /v1/blocks/{id}/children`. Used for file attachments. |
| **Connection status** | MCP `getStatus()` | No network call — checks `clientConnected` flag in memory. |

---

## MCP Tool Names → API Operations

Derived from the OpenAPI spec at `@notionhq/notion-mcp-server/scripts/notion-openapi.json`.

| MCP Tool | API Operation | Custom? | Notes |
|---|---|---|---|
| `notion-search` | `POST /v1/search` | No | `{ query }` param |
| `notion-fetch` | multiple GETs | **Yes** | Bundles page/block/database fetches via `resource_uri` param |
| `notion-create-pages` | `POST /v1/pages` | No | `{ parent, properties, children? }` — properties are Notion API objects |
| `notion-update-page` | `PATCH /v1/pages/{id}` | No | `{ page_id, properties?, archived? }` — NO children support |
| `notion-create-database` | `POST /v1/data_sources` | **Yes** | Accepts `{ parent, title, schema }` where schema is SQL DDL |
| `notion-update-data-source` | `PATCH /v1/data_sources/{id}` | No | |
| `notion-move-pages` | `POST /v1/pages/{id}/move` | No | |
| `notion-create-comment` | `POST /v1/comments` | No | |
| `notion-get-comments` | `GET /v1/comments` | No | |
| `notion-get-users` | `GET /v1/users` | No | |
| `notion-duplicate-page` | — | **Yes** | Not in OpenAPI spec |
| `notion-create-view` | — | **Yes** | Not in OpenAPI spec |
| `notion-update-view` | — | **Yes** | Not in OpenAPI spec |
| `notion-get-teams` | — | **Yes** | Not in OpenAPI spec |

---

## Implementation Files

| File | Role |
|---|---|
| `notionMCPProxy.js` | Hybrid proxy — MCP calls for mutations, REST for reads. Every call tagged `[Notion:MCP]` or `[Notion:REST]` in logs. |
| `notionMCP.js` | MCP client, OAuth provider, tool cache, auto-reconnect with `prepareTokenRequest()` for refresh. |
| `knowledgeSync.js` | KB CRUD — delegates to proxy, no direct `token` param. |
| `adviserToolsKnowledge.js` | Quokka KB tools — delegates to knowledgeSync. |
| `adviserToolsIntegrations.js` | Quokka Notion tools (query, create, update page) — delegates to proxy. |
| `server.js` | REST endpoints for file uploads + block append. All other `/api/notion/*` routes through proxy. |

---

## Server Endpoints

| Endpoint | Backend | Purpose |
|---|---|---|
| `POST /api/notion/search` | MCP | Search pages |
| `GET /api/notion/pages/:id` | REST→MCP | Get page by ID |
| `POST /api/notion/pages` | MCP | Create page |
| `PATCH /api/notion/pages/:id` | MCP (props) + REST (content) | Update page |
| `GET /api/notion/status` | MCP | Connection status |
| `GET /api/notion/blocks/:id` | REST→MCP | Read page content |
| `GET /api/notion/children/:id` | REST→MCP | List child pages |
| `POST /api/notion/databases/:id/query` | REST→MCP | Query database |
| `POST /api/notion/file-uploads` | REST only | Create file upload |
| `POST /api/notion/file-uploads/:id/send` | REST only | Send file data |
| `POST /api/notion/blocks/:id/children` | REST only | Append blocks (file attachments) |
| `POST /api/notion/mcp/connect` | MCP | Start OAuth + DCR flow |
| `GET /api/notion/mcp/callback` | MCP | OAuth callback |
| `GET /api/notion/mcp/status` | MCP | MCP health |
| `GET /api/notion/mcp/tools` | MCP | List tools + inputSchema |
| `POST /api/notion/mcp/disconnect` | MCP | Clear tokens |

---

## OpenAPI Spec Reference

The source of truth for MCP tool schemas is the Notion OpenAPI spec bundled in the `@notionhq/notion-mcp-server` npm package:

```bash
npm pack @notionhq/notion-mcp-server && tar xzf notionhq-notion-mcp-server-*.tgz
# Spec at: package/scripts/notion-openapi.json
```

**Key schemas verified against the spec (2026-05-23):**

### `post-page` (notion-create-pages)
```json
{
  "parent": { "page_id": "uuid" } | { "database_id": "uuid" },   // required
  "properties": { /* Notion API property-value objects */ },        // required
  "children": ["string", "string"],                                 // optional, enhanced markdown lines
}
```

### `patch-page` (notion-update-page)
```json
{
  "page_id": "uuid",          // path param, required
  "properties": { /* ... */ }, // optional
  "archived": true/false,     // optional
  "in_trash": true/false       // optional
}
```
**Does NOT support `children` — content updates require block-level REST calls.**

### `create-a-data-source` (notion-create-database)
The hosted MCP server wraps this as a custom tool accepting SQL DDL:
```json
{
  "parent": { "page_id": "uuid" },
  "title": "Database Name",
  "schema": "CREATE TABLE (\"Name\" TITLE, \"Type\" SELECT('A':blue, 'B':green))"
}
```

---

## Known Limitations

1. **No MCP database query tool.** The 14 tools include `notion-fetch` but no `query-data-source`. Filtered/sorted queries require REST.
2. **No MCP content update.** `patch-page` doesn't accept children. Body updates require REST delete-blocks + append-blocks.
3. **No MCP file upload.** File uploads require REST `POST /v1/file_uploads`.
4. **`notion-fetch` response format is unverified.** The hosted server may return enhanced markdown instead of JSON. Code tries JSON parse first.
5. **MCP token ≠ REST token.** Never use `notion_mcp_tokens.access_token` as a Bearer token for `api.notion.com`.
