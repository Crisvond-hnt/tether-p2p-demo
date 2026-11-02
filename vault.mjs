#!/usr/bin/env node
/**
 * PearPass-shaped, not PearPass.
 *   node vault.mjs                 create invite, leave a note, stay up
 *   node vault.mjs join            other process pairs and prints the note
 *   --until-paired                 host exits once the note was read
 */
import path from 'node:path'
import { rm } from 'node:fs/promises'
import {
  Corestore,
  createTestnet,
  createVault,
  pairVault,
  tmp,
  waitUntil,
  readJson,
  writeJson,
  patchJson,
  raceTimeout,
  flag
} from './lib.mjs'

const argv = process.argv.slice(2)
const isJoin = argv[0] === 'join'
const untilPaired = flag(argv, '--until-paired')
const sessionPath = path.join(tmp, 'vault-session.json')
const storeDir = path.join(tmp, isJoin ? 'vault-b' : 'vault-a')

let testnet = null
let pass = null
let pairer = null

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
  console.log('Local testnet, then an Autopass vault. This is the library under PearPass, not the app.')
  testnet = await createTestnet(3)
  await rm(storeDir, { recursive: true, force: true })
  pass = await createVault(new Corestore(storeDir), { bootstrap: testnet.bootstrap })
  const invite = await pass.createInvite()
  await pass.add('a-note', 'left this on the vault')
  await writeJson(sessionPath, {
    bootstrap: testnet.bootstrap,
    invite,
    paired: false
  })
  console.log('Invite (capability — do not post it):')
  console.log(invite)
  console.log('Other terminal: npm run vault -- join')
  await waitUntil(async () => {
    try { return (await readJson(sessionPath)).paired } catch { return false }
  }, 120000, 'nobody paired')
  console.log('They read the note.')
  if (untilPaired) await shutdown(0)
  else {
    console.log('Ctrl+C to stop the vault.')
    await new Promise(() => {})
  }
}

async function join () {
  const session = await waitUntil(async () => {
    try { return await readJson(sessionPath) } catch { return null }
  }, 20000, 'no vault session — start the other terminal first')
  await rm(storeDir, { recursive: true, force: true })
  pairer = pairVault(new Corestore(storeDir), session.invite, { bootstrap: session.bootstrap })
  const paired = raceTimeout(pairer.finished(), 45000, 'pair timed out after 45s')
  try {
    pass = await paired
    await pass.ready()
    const note = await waitUntil(async () => {
      const got = await pass.get('a-note')
      const value = got && (got.value !== undefined ? got.value : got)
      return value === 'left this on the vault' ? value : null
    }, 20000, 'paired, but the note never showed up')
    console.log('Note:', note)
    await patchJson(sessionPath, { paired: true })
    await shutdown(0)
  } finally {
    paired.cancel()
  }
}

async function shutdown (code) {
  try { if (pairer) await pairer.close() } catch {}
  try { if (pass && pass.close) await pass.close() } catch {}
  try { if (testnet) await testnet.destroy() } catch {}
  process.exit(code)
}
