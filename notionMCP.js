// Notion MCP client.
//
// Connects Boomerang to Notion's hosted MCP server at https://mcp.notion.com/mcp.
// Uses OAuth 2.0 with PKCE + Dynamic Client Registration — no pre-registered
// Notion integration required. The user OAuths into their own Notion workspace;
// Boomerang receives a user-scoped access token valid for the entire workspace.
//
// Persistence lives in app_data via the injected getData/setData helpers:
//   - notion_mcp_client  — DCR-issued client_id/secret (OAuthClientInformationFull)
//   - notion_mcp_tokens  — access_token / refresh_token / expires_in (OAuthTokens)
//   - notion_mcp_pkce    — transient PKCE state for an in-flight auth handshake

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { registerTool, getTool } from './adviserTools.js'

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'
const CLIENT_KEY = 'notion_mcp_client'
const TOKENS_KEY = 'notion_mcp_tokens'
const PKCE_KEY = 'notion_mcp_pkce'

let deps = null
let provider = null
let transport = null
let client = null
let clientConnected = false
let toolCache = null // [{ name, description, inputSchema }, ...]

// --- Provider ---

class NotionMCPProvider {
  constructor() {
    this._redirectUrl = null
    this._pendingRedirect = null // captured URL during an in-flight auth attempt
  }

  setRedirectUrl(url) { this._redirectUrl = url }
  takePendingRedirect() { const v = this._pendingRedirect; this._pendingRedirect = null; return v }

  get redirectUrl() { return this._redirectUrl }

  get clientMetadata() {
    return {
      client_name: 'Boomerang',
      redirect_uris: this._redirectUrl ? [this._redirectUrl] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read write',
    }
  }

  clientInformation() {
    return deps.getData(CLIENT_KEY) || undefined
  }

  async saveClientInformation(info) {
    deps.setData(CLIENT_KEY, info)
  }

  tokens() {
    return deps.getData(TOKENS_KEY) || undefined
  }

  async saveTokens(t) {
    // Stamp saved_at so the resolver in server.js can compute staleness.
    deps.setData(TOKENS_KEY, { ...t, saved_at: Date.now() })
  }

  async redirectToAuthorization(url) {
    this._pendingRedirect = url.toString()
  }

  async saveCodeVerifier(verifier) {
    const prev = deps.getData(PKCE_KEY) || {}
    deps.setData(PKCE_KEY, { ...prev, code_verifier: verifier })
  }

  async codeVerifier() {
    return deps.getData(PKCE_KEY)?.code_verifier || ''
  }

  async invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') deps.setData(TOKENS_KEY, null)
    if (scope === 'all' || scope === 'client') deps.setData(CLIENT_KEY, null)
    if (scope === 'all' || scope === 'verifier') deps.setData(PKCE_KEY, null)
    if (scope === 'all') {
      clientConnected = false
      toolCache = null
    }
  }
}

// --- Transport + client singletons ---

function makeTransport() {
  return new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), { authProvider: provider })
}

async function ensureClient() {
  if (!client) client = new Client({ name: 'boomerang', version: '1.0.0' })
  if (!transport) transport = makeTransport()
  if (clientConnected) return client
  try {
    await client.connect(transport)
    clientConnected = true
    return client
  } catch (err) {
    // UnauthorizedError or network — caller handles
    throw err
  }
}

async function refreshToolCache() {
  if (!clientConnected) return []
  const res = await client.listTools()
  toolCache = res.tools || []
  try { registerMCPToolsInQuokka(toolCache) } catch (e) { console.warn('[NotionMCP] tool registration failed:', e?.message) }
  return toolCache
}

// Dynamically register each MCP tool into Quokka's registry.
// Stage 2: read-only tools only (no Stage-3-caliber compensation for writes yet).
// Names collide-safe via `notion_mcp_` prefix and per-name existence check.
function registerMCPToolsInQuokka(toolList) {
  let registered = 0
  for (const tool of toolList) {
    const readOnly = tool.annotations?.readOnlyHint === true
    if (!readOnly) continue // skip writes — those still go through REST-backed tools

    const quokkaName = `notion_mcp_${tool.name.replace(/[^a-zA-Z0-9_]/g, '_')}`
    if (getTool(quokkaName)) continue // already registered on a prior connect

    registerTool({
      name: quokkaName,
      description: `[Notion MCP] ${tool.description || tool.name}`,
      readOnly: true,
      schema: tool.inputSchema || { type: 'object', properties: {} },
      execute: async (args) => {
        const res = await callTool(tool.name, args)
        return { result: extractMCPContent(res) }
      },
    })
    registered++
  }
  if (registered > 0) console.log(`[NotionMCP] Registered ${registered} read-only MCP tools in Quokka`)
  return registered
}

// Normalize MCP tool result content into a Quokka-friendly shape.
// MCP returns { content: [{ type: 'text' | 'resource' | ..., text?, resource? }, ...], isError? }
function extractMCPContent(mcpResult) {
  if (mcpResult?.isError) {
    const errText = (mcpResult.content || []).map(c => c.text || '').join('\n')
    throw new Error(errText || 'MCP tool returned an error')
  }
  const parts = mcpResult?.content || []
  // Prefer single JSON payload if model returned one; else concat text content
  const textParts = parts.filter(p => p.type === 'text').map(p => p.text).filter(Boolean)
  if (textParts.length === 1) {
    try { return JSON.parse(textParts[0]) } catch { return textParts[0] }
  }
  if (textParts.length > 1) return textParts.join('\n')
  // Fall back to raw structured content
  return mcpResult?.structuredContent || parts
}

// --- Public API ---

export function initNotionMCP(injectedDeps) {
  deps = injectedDeps // { getData, setData }
  provider = new NotionMCPProvider()
  client = new Client({ name: 'boomerang', version: '1.0.0' })
  transport = makeTransport()
}

export async function autoReconnect() {
  if (!deps?.getData(TOKENS_KEY)) return false
  try {
    await ensureClient()
    await refreshToolCache()
    return true
  } catch (err) {
    console.warn('[NotionMCP] auto-reconnect failed:', err?.message || err)
    return false
  }
}

export async function startAuth(redirectBase) {
  provider.setRedirectUrl(`${redirectBase}/api/notion/mcp/callback`)
  // Reset connection state so a fresh auth attempt runs
  clientConnected = false
  transport = makeTransport()
  client = new Client({ name: 'boomerang', version: '1.0.0' })
  try {
    await client.connect(transport)
    clientConnected = true
    await refreshToolCache()
    return { alreadyAuthorized: true }
  } catch {
    const url = provider.takePendingRedirect()
    if (!url) throw new Error('Auth flow did not produce a redirect URL')
    return { authUrl: url }
  }
}

export async function finishAuth(code) {
  if (!transport) throw new Error('No pending auth flow')
  await transport.finishAuth(code)
  clientConnected = false
  client = new Client({ name: 'boomerang', version: '1.0.0' })
  transport = makeTransport()
  await ensureClient()
  await refreshToolCache()
  // PKCE done, clear transient state
  deps.setData(PKCE_KEY, null)
}

export function getStatus() {
  const tokens = deps?.getData(TOKENS_KEY)
  return {
    connected: clientConnected && !!tokens,
    hasTokens: !!tokens,
    toolCount: toolCache?.length || 0,
  }
}

export async function disconnect() {
  try {
    if (transport?.close) await transport.close().catch(() => {})
  } catch { /* no-op */ }
  deps.setData(TOKENS_KEY, null)
  deps.setData(CLIENT_KEY, null)
  deps.setData(PKCE_KEY, null)
  clientConnected = false
  toolCache = null
  client = new Client({ name: 'boomerang', version: '1.0.0' })
  transport = makeTransport()
}

export function getCachedTools() {
  return toolCache || []
}

export async function callTool(name, args) {
  if (!clientConnected) {
    // Attempt a lazy reconnect before failing — tokens may still be valid
    const ok = await autoReconnect()
    if (!ok) throw new Error('Notion MCP not connected. Ask the user to connect in Settings → Integrations → Notion.')
  }
  return client.callTool({ name, arguments: args || {} })
}

export async function listTools() {
  if (!clientConnected) {
    const ok = await autoReconnect()
    if (!ok) return []
  }
  return refreshToolCache()
}
