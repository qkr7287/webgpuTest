/**
 * GLB 노드 애니메이션 파싱 및 재생 (스킨 없는 glTF 애니메이션용).
 * Orillusion 내장 파서는 비골격 노드 애니메이션을 처리하지 않으므로
 * 이 런타임에서 직접 GLB 바이너리를 파싱해 매 프레임 transform을 갱신한다.
 *
 * 버그 수정 사항:
 * - 노드 탐색을 GLTF 인덱스 대신 노드 이름 기반으로 변경
 *   (Orillusion의 GLTF_NODE_INDEX_PROPERTY 가 undefined로 초기화되어 있어
 *    obj[undefined] = 'undefined' 키로 저장되는 버그 회피)
 * - localRotQuat 회전을 인라인 set() 대신 setter 할당으로 변경해 dirty 플래그 보장
 * - GLB 이중 fetch 방지를 위한 모듈 레벨 캐시 추가
 */
import { ComponentBase, Object3D, View3D, Time, Quaternion } from '@orillusion/core'

// ── 타입 상수 ─────────────────────────────────────────────────────────────

const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
}

// ── 공개 인터페이스 ────────────────────────────────────────────────────────

export interface GLBNodeAnimationChannel {
  /** glTF nodes[] 인덱스 */
  nodeId: number
  /** glTF nodes[nodeId].name (노드 탐색에 사용) */
  nodeName: string
  path: 'translation' | 'rotation' | 'scale'
  times: Float32Array
  values: Float32Array
  numComponents: number
}

export interface GLBNodeAnimationClip {
  name: string
  duration: number
  channels: GLBNodeAnimationChannel[]
}

// ── GLB 파싱 유틸 ─────────────────────────────────────────────────────────

function parseGLBBuffer(glb: ArrayBuffer): { json: any; binary: ArrayBuffer } {
  const dv = new DataView(glb)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB magic')
  if (dv.getUint32(4, true) !== 2) throw new Error('Unsupported GLB version')
  const totalLength = dv.getUint32(8, true)
  let offset = 12
  let json: any = null
  let binary: ArrayBuffer = null!
  while (offset < totalLength) {
    const chunkLength = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, chunkStart, chunkLength)))
    } else if (chunkType === 0x004e4942) {
      binary = glb.slice(chunkStart, chunkStart + chunkLength)
    }
    offset = chunkStart + chunkLength
  }
  return { json, binary }
}

function getAccessorData(
  json: any,
  binary: ArrayBuffer,
  accessorIndex: number
): { data: Float32Array; count: number; numComponents: number } {
  const accessor = json.accessors[accessorIndex]
  const bufferView = json.bufferViews[accessor.bufferView]
  const ComponentCtor = COMPONENT_TYPES[accessor.componentType as keyof typeof COMPONENT_TYPES] ?? Float32Array
  const numComponents = TYPE_COMPONENTS[accessor.type] ?? 1
  const count = accessor.count
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const bytesPerElem = ComponentCtor.BYTES_PER_ELEMENT
  const stride = bufferView.byteStride || numComponents * bytesPerElem
  const src = new Uint8Array(binary)
  const out = new Float32Array(count * numComponents)
  for (let i = 0; i < count; i++) {
    const srcOff = byteOffset + i * stride
    for (let c = 0; c < numComponents; c++) {
      let v: number
      if (ComponentCtor === Float32Array) {
        v = new DataView(src.buffer, src.byteOffset + srcOff + c * 4, 4).getFloat32(0, true)
      } else if (ComponentCtor === Uint16Array || ComponentCtor === Int16Array) {
        v = new DataView(src.buffer, src.byteOffset + srcOff + c * 2, 2).getInt16(0, true)
      } else {
        v = new DataView(src.buffer, src.byteOffset + srcOff + c * bytesPerElem, bytesPerElem).getUint8(0)
      }
      out[i * numComponents + c] = v
    }
  }
  return { data: out, count, numComponents }
}

// ── GLB fetch 캐시 (같은 URL을 두 번 이상 fetch하지 않음) ─────────────────

const _glbCache = new Map<string, Promise<GLBNodeAnimationClip | null>>()

/**
 * GLB URL을 파싱해 첫 번째 애니메이션 클립을 반환한다.
 * 같은 URL은 캐시에서 반환한다.
 */
export function parseGLBNodeAnimation(glbUrl: string): Promise<GLBNodeAnimationClip | null> {
  if (_glbCache.has(glbUrl)) return _glbCache.get(glbUrl)!
  const promise = _fetchAndParse(glbUrl)
  _glbCache.set(glbUrl, promise)
  return promise
}

async function _fetchAndParse(glbUrl: string): Promise<GLBNodeAnimationClip | null> {
  const res = await fetch(glbUrl)
  const glb = await res.arrayBuffer()
  const { json, binary } = parseGLBBuffer(glb)
  const anims = json.animations as any[] | undefined
  if (!anims?.length) return null
  const anim = anims[0]
  const channels: GLBNodeAnimationChannel[] = []
  let duration = 0
  for (const ch of anim.channels as any[]) {
    const sampler = anim.samplers[ch.sampler]
    const input = getAccessorData(json, binary, sampler.input)
    const output = getAccessorData(json, binary, sampler.output)
    const path = ch.target.path as 'translation' | 'rotation' | 'scale'
    const nodeId: number = ch.target.node
    // 노드 이름 추출 (없으면 빈 문자열)
    const nodeName: string = (json.nodes?.[nodeId]?.name as string | undefined) ?? ''
    if (input.data.length) duration = Math.max(duration, input.data[input.data.length - 1])
    channels.push({ nodeId, nodeName, path, times: input.data, values: output.data, numComponents: output.numComponents })
  }
  return { name: (anim.name as string | undefined) ?? 'Take 01', duration, channels }
}

// ── 보간 ──────────────────────────────────────────────────────────────────

function sampleChannel(ch: GLBNodeAnimationChannel, t: number): number[] {
  const { times, values, numComponents } = ch
  if (times.length === 0) return []
  let i = 0
  while (i < times.length - 1 && times[i + 1] < t) i++
  if (i >= times.length - 1) {
    const off = (times.length - 1) * numComponents
    return Array.from({ length: numComponents }, (_, c) => values[off + c])
  }
  const t0 = times[i]
  const t1 = times[i + 1]
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1
  const off0 = i * numComponents
  const off1 = (i + 1) * numComponents
  const out: number[] = []
  for (let c = 0; c < numComponents; c++) {
    out.push(values[off0 + c] * (1 - f) + values[off1 + c] * f)
  }
  return out
}

// ── 노드 탐색 ─────────────────────────────────────────────────────────────

/**
 * 채널 배열에 대응하는 Object3D를 미리 탐색해 배열로 반환한다.
 *
 * 탐색 전략 (우선순위 순):
 * 1. nodeName이 있으면 root.getObjectByName(nodeName)
 * 2. 이름이 없거나 못 찾으면 DFS 순서로 순회하면서 obj['undefined'] 값(Orillusion가 실제로 사용하는 키)과 nodeId 비교
 */
function resolveChannelTargets(channels: GLBNodeAnimationChannel[], root: Object3D): (Object3D | null)[] {
  // Orillusion가 GLTF_NODE_INDEX_PROPERTY = undefined 로 선언해서
  // obj[undefined] === obj['undefined'] 에 nodeId를 저장함
  const ORILLUSION_NODE_ID_KEY = 'undefined'

  // DFS 인덱스 맵 미리 구성 (이름 탐색 실패 시 fallback)
  const idxMap = new Map<number, Object3D>()
  const walk = (obj: Object3D) => {
    const storedId = (obj as any)[ORILLUSION_NODE_ID_KEY]
    if (typeof storedId === 'number') idxMap.set(storedId, obj)
    const children = (obj as any).entityChildren as Object3D[] | undefined
    if (Array.isArray(children)) for (const child of children) walk(child)
  }
  walk(root)

  return channels.map((ch) => {
    // 1차: 이름 기반
    if (ch.nodeName) {
      const byName = (root as any).getObjectByName?.(ch.nodeName) as Object3D | null | undefined
      if (byName) return byName
    }
    // 2차: Orillusion 실제 키 기반
    return idxMap.get(ch.nodeId) ?? null
  })
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────

/**
 * 스킨 없는 GLB의 노드 애니메이션을 매 프레임 적용하는 컴포넌트.
 * `obj.addComponent(GLBNodeAnimationComponent, clip)` 으로 클립을 전달한다.
 */
export class GLBNodeAnimationComponent extends ComponentBase {
  clip!: GLBNodeAnimationClip
  speed = 1
  loop = true
  private _time = 0
  private _targets: (Object3D | null)[] | null = null
  /** 회전 계산용 재사용 쿼터니언 (매 프레임 할당 최소화) */
  private _rotQuat = new Quaternion()

  init(param?: GLBNodeAnimationClip) {
    if (param) this.clip = param
  }

  onUpdate(_view?: View3D) {
    if (!this.clip) return

    // 시간 진행
    const dt = Time.delta * 0.001 * this.speed
    this._time += dt
    if (this.loop && this.clip.duration > 0) {
      this._time %= this.clip.duration
    } else if (this._time > this.clip.duration) {
      this._time = this.clip.duration
    }

    // 최초 1회 노드 탐색
    if (!this._targets) {
      this._targets = resolveChannelTargets(this.clip.channels, this.object3D)
    }

    const t = Math.min(this._time, this.clip.duration)
    for (let i = 0; i < this.clip.channels.length; i++) {
      const ch = this.clip.channels[i]
      const node = this._targets[i]
      if (!node?.transform) continue
      const v = sampleChannel(ch, t)
      if (ch.path === 'translation' && v.length >= 3) {
        node.transform.x = v[0]
        node.transform.y = v[1]
        node.transform.z = v[2]
      } else if (ch.path === 'rotation' && v.length >= 4) {
        // setter를 통해 dirty 플래그를 확실히 세움
        this._rotQuat.set(v[0], v[1], v[2], v[3])
        node.transform.localRotQuat = this._rotQuat
      } else if (ch.path === 'scale' && v.length >= 3) {
        node.transform.scaleX = v[0]
        node.transform.scaleY = v[1]
        node.transform.scaleZ = v[2]
      }
    }
  }
}
