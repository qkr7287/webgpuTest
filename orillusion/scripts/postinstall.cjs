/**
 * postinstall — Orillusion GLB 파서 버그를 minified es.js에 직접 패치.
 *
 * 원본 minified 코드에서 특정 패턴을 찾아 방어 로직을 삽입한다.
 * Vite의 esbuild prebundle이 minified 코드를 그대로 가져가므로
 * 이 방식이면 prebundle 후에도 패치가 유지된다.
 */
const fs = require('fs')
const path = require('path')

const ES_PATH = path.join(__dirname, '../node_modules/@orillusion/core/dist/orillusion.es.js')

if (!fs.existsSync(ES_PATH)) {
  console.log('[postinstall] @orillusion/core not found, skipping.')
  process.exit(0)
}

let code = fs.readFileSync(ES_PATH, 'utf8')
const origLen = code.length
let patchCount = 0

// ── Patch 1: convertprimitives — position/indices 방어 ─────────────────
// 원본: const{attribArrays:l,modelName:h,drawMode:u}=i;let c;if(!l.indices.data){
// 패치: position 없으면 continue, indices 체크 강화
const p1_find = /const\{attribArrays:(\w+),modelName:(\w+),drawMode:(\w+)\}=(\w+);let (\w+);if\(!\1\.indices\.data\)\{/g
const p1_replace = 'const{attribArrays:$1,modelName:$2,drawMode:$3}=$4;let $5;if(!$1.position||!$1.position.data)continue;if(!$1.indices||!$1.indices.data){'
if (p1_find.test(code)) {
  code = code.replace(p1_find, p1_replace)
  patchCount++
  console.log('[postinstall] Patch 1 applied: position/indices guard in convertprimitives')
} else {
  console.log('[postinstall] Patch 1: pattern not found (may already be patched)')
}

// ── Patch 2: createGeometryBase — indices 접근 방어 ────────────────────
// 원본: "indices"in t&&(t.indices.data.length>65534?
// 패치: t.indices && t.indices.data 추가 체크
const p2a_find = '"indices"in t&&(t.indices.data.length>65534?'
const p2a_replace = '"indices"in t&&t.indices&&t.indices.data&&(t.indices.data.length>65534?'
if (code.includes(p2a_find)) {
  code = code.split(p2a_find).join(p2a_replace)
  patchCount++
  console.log('[postinstall] Patch 2a applied: indices guard (65534)')
}

const p2b_find = '"indices"in t&&(t.indices.data.length>65535?'
const p2b_replace = '"indices"in t&&t.indices&&t.indices.data&&(t.indices.data.length>65535?'
if (code.includes(p2b_find)) {
  code = code.split(p2b_find).join(p2b_replace)
  patchCount++
  console.log('[postinstall] Patch 2b applied: indices guard (65535)')
}

// ── Patch 3: setAttribute 루프 — data 없는 속성 스킵 ───────────────────
// 원본: for(const l in t){let h=t[l];a.setAttribute(l,h.data)}
// 패치: h 체크 추가
const p3_find = /for\(const (\w+) in (\w+)\)\{let (\w+)=\2\[\1\];(\w+)\.setAttribute\(\1,\3\.data\)\}/g
const p3_test = new RegExp(p3_find.source)
if (p3_test.test(code)) {
  code = code.replace(p3_find, 'for(const $1 in $2){let $3=$2[$1];if(!$3||typeof $3!=="object"||!$3.data)continue;$4.setAttribute($1,$3.data)}')
  patchCount++
  console.log('[postinstall] Patch 3 applied: setAttribute guard')
} else {
  console.log('[postinstall] Patch 3: pattern not found')
}

// ── Patch 4: addSubGeometry — indicesAttribute.data 방어 ───────────────
// 원본: let n=a.getAttribute(L.indices);return a.addSubGeometry({indexStart:0,indexCount:n.data.length
// 패치: n과 n.data 체크
const p4_find = /let (\w+)=(\w+)\.getAttribute\(L\.indices\);return \2\.addSubGeometry\(\{indexStart:0,indexCount:\1\.data\.length/g
const p4_test = new RegExp(p4_find.source)
if (p4_test.test(code)) {
  code = code.replace(p4_find, 'let $1=$2.getAttribute(L.indices);if(!$1||!$1.data)return $2;return $2.addSubGeometry({indexStart:0,indexCount:$1.data.length')
  patchCount++
  console.log('[postinstall] Patch 4 applied: indicesAttribute guard')
} else {
  console.log('[postinstall] Patch 4: pattern not found')
}

if (patchCount > 0) {
  fs.writeFileSync(ES_PATH, code, 'utf8')
  console.log(`[postinstall] ${patchCount} patches applied. Size: ${origLen} -> ${code.length} bytes`)
} else {
  console.log('[postinstall] No patches needed.')
}
