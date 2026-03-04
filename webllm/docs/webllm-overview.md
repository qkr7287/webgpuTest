# WebLLM 개요 및 사용기

> TODO: 직접 테스트 후 사용기 작성 예정

---

## 목차

- [WebLLM이란?](#webllm이란)
- [어떻게 동작하는가?](#어떻게-동작하는가)
- [지원 모델](#지원-모델)
- [프로젝트 구조](#프로젝트-구조)
- [실행 방법](#실행-방법)
- [장점](#장점)
- [단점](#단점)
- [사용기](#사용기)

---

## WebLLM이란?

[WebLLM](https://webllm.mlc.ai/)은 **브라우저 안에서 LLM(대규모 언어 모델)을 실행**하는 추론 엔진이다.

일반적인 ChatGPT/Claude 같은 AI 서비스는 서버에서 모델을 실행하고 네트워크로 결과를 보내주지만,
WebLLM은 **서버 없이 사용자의 브라우저(클라이언트)에서 직접 모델을 로드하고 추론**한다.

```
일반 LLM 서비스:
  사용자 브라우저 ──── 인터넷 ────► GPU 서버 (모델 실행) ──► 응답 반환

WebLLM:
  사용자 브라우저 (WebGPU로 모델 직접 실행) ──► 즉시 응답
  서버 불필요, 네트워크 불필요
```

**핵심 기술**: WebGPU를 활용한 GPU 가속 추론
**개발**: MLC (Machine Learning Compilation) 팀
**npm 패키지**: `@mlc-ai/web-llm`

---

## 어떻게 동작하는가?

### 동작 흐름

```
1. 브라우저가 모델 파일 다운로드 (최초 1회, 이후 캐시)
   └─ 모델 가중치 (.wasm + .bin 파일) → IndexedDB에 저장

2. WebGPU로 GPU 초기화
   └─ navigator.gpu.requestAdapter() → requestDevice()

3. WASM 런타임이 모델을 GPU 메모리에 로드
   └─ MLC 컴파일된 모델 → WebGPU Compute Shader로 실행

4. 사용자 입력 → 토크나이저 → GPU 추론 → 디토크나이저 → 텍스트 출력
   └─ OpenAI 호환 API (chat.completions.create)
```

### 기술 스택

| 계층 | 기술 | 역할 |
|------|------|------|
| **API** | OpenAI 호환 인터페이스 | `chat.completions.create()` — 기존 코드 재사용 가능 |
| **런타임** | TVM (Apache TVM) | ML 컴파일러 — 모델을 WebGPU용으로 최적화 |
| **실행** | WebGPU + WASM | GPU 가속 추론 + WASM으로 전처리/후처리 |
| **저장** | IndexedDB | 모델 파일 캐시 (재방문 시 다시 다운로드 안 함) |
| **스레딩** | Web Worker | 추론을 별도 스레드에서 실행 → UI 블로킹 방지 |

---

## 지원 모델

| 모델 | 크기 | 다운로드 | 특징 |
|------|------|---------|------|
| **Qwen2.5-0.5B-Instruct** | 0.5B | ~300MB | 가장 가벼움, 빠른 테스트용 |
| **SmolLM2-1.7B-Instruct** | 1.7B | ~1GB | 경량 모델 |
| **Qwen2.5-1.5B-Instruct** | 1.5B | ~1.5GB | 밸런스 (기본 설정) |
| **Gemma-2-2b-it** | 2B | ~1.5GB | Google 모델 |
| **Phi-3.5-mini-instruct** | 3.8B | ~2GB | Microsoft, 성능 좋음 |
| **Llama-3.1-8B-Instruct** | 8B | ~4GB | Meta, 고품질 |
| **Mistral-7B-Instruct** | 7B | ~4GB | 코딩/추론 우수 |

> 모델 ID 형식: `{모델명}-q4f16_1-MLC` (q4 = 4비트 양자화, f16 = float16)

---

## 프로젝트 구조

```
webllm/
├── index.html          ← 채팅 UI (다크 테마)
├── package.json        ← @mlc-ai/web-llm 의존성
├── vite.config.ts      ← Vite 설정 (COOP/COEP 헤더)
├── tsconfig.json
├── docs/
│   └── webllm-overview.md  ← 이 문서
└── src/
    ├── main.ts         ← 엔진 로드 + 채팅 로직 + 스트리밍
    └── worker.ts       ← Web Worker (UI 블로킹 방지)
```

---

## 실행 방법

```bash
cd webllm
npm install
npm run dev
# → http://localhost:5400 에서 열기 (Chrome, WebGPU 지원 필요)
```

**요구사항**: Chrome 113+ 또는 Edge 113+ (WebGPU 지원)
**첫 실행**: 모델 다운로드에 시간이 걸림 (~1.5GB for Qwen2.5-1.5B)
**재방문**: IndexedDB 캐시에서 로드 → 훨씬 빠름

---

## 장점

| 항목 | 설명 |
|------|------|
| **서버 비용 제로** | GPU 서버 없이 사용자의 브라우저에서 실행. API 호출 비용이 없다 |
| **프라이버시** | 사용자 데이터가 서버로 전송되지 않음. 모든 처리가 로컬에서 완료 |
| **오프라인 사용** | 모델이 한 번 캐시되면 인터넷 없이도 사용 가능 |
| **OpenAI API 호환** | `chat.completions.create()` — 기존 OpenAI SDK 코드를 거의 그대로 사용 가능 |
| **스트리밍 지원** | `stream: true`로 토큰 단위 실시간 출력 |
| **Web Worker 지원** | 추론을 별도 스레드에서 실행 → UI 멈춤 없음 |
| **다양한 모델** | Llama, Phi, Gemma, Qwen, Mistral 등 주요 오픈소스 모델 지원 |
| **양자화 모델** | 4비트 양자화로 메모리 사용량 대폭 감소 (8B 모델도 ~4GB로 실행) |
| **설치 간단** | `npm install @mlc-ai/web-llm` 한 줄 + 코드 몇 줄로 동작 |
| **CDN 사용 가능** | npm 없이 `import("https://esm.run/@mlc-ai/web-llm")`로 즉시 사용 |
| **WebGPU 활용** | GPU 하드웨어 가속으로 CPU 대비 수십 배 빠른 추론 |

## 단점

| 항목 | 설명 | 심각도 |
|------|------|--------|
| **초기 모델 다운로드** | 1.5B 모델도 ~1.5GB 다운로드 필요. 사용자가 기다려야 함 | **높음** |
| **VRAM 제한** | 브라우저가 사용할 수 있는 GPU 메모리에 한계. 8B 이상 모델은 VRAM 부족 가능 | **높음** |
| **모델 품질 한계** | 브라우저에서 실행 가능한 모델은 1.5B~8B 수준. GPT-4/Claude 급 품질은 불가능 | **높음** |
| **WebGPU 브라우저 제한** | Chrome 113+, Edge 113+ 필수. Safari/Firefox는 실험적이거나 미지원 | **중간** |
| **추론 속도** | 서버 GPU(A100/H100) 대비 느림. 소비자 GPU에서 ~10-30 tok/s 수준 | **중간** |
| **첫 토큰 지연 (TTFT)** | 모델 로드 후 첫 추론 시 셰이더 컴파일로 몇 초 지연 가능 | **중간** |
| **메모리 소비** | 브라우저 탭이 수 GB RAM/VRAM 사용. 다른 탭이나 3D 앱과 동시 사용 시 문제 | **중간** |
| **모바일 미지원** | 모바일 브라우저의 WebGPU 지원이 제한적. 실질적으로 데스크톱 전용 | **중간** |
| **디버깅 어려움** | WASM + WebGPU 레이어 깊숙이 있어 에러 발생 시 원인 파악 어려움 | **낮음** |
| **모델 커스터마이징** | 새 모델 추가 시 MLC 컴파일 파이프라인을 거쳐야 함 (간단하지 않음) | **낮음** |

---

## 사용기

> TODO: 직접 실행 후 아래 항목 작성 예정
>
> - 모델 다운로드 시간
> - 실제 추론 속도 (tok/s)
> - 응답 품질 (한국어)
> - VRAM 사용량
> - UI 반응성 (Web Worker 효과)
> - 3D 앱(Orillusion)과 동시 실행 시 영향
