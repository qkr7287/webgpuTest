/**
 * AI 3D Commander — Three.js Scene Manager
 *
 * 3D 오브젝트 CRUD, 애니메이션, 조명, 카메라 관리.
 * 다크 배경 + 안개 + 그리드 바닥 + 그림자.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ShapeType, AnimationType, SceneObjectInfo } from './types'

interface ManagedObject {
  mesh: THREE.Mesh
  name: string
  shape: ShapeType
  animation: AnimationType
  baseY: number
}

export class SceneManager {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private objects: Map<string, ManagedObject> = new Map()
  private clock = new THREE.Clock()
  private directionalLight: THREE.DirectionalLight
  private autoNameCounter = 0
  private onCountChange: (count: number) => void

  constructor(canvas: HTMLCanvasElement, onCountChange: (count: number) => void) {
    this.onCountChange = onCountChange

    // Scene
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0a1a)
    this.scene.fog = new THREE.Fog(0x0a0a1a, 20, 50)

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60, canvas.clientWidth / canvas.clientHeight, 0.1, 100
    )
    this.camera.position.set(5, 5, 8)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    // Controls
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 1, 0)

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.6)
    this.scene.add(ambient)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
    this.directionalLight.position.set(5, 10, 5)
    this.directionalLight.castShadow = true
    this.directionalLight.shadow.mapSize.set(1024, 1024)
    this.directionalLight.shadow.camera.near = 0.5
    this.directionalLight.shadow.camera.far = 30
    this.directionalLight.shadow.camera.left = -10
    this.directionalLight.shadow.camera.right = 10
    this.directionalLight.shadow.camera.top = 10
    this.directionalLight.shadow.camera.bottom = -10
    this.scene.add(this.directionalLight)

    // Ground plane (shadow receiver)
    const groundGeo = new THREE.PlaneGeometry(40, 40)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.9,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)

    // Grid
    const grid = new THREE.GridHelper(40, 40, 0x222244, 0x1a1a2e)
    grid.position.y = 0.01
    this.scene.add(grid)

    // Resize handler
    const onResize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    // Animation loop
    this.animate()
  }

  private animate = () => {
    requestAnimationFrame(this.animate)
    const elapsed = this.clock.getElapsedTime()

    for (const obj of this.objects.values()) {
      switch (obj.animation) {
        case 'spin':
          obj.mesh.rotation.y += 0.02
          break
        case 'bounce':
          obj.mesh.position.y = obj.baseY + Math.abs(Math.sin(elapsed * 3)) * 1.5
          break
        case 'float':
          obj.mesh.position.y = obj.baseY + Math.sin(elapsed * 1.5) * 0.5
          break
      }
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private createGeometry(shape: ShapeType, size: number): THREE.BufferGeometry {
    const s = size
    switch (shape) {
      case 'box': return new THREE.BoxGeometry(s, s, s)
      case 'sphere': return new THREE.SphereGeometry(s * 0.5, 32, 32)
      case 'cylinder': return new THREE.CylinderGeometry(s * 0.4, s * 0.4, s, 32)
      case 'cone': return new THREE.ConeGeometry(s * 0.5, s, 32)
      case 'torus': return new THREE.TorusGeometry(s * 0.4, s * 0.15, 16, 48)
    }
  }

  private generateName(shape: ShapeType): string {
    this.autoNameCounter++
    return `${shape}-${this.autoNameCounter}`
  }

  createObject(
    shape: ShapeType = 'sphere',
    color: string = '#4fc3f7',
    position: [number, number, number] = [0, 1, 0],
    size: number = 1,
    name?: string,
    animation: AnimationType = 'none'
  ): string {
    const objName = name || this.generateName(shape)

    // Remove existing object with same name
    if (this.objects.has(objName)) {
      this.deleteObject(objName)
    }

    const geometry = this.createGeometry(shape, size)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.4,
      metalness: 0.3,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(position[0], position[1], position[2])
    mesh.castShadow = true
    mesh.receiveShadow = true

    this.scene.add(mesh)
    this.objects.set(objName, {
      mesh,
      name: objName,
      shape,
      animation,
      baseY: position[1],
    })

    this.onCountChange(this.objects.size)
    return objName
  }

  deleteObject(target: string): boolean {
    if (target === 'all') {
      this.clearAll()
      return true
    }

    if (target === 'last') {
      const keys = [...this.objects.keys()]
      if (keys.length === 0) return false
      target = keys[keys.length - 1]
    }

    const obj = this.objects.get(target)
    if (!obj) return false

    this.scene.remove(obj.mesh)
    obj.mesh.geometry.dispose()
    ;(obj.mesh.material as THREE.Material).dispose()
    this.objects.delete(target)
    this.onCountChange(this.objects.size)
    return true
  }

  moveObject(target: string, position: [number, number, number]): boolean {
    const obj = this.resolveTarget(target)
    if (!obj) return false
    obj.mesh.position.set(position[0], position[1], position[2])
    obj.baseY = position[1]
    return true
  }

  colorObject(target: string, color: string): boolean {
    const obj = this.resolveTarget(target)
    if (!obj) return false
    ;(obj.mesh.material as THREE.MeshStandardMaterial).color.set(color)
    return true
  }

  animateObject(target: string, animation: AnimationType): boolean {
    if (target === 'all') {
      for (const obj of this.objects.values()) {
        obj.animation = animation
      }
      return true
    }

    const obj = this.resolveTarget(target)
    if (!obj) return false
    obj.animation = animation
    if (animation === 'none') {
      obj.mesh.position.y = obj.baseY
      obj.mesh.rotation.y = 0
    }
    return true
  }

  updateLight(color?: string, intensity?: number): void {
    if (color) this.directionalLight.color.set(color)
    if (intensity !== undefined) this.directionalLight.intensity = intensity
  }

  moveCamera(position: [number, number, number]): void {
    this.camera.position.set(position[0], position[1], position[2])
    this.camera.lookAt(this.controls.target)
  }

  clearAll(): void {
    for (const obj of this.objects.values()) {
      this.scene.remove(obj.mesh)
      obj.mesh.geometry.dispose()
      ;(obj.mesh.material as THREE.Material).dispose()
    }
    this.objects.clear()
    this.autoNameCounter = 0
    this.onCountChange(0)
  }

  getSceneDescription(): string {
    if (this.objects.size === 0) return 'Scene is empty.'
    const items = [...this.objects.values()].map(o => {
      const p = o.mesh.position
      const c = '#' + (o.mesh.material as THREE.MeshStandardMaterial).color.getHexString()
      return `- "${o.name}": ${o.shape}, color=${c}, pos=[${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}], anim=${o.animation}`
    })
    return `Objects (${this.objects.size}):\n${items.join('\n')}`
  }

  getObjectNames(): string[] {
    return [...this.objects.keys()]
  }

  getObjectCount(): number {
    return this.objects.size
  }

  private resolveTarget(target: string): ManagedObject | undefined {
    if (target === 'last') {
      const keys = [...this.objects.keys()]
      if (keys.length === 0) return undefined
      return this.objects.get(keys[keys.length - 1])
    }

    // Exact match
    if (this.objects.has(target)) return this.objects.get(target)

    // Partial match
    for (const [key, obj] of this.objects) {
      if (key.includes(target) || target.includes(key)) return obj
    }

    return undefined
  }
}
