#!/usr/bin/env bash
# Wait until the Portainer webhook host actually resolves over the tailnet.
#
# Why this exists (2026-08-31). The deploy step used to curl the webhook the
# instant the Tailscale action returned. But `tailscale up` returning means the
# node is authenticated — NOT that the tailnet resolver has been installed and
# the tailnet-only webhook host can be looked up. Two releases in a row died
# exactly there:
#
#   Triggering Portainer webhook...
#   curl: (6) Could not resolve host: <portainer host>     x4
#   ##[error]Process completed with exit code 6
#
# ...while the connect step above reported outcome=success. Because the old
# retry step was gated on the CONNECT failing, it never engaged for the failure
# that actually happens, and the release shipped an image nothing deployed.
#
# curl's own --retry cannot rescue this: each attempt burns a ~20s resolver
# timeout on a name that is not resolvable *yet*, so the whole budget is spent
# inside the window we should simply be waiting through.
#
# So: poll for resolution, bounded. Success means the next curl has a name to
# work with. Failure is a real signal the caller acts on — it re-runs
# `tailscale up` and probes again, and only then gives up.
#
# The host is derived from the webhook URL, which is a secret. It is never
# echoed: GitHub masks the whole secret string but not a substring of it.
set -uo pipefail

TIMEOUT_SECONDS="${TAILNET_DNS_TIMEOUT:-60}"
INTERVAL_SECONDS=2

if [ -z "${WEBHOOK_URL:-}" ]; then
  echo "PORTAINER_WEBHOOK_URL is not set — nothing to probe."
  exit 1
fi

# scheme://host[:port]/path -> host
host="${WEBHOOK_URL#*://}"
host="${host%%/*}"
host="${host%%\?*}"
host="${host%%:*}"

if [ -z "$host" ]; then
  echo "Could not derive a host from PORTAINER_WEBHOOK_URL."
  exit 1
fi

echo "Waiting up to ${TIMEOUT_SECONDS}s for the Portainer host to resolve over the tailnet..."

deadline=$(( SECONDS + TIMEOUT_SECONDS ))
attempt=0
while [ "$SECONDS" -lt "$deadline" ]; do
  attempt=$(( attempt + 1 ))
  # getent reads nsswitch/resolv.conf — the same path curl takes — so a hit
  # here means curl will resolve it too. Output is discarded so the tailnet
  # address never lands in a public log.
  if getent hosts "$host" >/dev/null 2>&1; then
    echo "Resolved after ${attempt} attempt(s) (~$(( attempt * INTERVAL_SECONDS ))s). Tailnet is usable."
    exit 0
  fi
  sleep "$INTERVAL_SECONDS"
done

echo "Still not resolving after ${TIMEOUT_SECONDS}s."
# Diagnostics for the next person here. `tailscale status` needs no DNS, so it
# distinguishes "tunnel is down" from "tunnel is up but DNS is not".
if command -v tailscale >/dev/null 2>&1; then
  echo "--- tailscale status (peers elided) ---"
  sudo tailscale status --peers=false 2>&1 | head -20 || true
fi
echo "--- /etc/resolv.conf nameservers ---"
grep -E '^nameserver' /etc/resolv.conf 2>/dev/null || echo "(none found)"
exit 1
