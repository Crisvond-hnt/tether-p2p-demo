#!/usr/bin/env node
/**
 * One sitting with one friend.
 *   node friends.mjs                         window: start, paste a code, or try both sides here
 *   node friends.mjs join                    the other window on this computer
 *   node friends.mjs join tether1.…          a friend on another computer, or this one
 *   node friends.mjs --ask "Name one ocean." model only, no swarm
 *
 * The window is the demo. --cli keeps the readline desk: /note, /ask, /card, /help.
 * Phrases stay in tmp/friends-a|b/secrets.json. This file never prints them.
 */
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  Corestore,
  Hyperswarm,
  createTestnet,
  openRoom,
  createVault,
  pairVault,
  skillAssets,
  root,
  tmp,
  sleep,
  waitUntil,
  readJson,
  writeJson,
  patchJson,
  raceTimeout,
  option,
  flag,
  mute
} from './lib.mjs'
import { ask, asidePrompt, closeAside, modelReady } from './aside.mjs'
import { openBrowser, serveWindow } from './ui.mjs'

const argv = process.argv.slice(2)
const isJoin = argv[0] === 'join'
const sendOnce = option(argv, '--send')
const noteOnce = option(argv, '--note')
const untilText = option(argv, '--until')
const askOnce = option(argv, '--ask')
const cli = flag(argv, '--cli')
const shareLocal = flag(argv, '--share-local')
const lines = []
let statusText = 'Loading the keys on this machine.'
let ui = null
let friendLaunched = false
let linked = false
let phase = 'live'
let sitting = null
let shareCode = null
let shareJoin = false
let localReady = false
let weightsHere = false
let generation = 0
let beginPromise = null
const identityDir = path.join(tmp, 'identity')
const sessionPath = path.join(tmp, 'friends-session.json')
const home = path.join(tmp, isJoin ? 'friends-b' : 'friends-a')
const require = createRequire(import.meta.url)
const walletUrl = pathToFileURL(path.join(skillAssets, 'wallet.mjs')).href

let testnet = null
let swarm = null
let roomStore = null
let vaultStore = null
let room = null
let pass = null
let pairer = null
let personHex = ''
let address = ''
let lastNote = null
let closed = false
let sessionChain = Promise.resolve()

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  if (askOnce && !isJoin && !untilText && !sendOnce && !noteOnce) {
    await modelOnly(askOnce)
  } else if (shareLocal) {
    await shareLocalHost()
  } else if (isJoin) {
    await join()
  } else if (headless()) {
    await host()
  } else {
    await lobby()
  }
} catch (err) {
  console.error(err.message || err)
  await shutdown(1)
}

async function modelOnly (question) {
  console.log('aside   Qwen3 0.6B, on this machine. No friend, no thread.')
  await runAsk(question, { raw: true, predict: 40 })
  await shutdown(0)
}

async function host () {
  await bootLocalHost()
  if (untilText) await stayOpen()
  else await repl()
}

async function lobby () {
  phase = 'choose'
  const me = await loadMe(identityDir)
  personHex = me.person
  address = me.address
  weightsHere = await weightsCached()
  setStatus('Start a thread, paste a friend’s code, or try both sides on this computer.')
  await showWindow()
  await stayOpen()
}

async function shareLocalHost () {
  console.log('Local testnet. The code carries the room and the vault invite.')
  testnet = await createTestnet(3)
  await rm(path.join(tmp, 'share-lab'), { recursive: true, force: true })
  await startWithFriend({
    bootstrap: testnet.bootstrap,
    dir: path.join(tmp, 'share-lab')
  })
  await writeFile(path.join(tmp, 'share-lab.code'), shareCode + '\n', { mode: 0o600 })
  console.log('code ' + shareCode)
  if (untilText) await stayOpen()
  else await repl()
}

async function begin (body) {
  if (beginPromise) return beginPromise
  if (phase === 'live') throw new Error('This window is already in a thread. Quit and start again to make another.')
  const mode = body && body.mode
  beginPromise = (async () => {
    try {
      if (mode === 'join') await joinWithCode(String((body && body.code) || ''))
      else if (mode === 'here') await startHere()
      else if (mode === 'friend') await startWithFriend()
      else throw new Error('Pick a way to start.')
    } catch (err) {
      beginPromise = null
      await closeNets()
      phase = 'choose'
      sitting = null
      shareCode = null
      localReady = false
      setStatus(err.message || 'Could not start.')
      throw err
    }
  })()
  return beginPromise
}

async function startHere () {
  sitting = 'here'
  phase = 'live'
  setStatus('Starting a private link on this computer.')
  await bootLocalHost({ identityDir })
  localReady = true
  setStatus('Open the other window. A friend on another computer uses a code instead.')
}

async function bootLocalHost ({ identityDir: who = home } = {}) {
  const gen = generation
  console.log('Starting a local testnet so both windows on this machine can find each other.')
  testnet = await createTestnet(3)
  const me = await loadMe(who)
  personHex = me.person
  address = me.address

  await rm(path.join(home, 'room'), { recursive: true, force: true })
  await rm(path.join(home, 'vault'), { recursive: true, force: true })
  roomStore = new Corestore(path.join(home, 'room'))
  vaultStore = new Corestore(path.join(home, 'vault'))
  swarm = new Hyperswarm({ bootstrap: testnet.bootstrap })
  swarm.on('connection', (socket) => mute(socket))
  room = await openRoom(roomStore, swarm)
  pass = await createVault(vaultStore, { bootstrap: testnet.bootstrap })
  const invite = await pass.createInvite()

  await writeJson(sessionPath, {
    bootstrap: testnet.bootstrap,
    room: room.keyHex(),
    writer: null,
    person: null,
    invite,
    note: null,
    seen: null,
    seenIds: []
  })

  printCard()
  setStatus('Waiting for the other window.')
  console.log('thread   waiting for a friend')

  watch()
  admitWhenReady().catch(async (err) => {
    if (closed || generation !== gen) return
    console.error(err.message || err)
    if (ui || !headless()) setStatus(err.message || 'Still waiting for the other window.')
    else await shutdown(1)
  })
}

async function join () {
  const codeArg = argv.find((arg) => typeof arg === 'string' && arg.startsWith('tether1.'))
  if (codeArg) return joinWithCode(codeArg)

  const session = await waitUntil(async () => {
    try { return await readJson(sessionPath) } catch { return null }
  }, 20000, 'no desk yet — start your window first')

  const me = await loadMe(home)
  personHex = me.person
  address = me.address
  printCard()
  setStatus('Joining your window.')

  await rm(path.join(home, 'room'), { recursive: true, force: true })
  await rm(path.join(home, 'vault'), { recursive: true, force: true })
  roomStore = new Corestore(path.join(home, 'room'))
  vaultStore = new Corestore(path.join(home, 'vault'))
  swarm = new Hyperswarm({ bootstrap: session.bootstrap })
  swarm.on('connection', (socket) => mute(socket))
  room = await openRoom(roomStore, swarm, { bootstrapKey: session.room })

  await patchSession({ writer: room.writerHex(), person: personHex })

  pairer = pairVault(vaultStore, session.invite, { bootstrap: session.bootstrap })
  const paired = raceTimeout(pairer.finished(), 45000, 'pair timed out after 45s')
  if (!headless()) await showWindow()

  try {
    console.log('joined   ' + short(session.room))
    watch()
    await waitForPeer()
    await waitUntil(async () => {
      await room.base.update()
      return room.base.writable
    }, 20000, 'the desk never admitted this writer')
    setStatus('Opening the note vault.')
    pass = await paired
    await pass.ready()
    setStatus('You can write.')
    console.log('Admitted. You can write.')

    if (noteOnce) {
      await pass.add('desk-note', noteOnce)
      await waitUntil(async () => {
        try { return (await readJson(sessionPath)).note === noteOnce } catch { return false }
      }, 20000, 'the other terminal never showed the note')
    }
    if (sendOnce) await sendAndLeave(sendOnce)
    else if (untilText) await stayOpen()
    else if (headless()) await repl()
    else await stayOpen()
  } finally {
    paired.cancel()
  }
}

async function admitWhenReady () {
  const gen = generation
  const writer = await waitUntil(async () => {
    try {
      const s = await readJson(sessionPath)
      return s.writer || null
    } catch {
      return null
    }
  }, headless() ? 120000 : 600000, 'nobody joined')
  if (closed || gen !== generation || !room) return
  await waitForPeer()
  if (closed || gen !== generation || !room) return
  const s = await readJson(sessionPath)
  console.log('Admitting writer ' + writer.slice(0, 16) + '…')
  await room.admit(writer)
  setStatus('Friend is in the other window.')
  console.log('friend is here')
  if (s.person) console.log('  person   ' + short(s.person))
}

async function waitForPeer (timeoutMs = 30000) {
  const discovery = swarm.join(room.base.discoveryKey, { server: true, client: true })
  const t0 = Date.now()
  while (!closed && swarm.connections.size === 0 && Date.now() - t0 < timeoutMs) {
    try { await discovery.refresh({ server: true, client: true }) } catch {}
    if (swarm.connections.size > 0) break
    await sleep(250)
  }
  if (closed) return
  if (swarm.connections.size === 0) {
    throw new Error(timeoutMs > 30000
      ? 'No peer yet. Their window has to stay open.'
      : 'no swarm connection')
  }
  linked = true
  publish()
  console.log('Peer connected.')
}

function watch () {
  const seen = new Set()
  const gen = generation
  ;(async () => {
    while (!closed && gen === generation) {
      try {
        if (!room) {
          await sleep(200)
          continue
        }
        await room.base.update()
        for (const value of await readMessages()) {
          if (!value || seen.has(value.id)) continue
          if (!isJoin && sitting !== 'friend' && sitting !== 'join' && value.id && value.person !== personHex) {
            await patchSession({ seen: value.text, seenIds: [value.id] })
          }
          seen.add(value.id)
          const label = value.person === personHex ? 'you' : 'friend'
          lines.push({ id: value.id, who: label, text: value.text })
          publish()
          console.log(label.padEnd(8) + value.text)
          if (untilText && value.text === untilText) {
            await shutdown(0)
            return
          }
        }
        await pollNote()
        const now = !!(swarm && swarm.connections.size > 0)
        if (now !== linked) {
          linked = now
          publish()
        }
      } catch (err) {
        if (!closed) console.error('watch', err.message)
      }
      await sleep(200)
    }
  })()
}

async function pollNote () {
  if (!pass) return
  let got
  try { got = await pass.get('desk-note') } catch { return }
  const value = got && (got.value !== undefined ? got.value : got)
  if (!value || value === lastNote) return
  lastNote = value
  publish()
  console.log('note    ' + value)
  if (!isJoin) await patchSession({ note: value })
}

async function repl () {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  for await (const line of rl) {
    const text = line.trim()
    if (!text || closed) continue
    try {
      if (text.startsWith('/')) await command(text)
      else await say(text)
    } catch (err) {
      if (!closed) console.error(err.message || err)
    }
  }
}

async function command (text) {
  const space = text.indexOf(' ')
  const cmd = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase()
  const arg = space === -1 ? '' : text.slice(space + 1).trim()
  if (cmd === 'help') {
    console.log('type a line to send it')
    console.log('/note text    private note, replicated to the friend')
    console.log('/ask text     local model, this thread only, nothing is sent')
    console.log('/card         person key and address')
    console.log('/quit')
    return
  }
  if (cmd === 'card') return printCard()
  if (cmd === 'quit' || cmd === 'q') return shutdown(0)
  if (cmd === 'note') {
    if (!arg) return console.log('usage: /note the dock at 7')
    if (!pass) return console.log('The note vault is not ready.')
    await pass.add('desk-note', arg)
    return
  }
  if (cmd === 'ask') {
    if (!arg) return console.log('usage: /ask what did they just say')
    return runAsk(arg)
  }
  console.log('Unknown command. /help')
}

async function say (text) {
  const joining = isJoin || sitting === 'join'
  if (joining && !room.base.writable) {
    console.log('Not a writer yet.')
    return null
  }
  const id = randomBytes(16).toString('hex')
  await room.base.append({
    type: 'message',
    id,
    text,
    person: personHex
  })
  await room.base.update()
  return id
}

async function sendAndLeave (text) {
  const id = await say(text)
  if (!id) throw new Error('Not a writer yet.')
  await waitUntil(async () => {
    await room.base.update()
    const values = await readMessages()
    return values.some((value) => value && value.id === id)
  }, 15000, 'sent line never showed up in the view')
  if (!shareJoin) {
    await waitUntil(async () => {
      try {
        const session = await readJson(sessionPath)
        return Array.isArray(session.seenIds) && session.seenIds.includes(id)
      } catch { return false }
    }, 20000, 'the other terminal never showed the line')
  }
  await shutdown(0)
}

async function runAsk (question, { raw = false, predict = 160 } = {}) {
  if (!modelReady()) {
    const cached = await weightsCached()
    const line = cached
      ? 'Qwen3 0.6B Q4, already on this machine'
      : 'Qwen3 0.6B Q4. First run fetches about 382 MB into .qvac/'
    console.log('aside   ' + line)
    if (ui) ui.emit({ type: 'ask-token', text: line + '\n' })
  }
  let lastPct = -1
  const content = raw
    ? question
    : asidePrompt({
      lines: (await readMessages()).map((value) => ({
        who: value.person === personHex ? 'you' : 'friend',
        text: value.text
      })),
      note: lastNote,
      question
    })
  let started = false
  await ask(content, {
    predict,
    onToken: (token) => {
      if (!started) {
        started = true
        process.stdout.write('aside   ')
      }
      process.stdout.write(token)
      if (ui) ui.emit({ type: 'ask-token', text: token })
    },
    onProgress: (p) => {
      const pct = Math.floor((p && p.percentage) || 0)
      if (pct < lastPct + 20) return
      lastPct = pct
      console.error('weights  ' + pct + '%')
    }
  })
  if (!started) process.stdout.write('aside   ')
  process.stdout.write('\n')
  if (ui) ui.emit({ type: 'ask-done' })
}

async function readMessages () {
  const stream = room.base.view.createReadStream({ gte: 'msg/', lt: 'msg0' })
  const values = []
  let settled = false
  const timer = setTimeout(() => { if (!settled) stream.destroy() }, 1500)
  try {
    for await (const entry of stream) {
      if (entry && entry.value) values.push(entry.value)
    }
  } catch (err) {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err
  } finally {
    settled = true
    clearTimeout(timer)
  }
  return values
}

async function loadMe (dir) {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'secrets.json')
  const Identity = require('keet-identity-key')
  const Ctor = Identity.from ? Identity : (Identity.default || Identity)
  let saved = null
  try { saved = JSON.parse(await readFile(file, 'utf8')) } catch { saved = null }
  const { createWallet, ethereumAddress } = await import(walletUrl)
  if (!saved) {
    const identityMnemonic = Ctor.generateMnemonic()
    const created = await createWallet()
    saved = { identityMnemonic, walletSeed: created.seed }
    await writeFile(file, JSON.stringify(saved) + '\n', { mode: 0o600 })
  }
  const id = await Ctor.from({ mnemonic: saved.identityMnemonic })
  const { wdk } = await createWallet({ seed: saved.walletSeed })
  const addr = await ethereumAddress(wdk)
  const raw = id.identityPublicKey
  const person = Buffer.isBuffer(raw) ? raw.toString('hex') : Buffer.from(raw).toString('hex')
  return { person, address: addr }
}

function printCard () {
  console.log('you')
  console.log('  person   ' + short(personHex))
  console.log('  address  ' + address)
}

function short (hex) {
  if (!hex || hex.length < 12) return hex || ''
  return hex.slice(0, 4) + '…' + hex.slice(-4)
}

async function weightsCached () {
  try {
    const names = await readdir(path.join(root, '.qvac'))
    return names.some((name) => name.endsWith('.gguf'))
  } catch {
    return false
  }
}

async function patchSession (patch) {
  const run = sessionChain.then(() => patchJson(sessionPath, patch))
  sessionChain = run.then(() => {}, () => {})
  return run
}

function headless () {
  return cli || sendOnce || noteOnce || untilText || askOnce
}

function setStatus (text) {
  statusText = text
  publish()
}

function snapshot () {
  const joining = isJoin || sitting === 'join'
  const title = sitting === 'friend'
    ? 'Your thread'
    : joining
      ? (isJoin && sitting !== 'join' ? 'The other window' : 'Joined')
      : phase === 'choose'
        ? 'Your keys'
        : 'Your window'
  return {
    phase,
    role: joining ? 'friend' : 'you',
    title,
    person: short(personHex),
    address,
    status: statusText,
    note: lastNote,
    lines,
    pieces: pieceList(),
    share: sitting === 'friend' ? shareCode : null,
    writable: phase === 'choose' ? false : (!joining || !!(room && room.base.writable)),
    canOpenFriend: sitting === 'here' && localReady && !friendLaunched,
    live: linked
  }
}

function pieceList () {
  const onPublic = sitting === 'friend' || sitting === 'join'
  return [
    { name: 'Identity', detail: 'Keet key, kept on this machine', state: personHex ? 'ready' : 'wait' },
    { name: 'Room', detail: 'Hypercore log through Autobase', state: room ? 'ready' : 'wait' },
    { name: 'Link', detail: onPublic ? 'Hyperswarm on the public network' : 'Hyperswarm, this computer only', state: linked ? 'live' : (room ? 'wait' : 'idle') },
    { name: 'Note', detail: onPublic ? 'Autopass vault, opened by the code' : 'Autopass vault on this computer', state: pass ? 'ready' : 'wait' },
    { name: 'Address', detail: 'WDK seed, a different phrase', state: address ? 'ready' : 'wait' },
    { name: 'Model', detail: weightsHere ? 'Qwen3 is already on this machine' : 'Qwen3 downloads here the first time you ask', state: modelReady() ? 'live' : 'idle' }
  ]
}

function publish () {
  if (ui) ui.emit({ type: 'state', state: snapshot() })
}

async function showWindow () {
  const port = isJoin ? 4788 : 4787
  ui = await serveWindow({
    port,
    getSnapshot: async () => snapshot(),
    sendLine: async (text) => {
      if (!text) throw new Error('Write a line first.')
      const id = await say(text)
      if (!id) throw new Error('Not a writer yet. Their window has to stay open until this one can write.')
    },
    saveNote: async (text) => {
      if (!text) throw new Error('Write the note first.')
      if (!pass) throw new Error('The note vault is not ready.')
      await pass.add('desk-note', text)
    },
    askModel: (text) => runAsk(text),
    begin: (body) => begin(body),
    openFriend: async () => {
      if (isJoin) throw new Error('The other window is already this one.')
      if (friendLaunched) return
      friendLaunched = true
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'join'], {
        cwd: root,
        detached: true,
        stdio: 'ignore'
      })
      child.on('error', (err) => {
        friendLaunched = false
        setStatus(err.message || 'The other window did not open.')
      })
      child.unref()
      setStatus('Opening the other window.')
    },
    quit: () => shutdown(0)
  })
  console.log('Window  ' + ui.url)
  openBrowser(ui.url)
}

function stayOpen () {
  return new Promise(() => {})
}

async function startWithFriend ({ bootstrap = null, dir = path.join(tmp, 'with-friend') } = {}) {
  sitting = 'friend'
  phase = 'live'
  if (!personHex) {
    const me = await loadMe(identityDir)
    personHex = me.person
    address = me.address
  }
  setStatus(bootstrap
    ? 'Starting the thread on this computer.'
    : 'Announcing the thread on the public network.')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  roomStore = new Corestore(path.join(dir, 'room'))
  vaultStore = new Corestore(path.join(dir, 'vault'))
  swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (socket) => {
    mute(socket)
    roomStore.replicate(socket)
  })
  room = await openRoom(roomStore, swarm, { attachSwarm: false })
  await announce(swarm, room, bootstrap)
  pass = await createVault(vaultStore, bootstrap ? { bootstrap } : {})
  const invite = await pass.createInvite()
  shareCode = encodeShare({ room: room.keyHex(), invite, bootstrap })
  await writeJson(path.join(dir, 'share.json'), {
    room: room.keyHex(),
    invite,
    bootstrap: bootstrap || null
  })
  printCard()
  console.log('thread   ' + short(room.keyHex()))
  watch()
  admitFromVault()
  setStatus(bootstrap
    ? 'Code is ready.'
    : 'Send this code to one friend. They run npm start and paste it. Both windows stay open.')
}

async function joinWithCode (raw) {
  const heldByLobby = !!ui
  shareJoin = true
  sitting = 'join'
  phase = 'live'
  const parsed = decodeShare(raw)
  const bootstrap = parsed.bootstrap || null
  const remote = !bootstrap
  if (!personHex) {
    const me = await loadMe(identityDir)
    personHex = me.person
    address = me.address
  }
  const dir = path.join(tmp, remote ? 'joined' : 'joined-lab')
  setStatus(remote
    ? 'Looking for your friend on the public network. Their window has to stay open.'
    : 'Joining the thread.')
  if (!ui && !headless()) await showWindow()

  const marker = path.join(dir, 'room-key')
  let previous = ''
  try { previous = (await readFile(marker, 'utf8')).trim() } catch { previous = '' }
  if (previous && previous !== parsed.room) await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  roomStore = new Corestore(path.join(dir, 'room'))
  vaultStore = new Corestore(path.join(dir, 'vault'))
  swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (socket) => {
    mute(socket)
    roomStore.replicate(socket)
  })
  room = await openRoom(roomStore, swarm, { bootstrapKey: parsed.room, attachSwarm: false })
  await announce(swarm, room, bootstrap)

  const vaultOpts = bootstrap ? { bootstrap } : {}
  if (previous === parsed.room) {
    pass = await createVault(vaultStore, vaultOpts)
    await pass.ready()
  } else {
    pairer = pairVault(vaultStore, parsed.invite, vaultOpts)
    const paired = raceTimeout(
      pairer.finished(),
      remote ? 90000 : 45000,
      remote
        ? 'Could not open the note vault. Their window has to stay open.'
        : 'pair timed out after 45s'
    )
    pass = await paired
    await pass.ready()
  }
  await writeFile(marker, parsed.room + '\n', { mode: 0o600 })
  await pass.add('desk-writer', room.writerHex())
  await pass.add('desk-person', personHex)
  printCard()
  watch()
  const timeout = remote ? 90000 : 45000
  try {
    await waitForPeer(timeout)
  } catch (err) {
    if (!remote) throw err
    setStatus(err.message)
  }
  try {
    await waitUntil(async () => {
      if (!room) return false
      await room.base.update()
      return room.base.writable
    }, timeout, remote
      ? 'Still waiting to write. Their window has to stay open.'
      : 'the desk never admitted this writer')
    setStatus('You can write.')
    console.log('Admitted. You can write.')
  } catch (err) {
    if (!remote) throw err
    setStatus(err.message)
  }

  if (noteOnce && pass) await pass.add('desk-note', noteOnce)
  if (sendOnce) await sendAndLeave(sendOnce)
  else if (untilText) await stayOpen()
  else if (headless()) await repl()
  else if (!heldByLobby) await stayOpen()
}

async function announce (group, opened, bootstrap) {
  const discovery = group.join(opened.base.discoveryKey, { server: true, client: true })
  if (bootstrap) {
    await discovery.flushed()
    return
  }
  try {
    await raceTimeout(discovery.flushed(), 20000, 'The public network is still announcing this thread.')
  } catch (err) {
    console.error(err.message || err)
  }
}

function admitFromVault () {
  const gen = generation
  const admitted = new Set()
  ;(async () => {
    while (!closed && gen === generation) {
      try {
        if (pass && room) {
          const writer = unwrap(await pass.get('desk-writer'))
          if (typeof writer === 'string' && /^[0-9a-f]{64}$/i.test(writer) && writer !== room.writerHex() && !admitted.has(writer)) {
            console.log('Admitting writer ' + writer.slice(0, 16) + '…')
            await room.admit(writer)
            admitted.add(writer)
            const person = unwrap(await pass.get('desk-person'))
            if (swarm && swarm.connections.size > 0) linked = true
            setStatus('Your friend can write.' + (typeof person === 'string' && person ? ' Person ' + short(person) + '.' : ''))
          }
        }
      } catch (err) {
        if (!closed && gen === generation) console.error('admit', err.message || err)
      }
      await sleep(400)
    }
  })()
}

async function closeNets () {
  generation++
  const paired = pairer
  pairer = null
  try { if (pass && pass.close) await pass.close() } catch {}
  pass = null
  try { if (swarm) await swarm.destroy() } catch {}
  swarm = null
  try { if (room && room.base) await room.base.close() } catch {}
  room = null
  try { if (roomStore) await roomStore.close() } catch {}
  roomStore = null
  try { if (paired) await paired.close() } catch {}
  try { if (vaultStore) await vaultStore.close() } catch {}
  vaultStore = null
  try { if (testnet) await testnet.destroy() } catch {}
  testnet = null
  linked = false
}

function encodeShare (payload) {
  const body = { room: payload.room, invite: payload.invite }
  if (payload.bootstrap) body.bootstrap = payload.bootstrap
  return 'tether1.' + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
}

function decodeShare (raw) {
  const compact = String(raw || '').trim().replace(/\s+/g, '')
  if (!compact.startsWith('tether1.')) throw new Error('Paste the whole code. It starts with tether1.')
  let data
  try {
    data = JSON.parse(Buffer.from(compact.slice('tether1.'.length), 'base64url').toString('utf8'))
  } catch {
    throw new Error('That code could not be read. Paste it again.')
  }
  if (!data || typeof data.room !== 'string' || !/^[0-9a-f]{64}$/i.test(data.room) || typeof data.invite !== 'string' || !data.invite) {
    throw new Error('That code is not a Tether P2P invite.')
  }
  return data
}

function unwrap (got) {
  if (got == null) return null
  if (typeof got === 'string') return got
  return typeof got === 'object' && got.value !== undefined ? got.value : null
}

async function shutdown (code) {
  if (closed) return
  closed = true
  try { if (ui) ui.close() } catch {}
  try { await closeAside() } catch {}
  try { if (pairer) await pairer.close() } catch {}
  try { if (pass && pass.close) await pass.close() } catch {}
  try { if (swarm) await swarm.destroy() } catch {}
  try { if (room) await room.base.close() } catch {}
  try { if (roomStore) await roomStore.close() } catch {}
  try { if (vaultStore) await vaultStore.close() } catch {}
  try { if (testnet) await testnet.destroy() } catch {}
  await new Promise((resolve) => {
    let pending = 2
    const done = () => { if (--pending === 0) resolve() }
    process.stdout.write('', done)
    process.stderr.write('', done)
  })
  process.exit(code)
}
