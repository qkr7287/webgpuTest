/**
 * WebLLM Web Worker — 메인 스레드 UI 블로킹 방지
 *
 * LLM 추론은 CPU/GPU를 많이 사용하므로 Web Worker에서 실행한다.
 * 이렇게 하면 모델 로딩/추론 중에도 UI가 멈추지 않는다.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg)
}
