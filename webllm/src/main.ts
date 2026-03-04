/**
 * WebLLM 테스트 — 브라우저에서 LLM 실행
 *
 * WebGPU를 활용해 브라우저 안에서 LLM을 로드하고 채팅한다.
 * Web Worker를 사용해 메인 스레드 블로킹을 방지한다.
 */
import { CreateWebWorkerMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm'

// ── 사용할 모델 ──────────────────────────────────────────────────────────
// 작은 모델부터 시작 (다운로드 ~1.5GB)
// 다른 모델로 바꾸려면 여기만 수정
const SELECTED_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'

// 더 큰 모델 옵션들:
// 'Llama-3.1-8B-Instruct-q4f32_1-MLC'     (~4GB, 고품질)
// 'Phi-3.5-mini-instruct-q4f16_1-MLC'      (~2GB, 밸런스)
// 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'     (~0.5GB, 가장 가벼움)
// 'Gemma-2-2b-it-q4f16_1-MLC'             (~1.5GB)
// 'SmolLM2-1.7B-Instruct-q4f16_1-MLC'     (~1GB)

// ── DOM 참조 ─────────────────────────────────────────────────────────────
const $status = document.getElementById('status') as HTMLDivElement
const $progress = document.getElementById('progress') as HTMLDivElement
const $progressBar = document.getElementById('progress-bar') as HTMLDivElement
const $chatMessages = document.getElementById('chat-messages') as HTMLDivElement
const $userInput = document.getElementById('user-input') as HTMLTextAreaElement
const $sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const $modelInfo = document.getElementById('model-info') as HTMLDivElement

// ── 상태 ─────────────────────────────────────────────────────────────────
let engine: MLCEngine | null = null
let isGenerating = false

// ── 유틸 ─────────────────────────────────────────────────────────────────
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

function updateLastAssistantMessage(text: string) {
  const messages = $chatMessages.querySelectorAll('.message.assistant')
  const last = messages[messages.length - 1]
  if (last) {
    const content = last.querySelector('.content')
    if (content) content.textContent = text
  }
  $chatMessages.scrollTop = $chatMessages.scrollHeight
}

// ── 모델 로드 ────────────────────────────────────────────────────────────
async function loadModel() {
  setStatus('모델 로딩 중...')
  $progress.style.display = 'block'

  const loadStart = performance.now()

  const initProgressCallback = (report: InitProgressReport) => {
    setStatus(report.text)
    // progress 값이 있으면 바 업데이트
    if (report.progress !== undefined) {
      const pct = Math.round(report.progress * 100)
      $progressBar.style.width = `${pct}%`
      $progressBar.textContent = `${pct}%`
    }
  }

  try {
    engine = await CreateWebWorkerMLCEngine(
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      SELECTED_MODEL,
      { initProgressCallback }
    )

    const loadTime = ((performance.now() - loadStart) / 1000).toFixed(1)
    setStatus(`모델 로드 완료! (${loadTime}초)`)
    $progress.style.display = 'none'
    $modelInfo.textContent = `모델: ${SELECTED_MODEL} | 로드 시간: ${loadTime}초`
    $userInput.disabled = false
    $sendBtn.disabled = false
    $userInput.focus()

    addMessage('system', `${SELECTED_MODEL} 모델이 로드되었습니다. (${loadTime}초) 메시지를 입력하세요.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setStatus(`모델 로드 실패: ${msg}`)
    $progress.style.display = 'none'
    addMessage('system', `오류: ${msg}`)
    console.error(err)
  }
}

// ── 채팅 ─────────────────────────────────────────────────────────────────
async function sendMessage() {
  if (!engine || isGenerating) return

  const userText = $userInput.value.trim()
  if (!userText) return

  isGenerating = true
  $sendBtn.disabled = true
  $userInput.value = ''

  addMessage('user', userText)
  addMessage('assistant', '...')

  const genStart = performance.now()

  try {
    const chunks = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. Answer concisely in the same language as the user.' },
        { role: 'user', content: userText },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
    })

    let reply = ''
    let usage = null

    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta?.content || ''
      reply += delta
      updateLastAssistantMessage(reply)
      if (chunk.usage) usage = chunk.usage
    }

    const genTime = ((performance.now() - genStart) / 1000).toFixed(1)
    const tokensPerSec = usage
      ? (usage.completion_tokens / ((performance.now() - genStart) / 1000)).toFixed(1)
      : '?'

    setStatus(`응답 완료 (${genTime}초, ${tokensPerSec} tok/s)`)

    if (usage) {
      $modelInfo.textContent =
        `모델: ${SELECTED_MODEL} | ` +
        `입력: ${usage.prompt_tokens}tok | ` +
        `출력: ${usage.completion_tokens}tok | ` +
        `${tokensPerSec} tok/s`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateLastAssistantMessage(`오류: ${msg}`)
    setStatus(`생성 실패: ${msg}`)
    console.error(err)
  }

  isGenerating = false
  $sendBtn.disabled = false
  $userInput.focus()
}

// ── 이벤트 바인딩 ────────────────────────────────────────────────────────
$sendBtn.addEventListener('click', sendMessage)
$userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// ── 시작 ─────────────────────────────────────────────────────────────────
loadModel()
