# GLB 로드 에러 해결 기록 (Orillusion 파서)

`free_cyberpunk_hovercar.glb` 등 일부 GLB를 로드할 때 발생하던 에러의 **추적 플로우**와 **해결 방법**을 정리한 문서입니다.

---

## 1. 증상

- **에러 메시지**: `TypeError: Cannot read properties of undefined (reading 'data')`
- **스택**:
  - `createGeometryBase` (@orillusion_core.js)
  - `convertprimitives`
  - `convertNodeToObject3D`
  - `parseObject3D` → `traverse` → `convertToNode`
- **상황**: 같은 GLB는 Windows 뷰어, Babylon.js, Three.js에서는 정상 로드됨. **Orillusion에서만** 크래시.

---

## 2. 원인 추적 플로우

### 2.1 에러 위치 특정

- 스택이 가리키는 건 **번들된** `@orillusion_core.js` (Vite가 사용하는 ESM 번들).
- 실제 소스는 `node_modules/@orillusion/core/dist/` 아래:
  - **Vite가 로드하는 파일**: `orillusion.es.js` (minify된 ESM)
  - **수정 대상 소스**: `orillusion.es.max.js` (미니파이 전 ESM)

### 2.2 파서 코드 흐름 파악

1. **프리미티브 초기화** (`parsePrimitive` 근처)
   - `dprimitive.attribArrays = { indices: [] }` 로 **indices를 빈 배열**로 둠.
   - glTF에 `primitive.indices`가 없으면(비인덱스 메시) 이 값을 **그대로 둔 채** accessor를 안 넣음 → `attribArrays['indices']`가 계속 `[]`.

2. **인덱스 보정 블록** (`convertprimitives` 내부)
   - `if (!attribArrays['indices'].data)` 로 “인덱스 없으면 채워주기” 진입.
   - 이 블록 안에서 `attribArrays["position"].data.length` 사용.
   - **position이 없는 primitive**가 있으면 여기서 `attribArrays["position"]`이 `undefined` → **같은 에러** 발생.

3. **createGeometryBase**
   - `"indices" in attribArrays` 만 보고 `attribArrays['indices'].data.length` 접근.
   - `attribArrays['indices']`가 빈 배열 `[]`이면 `.data`가 없음 → **에러**.
   - 그 다음 루프에서 `geometry.setAttribute(attributeName, attributeData.data)` 호출 시, `attributeData`가 `[]`이면 `attributeData.data`가 `undefined` → **에러**.
   - 마지막에 `indicesAttribute.data.length` 사용 시, 위에서 `undefined`가 들어갔다면 **에러**.

### 2.3 왜 Orillusion만 문제였나

- **다른 엔진**: position/indices 없거나 형식이 다르면 **스킵·방어 로직**이 있음.
- **Orillusion 파서**:  
  - `attribArrays["position"]` / `attribArrays['indices']` / `attributeData`가 **항상 기대한 형태라고 가정**하고 `.data`를 직접 접근.
  - 일부 glTF(비인덱스 메시, position 없는 primitive, 특정 익스포터 결과 등)에서 이 가정이 깨지면서 **같은 GLB는 다른 엔진에서는 되고 Orillusion에서만** 터짐.

---

## 3. 해결 방법 (적용한 패치)

아래는 **`orillusion.es.max.js`** 기준으로 적용한 수정입니다.  
(minify 시 `orillusion.es.js`가 갱신되므로, 실제 로드는 `orillusion.es.js`로 이뤄짐.)

### 3.1 convertprimitives (primitive 루프)

- **position 없으면 해당 primitive 스킵**  
  `attribArrays["position"]` / `attribArrays["position"].data` 없으면 `continue`.
- **indices 보정 조건 완화**  
  `!attribArrays['indices'] || !attribArrays['indices'].data` 일 때만 “인덱스 채우기” 블록 진입 (빈 배열 `[]`도 처리).

### 3.2 createGeometryBase

- **indices 사용 전 검사**  
  `"indices" in attribArrays` 뿐 아니라 `attribArrays["indices"]`와 `attribArrays["indices"].data`가 있을 때만 indices 변환/사용.
- **속성 설정 루프**  
  `attributeData`가 없거나 `.data`가 없으면 `setAttribute` 호출 스킵 (`continue`).
- **addSubGeometry 전**  
  `indicesAttribute` / `indicesAttribute.data` 없으면 그대로 `return geometry` (크래시 방지).
- **블렌드쉽·모프**  
  `attribArrays["position"]`, `MORPH_POSITION_PREFIX` / `MORPH_NORMAL_PREFIX` 접근 시 optional chaining(`?.`)으로 `.data` 없을 때 방어.

### 3.3 번들 갱신 및 캐시

- `orillusion.es.max.js` 수정 후 **esbuild로 minify** 해서 `orillusion.es.js` 재생성.
- Vite 의존성 캐시 삭제 (`node_modules/.vite`) 후 dev 서버 재시작.

```bash
cd node_modules/@orillusion/core
npx esbuild dist/orillusion.es.max.js --sourcemap --minify --outfile=dist/orillusion.es.js
```

프로젝트 루트에서:

```bash
# Vite 캐시 삭제 후
npm run dev
```

---

## 4. 플로우 요약 (다이어그램)

```
[호버카 GLB 로드 시도]
        │
        ▼
Engine3D.res.loadGltf → GLTFLoader → parsePrimitive
        │
        │  attribArrays = { indices: [] }  (indices 없으면 그대로)
        ▼
convertNodeToObject3D → convertprimitives
        │
        │  position 없음? → continue (패치)
        │  indices 없음/[]? → position 기반으로 indices 생성 (기존 + 조건 완화)
        │  indices.data 있고 length>3? → createGeometryBase 호출
        ▼
createGeometryBase
        │
        │  indices/indices.data 없음? → indices 블록 스킵 (패치)
        │  attributeData.data 없음? → setAttribute 스킵 (패치)
        │  indicesAttribute.data 없음? → return geometry (패치)
        ▼
Geometry 생성 완료 → 씬에 추가
```

---

## 5. 재질(머티리얼) 보정 — Occlusion 맵 적용

Three.js / Babylon.js와 비교했을 때 Orillusion에서 GLB 재질이 흐리거나 차이가 나는 원인 중 하나는 **Ambient Occlusion(차폐) 텍스처가 적용되지 않았기 때문**입니다.

- **파서**: `parseMaterial`에서 `occlusionTexture`를 파싱해 `dmaterial.occlusionTexture`에 넣음.
- **적용**: `convertprimitives` 안에서 LitMaterial에 텍스처를 넣을 때 **occlusionTexture → aoMap** 매핑이 빠져 있었음.
- **수정**: `orillusion.es.max.js`의 머티리얼 적용 블록에 아래를 추가함.
  ```js
  if (occlusionTexture) {
    physicMaterial.setTexture("aoMap", occlusionTexture);
  }
  ```
- **참고**: glTF는 occlusion을 **R 채널**에 둡니다. Orillusion LitMaterial의 aoMap 샘플링은 **G 채널**을 사용합니다. 채널이 다른 에셋은 AO 강도가 다르게 보일 수 있으며, 필요 시 엔진에서 R 채널 샘플 옵션을 추가할 수 있습니다.
- **이미 적용된 항목**: baseColor/baseMap, normalMap, metallicRoughness → maskMap(G=roughness, B=metallic), emissiveMap/emissiveFactor, baseColorFactor, metallicFactor, roughnessFactor는 기존에도 적용되고 있음.

수정 후 **esbuild로 minify** 해서 `orillusion.es.js`를 다시 빌드해야 합니다. (3.3절과 동일.)

---

## 6. 주의사항

- 수정은 **`node_modules/@orillusion/core`** 안에 적용된 것이므로, **`npm install`** 이나 패키지 업데이트 시 **덮어쓰일 수 있습니다**.
- 그 경우:
  - 이 문서와 동일한 방어 로직을 **다시 적용**하거나,
  - [Orillusion](https://github.com/Orillusion/orillusion) 저장소에 **이슈/PR**로 제안해 공식 반영을 요청하는 것을 권장합니다.
- 프로젝트에서는 **로드 실패 시 폴백**으로 `FALLBACK_GLB`(데미지 헬멧)를 쓰도록 `main.ts`에서 try/catch 처리해 두었습니다.

---

## 7. 참고

- Orillusion GLB 파서: `node_modules/@orillusion/core/dist/orillusion.es.max.js`  
  - `convertprimitives`, `createGeometryBase`, `parseAccessor` 등.
- Vite가 사용하는 번들: `node_modules/@orillusion/core/dist/orillusion.es.js` (위 .max.js를 minify한 결과).
