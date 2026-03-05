/**
 * WebLLM 테스트 — 브라우저에서 LLM 실행
 *
 * WebGPU를 활용해 브라우저 안에서 LLM을 로드하고 채팅한다.
 * Web Worker를 사용해 메인 스레드 블로킹을 방지한다.
 */
import { CreateWebWorkerMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm'

// ── 모델 목록 (UI 드롭다운에 표시) ─────────────────────────────────────
// 한국어 품질 순으로 정렬. 위에 있을수록 추천.
interface ModelOption {
  id: string
  label: string
  size: string
  vram: string
  desc: string
}

const MODEL_LIST: ModelOption[] = [
  // ── 추천: 한국어 잘 되는 모델 ──
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B (추천)',
    size: '8B',
    vram: '~5GB',
    desc: '한국어 최강. Qwen 최신, 다국어 학습량 최대. VRAM 여유 있으면 이거.',
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 7B',
    size: '7B',
    vram: '~4.5GB',
    desc: '한국어 우수. Qwen3보다 안정적 (정식 릴리즈). 실용적 선택.',
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
    label: 'DeepSeek-R1 Qwen 7B',
    size: '7B',
    vram: '~4.5GB',
    desc: '추론/논리력 특화. 수학/코딩 강함. 한국어도 Qwen 베이스라 괜찮음.',
  },
  {
    id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.1 8B',
    size: '8B',
    vram: '~5GB',
    desc: 'Meta 최신. 영어 최강, 한국어는 Qwen보다 약함. 범용 성능 우수.',
  },
  // ── 밸런스: 중간 크기 ──
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B (밸런스)',
    size: '4B',
    vram: '~3GB',
    desc: '한국어 양호. 8B의 80% 품질, VRAM 절반. 가성비 최고.',
  },
  {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    label: 'Phi 3.5 Mini (3.8B)',
    size: '3.8B',
    vram: '~2.5GB',
    desc: 'MS 모델. 영어 추론 강함. 한국어는 보통. 코딩 질문에 적합.',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 3B',
    size: '3B',
    vram: '~2GB',
    desc: '한국어 보통. 가벼움과 한국어의 타협점.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    size: '3B',
    vram: '~2GB',
    desc: 'Meta 경량 모델. 영어 좋음, 한국어 제한적.',
  },
  // ── 경량: 빠른 테스트용 ──
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    label: 'Qwen3 1.7B (경량)',
    size: '1.7B',
    vram: '~1.5GB',
    desc: '한국어 기본. 빠르고 가벼움. 간단한 대화만.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B',
    size: '1.5B',
    vram: '~1GB',
    desc: '한국어 기본. 빠른 테스트용.',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B (초경량)',
    size: '0.5B',
    vram: '~0.5GB',
    desc: '가장 작음. 한국어 거의 불가. 동작 확인용.',
  },
]

const DEFAULT_MODEL_INDEX = 0

// ── DOM 참조 ─────────────────────────────────────────────────────────────
const $status = document.getElementById('status') as HTMLDivElement
const $progress = document.getElementById('progress') as HTMLDivElement
const $progressBar = document.getElementById('progress-bar') as HTMLDivElement
const $chatMessages = document.getElementById('chat-messages') as HTMLDivElement
const $userInput = document.getElementById('user-input') as HTMLTextAreaElement
const $sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const $modelInfo = document.getElementById('model-info') as HTMLDivElement
const $modelSelect = document.getElementById('model-select') as HTMLSelectElement
const $loadBtn = document.getElementById('load-btn') as HTMLButtonElement
const $modelDesc = document.getElementById('model-desc') as HTMLDivElement
const $gpuDot = document.querySelector('.gpu-dot') as HTMLSpanElement
const $gpuDetail = document.getElementById('gpu-detail') as HTMLSpanElement

// ── WebGPU 감지 ─────────────────────────────────────────────────────────
// requestAdapterInfo()는 Chrome 130+에서 deprecated → adapter.info (동기 프로퍼티)로 교체됨.
// 정보 조회 실패 ≠ WebGPU 미지원. 어댑터+디바이스 생성 성공 여부로 판단해야 함.

interface GPUStatus {
  available: boolean       // WebGPU API 존재
  deviceCreated: boolean   // GPU Device 실제 생성 성공 (= WebGPU 진짜 사용 가능)
  vendor: string
  device: string           // 브라우저가 반환하는 디바이스 ID (예: 0x1e04)
  architecture: string
  description: string
  maxBufferSize: number    // 단일 버퍼 최대 크기 (VRAM이 아님!)
  maxComputeWorkgroups: number
}

// 브라우저는 개인정보 보호를 위해 GPU 모델명 대신 PCI Device ID만 노출한다.
// 주요 NVIDIA GPU의 Device ID → 모델명 매핑
const NVIDIA_DEVICE_MAP: Record<string, string> = {
  '0x2684': 'RTX 4090', '0x2702': 'RTX 4080 Super', '0x2704': 'RTX 4080',
  '0x2705': 'RTX 4070 Ti Super', '0x2782': 'RTX 4070 Ti', '0x2783': 'RTX 4070 Super',
  '0x2786': 'RTX 4070', '0x2803': 'RTX 4060 Ti', '0x2882': 'RTX 4060',
  '0x1e04': 'RTX 2080 Ti', '0x1e07': 'RTX 2080 Super', '0x1e82': 'RTX 2080',
  '0x1e84': 'RTX 2070 Super', '0x1e87': 'RTX 2070', '0x1f02': 'RTX 2070',
  '0x1f06': 'RTX 2060 Super', '0x1f08': 'RTX 2060',
  '0x2204': 'RTX 3090', '0x2206': 'RTX 3080', '0x2208': 'RTX 3080 Ti',
  '0x2484': 'RTX 3070', '0x2482': 'RTX 3070 Ti',
  '0x2503': 'RTX 3060', '0x2504': 'RTX 3060 Ti',
  '0x1b80': 'GTX 1080', '0x1b81': 'GTX 1070', '0x1b82': 'GTX 1070 Ti',
  '0x1b83': 'GTX 1060 6GB', '0x1c02': 'GTX 1060 3GB', '0x1c81': 'GTX 1050',
}

function resolveGPUName(vendor: string, deviceId: string): string {
  const v = vendor.toLowerCase()
  if (v.includes('nvidia') || v === 'nvidia') {
    const id = deviceId.toLowerCase()
    if (NVIDIA_DEVICE_MAP[id]) return `NVIDIA ${NVIDIA_DEVICE_MAP[id]}`
  }
  // 벤더명 + ID 그대로 표시 (AMD, Intel 등)
  if (vendor && deviceId) return `${vendor} ${deviceId}`
  if (vendor) return vendor
  return 'GPU'
}

async function detectWebGPU(): Promise<GPUStatus> {
  const fail = (desc: string): GPUStatus => ({
    available: false, deviceCreated: false,
    vendor: '', device: '', architecture: '', description: desc,
    maxBufferSize: 0, maxComputeWorkgroups: 0,
  })

  // 1) navigator.gpu 존재 확인
  if (!navigator.gpu) return fail('WebGPU API 없음 (브라우저 미지원)')

  // 2) 어댑터 요청
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return fail('GPU 어댑터 없음')

  // 3) 어댑터 정보 조회 (신/구 API 모두 시도)
  let vendor = '', device = '', architecture = '', description = ''
  try {
    // Chrome 130+: adapter.info (동기 프로퍼티)
    const info = (adapter as any).info ?? await (adapter as any).requestAdapterInfo?.()
    if (info) {
      vendor = info.vendor || ''
      device = info.device || ''
      architecture = info.architecture || ''
      description = info.description || ''
    }
  } catch {
    // 정보 조회 실패해도 WebGPU 자체는 사용 가능할 수 있음
  }

  // 4) 실제 GPU Device 생성 시도 — 이게 성공하면 WebGPU 진짜 사용 가능
  try {
    const gpuDevice = await adapter.requestDevice()
    const limits = gpuDevice.limits
    const maxBuf = limits.maxBufferSize ?? 0
    const maxWorkgroups = limits.maxComputeWorkgroupsPerDimension ?? 0
    gpuDevice.destroy() // 테스트용이니 바로 해제

    return {
      available: true, deviceCreated: true,
      vendor, device, architecture, description,
      maxBufferSize: maxBuf, maxComputeWorkgroups: maxWorkgroups,
    }
  } catch {
    return {
      available: true, deviceCreated: false,
      vendor, device, architecture,
      description: 'GPU Device 생성 실패 (드라이버 문제 가능)',
      maxBufferSize: 0, maxComputeWorkgroups: 0,
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)}MB`
  return `${bytes}B`
}

async function initGPUStatus() {
  const gpu = await detectWebGPU()

  $gpuDot.classList.remove('checking')

  if (gpu.deviceCreated) {
    // WebGPU Compute Shader 사용 확인됨
    $gpuDot.classList.add('active')
    const gpuName = resolveGPUName(gpu.vendor, gpu.device)
    $gpuDetail.textContent = `WebGPU ON — ${gpuName}`
    $gpuDetail.title =
      `Backend: WebGPU (Compute Shader)\n` +
      `GPU: ${gpuName}\n` +
      `Vendor: ${gpu.vendor || 'N/A'}\n` +
      `Device ID: ${gpu.device || 'N/A'}\n` +
      `Architecture: ${gpu.architecture || 'N/A'}\n` +
      `Description: ${gpu.description || 'N/A'}\n` +
      `Max Buffer (단일): ${formatBytes(gpu.maxBufferSize)}\n` +
      `Max Compute Workgroups/dim: ${gpu.maxComputeWorkgroups}\n` +
      `\n※ Max Buffer = 단일 GPU 버퍼 최대 크기 (실제 VRAM과 다름)`
  } else if (gpu.available) {
    // API는 있지만 Device 생성 실패
    $gpuDot.classList.add('inactive')
    $gpuDetail.textContent = `WASM 폴백 (${gpu.description})`
    $gpuDetail.style.color = '#ff9800'
  } else {
    // WebGPU API 자체가 없음
    $gpuDot.classList.add('inactive')
    $gpuDetail.textContent = `WASM 폴백 (${gpu.description})`
    $gpuDetail.style.color = '#f44336'
  }
}

// ── 상태 ─────────────────────────────────────────────────────────────────
let engine: MLCEngine | null = null
let isGenerating = false
let currentModelId = ''

// ── 모델 드롭다운 초기화 ─────────────────────────────────────────────────
function initModelSelect() {
  for (let i = 0; i < MODEL_LIST.length; i++) {
    const m = MODEL_LIST[i]
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = `${m.label}  [${m.size}, ${m.vram}]`
    $modelSelect.appendChild(opt)
  }
  $modelSelect.value = String(DEFAULT_MODEL_INDEX)
  updateModelDesc()

  $modelSelect.addEventListener('change', updateModelDesc)
}

function updateModelDesc() {
  const idx = Number($modelSelect.value)
  const m = MODEL_LIST[idx]
  $modelDesc.textContent = m.desc
}

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

function clearChat() {
  $chatMessages.innerHTML = ''
}

// ── 모델 로드 ────────────────────────────────────────────────────────────
async function loadModel() {
  const idx = Number($modelSelect.value)
  const model = MODEL_LIST[idx]

  // 이미 같은 모델이 로드되어 있으면 스킵
  if (engine && currentModelId === model.id) {
    addMessage('system', `${model.label} 이미 로드되어 있습니다.`)
    return
  }

  // 기존 엔진 정리
  if (engine) {
    addMessage('system', `기존 모델 해제 중...`)
    engine = null
    currentModelId = ''
  }

  setStatus(`${model.label} 로딩 중...`)
  $progress.style.display = 'block'
  $progressBar.style.width = '0%'
  $progressBar.textContent = '0%'
  $loadBtn.disabled = true
  $modelSelect.disabled = true
  $userInput.disabled = true
  $sendBtn.disabled = true

  const loadStart = performance.now()

  const initProgressCallback = (report: InitProgressReport) => {
    setStatus(report.text)
    if (report.progress !== undefined) {
      const pct = Math.round(report.progress * 100)
      $progressBar.style.width = `${pct}%`
      $progressBar.textContent = `${pct}%`
    }
  }

  try {
    engine = await CreateWebWorkerMLCEngine(
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      model.id,
      { initProgressCallback }
    )
    currentModelId = model.id

    const loadTime = ((performance.now() - loadStart) / 1000).toFixed(1)
    setStatus(`${model.label} 로드 완료! (${loadTime}초)`)
    $progress.style.display = 'none'
    $modelInfo.textContent = `모델: ${model.label} [${model.size}] | 로드 시간: ${loadTime}초`
    $userInput.disabled = false
    $sendBtn.disabled = false
    $userInput.focus()

    addMessage('system', `${model.label} (${model.id}) 로드 완료. ${loadTime}초 소요. 메시지를 입력하세요.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message
      : typeof err === 'string' ? err
      : (() => { try { return JSON.stringify(err) } catch { return String(err) } })()
    setStatus(`모델 로드 실패: ${msg}`)
    $progress.style.display = 'none'
    addMessage('system', `오류: ${msg}`)
    console.error(err)
  }

  $loadBtn.disabled = false
  $modelSelect.disabled = false
}

// ── 채팅 ─────────────────────────────────────────────────────────────────
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

    const idx = Number($modelSelect.value)
    const model = MODEL_LIST[idx]
    if (usage) {
      $modelInfo.textContent =
        `모델: ${model.label} | ` +
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
  $loadBtn.disabled = false
  $userInput.focus()
}

// ── 이벤트 바인딩 ────────────────────────────────────────────────────────
$sendBtn.addEventListener('click', sendMessage)
$loadBtn.addEventListener('click', () => {
  clearChat()
  loadModel()
})
$userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// ── 시작 ─────────────────────────────────────────────────────────────────
initGPUStatus()
initModelSelect()
loadModel()
