/**
 * AI 3D Commander — Web Worker for LLM inference
 * (기존 webllm/src/worker.ts 와 동일)
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg)
}
