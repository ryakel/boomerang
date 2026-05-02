# Security Notes

Boomerang is built for **single-user self-hosted deployment**. The threat model is "your own machine, your own data, your own network." This document is honest about what that means for credential handling — read it before deciding whether the app fits your situation.

## Credential Storage: How It Actually Works

### Where secrets live

| Secret | Server (`/data/boomerang.db`) | Browser `localStorage` | Env var |
|---|---|---|---|
| Anthropic API key | plaintext in `app_data.settings` | plaintext | optional `ANTHROPIC_API_KEY` |
| Notion integration token | plaintext in `app_data.settings` | plaintext | optional `NOTION_INTEGRATION_TOKEN` |
| Trello API key + token | plaintext in `app_data.settings` | plaintext | optional `TRELLO_API_KEY` / `TRELLO_SECRET` |
| Google Calendar Client ID/Secret | plaintext in `app_data.settings` | plaintext | optional `GOOGLE_CLIENT_*` |
| 17track API key | plaintext in `app_data.settings` | plaintext | optional `TRACKING_API_KEY` |
| **Pushover User Key + App Token** | plaintext in `app_data.settings` | plaintext | optional `PUSHOVER_DEFAULT_APP_TOKEN` (token only) |
| GCal **OAuth refresh tokens** | plaintext in `app_data.gcal_tokens` | not stored | — |
| Gmail **OAuth refresh tokens** | plaintext in `app_data.gmail_tokens` | not stored | — |
| Notion MCP **OAuth tokens** | plaintext in `app_data.notion_mcp_tokens` | not stored | — |
| **VAPID private key** (web push) | plaintext in `app_data.vapid_keys` | not stored | optional `VAPID_PRIVATE_KEY` |
| **SMTP credentials** | not stored | not stored | env-only by design |
| Web push subscriptions (p256dh + auth) | plaintext in `push_subscriptions` table | not stored | — |

### What's protective

- **OAuth refresh tokens are server-only.** GCal, Gmail, and Notion MCP tokens never round-trip to the browser. The client only knows whether the connection is live, not the token value.
- **SMTP credentials are env-only.** `SMTP_USER`, `SMTP_PASS`, etc. are read from environment variables on startup and never persisted to the database. They're not in the settings blob and not exposed via any API.
- **Quokka secret blocklist.** The AI adviser cannot read or write `anthropic_api_key`, `notion_token`, `trello_api_key`, `trello_secret`, `gcal_client_secret`, `tracking_api_key`, `pushover_user_key`, or `pushover_app_token` via the `update_settings` tool. The `get_settings` tool returns them redacted as `***redacted***`. So even if a malicious prompt fooled the model, it can't exfiltrate keys through the adviser surface.
- **HTTPS in transit.** Assumed if you're running behind a reverse proxy with TLS (Cloudflare Tunnel, Caddy, nginx + Let's Encrypt). Without HTTPS, every page load ships your settings in plaintext.

### What's NOT protective

- **No encryption at rest.** The SQLite database file at `/data/boomerang.db` is plaintext. Anyone who can read the file can read every API key. Same for Docker volume backups.
- **No master-key separation.** Settings are one flat JSON blob in `app_data.settings`. Secrets and toggles share the same row.
- **localStorage is XSS-readable.** Most user-entered keys (Anthropic, Notion, Trello, GCal Client Secret, 17track, Pushover) are also cached client-side in `localStorage` so the React app can send them as request headers. Any JavaScript running in the same browser origin can read them. If an attacker manages to inject script into the app (e.g. via a malicious browser extension, a same-origin RCE, or supply-chain attack on a dependency), they get every key.
- **No audit log of secret access.** The DB doesn't track who/what read which setting. Quokka mutations show up in the standard sync history but secrets aren't separately audited.

### Threat model assumptions

This level of protection is **acceptable** for the documented threat model:

> Boomerang is a single-user, self-hosted ADHD task manager. The user controls the machine, the network, the browser, the Docker host, and physical access to the storage volume. The threat model is one trusted user defending against external network attackers, not multiple users defending against each other.

Under that model, an attacker who can read your `boomerang.db` file already has shell access to your home server / VPS — which means they have your `~/.aws/credentials`, your SSH keys, and your browser cookies anyway. Adding SQLCipher or HashiCorp Vault to Boomerang would not meaningfully improve the security posture of someone in that situation.

This level of protection is **NOT acceptable** if you're using Boomerang outside the documented threat model:

- **Multi-tenant deployments.** If you're hosting Boomerang for multiple users behind a single instance, every user's keys are visible to every other user with DB access. Don't do this without major rework.
- **Untrusted networks.** If you're running Boomerang on a shared server you don't fully control (e.g. shared hosting, a friend's box, a SaaS platform's PaaS), assume your keys can be read by anyone with shell access there.
- **Sensitive backups.** When you copy `boomerang.db` to a backup location, you're copying every API key. Treat the backup file as sensitive — encrypt it, don't sync it to a plaintext cloud folder, don't email it.
- **Browser extension exposure.** A compromised browser extension on your Boomerang origin can read everything in `localStorage`. Be careful what extensions you install in the browser session you use Boomerang in.

### Practical hygiene

If you're running Boomerang as intended (single-user, self-hosted, your own server), here's what's worth doing:

1. **Run behind HTTPS.** Reverse proxy with TLS. Don't expose port 3001 to the internet over HTTP.
2. **Backup the DB encrypted.** If you're shipping `boomerang.db` to S3 / Backblaze / wherever, encrypt the backup file with `age` or `gpg` first.
3. **Rotate keys you care about periodically.** Anthropic, GCal, etc. all let you regenerate. If you suspect localStorage or the volume was exposed, rotate.
4. **Don't commit `.env` files.** They're already gitignored, but worth re-checking. The `.env.example` shows the shape; the real `.env` should never leave your server.
5. **Use the env-var path for the keys you can.** `ANTHROPIC_API_KEY`, `NOTION_INTEGRATION_TOKEN`, etc. set in env make those keys server-only — they don't get cached in the browser. (The Settings UI hides the input field when it detects the env var is set.)
6. **Review browser extensions.** Especially for the browser session you use Boomerang in. A malicious extension is one of the more realistic exfiltration paths.

### Future hardening (not currently planned)

If the threat model ever changes — multi-tenant, untrusted hosting, regulatory pressure — these are the obvious next steps:

- **SQLCipher.** Drop-in encrypted SQLite. Adds an at-rest encryption layer keyed off a passphrase.
- **Server-side keystore.** Move secrets out of `app_data.settings` into a separate `secrets` table that's never serialized to the API. Client never sees raw values; server signs requests on the user's behalf.
- **Per-key access auditing.** Log which code path accessed which secret, with timestamps. Useful for incident response.
- **External keystore.** HashiCorp Vault, AWS Parameter Store, or Doppler-style. Overkill for personal use, expected for SaaS.

None of these are on the roadmap. They're documented here so future-you (or anyone forking the project) knows what would be involved.

---

*If you find a security issue, please open a GitHub issue marked `[security]` or contact the maintainer directly. Boomerang is a personal project — there's no formal disclosure process, but issues will be addressed.*
