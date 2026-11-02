import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)))
export const skillAssets = path.join(root, 'gold')
export const tmp = path.join(root, 'tmp')

process.env.NODE_PATH = [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
Module.Module._initPaths()

const require = createRequire(import.meta.url)

export const Corestore = require('corestore')
export const Hyperswarm = require('hyperswarm')
export const createTestnet = require('hyperdht/testnet')
export const { openRoom } = require(path.join(skillAssets, 'room.cjs'))
export const { createVault, pairVault } = require(path.join(skillAssets, 'vault.cjs'))

export function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function waitUntil (fn, ms, label) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(40)
  }
  throw new Error(label + (last ? ': ' + last.message : ''))
}

export async function readJson (file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

let tmpSeq = 0

// Session files carry invites and room keys. Write a private temp file in the
// same directory, then rename it over the target so a reader never sees a
// half-written document. chmod ignores umask; writeFile's mode does not.
export async function writeJson (file, data, opts = {}) {
  const mode = opts.mode ?? 0o600
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmpFile = `${file}.${process.pid}.${++tmpSeq}.tmp`
  try {
    await writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', { mode, flag: 'wx' })
    await chmod(tmpFile, mode)
    await rename(tmpFile, file)
  } catch (err) {
    await unlink(tmpFile).catch(() => {})
    throw err
  }
}

// Two processes share one session file. The lock is the file itself, not a
// memory queue, and the token stops a finished writer from deleting a lock
// a later writer already took over.
export async function withFileLock (lockPath, fn, { timeoutMs = 20000, staleMs = 5000 } = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const token = randomBytes(8).toString('hex')
  const t0 = Date.now()
  while (true) {
    let fh
    try {
      fh = await open(lockPath, 'wx', 0o600)
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err
      if (Date.now() - t0 > timeoutMs) throw new Error('session file lock timed out')
      try {
        const st = await stat(lockPath)
        if (Date.now() - st.mtimeMs > staleMs) await unlink(lockPath)
      } catch {}
      await sleep(20)
      continue
    }
    try {
      await fh.chmod(0o600)
      await fh.writeFile(token)
      return await fn()
    } finally {
      await fh.close()
      try {
        if (await readFile(lockPath, 'utf8') === token) await unlink(lockPath)
      } catch {}
    }
  }
}

export async function patchJson (file, patch) {
  return withFileLock(file + '.lock', async () => {
    const cur = await readJson(file)
    const next = { ...cur, ...patch }
    if (Array.isArray(patch.seenIds)) {
      const prior = Array.isArray(cur.seenIds) ? cur.seenIds : []
      next.seenIds = [...new Set([...prior, ...patch.seenIds])]
    }
    await writeJson(file, next)
    return next
  })
}

// Promise.race leaves the loser rejection unhandled, and an uncleared
// timeout fires after the caller has already moved on. Both sides are caught
// here. cancel() is for the path that fails before anyone awaits the result.
export function raceTimeout (promise, ms, label) {
  let timer
  let settled = false
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms)
  })
  const quiet = (p) => p.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  )
  const raced = new Promise((resolve, reject) => {
    const take = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result.ok) resolve(result.value)
      else reject(result.error)
    }
    quiet(promise).then(take)
    quiet(timeout).then(take)
  })
  raced.catch(() => {})
  raced.cancel = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
  }
  return raced
}

export function flag (argv, name) {
  return argv.includes(name)
}

export function option (argv, name) {
  const i = argv.indexOf(name)
  if (i === -1 || !argv[i + 1] || argv[i + 1].startsWith('--')) return null
  return argv[i + 1]
}

export function mute (socket) {
  socket.on('error', () => {})
  return socket
}
