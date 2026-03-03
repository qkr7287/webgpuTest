/**
 * 로딩 단계 타임라인 기록. 기준: window.__PAGE_START (페이지 진입 시점)
 */
declare global {
  interface Window {
    __PAGE_START?: number
  }
}

const start = typeof window !== 'undefined' && window.__PAGE_START != null ? window.__PAGE_START : performance.now()
const stepDone = new Set<number>()

function ms(): number {
  return Math.round(performance.now() - start)
}

export function markStep(stepIndex: number): void {
  if (stepDone.has(stepIndex)) return
  stepDone.add(stepIndex)
  const el = document.getElementById(`step-${stepIndex}`)
  if (!el) return
  el.classList.add('loadTimeline__step--done')
  const msEl = el.querySelector('.loadTimeline__ms')
  if (msEl) msEl.textContent = `${ms()} ms`
}

export function setStatus(msg: string, isError = false): void {
  const el = document.getElementById('status')
  if (!el) return
  el.textContent = msg
  el.classList.toggle('status--error', isError)
}
