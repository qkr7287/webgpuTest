const fs = require('fs')
const path = require('path')
const p = path.join(__dirname, '../public/env/free_cyberpunk_hovercar.glb')
const buf = fs.readFileSync(p)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))

console.log('meshes:', json.meshes ? json.meshes.length : 0)
if (json.meshes) {
  json.meshes.forEach((m, i) => {
    if (m.primitives) {
      m.primitives.forEach((prim, j) => {
        const attrs = Object.keys(prim.attributes || {})
        const hasIndices = prim.indices !== undefined
        const hasPos = attrs.includes('POSITION')
        const hasNorm = attrs.includes('NORMAL')
        console.log(`mesh[${i}].prim[${j}] attrs: [${attrs}] indices: ${hasIndices} POSITION: ${hasPos} NORMAL: ${hasNorm}`)
        if (!hasPos) console.log('  !! MISSING POSITION attribute')
      })
    }
  })
}

// Check accessors for undefined bufferView
console.log('\naccessors count:', json.accessors ? json.accessors.length : 0)
let badAccessors = 0
if (json.accessors) {
  json.accessors.forEach((acc, i) => {
    if (acc.bufferView === undefined) {
      console.log(`accessor[${i}] has NO bufferView! type=${acc.type} componentType=${acc.componentType}`)
      badAccessors++
    }
  })
}
console.log('accessors without bufferView:', badAccessors)
