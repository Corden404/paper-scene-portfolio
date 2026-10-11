import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshReflectorMaterial, useGLTF, useTexture } from '@react-three/drei';
import type { MeshReflectorMaterial as ReflectorMaterial } from '@react-three/drei/materials/MeshReflectorMaterial';
import { Bloom, EffectComposer, Noise, SMAA } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { ArrowLeft, ArrowRight, ArrowUpRight, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import {
  AdditiveBlending, AgXToneMapping, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide,
  InstancedBufferAttribute, InstancedMesh, Matrix4, MathUtils, Mesh, MeshDepthMaterial,
  MeshStandardMaterial, PerspectiveCamera, Quaternion, RGBADepthPacking, ShaderMaterial,
  SRGBColorSpace, Vector3,
} from 'three';
import type { DirectionalLight, Texture } from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { portfolio, stages } from '../config/portfolio';
import type { PortfolioProject, Stage } from '../config/portfolio';
import FinalPortfolio from './FinalPortfolio';
import { createSkyGlowTexture } from '../utils/skyGlowTexture';
import { createPaperTexture } from '../utils/paperTexture';
import RealtimeFog, { createAtmosphere } from './RealtimeFog';
import type { AtmosphereData } from './RealtimeFog';
import RealtimeGrade from './RealtimeGrade';
import { createLightingTexture, createPaperMaterial } from './realtimePaperMaterial';
import type { LightingTexture } from './realtimePaperMaterial';
import './realtime-preview.css';

RectAreaLightUniformsLib.init();
const chapters = stages;
type Chapter = Stage;
type Quality = 'cinema' | 'balanced';
type GeometryData = { positions: number[]; normals: number[]; uvs: number[]; indices: number[] };
type CameraSample = { frame: number; position: number[]; quaternion: number[]; landscapeLens: number; portraitLens: number };
type SceneData = {
  instanceCount: number; instanceStride: number; assetVersion: string; sourceSha256: string;
  groups: { name: string; offset: number; count: number; prototype: { ground: boolean; texture: string; levels: GeometryData[] } }[];
  stops: Record<Chapter, number>;
  camera: { sensorWidth: number; frames: CameraSample[] };
};
type LightingData = { sourceSha256: string; bakedPapers: number; grid: [number, number] };
type HeroLightingData = { sourceSha256: string; names: string[]; frames: number[]; grid: [number, number]; weights: [number, number, number][] };
type SceneBundle = { data: SceneData; binary: ArrayBuffer; lighting: LightingData; lightBinary: ArrayBuffer;
  atmosphere: AtmosphereData; volumeBinary: ArrayBuffer; heroLighting: HeroLightingData; heroBinary: ArrayBuffer };
type PreviewStats = { ready: boolean; frame: number; fps: number; renderFrames: number; triangles: number; drawCalls: number; instances: number; moving: boolean; quality: Quality };
declare global { interface Window { __PAPER_3D?: PreviewStats } }

const params = new URLSearchParams(window.location.search);
const sceneOnly = params.get('view') === 'scene';
const still = params.get('still') === '1';
const requested = params.get('chapter') as Chapter;
const textureUrls = Array.from({ length: 7 }, (_, i) => `/assets/realtime/cotton-print-${i + 1}.png`);
let bundlePromise: Promise<SceneBundle> | undefined;
function loadBundle() {
  return bundlePromise ??= Promise.all([
    fetch('/assets/realtime/scene.json').then(async response => {
      if (!response.ok) throw new Error('The 3D scene could not be loaded.');
      return response.json() as Promise<SceneData>;
    }),
    fetch('/assets/realtime/papers.bin').then(async response => {
      if (!response.ok) throw new Error('The paper geometry could not be loaded.');
      return response.arrayBuffer();
    }),
    fetch('/assets/realtime/lighting.json').then(async response => {
      if (!response.ok) throw new Error('The scene lighting could not be loaded.');
      return response.json() as Promise<LightingData>;
    }),
    fetch('/assets/realtime/lighting.bin').then(async response => {
      if (!response.ok) throw new Error('The surface lighting could not be loaded.');
      return response.arrayBuffer();
    }),
    fetch('/assets/realtime/atmosphere.json').then(async response => {
      if (!response.ok) throw new Error('The atmosphere could not be loaded.');
      return response.json() as Promise<AtmosphereData>;
    }),
    fetch('/assets/realtime/atmosphere.bin').then(async response => {
      if (!response.ok) throw new Error('The atmosphere lighting could not be loaded.');
      return response.arrayBuffer();
    }),
    fetch('/assets/realtime/hero-lighting.json').then(async response => {
      if (!response.ok) throw new Error('The paper lighting could not be loaded.');
      return response.json() as Promise<HeroLightingData>;
    }),
    fetch('/assets/realtime/hero-lighting.bin').then(async response => {
      if (!response.ok) throw new Error('The paper illumination could not be loaded.');
      return response.arrayBuffer();
    }),
  ]).then(([data, binary, lighting, lightBinary, atmosphere, volumeBinary, heroLighting, heroBinary]) => {
    if (data.instanceCount !== 10436 || data.instanceStride !== 23 || binary.byteLength !== data.instanceCount * 23 * 4) {
      throw new Error('The 3D scene is incomplete.');
    }
    if (lighting.sourceSha256 !== data.sourceSha256 || lighting.bakedPapers !== data.instanceCount ||
        lightBinary.byteLength !== data.instanceCount * 2 * lighting.grid[0] * lighting.grid[1] * 3 * 2) {
      throw new Error('The surface lighting belongs to another scene.');
    }
    if (atmosphere.sourceSha256 !== data.sourceSha256 || volumeBinary.byteLength !== atmosphere.grid.reduce((a, b) => a * b, 1) * 32) {
      throw new Error('The atmosphere belongs to another scene.');
    }
    if (heroLighting.sourceSha256 !== data.sourceSha256 || heroBinary.byteLength !==
        heroLighting.frames.length * heroLighting.names.length * 2 * heroLighting.grid[0] * heroLighting.grid[1] * 6 ||
        heroLighting.weights?.length !== data.camera.frames.length) {
      throw new Error('The paper lighting belongs to another scene.');
    }
    if (chapters.some(chapter => !data.camera.frames.some(sample => sample.frame === data.stops[chapter]))) {
      throw new Error('The camera journey is incomplete.');
    }
    return { data, binary, lighting, lightBinary, atmosphere, volumeBinary, heroLighting, heroBinary };
  });
}

function createGeometry(data: GeometryData) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(data.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(data.normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(data.uvs), 2));
  geometry.setIndex(data.indices);
  return geometry;
}

function PaperInstances({ data, binary, textures, lighting, grid }: {
  data: SceneData; binary: ArrayBuffer; textures: Texture[]; lighting: LightingTexture; grid: [number, number];
}) {
  const collection = useMemo(() => {
    const depths = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide });
    const materials: ShaderMaterial[] = [];
    const meshes: InstancedMesh[] = [];
    const matrix = new Matrix4();
    const cameraPoints = data.camera.frames.filter((_, i) => i % 12 === 0).map(f => f.position);
    for (const group of data.groups) {
      const number = Number(group.prototype.texture.match(/(\d+)/)![1]) - 1;
      const material = createPaperMaterial(textures[number], lighting, grid, true, .42);
      materials.push(material);
      const records = new Float32Array(binary, group.offset, group.count * data.instanceStride);
      const sets: number[][] = [[], [], []];
      for (let i = 0; i < group.count; i++) {
        const start = i * data.instanceStride;
        const x = records[start + 12], y = records[start + 13], z = records[start + 14];
        const nearest = Math.min(...cameraPoints.map(p => {
          return Math.hypot(x - p[0], y - p[1], z - p[2]);
        }));
        const level = nearest < 2.7 ? 2 : nearest < 6 ? 1 : 0;
        sets[level].push(i);
      }
      for (let level = 0; level < 3; level++) {
        const indices = sets[level];
        if (!indices.length) continue;
        const geometry = createGeometry(group.prototype.levels[level]);
        const offsets = new Float32Array(indices.length);
        const mesh = new InstancedMesh(geometry, material, indices.length);
        indices.forEach((record, index) => {
          const start = record * data.instanceStride;
          matrix.fromArray(records, start);
          mesh.setMatrixAt(index, matrix);
          offsets[index] = (group.offset / (data.instanceStride * 4) + record) * grid[0] * grid[1] * 2;
        });
        geometry.setAttribute('aLightingOffset', new InstancedBufferAttribute(offsets, 1));
        mesh.name = `${group.name} / detail ${level}`;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = !group.prototype.ground;
        mesh.customDepthMaterial = depths;
        meshes.push(mesh);
      }
    }
    return { meshes, materials, depths, users: 0 };
  }, [binary, data, textures, lighting, grid]);
  useEffect(() => {
    collection.users++;
    return () => {
      collection.users--;
      queueMicrotask(() => {
        if (collection.users) return;
        collection.meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.dispose(); });
        collection.materials.forEach(material => material.dispose());
        collection.depths.dispose();
      });
    };
  }, [collection]);
  return <group>{collection.meshes.map(mesh => <primitive key={mesh.name} object={mesh} />)}</group>;
}

function ReflectiveFloor({ height, screen }: { height: number; screen: Vector3 }) {
  const floor = useRef<ReflectorMaterial>(null);
  useEffect(() => {
    const material = floor.current as (ReflectorMaterial & { v4Reflection?: boolean }) | null;
    if (!material || material.v4Reflection) return;
    material.v4Reflection = true;
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
      compile.call(material, shader);
      shader.uniforms.v4Screen = { value: screen };
      shader.vertexShader = 'varying vec3 v4Ground;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nv4Ground = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = 'uniform vec3 v4Screen;\nvarying vec3 v4Ground;\n' + shader.fragmentShader;
      // Reflection is a specular contribution, independent of the very dark
      // concrete's diffuse albedo. The source's warm screen stays visible.
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        '#include <opaque_fragment>\n' +
        'float groundFresnel = .13 + .13 * pow(1.0-abs(dot(normal,geometryViewDir)),2.0);\n' +
        'float mineralGrain = fract(sin(dot(vUv*1800.0,vec2(12.9898,78.233)))*43758.5453);\n' +
        'vec3 floorView = normalize(cameraPosition-v4Ground);\n' +
        'vec3 screenDirection = normalize(v4Screen-v4Ground);\n' +
        'float screenLobe = pow(max(0.0,dot(reflect(-floorView,vec3(0,1,0)),screenDirection)),220.0);\n' +
        'gl_FragColor.rgb += (newMerge.rgb * groundFresnel + vec3(1.0,.85,.65)*screenLobe*.45) * (.75+.5*mineralGrain);');
    };
    material.customProgramCacheKey = () => 'v4-concrete-specular-reflection';
    material.needsUpdate = true;
  }, [screen]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height + .0001, 0]}>
    <planeGeometry args={[36, 42]} />
    <MeshReflectorMaterial ref={floor} resolution={512} blur={[20, 32]} mixBlur={2} mixStrength={.65}
      mirror={0} roughness={.12} metalness={0} color="#070d0f" depthScale={.16}
      minDepthThreshold={.7} maxDepthThreshold={1.4} />
  </mesh>;
}

function Room({ quality, version, lighting, metadata, frame, onOpenScreen }: { quality: Quality; version: string;
  lighting: LightingTexture; metadata: HeroLightingData; frame: MutableRefObject<number>; onOpenScreen: () => void }) {
  const gltf = useGLTF(`/assets/realtime/room.glb?v=${version}`);
  const monitor = useTexture(portfolio.monitorImage);
  const { gl } = useThree();
  monitor.colorSpace = SRGBColorSpace;
  monitor.flipY = false;
  monitor.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  const room = useMemo(() => {
    const scene = gltf.scene.clone(true);
    let floorHeight = -.08;
    const screen = new Vector3(0, 1.3, 0);
    const heroMaterials: ShaderMaterial[] = [];
    const ownedGeometries: BufferGeometry[] = [];
    const ownedMaterials: (MeshStandardMaterial | ShaderMaterial)[] = [];
    const ownedTextures: Texture[] = [];
    scene.traverse(object => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const name = mesh.name.replace(/_/g, ' ');
      mesh.castShadow = !name.includes('display');
      mesh.receiveShadow = false;
      if (name === 'Polished concrete floor') {
        floorHeight = new Box3().setFromObject(mesh).max.y;
        mesh.visible = false; return;
      }
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = originals.map(original => {
        const material = original.clone() as MeshStandardMaterial;
        material.side = DoubleSide;
        if (name.includes('hero surface')) {
          const index = metadata.names.findIndex(entry => entry === name);
          if (index < 0 || !material.map) throw new Error('The printed paper is incomplete.');
          const geometry = mesh.geometry.clone();
          const count = geometry.getAttribute('position').count;
          const offset = new Float32Array(count).fill(index * metadata.grid[0] * metadata.grid[1] * 2);
          const sides = new Float32Array(count);
          const normals = geometry.getAttribute('normal');
          for (let i = 0; i < count; i++) sides[i] = normals.getY(i) > 0 ? 0 : 1;
          geometry.setAttribute('aLightingOffset', new BufferAttribute(offset, 1));
          geometry.setAttribute('aLightingSide', new BufferAttribute(sides, 1));
          mesh.geometry = geometry; ownedGeometries.push(geometry);
          const project: PortfolioProject | undefined = portfolio.projects[index];
          const print = project?.editablePrint ? createPaperTexture(project) : material.map;
          if (print !== material.map) ownedTextures.push(print);
          const paper = createPaperMaterial(print, lighting, metadata.grid, false, .38, true);
          heroMaterials.push(paper); ownedMaterials.push(paper); material.dispose();
          return paper;
        }
        if (name.includes('Monitor warm display')) {
          new Box3().setFromObject(mesh).getCenter(screen);
          material.map = monitor;
          // V4's display is an emission surface. It does not receive the
          // skylight's glossy highlight, which would obscure the profile.
          material.color.setRGB(0, 0, 0);
          material.roughness = 1;
          material.metalness = 0;
          material.onBeforeCompile = shader => {
            shader.fragmentShader = shader.fragmentShader.replace(
              'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
              'vec3 totalSpecular = vec3(0.0);');
          };
          material.customProgramCacheKey = () => 'v4-emission-display';
          material.emissive = new Color('#fff4df');
          material.emissiveMap = monitor;
          material.emissiveIntensity = 12;
        } else if (!name.includes('charcoal hall')) {
          // The V4 sky lights exclude furniture. Reduce the realtime rig's
          // direct contribution on the desk while retaining screen bounce.
          material.onBeforeCompile = shader => {
            shader.fragmentShader = shader.fragmentShader.replace(
              'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
              'vec3 totalDiffuse = .5*reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;');
          };
          material.customProgramCacheKey = () => 'v4-furniture-light-link-compensation';
        }
        ownedMaterials.push(material);
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    });
    return { scene, floorHeight, screen, heroMaterials, ownedMaterials, ownedGeometries, ownedTextures, users: 0 };
  }, [gltf.scene, lighting, metadata, monitor]);
  useEffect(() => {
    room.users++;
    return () => {
      room.users--;
      queueMicrotask(() => {
        if (room.users) return;
        room.ownedMaterials.forEach(material => material.dispose());
        room.ownedGeometries.forEach(geometry => geometry.dispose());
        room.ownedTextures.forEach(texture => texture.dispose());
      });
    };
  }, [room]);
  useFrame(() => {
    const offset = MathUtils.clamp(frame.current - metadata.weights[0][0], 0, metadata.weights.length - 1);
    const lower = Math.floor(offset);
    const next = Math.min(lower + 1, metadata.weights.length - 1);
    const blend = offset - lower;
    const reading = MathUtils.lerp(metadata.weights[lower][1], metadata.weights[next][1], blend);
    const fill = MathUtils.lerp(metadata.weights[lower][2], metadata.weights[next][2], blend);
    const stride = metadata.names.length * metadata.grid[0] * metadata.grid[1] * 2;
    room.heroMaterials.forEach(material => {
      material.uniforms.uFrameBase.value = 0;
      material.uniforms.uNextFrameBase.value = stride;
      material.uniforms.uFrameBlend.value = reading;
      material.uniforms.uFillFrameBase.value = 2 * stride;
      material.uniforms.uFillBlend.value = fill;
    });
  });
  return <>
    <primitive object={room.scene} dispose={null} onClick={(event: { object: Mesh; stopPropagation: () => void }) => {
      if (event.object.name.replace(/_/g, ' ').includes('Monitor warm display')) {
        event.stopPropagation(); onOpenScreen();
      }
    }} />
    {quality === 'cinema' ? <ReflectiveFloor height={room.floorHeight} screen={room.screen} /> :
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, room.floorHeight + .0001, 0]}>
        <planeGeometry args={[36, 42]} /><meshStandardMaterial color="#070d0f" roughness={.75} metalness={.15} />
      </mesh>}
  </>;
}

function FrameSchedule({ active, quality }: { active: boolean; quality: Quality }) {
  const { invalidate } = useThree();
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    const interval = 1000 / (quality === 'cinema' ? 60 : 30);
    const tick = (now: number) => {
      if (document.visibilityState === 'visible' && now - last >= interval) {
        last = now - (now - last) % interval;
        invalidate();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, invalidate, quality]);
  return null;
}

function World({ bundle, chapter, quality, reducedMotion, jump, onReady, onArrive, onOpenScreen }: {
  bundle: SceneBundle; chapter: Chapter; quality: Quality;
  reducedMotion: boolean; jump: boolean; onReady: () => void; onArrive: () => void; onOpenScreen: () => void;
}) {
  const { camera, size, gl } = useThree();
  const light = useRef<DirectionalLight>(null);
  const frame = useRef(bundle.data.stops[chapters.includes(requested) ? requested : 'intro']);
  const flight = useRef<{ from: number; to: number; elapsed: number; duration: number } | null>(null);
  const textures = useTexture(textureUrls);
  const lighting = useMemo(() => createLightingTexture(bundle.lightBinary), [bundle.lightBinary]);
  const heroLighting = useMemo(() => createLightingTexture(bundle.heroBinary), [bundle.heroBinary]);
  const atmosphere = useMemo(() => createAtmosphere(bundle.atmosphere, bundle.volumeBinary), [bundle.atmosphere, bundle.volumeBinary]);
  const ownedLighting = useMemo(() => ({ users: 0, lighting, heroLighting, atmosphere }), [lighting, heroLighting, atmosphere]);
  useEffect(() => {
    ownedLighting.users++;
    return () => {
      ownedLighting.users--;
      queueMicrotask(() => {
        if (ownedLighting.users) return;
        ownedLighting.lighting.texture.dispose();
        ownedLighting.heroLighting.texture.dispose();
        ownedLighting.atmosphere.textures.forEach(texture => texture.dispose());
      });
    };
  }, [ownedLighting]);
  textures.forEach(texture => { texture.colorSpace = SRGBColorSpace; texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy()); });
  const glow = useMemo(() => createSkyGlowTexture(), []);
  const point = useMemo(() => new Vector3(), []);
  const nextPoint = useMemo(() => new Vector3(), []);
  const rotation = useMemo(() => new Quaternion(), []);
  const nextRotation = useMemo(() => new Quaternion(), []);
  const fps = useRef({ frames: 0, elapsed: 0, value: 0, total: 0 });
  const parallax = useRef({ x: 0, y: 0 });
  const ready = useRef(false);

  useEffect(() => {
    const target = bundle.data.stops[chapter];
    if (Math.abs(target - frame.current) < .01) { onArrive(); return; }
    if (reducedMotion || jump) { frame.current = target; flight.current = null; onArrive(); return; }
    flight.current = { from: frame.current, to: target, elapsed: 0, duration: Math.min(8, Math.abs(target - frame.current) / 28) };
  }, [bundle.data.stops, chapter, jump, onArrive, reducedMotion]);

  useFrame((state, delta) => {
    if (!ready.current) { ready.current = true; onReady(); }
    const moving = flight.current;
    if (moving) {
      moving.elapsed += Math.min(delta, .1);
      const portion = Math.min(1, moving.elapsed / moving.duration);
      frame.current = MathUtils.lerp(moving.from, moving.to, portion);
      if (portion === 1) { flight.current = null; onArrive(); }
    }
    const frames = bundle.data.camera.frames;
    const f = frame.current - frames[0].frame;
    const index = MathUtils.clamp(Math.floor(f), 0, frames.length - 1);
    const from = frames[index], to = frames[Math.min(index + 1, frames.length - 1)];
    const blend = f - Math.floor(f);
    point.fromArray(from.position).lerp(nextPoint.fromArray(to.position), blend);
    rotation.fromArray(from.quaternion).slerp(nextRotation.fromArray(to.quaternion), blend);
    camera.position.copy(point); camera.quaternion.copy(rotation);
    const aspect = size.width / size.height;
    const lens = MathUtils.lerp(aspect >= 1 ? from.landscapeLens : from.portraitLens,
      aspect >= 1 ? to.landscapeLens : to.portraitLens, blend);
    // Match the original image's cover crop at unusual screen ratios, while
    // keeping the authored horizontal field of view for its native formats.
    const coverAspect = Math.max(aspect, aspect >= 1 ? 16 / 9 : 816 / 1456);
    const fov = MathUtils.radToDeg(2 * Math.atan(bundle.data.camera.sensorWidth / (2 * lens * coverAspect)));
    const perspective = camera as PerspectiveCamera;
    if (Math.abs(perspective.fov - fov) > .001) { perspective.fov = fov; perspective.updateProjectionMatrix(); }
    if (!still && !reducedMotion && !flight.current) {
      parallax.current.x = MathUtils.damp(parallax.current.x, state.pointer.x * .010, 3, delta);
      parallax.current.y = MathUtils.damp(parallax.current.y, state.pointer.y * .006, 3, delta);
      camera.translateX(parallax.current.x); camera.translateY(parallax.current.y);
      camera.rotateY(-parallax.current.x * .07); camera.rotateX(parallax.current.y * .07);
    }
    camera.updateMatrixWorld();
    if (light.current) {
      light.current.target.position.set(0, 3, 1);
      light.current.target.updateMatrixWorld();
    }
    fps.current.frames++; fps.current.total++; fps.current.elapsed += delta;
    if (fps.current.elapsed >= .6) {
      fps.current.value = Math.round(fps.current.frames / fps.current.elapsed);
      fps.current.frames = 0; fps.current.elapsed = 0;
    }
    window.__PAPER_3D = {
      ready: true, frame: frame.current, fps: fps.current.value, renderFrames: fps.current.total,
      triangles: gl.info.render.triangles, drawCalls: gl.info.render.calls,
      instances: bundle.data.instanceCount, moving: !!flight.current, quality,
    };
    gl.info.reset();
  });

  return <>
    <color attach="background" args={['#080f13']} />
    <ambientLight intensity={.12} color="#a4bec4" />
    <hemisphereLight args={['#b8d7dc', '#080d10', .30]} />
    <directionalLight ref={light} position={[-.4, 12, -8]} color="#c0dae1" intensity={3.2}
      castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-10} shadow-camera-right={10}
      shadow-camera-top={10} shadow-camera-bottom={-10} shadow-camera-near={.1} shadow-camera-far={36}
      shadow-bias={-.001} shadow-autoUpdate={false} shadow-needsUpdate />
    <directionalLight position={[-1, 13, 1]} color="#a4c1cf" intensity={.38} />
    <directionalLight position={[-5, 7, 7]} color="#a4c0c5" intensity={.10} />
    <rectAreaLight position={[0, 5.5, 7]} rotation={[-.5, 0, 0]} color="#c2d0d3"
      intensity={chapter === 'intro' ? 0 : .7} width={5} height={5} />
    <pointLight position={[0, 1, -.7]} color="#ffe5b7" intensity={3.5} distance={4} decay={2} />
    <mesh position={[-.4, 12.8, -9]} rotation={[-.62, 0, 0]}>
      <planeGeometry args={[9, 8]} />
      <meshBasicMaterial map={glow} color={new Color().setRGB(5.4, 7.1, 7.4)} transparent
        depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
    <PaperInstances data={bundle.data} binary={bundle.binary} textures={textures} lighting={lighting} grid={bundle.lighting.grid} />
    <Room quality={quality} version={bundle.data.assetVersion} lighting={heroLighting} metadata={bundle.heroLighting} frame={frame} onOpenScreen={onOpenScreen} />
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <RealtimeFog field={atmosphere} quality={quality} />
      <Bloom mipmapBlur luminanceThreshold={1.5} luminanceSmoothing={.28} intensity={.20} />
      <RealtimeGrade version={bundle.data.assetVersion} />
      <SMAA />
      <Noise opacity={.008} blendFunction={BlendFunction.SOFT_LIGHT} />
    </EffectComposer>
  </>;
}

class PreviewBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function RealtimePreview() {
  const [bundle, setBundle] = useState<SceneBundle>();
  const [chapter, setChapter] = useState<Chapter>(chapters.includes(requested) ? requested : 'intro');
  const [ready, setReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const [jump, setJump] = useState(false);
  const [webEntered, setWebEntered] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<Quality>(() => window.innerWidth < 720 ? 'balanced' : 'cinema');
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const onReady = useCallback(() => setReady(true), []);
  const onArrive = useCallback(() => setMoving(false), []);
  const onError = useCallback((message: string) => { setError(message); setMoving(false); }, []);
  const index = chapters.indexOf(chapter);
  const project = portfolio.projects.find(project => project.id === chapter);
  const goTo = useCallback((next: Chapter, skipFlight = false) => {
    if (!ready || error || (moving && !skipFlight)) return;
    setWebEntered(false);
    if (chapter === next && !moving) return;
    setJump(skipFlight); setMoving(!reducedMotion && !skipFlight); setChapter(next);
  }, [chapter, error, moving, ready, reducedMotion]);
  const onOpenScreen = useCallback(() => {
    if (chapter === 'screen' && ready && !moving) window.open(portfolio.github, '_blank', 'noopener,noreferrer');
  }, [chapter, moving, ready]);
  useEffect(() => {
    let active = true;
    void loadBundle().then(value => { if (active) setBundle(value); }).catch(err => { if (active) onError(String(err.message)); });
    return () => { active = false; };
  }, [onError]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') || (event.target as HTMLElement).closest('button,a,input,textarea')) return;
      if (event.key === 'Escape' && webEntered) { goTo(chapters[chapters.length - 2], true); return; }
      if (webEntered) return;
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') {
        event.preventDefault(); goTo(chapters[Math.min(index + 1, chapters.length - 1)]);
      }
      if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(chapters[Math.max(0, index - 1)]); }
      if (event.key === 'Home') { event.preventDefault(); goTo('intro'); }
      if (event.key === 'End') { event.preventDefault(); goTo('screen', true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, webEntered]);
  const heading = project ? project.heroHeading : chapter === 'screen' ? 'THE WORK\nCOMES INTO VIEW.' : "IDEAS DON'T\nSTAY ON PAPER.";
  return <div className={`experience experience--rendered realtime-preview${sceneOnly ? ' experience--scene-only' : ''}${webEntered ? ' experience--web' : ''}`}>
    <div className="scene-canvas" aria-hidden="true" onClick={() => {
      if (!sceneOnly && chapter !== 'screen') goTo(chapters[index + 1]);
    }}>
      {bundle && <PreviewBoundary onError={onError}>
        <Canvas frameloop="demand" shadows="basic" dpr={quality === 'cinema' ? [1, 1.25] : [0.75, 1]}
          gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: AgXToneMapping, toneMappingExposure: .9 }}
          onCreated={({ gl }) => { gl.info.autoReset = false; }}
          camera={{ near: .025, far: 55, position: [0, 2, 8] }}>
          <FrameSchedule active={!webEntered} quality={quality} />
          <Suspense fallback={null}>
            <World bundle={bundle} chapter={chapter} quality={quality} reducedMotion={reducedMotion} jump={jump} onReady={onReady} onArrive={onArrive} onOpenScreen={onOpenScreen} />
          </Suspense>
        </Canvas>
      </PreviewBoundary>}
    </div>
    <header className={`site-header${webEntered ? ' site-header--hidden' : ''}`}>
      <div className="brand"><span className="brand-icon">{portfolio.monogram}</span><span className="brand-label">PAPER SCENE<small>LIGHT, PAPER & SPACE</small></span></div>
      <div className="header-actions">
        <span className="realtime-indicator"><i /> LIVE 3D</span>
        <button className="quality-toggle" onClick={() => setQuality(quality === 'cinema' ? 'balanced' : 'cinema')} aria-label="Toggle 3D quality"
          aria-pressed={quality === 'cinema'} title={quality === 'cinema' ? 'Cinema quality · switch to Lite' : 'Lite quality · switch to Cinema'}>
          {quality === 'cinema' ? <Eye size={16} /> : <EyeOff size={16} />}<span>{quality === 'cinema' ? 'CINEMA' : 'LITE'}</span>
        </button>
        <button className="text-link" type="button" disabled={!ready || chapter === 'screen'} onClick={() => goTo('screen', true)}>SKIP INTRO <ArrowUpRight size={14} /></button>
        <a className="text-link realtime-reference" href={`/?render=video&view=scene&chapter=${chapter}`} target="_blank" rel="noreferrer">ORIGINAL <ArrowUpRight size={14} /></a>
      </div>
    </header>
    {!webEntered && <div className={`scene-copy scene-copy--${chapter}${project ? ' scene-copy--featured-paper' : ''}${moving ? ' scene-copy--moving' : ''}`}>
      <div className="intro-rule"><span /><p>{project?.tag ?? 'THE WORLD BETWEEN THE PAGES'}</p></div>
      <p className="scene-copy__index">{String(index).padStart(2, '0')} / {String(chapters.length - 1).padStart(2, '0')}</p>
      <h1>{heading.split('\n').map(line => <span key={line}>{line}</span>)}</h1>
      <p className="scene-copy__desc">{project?.summary ?? 'Follow the pages. A live journey through light, paper and space.'}</p>
      {index === 0 && <p className="intro-hint">MOVE YOUR POINTER · FOLLOW THE PAGES</p>}
    </div>}
    {!webEntered && <footer className="scene-footer">
      <div className="footer-chapters" aria-label="3D chapters">
        {chapters.map((entry, i) => <button className={`chapter-marker${entry === chapter ? ' chapter-marker--active' : ''}`}
          key={entry} disabled={!ready || moving} onClick={() => goTo(entry)} aria-current={entry === chapter ? 'step' : undefined}
          aria-label={`Go to ${entry}`}>
          <span className="chapter-marker__index">0{i}</span><span className="chapter-marker__bar" />
          <span className="chapter-marker__name">{i === 0 ? 'THE SPACE' : entry === 'screen' ? 'THE SCREEN' : `PAPER 0${i}`}</span>
        </button>)}
      </div>
      <div className="footer-actions">
        {index > 0 && <button className="back-button" disabled={!ready || moving} onClick={() => goTo(chapters[index - 1])}><ArrowLeft size={16} /> BACK</button>}
        {chapter === 'screen' ? <>
          <button type="button" className="replay-button" disabled={!ready || moving} onClick={() => goTo('intro', true)} aria-label="Replay journey"><RotateCcw size={16} /></button>
          <a className={`next-button${moving ? ' next-button--disabled' : ''}`} href={portfolio.github} target="_blank" rel="noreferrer" aria-disabled={moving} onClick={event => { if (moving) event.preventDefault(); }}>OPEN GITHUB <ArrowUpRight size={17} /></a>
        </> : <button className="next-button" disabled={!ready || moving} onClick={() => goTo(chapters[index + 1])}>
          {index === 0 ? 'BEGIN JOURNEY' : index === chapters.length - 2 ? 'THE FULL STORY' : 'NEXT CHAPTER'}<ArrowRight size={17} />
        </button>}
      </div>
    </footer>}
    {!webEntered && chapter === 'screen' && ready && !moving && <div className="screen-caption"><span>GITHUB.COM / CORDEN404</span><button type="button" className="text-link" onClick={() => setWebEntered(true)}>VIEW COLLECTION <ArrowUpRight size={14} /></button></div>}
    {webEntered && <div className="portfolio-transition"><FinalPortfolio onRevisit={() => goTo(chapters[chapters.length - 2], true)} /></div>}
    {!ready && !error && <div className="loading-screen" role="status" aria-live="polite"><div className="loading-logo">LQ</div><p>PREPARING THE SCENE</p><div className="loading-progress"><i /></div><span>LIGHT, PAPER & SPACE</span></div>}
    {error && <div className="error-screen" role="alert"><h2>The scene could not open.</h2><p>{error}</p><a className="next-button" href="/?render=video">OPEN THE ORIGINAL <ArrowUpRight size={16} /></a></div>}
  </div>;
}
