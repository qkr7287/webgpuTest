/**
 * AI 3D Commander — Main orchestrator
 *
 * WebLLM(Web Worker) + Three.js SceneManager + Chat UI를 연결.
 * 사용자 자연어 → LLM → JSON 명령 → 3D 씬 반영.
 */
import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine, type InitProgressReport } from '@mlc-ai/web-llm'
import { SceneManager } from './scene'
import { parseResponse, CommandExecutor } from './commands'
import { SYSTEM_PROMPT } from './prompt'
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm'

// ── Model list ──────────────────────────────────────────────────────────
interface ModelOption {
  id: string
  label: string
  size: string
  vram: string
}

const MODEL_LIST: ModelOption[] = [
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B (Fast)', size: '1.7B', vram: '~1.5GB' },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B (Balanced)', size: '4B', vram: '~3GB' },
  { id: 'Qwen3-8B-q4f16_1-MLC', label: 'Qwen3 8B (Best)', size: '8B', vram: '~5GB' },
]

const MAX_HISTORY = 20

// ── DOM refs ────────────────────────────────────────────────────────────
const $canvas = document.getElementById('scene-canvas') as HTMLCanvasElement
const $chatMessages = document.getElementById('chat-messages') as HTMLDivElement
const $userInput = document.getElementById('user-input') as HTMLTextAreaElement
const $sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const $modelSelect = document.getElementById('model-select') as HTMLSelectElement
const $loadBtn = document.getElementById('load-btn') as HTMLButtonElement
const $status = document.getElementById('status') as HTMLDivElement
const $progress = document.getElementById('progress') as HTMLDivElement
const $progressBar = document.getElementById('progress-bar') as HTMLDivElement
const $objectCount = document.getElementById('object-count') as HTMLSpanElement

// ── Scene ───────────────────────────────────────────────────────────────
const sceneManager = new SceneManager($canvas, (count) => {
  $objectCount.textContent = String(count)
})
const cmdExecutor = new CommandExecutor(sceneManager)

// ── State ───────────────────────────────────────────────────────────────
let engine: WebWorkerMLCEngine | null = null
let currentWorker: Worker | null = null
let isGenerating = false
let currentModelId = ''
let history: ChatCompletionMessageParam[] = []

// ── Model select init ───────────────────────────────────────────────────
function initModelSelect() {
  MODEL_LIST.forEach((m, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = `${m.label} [${m.vram}]`
    $modelSelect.appendChild(opt)
  })
  $modelSelect.value = '0'
}

// ── Error formatting ────────────────────────────────────────────────────
function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

// ── UI helpers ──────────────────────────────────────────────────────────
function setStatus(text: string) {
  $status.textContent = text
}

function addMessage(role: 'user' | 'assistant' | 'system', content: string): HTMLDivElement {
  const msgDiv = document.createElement('div')
  msgDiv.className = `message ${role}`

  const labelSpan = document.createElement('span')
  labelSpan.className = 'label'
  labelSpan.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'AI' : 'System'

  const contentDiv = document.createElement('div')
  contentDiv.className = 'content'
  contentDiv.textContent = content

  msgDiv.appendChild(labelSpan)
  msgDiv.appendChild(contentDiv)
  $chatMessages.appendChild(msgDiv)
  $chatMessages.scrollTop = $chatMessages.scrollHeight
  return msgDiv
}

function updateLastAssistantContent(text: string) {
  const messages = $chatMessages.querySelectorAll('.message.assistant')
  const last = messages[messages.length - 1]
  if (last) {
    const content = last.querySelector('.content')
    if (content) content.textContent = text
  }
  $chatMessages.scrollTop = $chatMessages.scrollHeight
}

function addCommandFeedback(results: string[]) {
  if (results.length === 0) return
  const div = document.createElement('div')
  div.className = 'message system cmd-feedback'
  div.innerHTML = results.map(r => `<span class="cmd-result">${r}</span>`).join('')
  $chatMessages.appendChild(div)
  $chatMessages.scrollTop = $chatMessages.scrollHeight
}

// ── Cleanup previous engine ─────────────────────────────────────────────
async function cleanupEngine() {
  if (engine) {
    try {
      engine.unload()
    } catch { /* ignore cleanup errors */ }
    engine = null
  }
  if (currentWorker) {
    currentWorker.terminate()
    currentWorker = null
  }
  currentModelId = ''
}

// ── Model load ──────────────────────────────────────────────────────────
async function loadModel() {
  const idx = Number($modelSelect.value)
  const model = MODEL_LIST[idx]

  if (engine && currentModelId === model.id) {
    addMessage('system', `${model.label} already loaded.`)
    return
  }

  // Cleanup previous engine & worker
  await cleanupEngine()

  setStatus(`Loading ${model.label}...`)
  $progress.style.display = 'block'
  $progressBar.style.width = '0%'
  $progressBar.textContent = '0%'
  $loadBtn.disabled = true
  $modelSelect.disabled = true
  $userInput.disabled = true
  $sendBtn.disabled = true

  history = []

  const initProgressCallback = (report: InitProgressReport) => {
    setStatus(report.text)
    if (report.progress !== undefined) {
      const pct = Math.round(report.progress * 100)
      $progressBar.style.width = `${pct}%`
      $progressBar.textContent = `${pct}%`
    }
  }

  try {
    // Create and keep worker reference for proper cleanup
    currentWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

    engine = await CreateWebWorkerMLCEngine(
      currentWorker,
      model.id,
      { initProgressCallback }
    )
    currentModelId = model.id

    setStatus(`${model.label} ready!`)
    $progress.style.display = 'none'
    $userInput.disabled = false
    $sendBtn.disabled = false
    $userInput.focus()

    addMessage('system', `${model.label} loaded. Try: "빨간 공을 만들어"`)
  } catch (err) {
    const msg = formatError(err)
    setStatus(`Load failed`)
    $progress.style.display = 'none'

    // Provide actionable error message
    if (msg.includes('OperationError') || msg.includes('Instance reference')) {
      addMessage('system',
        `GPU error: ${msg}\n\n` +
        `Fix: Close other WebLLM tabs, then click Load again.`
      )
    } else {
      addMessage('system', `Error: ${msg}`)
    }
    console.error('[3d-ai-scene] loadModel error:', err)

    // Cleanup on failure
    await cleanupEngine()
  }

  $loadBtn.disabled = false
  $modelSelect.disabled = false
}

// ── Send message ────────────────────────────────────────────────────────
async function sendMessage() {
  if (!engine || isGenerating) return

  const userText = $userInput.value.trim()
  if (!userText) return

  isGenerating = true
  $sendBtn.disabled = true
  $loadBtn.disabled = true
  $userInput.value = ''

  addMessage('user', userText)
  addMessage('assistant', '...')

  // Build messages with scene context
  const sceneCtx = sceneManager.getSceneDescription()
  const systemMsg: ChatCompletionMessageParam = {
    role: 'system',
    content: `${SYSTEM_PROMPT}\n\n## Current Scene State\n${sceneCtx}`,
  }

  history.push({ role: 'user', content: userText })

  // Trim history
  if (history.length > MAX_HISTORY) {
    history = history.slice(history.length - MAX_HISTORY)
  }

  const messages: ChatCompletionMessageParam[] = [systemMsg, ...history]

  try {
    const chunks = await engine.chat.completions.create({
      messages,
      temperature: 0.3,
      max_tokens: 512,
      stream: true,
      stream_options: { include_usage: true },
    })

    let fullReply = ''
    let usage = null

    // Stream: show text only (before ---CMD---)
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content || ''
      fullReply += delta

      // Display only the text part during streaming
      const sepIdx = fullReply.indexOf('---CMD---')
      const displayText = sepIdx !== -1
        ? fullReply.substring(0, sepIdx).trim()
        : fullReply

      updateLastAssistantContent(displayText)
      if (chunk.usage) usage = chunk.usage
    }

    // Parse and execute commands
    const parsed = parseResponse(fullReply)
    updateLastAssistantContent(parsed.text || '(command executed)')

    if (parsed.commands.length > 0) {
      const results = cmdExecutor.executeAll(parsed.commands)
      addCommandFeedback(results)
    }

    // Add to history
    history.push({ role: 'assistant', content: fullReply })

    // Status update
    if (usage) {
      const tokPerSec = usage.completion_tokens > 0
        ? `${(usage.completion_tokens / 1).toFixed(0)}tok`
        : ''
      setStatus(`Done | ${tokPerSec} | ${parsed.commands.length} cmd(s)`)
    }
  } catch (err) {
    const msg = formatError(err)
    updateLastAssistantContent(`Error: ${msg}`)
    setStatus(`Generation failed`)
    console.error('[3d-ai-scene] sendMessage error:', err)
  }

  isGenerating = false
  $sendBtn.disabled = false
  $loadBtn.disabled = false
  $userInput.focus()
}

// ── Event bindings ──────────────────────────────────────────────────────
$sendBtn.addEventListener('click', sendMessage)
$loadBtn.addEventListener('click', () => {
  $chatMessages.innerHTML = ''
  loadModel()
})
$userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// ── Boot ────────────────────────────────────────────────────────────────
initModelSelect()
setStatus('Select a model and click Load. (Close other WebLLM tabs first)')
addMessage('system', 'Ready. Select a model and click Load.\nNote: Close the main WebLLM tab (port 5400) first to avoid GPU conflicts.')
