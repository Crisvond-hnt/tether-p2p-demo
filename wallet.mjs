#!/usr/bin/env node
/**
 * A second seed. Prints an address. Does not print either phrase. Does not send.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { skillAssets } from './lib.mjs'

const require = createRequire(import.meta.url)
const Identity = require('keet-identity-key')
const Ctor = Identity.generateMnemonic ? Identity : (Identity.default || Identity)
const { createWallet, ethereumAddress } = await import(pathToFileURL(path.join(skillAssets, 'wallet.mjs')).href)

const identity = Ctor.generateMnemonic()
const { wdk, seed } = await createWallet()
const address = await ethereumAddress(wdk)

console.log('address', address)
console.log('identity words', identity.trim().split(/\s+/).length)
console.log('wallet words', seed.trim().split(/\s+/).length)
console.log('same phrase', seed === identity)
console.log('No transaction. The chain is not a Hypercore. Neither phrase is printed.')
