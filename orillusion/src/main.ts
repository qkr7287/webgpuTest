/**
 * Orillusion 스타터 — 호버카 GLB 로드 및 애니메이션 재생
 *
 * free_cyberpunk_hovercar.glb 는 스킨(골격)이 없는 노드 애니메이션 파일이다.
 * Orillusion의 내장 파서는 비골격 애니메이션을 처리하지 않으므로
 * ./glbNodeAnimation.ts 의 커스텀 런타임으로 재생한다.
 */

// ── 상수 ──────────────────────────────────────────────────────────────────

const HOVERCAR_GLB = '/env/free_cyberpunk_hovercar.glb'
const FALLBACK_GLB =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb'
const ENV_HDR_URL = '/env/royal_esplanade_2k.hdr'

const STABLE_FRAME_THRESHOLD = 30
const MIN_FPS = 15
const INSTANCE_BOX_SIZE = 30
const GLB_ENV_INTENSITY = 1.8

// ── 임포트 ────────────────────────────────────────────────────────────────

import {
  Engine3D,
  Scene3D,
  View3D,
  Object3D,
  Camera3D,
  HoverCameraController,
  DirectLight,
  SkyRenderer,
  KelvinUtil,
  Time,
  PostProcessingComponent,
  BloomPost,
  TAAPost,
  SkeletonAnimationComponent,
  AnimatorComponent,
  MeshRenderer,
  webGPUContext,
} from '@orillusion/core'
import { parseGLBNodeAnimation, GLBNodeAnimationComponent } from './glbNodeAnimation'
import { markStep, setStatus } from './loadTimeline'

// ── DOM 참조 ──────────────────────────────────────────────────────────────

const statsPanel = document.getElementById('stats-panel')!
const statsLoadingTime = document.getElementById('stats-loading-time')!
const statsFps = document.getElementById('stats-fps')!
const statsInstanceCount = document.getElementById('stats-instance-count')!
const btnAdd = document.getElementById('btn-add')!
const btnRemove = document.getElementById('btn-remove')!
const ipPanel = document.getElementById('ip-panel')!

// ── 전역 상태 ─────────────────────────────────────────────────────────────

let instanceList: Object3D[] = []
let sceneRef: Scene3D | null = null
let modelTemplate: Object3D | null = null
let loadedGlbUrl = ''

// ── 유틸 ──────────────────────────────────────────────────────────────────

function randomInBox(): number {
  return (Math.random() - 0.5) * INSTANCE_BOX_SIZE
}

function updateInstanceCount() {
  statsInstanceCount.textContent = String(instanceList.length)
}

function hideLoadingOverlay(loadedMs: number) {
  const sec = (loadedMs / 1000).toFixed(2)
  markStep(6)
  setStatus(`로딩 완료 (${sec}초)\nFPS 안정화 후 렌더링 중.`)
  statsPanel.classList.add('visible')
  ipPanel.classList.add('visible')
  statsLoadingTime.textContent = `${sec}초`
  updateInstanceCount()
}

/** GLB에서 로드한 모델의 PBR 재질 보정(envIntensity) */
function applyGlbMaterialTweaks(obj: Object3D) {
  const renderers = obj.getComponentsInChild<MeshRenderer>(MeshRenderer)
  for (const r of renderers) {
    const mat = r.material as { envIntensity?: number }
    if (mat && 'envIntensity' in mat) mat.envIntensity = GLB_ENV_INTENSITY
  }
}

/**
 * 오브젝트(또는 자식)에서 첫 번째 애니메이션을 재생한다.
 *
 * 시도 순서:
 * 1. AnimatorComponent (골격 있는 GLB — playAnim)
 * 2. SkeletonAnimationComponent (골격 있는 GLB — 구형 API)
 * 3. GLBNodeAnimationComponent (스킨 없는 GLB — 커스텀 파서)
 */
async function playFirstAnimation(obj: Object3D, glbUrl?: string) {
  // 1) AnimatorComponent
  const animator =
    obj.getComponent(AnimatorComponent) ??
    obj.getComponentsInChild(AnimatorComponent)[0]
  if (animator?.clips?.length) {
    const clip = animator.clips[0]
    // PropertyAnimationClip 의 실제 이름 필드는 clipName
    const clipName = (clip as any).clipName ?? (clip as any).name
    if (clipName) animator.playAnim(clipName, 0, 1)
    return
  }

  // 2) SkeletonAnimationComponent
  const skelAnim =
    obj.getComponent(SkeletonAnimationComponent) ??
    obj.getComponentsInChild(SkeletonAnimationComponent)[0]
  if (skelAnim) {
    const clips = skelAnim.getAnimationClips()
    if (clips?.length) {
      skelAnim.setAnimIsLoop(clips[0].name, true)
      skelAnim.play(clips[0].name, 1, true)
    }
    return
  }

  // 3) 노드 애니메이션 (스킨 없는 GLB)
  if (glbUrl) {
    const clip = await parseGLBNodeAnimation(glbUrl)
    if (clip?.channels.length) {
      const comp = obj.addComponent(GLBNodeAnimationComponent, clip) as GLBNodeAnimationComponent
      comp.speed = 1
      comp.loop = true
    }
  }
}

async function addInstance() {
  if (!sceneRef || !modelTemplate) return
  const clone = modelTemplate.clone()
  clone.x = randomInBox()
  clone.y = randomInBox()
  clone.z = randomInBox()
  applyGlbMaterialTweaks(clone)
  sceneRef.addChild(clone)
  instanceList.push(clone)
  await playFirstAnimation(clone, loadedGlbUrl)
  updateInstanceCount()
}

function removeInstance() {
  if (instanceList.length <= 1) return
  const obj = instanceList.pop()!
  sceneRef?.removeChild(obj)
  obj.destroy()
  updateInstanceCount()
}

// ── Image Processing UI ───────────────────────────────────────────────────

function bindImageProcessingUI(scene: Scene3D, view: View3D, postComp: PostProcessingComponent) {
  const sky = Engine3D.setting.sky
  const post = Engine3D.setting.render.postProcessing

  function bindSlider(
    rangeId: string,
    numId: string,
    min: number,
    max: number,
    step: number,
    getValue: () => number,
    setValue: (v: number) => void
  ) {
    const range = document.getElementById(rangeId) as HTMLInputElement
    const num = document.getElementById(numId) as HTMLInputElement
    if (!range || !num) return
    const clamp = (v: number) => Math.min(max, Math.max(min, v))
    const sync = () => {
      const v = getValue()
      range.value = String(v)
      num.value = String(Number(v.toFixed(3)))
    }
    range.min = String(min); range.max = String(max); range.step = String(step)
    num.min = String(min); num.max = String(max); num.step = String(step)
    sync()
    range.addEventListener('input', () => {
      const v = clamp(Number(range.value))
      setValue(v)
      num.value = String(Number(v.toFixed(3)))
    })
    num.addEventListener('change', () => {
      const v = clamp(Number(num.value) || min)
      setValue(v)
      range.value = String(v)
    })
  }

  function bindCheck(id: string, getValue: () => boolean, setValue: (v: boolean) => void) {
    const el = document.getElementById(id) as HTMLInputElement
    if (!el) return
    el.checked = getValue()
    el.addEventListener('change', () => setValue(el.checked))
  }

  if (sky) {
    bindSlider('ip-sky-exposure', 'ip-sky-exposure-n', 0, 8, 0.05,
      () => sky.skyExposure, (v) => { sky.skyExposure = v })
  }
  bindSlider('ip-skybox-exposure', 'ip-skybox-exposure-n', 0, 8, 0.05,
    () => scene.exposure, (v) => { scene.exposure = v })
  bindSlider('ip-skybox-roughness', 'ip-skybox-roughness-n', 0, 1, 0.01,
    () => scene.roughness, (v) => { scene.roughness = v })

  bindCheck('ip-post-enabled', () => postComp.enable, (v) => {
    postComp.enable = v
    ;(post as { enable?: boolean }).enable = v
  })

  if (post.bloom) {
    bindSlider('ip-bloom-intensity', 'ip-bloom-intensity-n', 0, 10, 0.05,
      () => post.bloom!.bloomIntensity, (v) => { post.bloom!.bloomIntensity = v })
  }

  if (post.taa) {
    bindCheck('ip-taa-enabled', () => post.taa!.enable, (v) => {
      post.taa!.enable = v
      view.camera.enableJitterProjection(v)
      // Orillusion Ctor 타입과 TypeScript 간 호환 문제로 as any 사용
      // removePost도 인스턴스가 아닌 클래스를 받음
      if (v) { if (!postComp.getPost(TAAPost as any)) postComp.addPost(TAAPost as any) }
      else { postComp.removePost(TAAPost as any) }
    })
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  markStep(1)
  markStep(2)
  markStep(3)
  setStatus('연결 중… 엔진 초기화')

  const loadingStart = performance.now()
  let stableFrames = 0
  let overlayHidden = false

  const lateRender = () => {
    const fps = Time.delta > 0 ? Math.round(1000 / Time.delta) : 0
    statsFps.textContent = String(fps)
    // 메인 모델 자동 회전 (Y축)
    if (modelTemplate) modelTemplate.rotationY += Time.delta * 0.001 * 25

    if (overlayHidden) return
    if (fps >= MIN_FPS) {
      if (++stableFrames >= STABLE_FRAME_THRESHOLD) {
        overlayHidden = true
        hideLoadingOverlay(performance.now() - loadingStart)
      }
    } else {
      stableFrames = 0
    }
  }

  // 엔진 초기화
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  await Engine3D.init({ canvasConfig: { canvas }, lateRender })
  markStep(4)
  requestAnimationFrame(() => webGPUContext.updateSize())

  // 씬 생성
  const scene = new Scene3D()

  // HDR 로드
  markStep(5)
  setStatus('mount: HDR·GLB 로드 중…')
  const envMap = await Engine3D.res.loadHDRTextureCube(ENV_HDR_URL)

  // 렌더 설정
  scene.exposure = 0.85
  scene.roughness = 0.4
  Engine3D.setting.render.hdrExposure = 1.2
  if (Engine3D.setting.sky) Engine3D.setting.sky.skyExposure = 1.0
  const post = Engine3D.setting.render.postProcessing
  if (post.bloom) { post.bloom.enable = true; post.bloom.bloomIntensity = 1; post.bloom.hdr = 1 }
  if ((post as { enable?: boolean }).enable === undefined) (post as { enable?: boolean }).enable = true
  if (post.taa) { post.taa.enable = true; post.taa.sharpFactor = 0.43; post.taa.blendFactor = 0.1; post.taa.sharpPreBlurFactor = 0.4 }

  // 스카이 (HDR 큐브맵)
  const sky = scene.addComponent(SkyRenderer)
  scene.envMap = envMap
  sky.map = envMap

  // 카메라
  const cameraObj = new Object3D()
  const mainCamera = cameraObj.addComponent(Camera3D)
  mainCamera.perspective(60, Engine3D.aspect, 0.1, 5000.0)
  scene.addChild(cameraObj)
  const controller = cameraObj.addComponent(HoverCameraController)
  controller.setCamera(0, -25, 8)
  controller.mouseLeftFactor = 10
  controller.mouseRightFactor = 0.15

  // 방향광
  const lightObj = new Object3D()
  lightObj.rotationX = 45
  lightObj.rotationY = 60
  const dirLight = lightObj.addComponent(DirectLight)
  dirLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355)
  dirLight.intensity = 5
  scene.addChild(lightObj)

  // GLB 로드 (실패 시 데미지 헬멧으로 폴백)
  let model: Object3D
  try {
    model = await Engine3D.res.loadGltf(HOVERCAR_GLB)
    loadedGlbUrl = HOVERCAR_GLB
  } catch (e) {
    console.warn('호버카 GLB 로드 실패 — 데미지 헬멧으로 폴백.', e)
    model = await Engine3D.res.loadGltf(FALLBACK_GLB)
    loadedGlbUrl = FALLBACK_GLB
  }
  model.rotationY = 35
  applyGlbMaterialTweaks(model)
  scene.addChild(model)
  sceneRef = scene
  modelTemplate = model
  instanceList.push(model)
  await playFirstAnimation(model, loadedGlbUrl)

  // 버튼 연결
  btnAdd.addEventListener('click', addInstance)
  btnRemove.addEventListener('click', removeInstance)

  // 뷰 생성 및 렌더 시작
  const view = new View3D()
  view.scene = scene
  view.camera = mainCamera
  Engine3D.startRenderView(view)

  // 포스트 프로세싱
  const postComp = view.scene.getOrAddComponent(PostProcessingComponent)
  postComp.addPost(BloomPost)
  postComp.addPost(TAAPost)

  // UI 바인딩
  bindImageProcessingUI(scene, view, postComp)

  const btnDisconnect = document.getElementById('btn-disconnect') as HTMLButtonElement
  if (btnDisconnect) btnDisconnect.disabled = false
}

main().catch((e) => {
  console.error(e)
  setStatus(`오류: ${e instanceof Error ? e.message : String(e)}`, true)
  const btnDisconnect = document.getElementById('btn-disconnect') as HTMLButtonElement
  if (btnDisconnect) btnDisconnect.disabled = false
})
