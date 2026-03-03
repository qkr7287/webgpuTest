/**
 * GLB 패치 스크립트 — TEXCOORD_0 이 없는 메시에 빈 UV 를 추가한다.
 * Orillusion 파서가 UV 를 필수로 기대하기 때문에 필요.
 *
 * 사용법: node scripts/patch-glb-uv.cjs
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '../public/env/free_cyberpunk_hovercar.glb')
const DST = SRC // 덮어쓰기 (백업은 .bak)

// ── GLB 읽기 ─────────────────────────────────────────────────────────────
const buf = fs.readFileSync(SRC)

// 백업
fs.writeFileSync(SRC + '.bak', buf)
console.log('백업 생성:', SRC + '.bak')

const magic = buf.readUInt32LE(0)
if (magic !== 0x46546C67) throw new Error('Not a GLB file')

const jsonChunkLen = buf.readUInt32LE(12)
const jsonChunkType = buf.readUInt32LE(16)
if (jsonChunkType !== 0x4E4F534A) throw new Error('First chunk is not JSON')

const jsonStr = buf.slice(20, 20 + jsonChunkLen).toString('utf8')
const gltf = JSON.parse(jsonStr)

const binOffset = 20 + jsonChunkLen
const binChunkLen = buf.readUInt32LE(binOffset)
const binChunkType = buf.readUInt32LE(binOffset + 4)
if (binChunkType !== 0x004E4942) throw new Error('Second chunk is not BIN')

const binData = buf.slice(binOffset + 8, binOffset + 8 + binChunkLen)

// ── 패치: 누락된 TEXCOORD_0 추가 ────────────────────────────────────────
const extraBuffers = []
let patchCount = 0

for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    if (prim.attributes.TEXCOORD_0 !== undefined) continue

    // POSITION accessor 에서 vertexCount 가져오기
    const posAccessorIdx = prim.attributes.POSITION
    const posAccessor = gltf.accessors[posAccessorIdx]
    const vertexCount = posAccessor.count

    // 빈 UV 데이터 생성 (vec2 float = 8 bytes per vertex)
    const uvBytes = vertexCount * 2 * 4 // float32 x 2
    const uvBuf = Buffer.alloc(uvBytes, 0)

    // 현재 바이너리 끝 오프셋
    const currentBinLen = binData.length + extraBuffers.reduce((s, b) => s + b.length, 0)

    // 4바이트 정렬 패딩
    const padding = (4 - (currentBinLen % 4)) % 4
    if (padding > 0) {
      extraBuffers.push(Buffer.alloc(padding, 0))
    }
    const byteOffset = currentBinLen + padding

    // bufferView 추가
    const bvIdx = gltf.bufferViews.length
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: byteOffset,
      byteLength: uvBytes,
      target: 34962, // ARRAY_BUFFER
    })

    // accessor 추가
    const accIdx = gltf.accessors.length
    gltf.accessors.push({
      bufferView: bvIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertexCount,
      type: 'VEC2',
      max: [0, 0],
      min: [0, 0],
    })

    // primitive 에 TEXCOORD_0 연결
    prim.attributes.TEXCOORD_0 = accIdx

    extraBuffers.push(uvBuf)
    patchCount++
  }
}

if (patchCount === 0) {
  console.log('패치할 메시 없음. 이미 정상.')
  process.exit(0)
}

console.log(`${patchCount}개 메시에 빈 TEXCOORD_0 추가`)

// ── GLB 재조립 ───────────────────────────────────────────────────────────
const newBinParts = [binData, ...extraBuffers]
let newBinBuf = Buffer.concat(newBinParts)

// BIN 청크 4바이트 정렬
const binPad = (4 - (newBinBuf.length % 4)) % 4
if (binPad > 0) newBinBuf = Buffer.concat([newBinBuf, Buffer.alloc(binPad, 0)])

// buffer 크기 업데이트
gltf.buffers[0].byteLength = newBinBuf.length

// JSON 직렬화 + 4바이트 정렬 (공백 패딩)
let newJsonStr = JSON.stringify(gltf)
while (newJsonStr.length % 4 !== 0) newJsonStr += ' '
const newJsonBuf = Buffer.from(newJsonStr, 'utf8')

// GLB 헤더 (12) + JSON chunk (8 + json) + BIN chunk (8 + bin)
const totalLen = 12 + 8 + newJsonBuf.length + 8 + newBinBuf.length

const out = Buffer.alloc(totalLen)
let off = 0

// Header
out.writeUInt32LE(0x46546C67, off); off += 4  // magic
out.writeUInt32LE(2, off); off += 4            // version
out.writeUInt32LE(totalLen, off); off += 4     // total length

// JSON chunk
out.writeUInt32LE(newJsonBuf.length, off); off += 4
out.writeUInt32LE(0x4E4F534A, off); off += 4
newJsonBuf.copy(out, off); off += newJsonBuf.length

// BIN chunk
out.writeUInt32LE(newBinBuf.length, off); off += 4
out.writeUInt32LE(0x004E4942, off); off += 4
newBinBuf.copy(out, off)

fs.writeFileSync(DST, out)
console.log(`패치 완료: ${DST} (${(out.length / 1024 / 1024).toFixed(1)}MB)`)
