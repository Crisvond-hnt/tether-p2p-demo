/**
 * Gold Recipe B. Copy into workers/vault.cjs. Do not reimplement pairing.
 */
const Autopass = require('autopass')

async function createVault (store, opts = {}) {
  const pass = new Autopass(store, opts)
  await pass.ready()
  return pass
}

function pairVault (store, invite, opts = {}) {
  return Autopass.pair(store, invite, opts)
}

module.exports = { createVault, pairVault }
