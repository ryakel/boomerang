---
name: notion-dev
description: Rules for writing or changing any Notion integration code (MCP or REST) in Boomerang. Load before touching notionMCP.js, notionMCPProxy.js, knowledgeSync.js, adviserToolsKnowledge.js, adviserToolsIntegrations.js, or any /api/notion route.
---

# Notion development rules

Born of repeated guess-ship-fail cycles. The full operation-routing table and endpoint reference: `wiki/Notion-Integration.md` (keep it in sync with any change); implementation notes: `wiki/Claude-Notes-Integrations.md`.

## The spec is the source of truth

1. Never write Notion MCP code without referencing the actual OpenAPI spec. It ships in the `@notionhq/notion-mcp-server` npm package at `scripts/notion-openapi.json`: `npm pack @notionhq/notion-mcp-server && tar xzf notionhq-notion-mcp-server-*.tgz`. Do not guess parameter names, types, or formats.
2. The hosted server at mcp.notion.com may add custom tools and response formats beyond the open-source package (e.g. SQL DDL for `notion-create-database`). When in doubt, log the full `inputSchema` from the tool cache before calling.
3. Tool input schemas come from the OpenAPI spec (converter: `openapi/parser.ts`). Path params (like `page_id`) become top-level tool params; complex nested objects get wrapped with `anyOf: [schema, {type: 'string'}]` for double-serialization safety.
4. Responses from the hosted server are JSON (the proxy `JSON.stringify`s), but may be formatted differently (enhanced markdown). Always try `JSON.parse` first, fall back to text parsing.
5. Before shipping: extract the spec, read the schema for the operation, match names and types exactly.

## The two auth paths are independent

- **MCP**: OAuth 2.0 + PKCE + DCR to `https://mcp.notion.com/mcp`. The MCP OAuth token does NOT work as a REST `Authorization: Bearer` token (401 from api.notion.com).
- **REST**: `NOTION_INTEGRATION_TOKEN` env var, per-page Connection sharing required. Used for file uploads, block-level writes, and as the *primary* path for structured reads (get page, query database, block children) when configured.
- Everywhere REST is primary, it's gated on the token being set — a fresh install with only the MCP connection must transparently degrade to the MCP fallback. Both paths have to keep working.
- `check_integrations` probes them as two separate rows (`notionMCP.getStatus()` vs `restTokenStatus()` → `GET /v1/users/me`, no MCP fallback) — keep that split so a rotated REST key is tested on its own path.

## Routing summary

MCP for search/create/update-props/archive; REST-first (MCP fallback) for get page/children/blocks/database reads; REST-only for file uploads, block append, and full content replacement (`updatePageContent()` = delete blocks + append). Update the routing table in `wiki/Notion-Integration.md` whenever this changes. Rate limit: ~400ms between REST calls.
