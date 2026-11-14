// Fresh process, not a second cached import. Never starts the application server.
import { installNetworkFence } from './quokkaNetworkFence.mjs'
const fence = installNetworkFence()
await fence.verify()
const { initDb, getAllTasks, getData, flushNow } = await import('../../server/db.js')
const { getSession, commitPlan } = await import('../../server/adviserTools.js')
const connection = await initDb(process.argv[2])
const sessionId = process.argv[3]
const result = {
  tasks: getAllTasks(),
  chats: getData('adviser_chats'),
  hasSession: !!getSession(sessionId),
  commit: await commitPlan(sessionId, {}, 'f'.repeat(64)),
  blocked: fence.blocked,
}
flushNow()
connection.close()
console.log(`P1_RESULT=${JSON.stringify(result)}`)
