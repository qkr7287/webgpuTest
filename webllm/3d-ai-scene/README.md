# AI 3D Commander

자연어로 3D 씬을 조작하는 브라우저 데모.
WebLLM(브라우저 LLM) + Three.js를 결합하여, 채팅으로 3D 오브젝트를 생성/삭제/이동/애니메이션한다.

## 핵심 아이디어

| 영역 | 기술 | 역할 |
|------|------|------|
| 3D 렌더링 | Three.js (WebGL) | 오브젝트 생성, 애니메이션, 조명, 카메라 |
| LLM 추론 | WebLLM (WebGPU) | 자연어 → JSON 명령 변환 |
| UI | HTML/CSS Grid | 좌측 70% 3D 캔버스 + 우측 30% 채팅 |

GPU 충돌 없음: Three.js는 **WebGL**, WebLLM은 **WebGPU** — 서로 다른 파이프라인.

## 아키텍처

```
사용자 입력 ("빨간 공을 만들어")
       │
       ▼
  ┌─────────┐     ┌──────────────┐
  │ main.ts │────▶│  worker.ts   │  ← Web Worker (UI 블로킹 방지)
  │ (통합)  │     │  (LLM 추론)  │
  └────┬────┘     └──────┬───────┘
       │                 │
       │    LLM 응답 (스트리밍)
       │    "빨간 공을 만들었습니다!"
       │    ---CMD---
       │    {"action":"create","shape":"sphere","color":"#ff0000"}
       │                 │
       ▼                 ▼
  ┌──────────┐    ┌─────────────┐
  │ Chat UI  │    │ commands.ts │  ← ---CMD--- 파싱 + JSON 추출
  │ (텍스트) │    │  (파서)     │
  └──────────┘    └──────┬──────┘
                         │
                         ▼
                  ┌─────────────┐
                  │  scene.ts   │  ← Three.js SceneManager
                  │  (3D 씬)    │
                  └──────┬──────┘
                         │
                         ▼
                    3D Canvas
```

## 파일 구조

```
3d-ai-scene/
├── index.html          UI 레이아웃 (CSS Grid 스플릿)
└── src/
    ├── main.ts         오케스트레이터: LLM + 3D + Chat 연결
    ├── worker.ts       Web Worker (LLM 추론 오프로드)
    ├── scene.ts        Three.js SceneManager (오브젝트 CRUD, 애니메이션)
    ├── commands.ts     LLM 응답 파서 + CommandExecutor
    ├── prompt.ts       시스템 프롬프트 (한국어 예시 7개)
    └── types.ts        TypeScript 인터페이스
```

## 각 파일 역할

### types.ts (38줄) — 타입 정의
프로젝트 전체에서 사용하는 인터페이스.

- **ShapeType**: `box | sphere | cylinder | cone | torus`
- **AnimationType**: `spin | bounce | float | none`
- **ActionType**: `create | delete | move | color | animate | light | camera | clear`
- **SceneCommand**: LLM이 출력하는 JSON 명령 구조
- **SceneObjectInfo**: 씬 내 오브젝트 상태 정보

### scene.ts (293줄) — 3D 씬 관리

`SceneManager` 클래스가 Three.js의 모든 것을 관리한다.

**초기화**:
- 배경: 다크 블루 (`#0a0a1a`) + 안개
- 조명: AmbientLight + DirectionalLight (그림자)
- 바닥: GridHelper + 그림자 수신 Plane
- 카메라: PerspectiveCamera + OrbitControls (마우스 드래그/줌)

**오브젝트 관리 (`Map<string, ManagedObject>`)**:
- `createObject(shape, color, position, size, name, animation)` — 5종 도형 생성
- `deleteObject(target)` — 이름/"all"/"last" 지원
- `moveObject(target, position)` — 위치 이동
- `colorObject(target, color)` — 색상 변경
- `animateObject(target, animation)` — spin/bounce/float/none

**애니메이션 루프** (`requestAnimationFrame`):
- `spin`: 매 프레임 Y축 회전
- `bounce`: `Math.sin`으로 통통 튀기
- `float`: `Math.sin`으로 둥둥 떠다니기

**씬 컨텍스트**: `getSceneDescription()`이 현재 오브젝트 목록을 문자열로 반환 → LLM에 전달하여 "그걸 위로 올려" 같은 상대 명령 처리 가능.

### commands.ts (140줄) — 명령 파싱 & 실행

**parseResponse(response)**:
```
"빨간 공을 만들었습니다!       ← 텍스트 (사용자에게 표시)
---CMD---                     ← 구분자
{"action":"create",...}        ← JSON 명령 (파싱 대상)
```

- `---CMD---` 구분자로 텍스트/명령 분리
- 여러 JSON 줄 지원 (한 번에 여러 명령)
- JSON 파싱 실패 시 복구 시도: trailing comma 제거, 코드 펜스 제거, 정규식 추출

**CommandExecutor.execute(cmd)**:
- `SceneCommand.action`에 따라 `SceneManager` 메서드 dispatch
- 실행 결과를 문자열로 반환 (UI 피드백용)

### prompt.ts (88줄) — LLM 시스템 프롬프트

LLM에게 "자연어 → JSON 변환기" 역할을 부여하는 프롬프트.

- 8개 액션 정의표 (create, delete, move, color, animate, light, camera, clear)
- 12색 컬러 테이블 (red=#ff0000, blue=#0000ff, ...)
- 한국어 예시 7개 ("빨간 공을 만들어" → JSON)
- 규칙 9개 (기본값, 포맷, 한국어 표현 매핑)

핵심: LLM이 "생각"하는 게 아니라 **패턴 변환**만 하므로 1.7B 경량 모델로도 동작.

### main.ts (312줄) — 오케스트레이터

모든 모듈을 연결하는 중심부.

**모델 선택** (3가지):
| 모델 | 크기 | VRAM | 특성 |
|------|------|------|------|
| Qwen3 1.7B | 1.7B | ~1.5GB | 빠름, 기본 |
| Qwen3 4B | 4B | ~3GB | 균형 |
| Qwen3 8B | 8B | ~5GB | 최고 품질 |

**핵심 흐름 (`sendMessage()`)**:
1. 사용자 입력 수집
2. 시스템 프롬프트 + 씬 컨텍스트 + 대화 히스토리 조합
3. WebLLM 엔진에 스트리밍 요청 (`temperature: 0.3`)
4. 스트리밍 중: 텍스트만 실시간 표시 (`---CMD---` 이전 부분)
5. 완료 후: `parseResponse()`로 명령 추출 → `CommandExecutor`로 실행
6. 명령 실행 결과를 UI에 피드백

**컨텍스트 관리**:
- 대화 히스토리 최대 20턴 유지
- 매 요청마다 현재 씬 상태를 LLM에 주입 (`getSceneDescription()`)

**리소스 관리**:
- `cleanupEngine()`: 모델 전환 시 이전 Worker terminate + engine unload
- 자동 로드 없음 (GPU 충돌 방지)

### worker.ts (12줄) — Web Worker

```typescript
const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg) => handler.onmessage(msg)
```

WebLLM의 모든 LLM 추론을 별도 스레드에서 실행.
메인 스레드가 블로킹되지 않으므로 3D 렌더링과 LLM 추론이 동시 진행.

### index.html (306줄) — UI

CSS Grid 스플릿 레이아웃:
- **좌측**: Three.js 캔버스 + 오버레이 (오브젝트 수, 조작 안내)
- **우측 380px**: 채팅 패널 (모델 선택, 프로그레스 바, 메시지, 입력)

디자인 테마: 기존 WebLLM 다크 테마 재사용 (`#0f0f0f`, `#4fc3f7`, `#ff9800`)
반응형: 800px 이하에서 세로 분할 (40% 3D + 60% 채팅)

## 명령 프로토콜

LLM 응답은 항상 이 형식을 따른다:

```
자연어 응답 (한국어)
---CMD---
{"action":"create","shape":"sphere","color":"#ff0000","name":"red-ball"}
```

### 지원 액션

| 액션 | 파라미터 | 예시 명령 |
|------|---------|----------|
| `create` | shape, color, position, size, name, animation | "빨간 공을 만들어" |
| `delete` | target (이름/"all"/"last") | "그거 지워" |
| `move` | target, position | "위로 올려" |
| `color` | target, color | "파랗게 바꿔" |
| `animate` | target, animation | "회전시켜" |
| `light` | color, intensity (0-2) | "조명을 따뜻하게" |
| `camera` | position | "위에서 내려다봐" |
| `clear` | — | "다 지워" |

## 실행 방법

```bash
cd webllm
npm install
npm run dev
```

`http://localhost:5400/3d-ai-scene/` 접속 → 모델 Load → 채팅 시작.

**주의**: 메인 WebLLM 페이지(5400)와 동시 사용 시 GPU 충돌 가능. 한쪽 탭만 사용할 것.

## 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `three` | ^0.172.0 | 3D 렌더링 (WebGL) |
| `@mlc-ai/web-llm` | ^0.2.81 | 브라우저 LLM 추론 (WebGPU) |
| `typescript` | ^5.7.0 | 타입 체크 |
| `vite` | ^6.0.0 | 번들러/개발 서버 |

## 설계 포인트

1. **GPU 파이프라인 분리**: Three.js(WebGL)와 WebLLM(WebGPU)이 서로 다른 GPU 파이프라인을 사용하여 충돌 없음
2. **Worker 분리**: LLM 추론은 Web Worker에서 실행 — 3D 렌더링 프레임레이트에 영향 없음
3. **경량 모델 활용**: "자연어→JSON" 패턴 변환은 단순 작업이므로 1.7B 모델로도 충분
4. **씬 컨텍스트 주입**: 매 요청마다 현재 오브젝트 상태를 LLM에 전달 → "그걸", "전부" 같은 상대 참조 해석 가능
5. **에러 허용 파싱**: LLM이 불완전한 JSON을 출력해도 복구 시도 (trailing comma 제거 등)
6. **스트리밍 UX**: 응답 중 텍스트만 실시간 표시, `---CMD---` 이후 JSON은 숨김
