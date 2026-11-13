import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'

// Same-volume replacement prevents partial exports from truncating the live DB.
// File fsync + rename is not a claim of directory/power-loss durability.
export function atomicPersist(filePath, bytes) {
  const temporary = `${filePath}.tmp`
  let fd
  try {
    fd = openSync(temporary, 'w', 0o600)
    writeFileSync(fd, bytes)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, filePath)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch { /* rename succeeded or no temp file */ }
  }
}
