import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import { portfolio, stageFrames } from '../config/portfolio';
import type { Stage } from '../config/portfolio';
import { createPaperTexture } from '../utils/paperTexture';
import { createMonitorHaloTexture, createMonitorTexture } from '../utils/monitorTexture';
import { createSkyGlowTexture } from '../utils/skyGlowTexture';

type CameraFrame = {
  frame: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  lens: number;
};
type CameraPath = { frames: CameraFrame[]; sensorWidth: number; start: number; end: number };
type Floater = { mesh: Object3D; pos: Vector3; rz: number; rx: number; phase: number };
type SheetShader = { uniforms: { uPaperTime: { value: number } } };

const cameraPoint = new Vector3();
const cameraRotation = new Quaternion();
const cameraRotationNext = new Quaternion();
const clamp = MathUtils.clamp;

function updateCamera(camera: PerspectiveCamera, path: CameraPath, time: number, aspect: number) {
  const samples = path.frames;
  const bounded = clamp(time, samples[0].frame, samples[samples.length - 1].frame);
  const offset = bounded - samples[0].frame;
  const index = clamp(Math.floor(offset), 0, samples.length - 1);
  const next = Math.min(index + 1, samples.length - 1);
  const from = samples[index], to = samples[next];
  const alpha = offset - Math.floor(offset);

  cameraPoint.fromArray(from.position).lerp(new Vector3().fromArray(to.position), alpha);
  cameraRotation.fromArray(from.quaternion);
  cameraRotationNext.fromArray(to.quaternion);
  cameraRotation.slerp(cameraRotationNext, alpha);
  camera.position.copy(cameraPoint);
  camera.quaternion.copy(cameraRotation);

  const lens = MathUtils.lerp(from.lens, to.lens, alpha);
  const opticalFov = MathUtils.radToDeg(2 * Math.atan((path.sensorWidth / Math.max(aspect, 0.65)) / (2 * lens)));
  // Give the opening composition enough breathing room on wide screens.
  // Focus close-ups retain exactly the lens motion authored in Blender.
  const opening = 1 - MathUtils.smoothstep(bounded, 25, 104);
  const desiredFov = opticalFov + opening * (aspect >= 1 ? 19 : 8);
  if (Math.abs(camera.fov - desiredFov) > 0.02) {
    camera.fov = desiredFov;
    camera.updateProjectionMatrix();
  }
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function attachPaperMotion(mesh: Mesh, shaderRefs: SheetShader[]) {
  const geometry = mesh.geometry;
  const attribute = geometry.getAttribute('_SHEET_PHASE');
  if (!attribute || Array.isArray(mesh.material)) return;
  const material = mesh.material.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nattribute float _SHEET_PHASE;\nuniform float uPaperTime;'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
      'float sheetWave = sin(uPaperTime * (0.60 + fract(_SHEET_PHASE * 0.71) * 0.45) + _SHEET_PHASE * 6.28318);\n' +
      'transformed += vec3(0.005 * sin(uPaperTime * 0.43 + _SHEET_PHASE * 6.28318), 0.005 * sheetWave, 0.006 * sheetWave);'
    );
    shaderRefs.push(shader as unknown as SheetShader);
  };
  material.customProgramCacheKey = () => 'paper-sway-v1';
  mesh.material = material;
}

function configureScene(scene: Object3D, sheetShaders: SheetShader[]) {
  const floaters: Floater[] = [];
  const heroes: Object3D[] = [];
  const textures = portfolio.projects.map((project) => createPaperTexture(project));
  const monitorTexture = createMonitorTexture();
  const haloTexture = createMonitorHaloTexture();
  const disposable: Array<{ dispose(): void }> = [...textures, monitorTexture, haloTexture];

  scene.traverse((object) => {
    const name = object.name.replace(/_/g, ' '); // GLTFLoader normalizes spaces to underscores.
    const paperPart = /^Paper ([A-F]) \| (.+)$/i.exec(name);
    if (paperPart && /^(mock image|fine rule|temporary heading|temporary note|text line|label)/i.test(paperPart[2])) {
      object.visible = false;
    }
    if (paperPart && paperPart[2] === 'editable layout anchor') heroes.push(object);

    if (isMesh(object) && paperPart && paperPart[2] === 'hero surface') {
      const sheetIndex = paperPart[1].toUpperCase().charCodeAt(0) - 65;
      // Preserve real curved 3D surfaces, but replace the Blender's temporary
      // ink with config-driven canvas textures for all six sheets.
      object.material = new MeshStandardMaterial({
        map: textures[sheetIndex], color: '#fffdf4', roughness: 0.94, metalness: 0,
        // Diffuse ambient bounce allows legible ink without self-lit text.
        emissive: '#9eafa7', emissiveIntensity: 0.09, side: DoubleSide,
      });
      disposable.push(object.material);
    }
    if (isMesh(object) && name === 'Monitor warm display') {
      object.material = new MeshStandardMaterial({
        map: monitorTexture,
        color: '#fff9e8',
        emissive: '#fff0d4',
        emissiveMap: monitorTexture,
        emissiveIntensity: 1.5,
        roughness: 0.35,
        metalness: 0,
        side: DoubleSide,
      });
      disposable.push(object.material);
    }

    if (!isMesh(object)) return;
    // These are separate airborne sheets in the current Blender scene.
    if (/^(Exterior ordinary paper|Reference near-floor sheet)/i.test(name)) {
      const n = floaters.length;
      floaters.push({
        mesh: object,
        pos: object.position.clone(),
        rx: object.rotation.x,
        rz: object.rotation.z,
        phase: n * 2.39996 + (n % 7) * .33,
      });
    }
    if (/(Layered paper canopy|Continuous medium bowed paper tier|Reference middle-scale crossover sheets|Irregular descending cascade)/i.test(name)) {
      attachPaperMotion(object, sheetShaders);
    }
  });
  // The source screen's front plate is partly hidden by its chassis from the
  // authored long-shot viewpoint. A tiny unlit overlay behaves like genuine
  // emitted display light, rather than a piece of shaded paper.
  const panelGeometry = new PlaneGeometry(0.84, 0.338);
  // GLB textures use flipY=false while Three's PlaneGeometry has V=1 at its
  // upper edge. Reverse only this overlay's UVs to avoid inverted screen text.
  const panelUV = panelGeometry.getAttribute('uv');
  for (let i = 0; i < panelUV.count; i++) panelUV.setY(i, 1 - panelUV.getY(i));
  panelUV.needsUpdate = true;
  const panel = new Mesh(
    panelGeometry,
    new MeshBasicMaterial({ map: monitorTexture, color: '#fff7e8', toneMapped: false, side: DoubleSide }),
  );
  panel.name = 'WEB | emissive monitor front';
  panel.position.set(0, 0.934, -0.752);
  scene.add(panel);
  disposable.push(panel.geometry, panel.material);
  const halo = new Sprite(new SpriteMaterial({
    map: haloTexture, transparent: true, depthWrite: false, opacity: 0.65,
    blending: AdditiveBlending, toneMapped: false,
  }));
  halo.position.set(0, 0.95, -0.747);
  halo.scale.set(2.0, 1.3, 1);
  halo.name = 'WEB | monitor light halo';
  scene.add(halo);
  disposable.push(halo.material);

  const heroStarts = heroes.map((object) => ({ object, position: object.position.clone(), rotation: object.rotation.clone() }));
  return { floaters, heroStarts, disposable };
}

type Props = {
  stage: Stage;
  quality: 'cinema' | 'balanced';
  reducedMotion: boolean;
  onReady: () => void;
  onArrive: (stage: Stage) => void;
  onAssetError: (error: string) => void;
};

export default function PaperWorld({ stage, quality, reducedMotion, onReady, onArrive, onAssetError }: Props) {
  const gltf = useGLTF('/assets/paper-scene.glb');
  const { camera, size } = useThree();
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const shaders = useMemo<SheetShader[]>(() => [], [scene]);
  const visuals = useMemo(() => configureScene(scene, shaders), [scene, shaders]);
  const [path, setPath] = useState<CameraPath | null>(null);
  const skyGlow = useMemo(() => createSkyGlowTexture(), []);
  useEffect(() => () => skyGlow.dispose(), [skyGlow]);
  const frame = useRef(stageFrames.intro);
  const readyOnce = useRef(false);

  useEffect(() => {
    let active = true;
    fetch('/assets/camera-path.json')
      .then((res) => {
        if (!res.ok) throw new Error('Camera path was not exported (HTTP ' + res.status + ')');
        return res.json() as Promise<CameraPath>;
      })
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data.frames) || data.frames.length < 10) throw new Error('Invalid camera animation data');
        setPath(data);
      })
      .catch((error: unknown) => {
        if (active) onAssetError(error instanceof Error ? error.message : 'Unknown camera error');
      });
    return () => { active = false; };
  }, [onAssetError]);

  useEffect(() => {
    if (!path || readyOnce.current) return;
    readyOnce.current = true;
    updateCamera(camera as PerspectiveCamera, path, frame.current, size.width / size.height);
    onReady();
  }, [camera, onReady, path, size.height, size.width]);

  useEffect(() => {
    if (!path) return;
    const target = stageFrames[stage];
    const distance = Math.abs(target - frame.current);
    if (distance < 0.5) {
      onArrive(stage);
      return;
    }
    // People requesting reduced motion should see an instant chapter cut,
    // not an accelerated camera flight that may be more disorienting.
    if (reducedMotion) {
      frame.current = target;
      onArrive(stage);
      return;
    }
    const frameValue = { value: frame.current };
    const duration = Math.min(5.2, Math.max(2.6, distance / 31));
    const anim = gsap.to(frameValue, {
      value: target,
      duration: stage === 'screen' && distance > 160 ? 3.15 : duration,
      ease: 'none', // Real speed ramps already exist in baked Blender keyframes.
      onUpdate: () => { frame.current = frameValue.value; },
      onComplete: () => { frame.current = target; onArrive(stage); },
    });
    return () => { anim.kill(); };
  }, [stage, path, onArrive, reducedMotion]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;
    if (path) updateCamera(state.camera as PerspectiveCamera, path, frame.current, state.size.width / state.size.height);
    if (reducedMotion) return;

    for (let i = 0; i < visuals.floaters.length; i++) {
      const item = visuals.floaters[i];
      const t = elapsed * (0.48 + i % 7 * 0.028) + item.phase;
      item.mesh.position.y = item.pos.y + Math.sin(t) * 0.012;
      item.mesh.position.x = item.pos.x + Math.cos(t * 0.71) * 0.005;
      item.mesh.rotation.z = item.rz + Math.sin(t * 0.67) * 0.012;
      item.mesh.rotation.x = item.rx + Math.cos(t * 0.53) * 0.008;
    }

    visuals.heroStarts.forEach(({ object, position, rotation }, i) => {
      const t = elapsed * 0.48 + i * 2.3;
      object.position.y = position.y + Math.sin(t) * 0.004;
      object.rotation.z = rotation.z + Math.sin(t * 0.7) * 0.003;
    });

    shaders.forEach((shader) => { shader.uniforms.uPaperTime.value = elapsed; });
  });

  useEffect(() => () => {
    visuals.disposable.forEach((x) => x.dispose());
  }, [visuals]);

  return (
    <>
      <color attach="background" args={['#091217']} />
      <fogExp2 attach="fog" args={['#0b161b', quality === 'cinema' ? 0.025 : 0.018]} />
      <ambientLight intensity={0.52} color="#aec4c3" />
      <hemisphereLight args={['#c4e2e5', '#0c1719', 1.0]} />
      <directionalLight color="#c9eef2" intensity={2.6} position={[-2, 12, -3]} />
      <directionalLight color="#a7c6ce" intensity={1.1} position={[4, 9, 5]} />
      <directionalLight color="#bddee0" intensity={0.48} position={[-3, 5, 11]} />
      <mesh position={[0, 15.8, -23]} renderOrder={-10}>
        <planeGeometry args={[28, 23]} />
        <meshBasicMaterial map={skyGlow} transparent opacity={0.78} blending={AdditiveBlending}
          depthWrite={false} fog={false} toneMapped={false} side={DoubleSide} />
      </mesh>
      <pointLight color="#ffe4b4" intensity={16} distance={5} decay={2} position={[0, 1.25, -0.8]} />
      <primitive object={scene} dispose={null} />
      {quality === 'cinema' && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom mipmapBlur luminanceThreshold={1.15} luminanceSmoothing={0.18} intensity={0.56} />
          <Noise opacity={0.018} blendFunction={BlendFunction.SOFT_LIGHT} />
          <Vignette eskil={false} offset={0.27} darkness={0.68} />
        </EffectComposer>
      )}
    </>
  );
}
