/**
 * Gold Recipe E. Import from the Bare worker. New seed — never the Keet mnemonic.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

async function loadWdk () {
  try {
    const [{ default: WDK }, { default: EvmWalletManager }] = await Promise.all([
      import('@tetherto/wdk'),
      import('@tetherto/wdk-wallet-evm')
    ])
    return { WDK, EvmWalletManager }
  } catch {
    const root = join(process.cwd(), 'node_modules')
    const [{ default: WDK }, { default: EvmWalletManager }] = await Promise.all([
      import(pathToFileURL(join(root, '@tetherto/wdk/index.js')).href),
      import(pathToFileURL(join(root, '@tetherto/wdk-wallet-evm/index.js')).href)
    ])
    return { WDK, EvmWalletManager }
  }
}

export async function createWallet (opts = {}) {
  const { WDK, EvmWalletManager } = await loadWdk()
  const seed = opts.seed || WDK.getRandomSeedPhrase(24)
  if (!WDK.isValidSeed(seed)) throw new Error('invalid WDK seed')
  const wdk = new WDK(seed)
  wdk.registerWallet('ethereum', EvmWalletManager, {
    provider: opts.provider || 'http://127.0.0.1:1'
  })
  return { wdk, seed, WDK }
}

export async function ethereumAddress (wdk) {
  const account = await wdk.getAccount('ethereum', 0)
  return account.getAddress()
}
