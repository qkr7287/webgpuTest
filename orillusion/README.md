# Orillusion 스타터 프로젝트

[Orillusion](https://www.orillusion.com/en/guide/) WebGPU 엔진 기반 스타터 (엔진 초기화 + 큐브 그리기).

## 요구사항

- **WebGPU 지원 브라우저**: Chrome 113+, Edge 113+, Safari 17.5+

## 실행

```bash
npm install
npm run dev
```

브라우저에서 **http://localhost:3000/** 접속.

- 마우스 드래그: 카메라 회전 (HoverCameraController)
- 큐브 1개 + 방향광 + 대기(하늘) 렌더링

## 프로젝트 구조

```
├── index.html      # 엔트리 HTML
├── src/main.ts     # 엔진 초기화, 씬/카메라/광원/큐브 설정
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 빌드

```bash
npm run build
npm run preview   # 빌드 결과 미리보기
```

## 문서

- **[GLB 로드 에러 해결 기록](docs/GLB-PARSER-FIX.md)** — 일부 GLB(`free_cyberpunk_hovercar.glb` 등) 로드 시 `Cannot read properties of undefined (reading 'data')` 가 나던 문제의 **원인 추적 플로우**와 **Orillusion 파서 패치** 해결 방법.
