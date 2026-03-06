# AI 3D Commander - Architecture Summary

## Overview

자연어로 3D 씬을 조작하는 브라우저 애플리케이션.
WebLLM(WebGPU)으로 LLM 추론, Three.js(WebGL)로 3D 렌더링을 수행하며, 서로 다른 GPU 파이프라인을 사용하여 충돌 없이 동시 동작한다.

## Pipeline Overview

사용자 입력이 3D Canvas에 반영되기까지의 전체 파이프라인.

```mermaid
graph TD
    User["사용자 입력<br/>'빨간 공을 만들어'"]

    User --> Main

    subgraph MainThread["Main Thread"]
        Main["main.ts<br/>(Orchestrator)"]
    end

    Main -->|postMessage| Worker

    subgraph WorkerThread["Web Worker"]
        Worker["worker.ts<br/>(LLM 추론)"]
    end

    Worker -->|"streaming response<br/>'빨간 공을 만들었습니다!<br/>---CMD---<br/>{action:create, shape:sphere, color:#ff0000}'"| Main

    Main --> ChatUI & CmdParser

    subgraph Output["Response Handling"]
        ChatUI["Chat UI<br/>(텍스트 표시)"]
        CmdParser["commands.ts<br/>(---CMD--- 파싱 + JSON 추출)"]
    end

    CmdParser -->|SceneCommand| Scene

    Scene["scene.ts<br/>(Three.js SceneManager)"]

    Scene --> Canvas["3D Canvas"]

    style User fill:#ff9800,color:#000
    style Worker fill:#1a2e1a,color:#fff
    style Main fill:#1a3a5c,color:#fff
    style ChatUI fill:#2a2a2a,color:#e0e0e0
    style CmdParser fill:#2a2a2a,color:#e0e0e0
    style Scene fill:#1a3a5c,color:#fff
    style Canvas fill:#4fc3f7,color:#000
```

## System Architecture

```mermaid
graph TB
    subgraph Browser["Browser (Client-side Only)"]
        subgraph MainThread["Main Thread"]
            UI["Chat UI<br/>index.html"]
            Main["main.ts<br/>Orchestrator"]
            Cmd["commands.ts<br/>Parser + Executor"]
            Scene["scene.ts<br/>SceneManager"]
            Prompt["prompt.ts<br/>System Prompt"]
            Types["types.ts<br/>Type Definitions"]
        end

        subgraph WorkerThread["Web Worker Thread"]
            Worker["worker.ts<br/>WebWorkerMLCEngineHandler"]
            LLM["WebLLM Engine<br/>Qwen3 (1.7B / 4B / 8B)"]
        end

        subgraph GPU["GPU"]
            WebGPU["WebGPU Pipeline<br/>LLM Inference"]
            WebGL["WebGL Pipeline<br/>3D Rendering"]
        end

        Canvas["3D Canvas<br/>Three.js"]
    end

    User["User Input<br/>'빨간 공을 만들어'"] --> UI
    UI --> Main
    Main -->|"message"| Worker
    Worker --> LLM
    LLM --> WebGPU
    LLM -->|"streaming response"| Worker
    Worker -->|"message"| Main
    Main --> Cmd
    Cmd -->|"SceneCommand"| Scene
    Scene --> WebGL
    Scene --> Canvas
    Main -->|"scene context"| Prompt
    Prompt -->|"system prompt"| Main
```

## Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant M as main.ts
    participant W as worker.ts (WebLLM)
    participant C as commands.ts
    participant S as scene.ts (Three.js)

    U->>M: "빨간 공을 만들어"
    M->>S: getSceneDescription()
    S-->>M: "Objects (2): ..."

    M->>M: Build messages<br/>[system prompt + scene ctx + history]
    M->>W: chat.completions.create (stream)

    loop Streaming
        W-->>M: delta text
        M->>M: Display text (before ---CMD---)
    end

    W-->>M: Full response
    M->>C: parseResponse(fullReply)
    C-->>M: { text, commands[] }

    loop Each command
        M->>C: execute(cmd)
        C->>S: createObject / deleteObject / ...
        S-->>C: result
        C-->>M: feedback string
    end

    M->>U: Show text + command feedback
```

## Module Structure

```mermaid
graph LR
    subgraph Source["src/"]
        main["main.ts<br/>312 lines<br/>Orchestrator"]
        scene["scene.ts<br/>293 lines<br/>3D Scene Manager"]
        commands["commands.ts<br/>140 lines<br/>Parser + Executor"]
        prompt["prompt.ts<br/>88 lines<br/>System Prompt"]
        worker["worker.ts<br/>12 lines<br/>Web Worker"]
        types["types.ts<br/>38 lines<br/>Type Definitions"]
    end

    main -->|imports| scene
    main -->|imports| commands
    main -->|imports| prompt
    main -->|spawns| worker
    commands -->|uses| types
    commands -->|calls| scene
    scene -->|uses| types
```

## Command Protocol

```mermaid
graph TD
    LLMResponse["LLM Response"]
    LLMResponse --> TextPart["Text Part<br/>'빨간 공을 만들었습니다!'"]
    LLMResponse --> Separator["---CMD---"]
    LLMResponse --> JSONPart["JSON Commands<br/>One per line"]

    JSONPart --> Parse["parseResponse()"]
    Parse --> TryParse["tryParseJSON()"]
    TryParse -->|success| Cmd["SceneCommand"]
    TryParse -->|fail| Recovery["Recovery:<br/>- Remove trailing comma<br/>- Strip code fences<br/>- Regex extract"]
    Recovery --> Cmd

    Cmd --> Executor["CommandExecutor"]
    Executor --> Actions

    subgraph Actions["8 Actions"]
        create["create<br/>shape, color, pos, size, name, anim"]
        delete["delete<br/>target: name/all/last"]
        move["move<br/>target, position"]
        color["color<br/>target, color"]
        animate["animate<br/>target, animation"]
        light["light<br/>color, intensity"]
        camera["camera<br/>position"]
        clear["clear"]
    end
```

## Scene Manager Class

```mermaid
classDiagram
    class SceneManager {
        -scene: THREE.Scene
        -camera: THREE.PerspectiveCamera
        -renderer: THREE.WebGLRenderer
        -controls: OrbitControls
        -objects: Map~string, ManagedObject~
        -clock: THREE.Clock
        -directionalLight: THREE.DirectionalLight
        +createObject(shape, color, pos, size, name, anim) string
        +deleteObject(target) bool
        +moveObject(target, pos) bool
        +colorObject(target, color) bool
        +animateObject(target, anim) bool
        +updateLight(color, intensity) void
        +moveCamera(pos) void
        +clearAll() void
        +getSceneDescription() string
        -animate() void
        -createGeometry(shape, size) BufferGeometry
        -resolveTarget(target) ManagedObject
    }

    class ManagedObject {
        +mesh: THREE.Mesh
        +name: string
        +shape: ShapeType
        +animation: AnimationType
        +baseY: number
    }

    class CommandExecutor {
        -scene: SceneManager
        +execute(cmd) string
        +executeAll(cmds) string[]
    }

    SceneManager "1" --> "*" ManagedObject : manages
    CommandExecutor --> SceneManager : dispatches to
```

## Type System

```mermaid
graph TD
    subgraph Types["types.ts"]
        ShapeType["ShapeType<br/>box | sphere | cylinder | cone | torus"]
        AnimationType["AnimationType<br/>spin | bounce | float | none"]
        ActionType["ActionType<br/>create | delete | move | color<br/>animate | light | camera | clear"]

        SceneCommand["SceneCommand"]
        SceneCommand --- action["action: ActionType"]
        SceneCommand --- shape["shape?: ShapeType"]
        SceneCommand --- colorF["color?: string"]
        SceneCommand --- position["position?: [x, y, z]"]
        SceneCommand --- size["size?: number"]
        SceneCommand --- name["name?: string"]
        SceneCommand --- target["target?: string"]
        SceneCommand --- animation["animation?: AnimationType"]
        SceneCommand --- intensity["intensity?: number"]
    end
```

## Threading Model

```mermaid
graph LR
    subgraph MT["Main Thread"]
        UI_Render["UI Rendering"]
        ThreeJS["Three.js Animation Loop<br/>requestAnimationFrame"]
        EventLoop["Event Handling<br/>click, keydown"]
    end

    subgraph WT["Web Worker Thread"]
        LLM_Inf["LLM Inference<br/>WebLLM Engine"]
    end

    MT <-->|"postMessage"| WT

    style MT fill:#1a3a5c,color:#fff
    style WT fill:#1a2e1a,color:#fff
```

Main Thread에서 Three.js 렌더링 루프(`requestAnimationFrame`)가 60fps로 동작하고,
Web Worker에서 LLM 추론이 병렬로 실행되어 UI가 블로킹되지 않는다.

## Model Options

| Model | Size | VRAM | Trade-off |
|-------|------|------|-----------|
| Qwen3 1.7B | 1.7B params | ~1.5GB | 빠른 응답, 기본 품질 |
| Qwen3 4B | 4B params | ~3GB | 균형잡힌 성능 |
| Qwen3 8B | 8B params | ~5GB | 최고 품질, 느린 로딩 |

## Key Design Decisions

1. **GPU Pipeline Separation** - Three.js(WebGL)와 WebLLM(WebGPU)이 별도 파이프라인 사용
2. **Worker Isolation** - LLM 추론을 Web Worker로 분리하여 렌더링 프레임레이트 보장
3. **Lightweight Model** - "자연어 -> JSON" 패턴 변환은 단순 작업이므로 1.7B 모델로도 충분
4. **Scene Context Injection** - 매 요청마다 현재 씬 상태를 LLM에 전달하여 상대 참조 해석 가능
5. **Fault-tolerant Parsing** - LLM의 불완전한 JSON 출력을 복구 시도 (trailing comma, code fence 제거)
6. **Streaming UX** - 응답 중 텍스트만 실시간 표시, `---CMD---` 이후 JSON은 사용자에게 숨김
