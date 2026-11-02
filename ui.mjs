import http from 'node:http'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui', 'index.html'))

export function openBrowser (url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

export function serveWindow ({ port, getSnapshot, sendLine, saveNote, askModel, openFriend, begin, quit }) {
  const listeners = new Set()
  const emit = (event) => {
    const chunk = `data: ${JSON.stringify(event)}\n\n`
    for (const res of listeners) res.write(chunk)
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(page)
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, await getSnapshot())
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        })
        res.write('\n')
        listeners.add(res)
        req.on('close', () => listeners.delete(res))
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/message') {
        const body = await readBody(req)
        await sendLine(String(body.text || '').trim())
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/note') {
        const body = await readBody(req)
        await saveNote(String(body.text || '').trim())
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/ask') {
        const body = await readBody(req)
        askModel(String(body.text || '').trim()).catch((err) => {
          emit({ type: 'ask-error', message: err.message || String(err) })
        })
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/begin') {
        if (!begin) return json(res, 400, { error: 'This window cannot start a thread.' })
        const body = await readBody(req)
        await begin(body || {})
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/friend') {
        await openFriend()
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/quit') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
        setTimeout(() => quit(), 50)
        return
      }
      res.writeHead(404)
      res.end('Not found')
    } catch (err) {
      json(res, 400, { error: err.message || String(err) })
    }
  })
  return new Promise((resolve, reject) => {
    const listen = (usePort) => {
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && usePort !== 0) {
          listen(0)
          return
        }
        reject(err)
      })
      server.listen(usePort, '127.0.0.1', () => {
        const address = server.address()
        const url = 'http://127.0.0.1:' + address.port + '/'
        resolve({ url, emit, close: () => server.close() })
      })
    }
    listen(port)
  })
}

function json (res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 250000) {
        reject(new Error('Message is too long.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Bad request.')) }
    })
    req.on('error', reject)
  })
}
