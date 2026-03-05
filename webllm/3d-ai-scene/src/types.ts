/**
 * AI 3D Commander — Type definitions
 */

export type ShapeType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus'
export type AnimationType = 'spin' | 'bounce' | 'float' | 'none'
export type ActionType = 'create' | 'delete' | 'move' | 'color' | 'animate' | 'light' | 'camera' | 'clear'

export interface SceneCommand {
  action: ActionType
  shape?: ShapeType
  color?: string
  position?: [number, number, number]
  size?: number
  name?: string
  target?: string
  animation?: AnimationType
  intensity?: number
}

export interface SceneObjectInfo {
  name: string
  shape: ShapeType
  color: string
  position: [number, number, number]
  animation: AnimationType
}

export interface WorkerMessage {
  type: 'init-progress' | 'stream-delta' | 'stream-done' | 'error' | 'ready'
  text?: string
  progress?: number
  delta?: string
  fullText?: string
  usage?: { prompt_tokens: number; completion_tokens: number }
  error?: string
}
