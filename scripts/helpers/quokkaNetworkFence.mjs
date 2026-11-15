// Test-only process-wide fence. Install BEFORE dynamically importing app modules.
// No listeners, real HTTP, provider calls, or fallback to the original fetch.
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import assert from 'node:assert/strict'

export function installNetworkFence() {
  const blocked = []
  let handler
  const deny = (kind) => () => {
    blocked.push(kind)
    throw new Error(`P1 network fence: ${kind}`)
  }
  const originals = {
    fetch: globalThis.fetch,
    connect: net.Socket.prototype.connect,
    tls: tls.connect,
    udp: dgram.createSocket,
  }
  net.Socket.prototype.connect = deny('socket')
  tls.connect = deny('tls')
  dgram.createSocket = deny('udp')
  globalThis.fetch = async (url, init) => {
    if (handler) return handler(url, init)
    blocked.push('fetch')
    throw new Error('P1 network fence: fetch')
  }
  return {
    blocked,
    route(fn) { handler = fn },
    async verify() {
      assert.ok(!handler, 'verify isolation before installing simulated routes')
      assert.deepEqual(blocked, [], 'unexpected network attempt before sandbox setup')
      await assert.rejects(globalThis.fetch('https://api.anthropic.com/v1/messages'), /network fence/)
      await assert.rejects(globalThis.fetch('https://api.openai.com/v1/chat/completions'), /network fence/)
      const socket = new net.Socket()
      try { assert.throws(() => socket.connect(443, 'example.invalid'), /network fence/) }
      finally { socket.destroy() }
      assert.throws(() => tls.connect(443, 'example.invalid'), /network fence/)
      assert.throws(() => dgram.createSocket('udp4'), /network fence/)
      assert.deepEqual(blocked.splice(0), ['fetch', 'fetch', 'socket', 'tls', 'udp'])
    },
    restore() {
      globalThis.fetch = originals.fetch
      net.Socket.prototype.connect = originals.connect
      tls.connect = originals.tls
      dgram.createSocket = originals.udp
    },
  }
}
