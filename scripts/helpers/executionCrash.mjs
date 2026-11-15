import { writeFileSync } from 'node:fs'
import { installNetworkFence } from './quokkaNetworkFence.mjs'
const fence = installNetworkFence()
await fence.verify()
const { initDb } = await import('../../server/db.js')
const engine = await import('../../server/adviserTools.js')
await initDb(process.argv[2])
engine.registerTool({
  name: 'synthetic_crash',
  execute() {
    writeFileSync(process.argv[3], 'effect happened')
    process.kill(process.pid, 'SIGKILL')
  },
})
const id = engine.newSession({ chatId: 'synthetic-chat' })
await engine.handleToolCall(id, 'synthetic_crash', {}, {})
writeFileSync(process.argv[4], JSON.stringify({ sessionId: id, ...engine.getPlanApproval(id) }))
await engine.commitPlan(id, {})
