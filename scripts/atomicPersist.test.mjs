import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { atomicPersist } from '../server/atomicPersist.js'

for (const failure of ['fsyncSync', 'renameSync', null]) {
  test(`atomic export: ${failure || 'success'} preserves a complete readable file`, t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'boom-export-'))
    const file = join(directory, 'synthetic.db')
    fs.writeFileSync(file, 'old complete snapshot')
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    if (failure) {
      const mock = t.mock.method(fs, failure, () => { throw new Error('injected storage failure') })
      syncBuiltinESMExports()
      try {
        assert.throws(() => atomicPersist(file, Buffer.from('new complete snapshot')), /injected/)
        assert.equal(fs.readFileSync(file, 'utf8'), 'old complete snapshot')
      } finally { mock.mock.restore(); syncBuiltinESMExports() }
    } else {
      atomicPersist(file, Buffer.from('new complete snapshot'))
      assert.equal(fs.readFileSync(file, 'utf8'), 'new complete snapshot')
    }
    assert.equal(fs.existsSync(`${file}.tmp`), false)
  })
}
