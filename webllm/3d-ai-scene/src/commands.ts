/**
 * AI 3D Commander — Command parser & executor
 *
 * LLM 응답에서 ---CMD--- 구분자 이후의 JSON을 파싱하고,
 * SceneManager에 명령을 전달한다.
 */
import type { SceneCommand } from './types'
import type { SceneManager } from './scene'

const CMD_SEPARATOR = '---CMD---'

export interface ParseResult {
  text: string
  commands: SceneCommand[]
}

/**
 * LLM 응답을 텍스트와 명령으로 분리
 */
export function parseResponse(response: string): ParseResult {
  const sepIdx = response.indexOf(CMD_SEPARATOR)
  if (sepIdx === -1) {
    return { text: response.trim(), commands: [] }
  }

  const text = response.substring(0, sepIdx).trim()
  const cmdPart = response.substring(sepIdx + CMD_SEPARATOR.length).trim()

  const commands: SceneCommand[] = []

  // Multiple JSON objects can be separated by newlines
  const jsonCandidates = cmdPart.split('\n').filter(line => line.trim())

  for (const candidate of jsonCandidates) {
    const cmd = tryParseJSON(candidate.trim())
    if (cmd && cmd.action) {
      commands.push(cmd as unknown as SceneCommand)
    }
  }

  return { text, commands }
}

function tryParseJSON(str: string): Record<string, unknown> | null {
  // Remove code fences if present
  let cleaned = str.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()

  // Try direct parse
  try {
    return JSON.parse(cleaned)
  } catch { /* continue */ }

  // Remove trailing comma before closing brace
  cleaned = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
  try {
    return JSON.parse(cleaned)
  } catch { /* continue */ }

  // Try to extract JSON object from text
  const match = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch { /* give up */ }
  }

  return null
}

/**
 * 명령을 SceneManager에 실행
 */
export class CommandExecutor {
  constructor(private scene: SceneManager) {}

  execute(cmd: SceneCommand): string {
    switch (cmd.action) {
      case 'create': {
        const name = this.scene.createObject(
          cmd.shape || 'sphere',
          cmd.color || '#4fc3f7',
          cmd.position || [0, 1, 0],
          cmd.size || 1,
          cmd.name,
          cmd.animation || 'none'
        )
        return `Created ${cmd.shape || 'sphere'} "${name}"`
      }

      case 'delete': {
        const target = cmd.target || 'last'
        const ok = this.scene.deleteObject(target)
        return ok ? `Deleted "${target}"` : `Not found: "${target}"`
      }

      case 'move': {
        const target = cmd.target || 'last'
        const pos = cmd.position || [0, 1, 0]
        const ok = this.scene.moveObject(target, pos)
        return ok ? `Moved "${target}" to [${pos}]` : `Not found: "${target}"`
      }

      case 'color': {
        const target = cmd.target || 'last'
        const ok = this.scene.colorObject(target, cmd.color || '#ffffff')
        return ok ? `Colored "${target}" to ${cmd.color}` : `Not found: "${target}"`
      }

      case 'animate': {
        const target = cmd.target || 'last'
        const ok = this.scene.animateObject(target, cmd.animation || 'spin')
        return ok ? `Animation "${cmd.animation}" on "${target}"` : `Not found: "${target}"`
      }

      case 'light': {
        this.scene.updateLight(cmd.color, cmd.intensity)
        return `Light updated${cmd.color ? ` color=${cmd.color}` : ''}${cmd.intensity !== undefined ? ` intensity=${cmd.intensity}` : ''}`
      }

      case 'camera': {
        const pos = cmd.position || [5, 5, 8]
        this.scene.moveCamera(pos)
        return `Camera moved to [${pos}]`
      }

      case 'clear': {
        this.scene.clearAll()
        return 'Scene cleared'
      }

      default:
        return `Unknown action: ${cmd.action}`
    }
  }

  executeAll(commands: SceneCommand[]): string[] {
    return commands.map(cmd => this.execute(cmd))
  }
}
