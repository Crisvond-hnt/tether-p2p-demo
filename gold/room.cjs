/**
 * Gold Recipe A room. Copy into a Bare worker. Do not rewrite apply.
 * Node prove: tests/prove-room.mjs
 */
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const crypto = require('hypercore-crypto')

function apply (nodes, view, host) {
  return (async () => {
    for (const { value } of nodes) {
      if (value.addWriter) {
        const key = Buffer.isBuffer(value.addWriter)
          ? value.addWriter
          : Buffer.from(value.addWriter, 'hex')
        await host.addWriter(key, { indexer: true })
        continue
      }
      if (value.type === 'message') {
        await view.put('msg/' + value.id, value)
      }
    }
  })()
}

function openView (viewStore) {
  return new Hyperbee(viewStore.get({ name: 'view' }), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

function msgid () {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * @param {import('corestore')} store
 * @param {import('hyperswarm')} swarm
 * @param {{ bootstrapKey?: Buffer|string|null, attachSwarm?: boolean }} [opts]
 */
async function openRoom (store, swarm, opts = {}) {
  let bootstrap = opts.bootstrapKey || null
  if (typeof bootstrap === 'string') bootstrap = Buffer.from(bootstrap, 'hex')

  const base = new Autobase(store.namespace('room'), bootstrap, {
    valueEncoding: 'json',
    open: openView,
    apply
  })
  await base.ready()

  if (opts.attachSwarm !== false) {
    swarm.on('connection', (socket) => {
      socket.on('error', () => {})
      store.replicate(socket)
    })
    await swarm.join(base.discoveryKey, { server: true, client: true }).flushed()
  }

  return {
    base,
    keyHex: () => base.key.toString('hex'),
    writerHex: () => base.local.key.toString('hex'),
    invite () {
      return { key: base.key.toString('hex'), writer: base.local.key.toString('hex') }
    },
    async admit (writerHex) {
      await base.append({ addWriter: writerHex })
    },
    async send (text, id) {
      const msgId = id || msgid()
      await base.append({ type: 'message', id: msgId, text })
      await base.update()
      return msgId
    },
    async get (id) {
      await base.update()
      const entry = await base.view.get('msg/' + id)
      return entry && entry.value
    }
  }
}

module.exports = { openRoom, apply, openView, msgid }
