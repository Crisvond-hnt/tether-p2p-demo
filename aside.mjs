/**
 * Local aside. @qvac/sdk 0.23 drives a Bare worker from Node.
 * Do not import @qvac/inference here. Weights land in .qvac/.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { root, tmp } from './lib.mjs'

const cacheDir = path.join(root, '.qvac')
let sdk = null
let modelId = null
let loading = null

export function modelReady () {
  return !!modelId
}

export async function ask (content, { onProgress, onToken, predict = 160 } = {}) {
  await ensureModel(onProgress)
  const run = sdk.completion({
    modelId,
    history: [{ role: 'user', content }],
    stream: true,
    captureThinking: true,
    generationParams: { predict }
  })
  let text = ''
  if (run.events) {
    for await (const event of run.events) {
      if (event && event.type === 'contentDelta' && event.text) {
        text += event.text
        if (onToken) onToken(event.text)
      }
    }
    if (run.final) await run.final
  } else {
    for await (const token of run.tokenStream) {
      text += token
      if (onToken) onToken(token)
    }
  }
  return text.trim()
}

export async function closeAside () {
  if (!sdk || !modelId) return
  const id = modelId
  modelId = null
  try { await sdk.unloadModel({ modelId: id, clearStorage: false }) } catch {}
  try { if (sdk.close) await sdk.close() } catch {}
  sdk = null
}

async function ensureModel (onProgress) {
  if (modelId) return
  if (!loading) {
    loading = load(onProgress).catch((err) => {
      loading = null
      throw err
    })
  }
  await loading
}

async function load (onProgress) {
  await mkdir(cacheDir, { recursive: true })
  await mkdir(tmp, { recursive: true })
  const cfg = path.join(tmp, 'qvac.config.json')
  await writeFile(cfg, JSON.stringify({
    loggerLevel: 'error',
    loggerConsoleOutput: false,
    cacheDirectory: cacheDir,
    httpDownloadConcurrency: 3
  }))
  process.env.QVAC_CONFIG_PATH = cfg
  sdk = await import('@qvac/sdk')
  const modelSrc = sdk.QWEN3_600M_INST_Q4
  if (!modelSrc) throw new Error('this @qvac/sdk build has no QWEN3_600M_INST_Q4')
  try {
    modelId = await sdk.loadModel({
      modelSrc,
      modelConfig: { ctx_size: 4096, reasoning_budget: 0 },
      onProgress
    })
  } catch (err) {
    modelId = await sdk.loadModel({
      modelSrc,
      modelConfig: { ctx_size: 4096 },
      onProgress
    })
    if (!modelId) throw err
  }
}

export function asidePrompt ({ lines, note, question }) {
  const thread = lines.length
    ? lines.map((line) => line.who + ': ' + line.text).join('\n')
    : '(no messages yet)'
  return [
    'You are a private aside on this machine. You can read one friend thread and one note.',
    'Use only what is written below. Answer in two or three sentences.',
    '',
    'Thread:',
    thread,
    '',
    'Note:',
    note || '(none)',
    '',
    'Question:',
    question
  ].join('\n')
}
