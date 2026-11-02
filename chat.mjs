#!/usr/bin/env node
/**
 * Two terminals, one room.
 *   node chat.mjs              host, local testnet, writes tmp/chat-session.json
 *   node chat.mjs join         second process, same machine
 *   node chat.mjs --public     host on the public DHT
 *   node chat.mjs join <hex> --public
 *   --send "text"              send one line and leave (used to check the lab)
 *   --until "text"             host exits after it sees that line
 */
import readline from 'node:readline'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import {
  Corestore,
  Hyperswarm,
  createTestnet,
  openRoom,
  tmp,
  sleep,
  waitUntil,
  readJson,
  writeJson,
  patchJson,
  flag,
  option,
  mute
} from './lib.mjs'

const argv = process.argv.slice(2)
const isJoin = argv[0] === 'join'
const pub = flag(argv, '--public')
const sendOnce = option(argv, '--send')
const untilText = option(argv, '--until')
const sessionPath = path.join(tmp, 'chat-session.json')
const storeDir = path.join(tmp, isJoin ? 'chat-b' : 'chat-a')

let testnet = null
let swarm = null
let store = null
let room = null
let closed = false
let sessionChain = Promise.resolve()
const sentIds = new Set()

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  if (isJoin) await join()
  else await host()
} catch (err) {
  console.error(err.message || err)
  await shutdown(1)
}

async function host () {
  let bootstrap
  if (pub) {
    console.log('Public DHT. Same laptop often fails to hairpin. Two computers is the interesting try.')
    bootstrap = undefined
  } else {
    console.log('Starting a local testnet so both terminals on this machine can find each other.')
    testnet = await createTestnet(3)
    bootstrap = testnet.bootstrap
  }

  await rm(storeDir, { recursive: true, force: true })
  store = new Corestore(storeDir)
  swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (socket) => mute(socket))
  room = await openRoom(store, swarm)
  await writeJson(sessionPath, {
    public: pub,
    bootstrap: pub ? null : bootstrap,
    room: room.keyHex(),
    writer: null,
    seen: null,
    seenIds: []
  })

  console.log('Room key')
  console.log(room.keyHex())
  console.log(pub
    ? 'Other machine: npm run chat -- join ' + room.keyHex() + ' --public'
    : 'Other terminal, this machine: npm run chat -- join')
  console.log('Waiting for their writer key. Type whenever. Ctrl+C stops.')

  watch()
  admitWhenReady().catch(async (err) => {
    if (closed) return
    console.error(err.message || err)
    await shutdown(1)
  })
  if (sendOnce) await sendAndMaybeLeave(sendOnce)
  else if (untilText) await new Promise(() => {})
  else await repl()
}

async function join () {
  const keyArg = argv.find((a, i) => i > 0 && !a.startsWith('--') && a !== sendOnce && a !== untilText)
  let session
  if (pub) {
    if (!keyArg) throw new Error('public join needs the room key: npm run chat -- join <hex> --public')
    session = { public: true, bootstrap: null, room: keyArg }
  } else {
    session = await waitUntil(async () => {
      try { return await readJson(sessionPath) } catch { return null }
    }, 20000, 'no chat session yet — start the other terminal first')
  }

  await rm(storeDir, { recursive: true, force: true })
  store = new Corestore(storeDir)
  swarm = new Hyperswarm(session.bootstrap ? { bootstrap: session.bootstrap } : {})
  swarm.on('connection', (socket) => mute(socket))
  room = await openRoom(store, swarm, { bootstrapKey: session.room })

  if (!pub) {
    await patchSession({ writer: room.writerHex() })
  } else {
    console.log('Your writer key (the host has to admit this before you can write):')
    console.log(room.writerHex())
    console.log('On the host, this lab auto-admits only on the local testnet.')
    console.log('Public mode: paste that key is a later experiment. This join still replicates what they already wrote.')
  }

  console.log('Joined', session.room.slice(0, 16) + '…')
  watch()

  if (!pub) {
    await waitForPeer()
    await waitUntil(async () => {
      await room.base.update()
      return room.base.writable
    }, 20000, 'host never admitted this writer')
    console.log('Admitted. You can write.')
  }

  if (sendOnce) await sendAndMaybeLeave(sendOnce)
  else await repl()
}

async function admitWhenReady () {
  if (pub) return
  const writer = await waitUntil(async () => {
    try {
      const s = await readJson(sessionPath)
      return s.writer || null
    } catch {
      return null
    }
  }, 120000, 'nobody joined')
  if (closed) return
  await waitForPeer()
  if (closed) return
  console.log('Admitting writer', writer.slice(0, 16) + '…')
  await room.admit(writer)
}

async function waitForPeer () {
  const discovery = swarm.join(room.base.discoveryKey, { server: true, client: true })
  const t0 = Date.now()
  while (!closed && swarm.connections.size === 0 && Date.now() - t0 < 30000) {
    try {
      await discovery.refresh({ server: true, client: true })
    } catch (err) {
      if (!closed) console.error('still looking for the other terminal:', err.message)
    }
    if (swarm.connections.size > 0) break
    await sleep(250)
  }
  if (closed) return
  if (swarm.connections.size === 0) {
    throw new Error('no swarm connection. Start the other terminal in this folder, without --public.')
  }
  console.log('Peer connected.')
}

async function patchSession (patch) {
  const run = sessionChain.then(() => patchJson(sessionPath, patch))
  sessionChain = run.then(() => {}, () => {})
  return run
}

function watch () {
  const seen = new Set()
  ;(async () => {
    while (!closed) {
      try {
        await room.base.update()
        for (const value of await readMessages(room)) {
          if (!value || seen.has(value.id)) continue
          if (!isJoin && !pub && value.id && !sentIds.has(value.id)) {
            await patchSession({ seen: value.text, seenIds: [value.id] })
          }
          seen.add(value.id)
          console.log('> ' + value.text)
          if (untilText && value.text === untilText) {
            await shutdown(0)
            return
          }
        }
      } catch (err) {
        if (!closed) console.error('watch', err.message)
      }
      await sleep(200)
    }
  })()
}

async function repl () {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.setPrompt('')
  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue
    if (isJoin && !room.base.writable) {
      console.log(pub
        ? 'Not a writer yet. Public mode does not auto-admit; the host has to add this writer key.'
        : 'Not a writer yet.')
      continue
    }
    await sendLine(text)
  }
}

async function sendLine (text) {
  const id = randomBytes(16).toString('hex')
  sentIds.add(id)
  await room.send(text, id)
  return id
}

async function sendAndMaybeLeave (text) {
  if (isJoin && !room.base.writable) {
    if (pub) {
      throw new Error('Not a writer yet. Public mode does not auto-admit; the host has to add this writer key.')
    }
    await waitUntil(async () => room.base.writable, 20000, 'not writable')
  }
  const id = await sendLine(text)
  await waitUntil(async () => {
    await room.base.update()
    const values = await readMessages(room)
    return values.some((value) => value && value.id === id)
  }, 15000, 'sent line never showed up in the view')
  if (!untilText && !pub && isJoin) {
    await waitUntil(async () => {
      try {
        const session = await readJson(sessionPath)
        return Array.isArray(session.seenIds) && session.seenIds.includes(id)
      } catch { return false }
    }, 20000, 'the other terminal never showed the line')
  }
  if (!untilText) await shutdown(0)
}

async function readMessages (room) {
  const stream = room.base.view.createReadStream({ gte: 'msg/', lt: 'msg0' })
  const values = []
  let settled = false
  const timer = setTimeout(() => {
    if (!settled) stream.destroy()
  }, 1500)
  try {
    for await (const entry of stream) {
      if (entry && entry.value) values.push(entry.value)
    }
  } catch (err) {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !settled) throw err
  } finally {
    settled = true
    clearTimeout(timer)
  }
  return values
}

async function shutdown (code) {
  if (closed) return
  closed = true
  try { if (swarm) await swarm.destroy() } catch {}
  try { if (room) await room.base.close() } catch {}
  try { if (store) await store.close() } catch {}
  try { if (testnet) await testnet.destroy() } catch {}
  await new Promise((resolve) => {
    let pending = 2
    const done = () => { if (--pending === 0) resolve() }
    process.stdout.write('', done)
    process.stderr.write('', done)
  })
  process.exit(code)
}
