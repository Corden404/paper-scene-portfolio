import { useFrame, useThree } from '@react-three/fiber';
import CinematicAtmosphere from './CinematicAtmosphere';

import { useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  Color,
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
const SKY_LIGHT_COLOR = new Color().setRGB(3.2, 3.8, 4.1);
const PAPER_FOCUS_LIGHTS = {
  'paper-a': [-1.8, 3.4, 6], 'paper-b': [1.25, 2.4, 3.1],
  'paper-c': [2.35, 3.45, 4.8], 'paper-d': [3.05, 1.75, 2.8],
  'paper-e': [1.95, 2.65, 1.5], 'paper-f': [0.1, 3.15, 2.6],
} as const;

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

/**
 * Rebuild the missing thin-sheet scattering from the original Cycles shader.
 * The glTF export keeps ink textures but cannot represent Blender's
 * translucent BSDF mix. Add a view-dependent, back-lit diffuse term AFTER
 * the original PBR lighting; preserve printed detail and true opaque depth.
 *
 * Individual sheets and each disconnected canopy island share the same
 * shading model. glTF uses _SHEET_PHASE, but GLTFLoader lowercases custom
 * geometry attributes to _sheet_phase before Three.js renders them.
 */
function enhanceAirbornePaper(
  mesh: Mesh,
  shaderRefs: SheetShader[],
  disposable: Array<{ dispose(): void }>,
) {
  const sway = !!mesh.geometry.getAttribute('_sheet_phase');
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const enhanced = materials.map((original) => {
    const material = original.clone();
    material.side = DoubleSide;
    material.onBeforeCompile = (shader) => {
      if (sway) shader.uniforms.uPaperTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\n' +
          'varying vec3 vCinemaWorldNormal;\nvarying vec3 vCinemaWorldPos;\n' +
          (sway ? 'attribute float _sheet_phase;\nuniform float uPaperTime;' : ''))
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          (sway
            ? 'float paperSway = sin(uPaperTime * (0.60 + fract(_sheet_phase * .71) * .45) + _sheet_phase * 6.28318);\n' +
              'transformed += vec3(.005 * sin(uPaperTime * .43 + _sheet_phase * 6.28318), .005 * paperSway, .006 * paperSway);'
            : ''))
        .replace('#include <project_vertex>',
          '#include <project_vertex>\n' +
          'vCinemaWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
          'vCinemaWorldNormal = normalize(mat3(modelMatrix) * normal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vCinemaWorldNormal;\nvarying vec3 vCinemaWorldPos;')
        // Three.js r177 uses opaque_fragment; output_fragment was removed.
        // Inject before tone mapping, while colors are still linear PBR values.
        .replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\n' +
          'vec3 toSky = normalize(vec3(0.0, 17.0, -25.0) - vCinemaWorldPos);\n' +
          'vec3 visibleFace = normalize(vCinemaWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);\n' +
          'float backlit = pow(max(0.0, -dot(visibleFace, toSky)), 1.25);\n' +
          'float elevation = smoothstep(1.8, 13.0, vCinemaWorldPos.y);\n' +
          'float distanceToSky = 1.0 - smoothstep(-17.0, 8.0, vCinemaWorldPos.z);\n' +
          'float thinScatter = backlit * (0.25 + 0.75 * elevation) * (0.40 + 0.60 * distanceToSky);\n' +
          'float inkDensity = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 1.8, 0.0, 1.0);\n' +
          'float inkTransmission = mix(0.35, 1.0, inkDensity);\n' +
          'gl_FragColor.rgb += vec3(0.52, 0.70, 0.75) * thinScatter * inkTransmission * 0.70;');
      if (sway) shaderRefs.push(shader as unknown as SheetShader);
    };
    material.customProgramCacheKey = () => sway ? 'paper-cinema-scatter-sway-v5' : 'paper-cinema-scatter-static-v5';
    disposable.push(material);
    return material;
  });
  mesh.material = Array.isArray(mesh.material) ? enhanced : enhanced[0];
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
    if (/(Layered paper canopy|Continuous medium bowed paper tier|Reference middle-scale crossover sheets|Irregular descending cascade|Exterior ordinary paper|Reference near-floor sheet)/i.test(name)) {
      enhanceAirbornePaper(object, sheetShaders, disposable);
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
      <fogExp2 attach="fog" args={['#122a30', quality === 'cinema' ? 0.023 : 0.017]} />
      {/* Preserve dark faces and walls: the source is above and far BEHIND the paper. */}
      <ambientLight intensity={0.23} color="#a6bcc2" />
      <hemisphereLight args={['#bedee6', '#061012', 0.52]} />
      <directionalLight color="#d1f0f5" intensity={3.5} position={[0, 18, -16]} />
      <directionalLight color="#8dafb7" intensity={0.37} position={[5, 8, 2]} />
      <directionalLight color="#b4cbd1" intensity={0.15} position={[-3, 5, 11]} />
      {/* A bright, physically located source seen through gaps in the paper. */}
      <mesh position={[0, 17.0, -25.0]} renderOrder={-10}>
        <planeGeometry args={[32, 29]} />
        <meshBasicMaterial map={skyGlow} color={SKY_LIGHT_COLOR} transparent opacity={0.96}
          blending={AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={DoubleSide} />
      </mesh>
      {/* A second, higher cloud of cool light lifts the upper paper canopy. The
          nearest paper still passes the depth test and reads as a silhouette. */}
      {quality === 'cinema' && (
        <mesh position={[0, 23.0, -14.0]} renderOrder={-10}>
          <planeGeometry args={[24, 18]} />
          <meshBasicMaterial map={skyGlow} color={SKY_LIGHT_COLOR} transparent opacity={0.64}
            blending={AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} side={DoubleSide} />
        </mesh>
      )}
      <CinematicAtmosphere frame={frame} reducedMotion={reducedMotion} quality={quality} />
      <pointLight color="#ffdfab" intensity={9} distance={4.2} decay={2} position={[0, 1.25, -0.8]} />
      {/* Close paper chapters keep printed content legible without raising all ambient light. */}
      {stage !== 'intro' && stage !== 'screen' && (
        <pointLight color="#b4d3d0" intensity={1.75} distance={3.6} decay={2}
          position={PAPER_FOCUS_LIGHTS[stage]} />
      )}
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
