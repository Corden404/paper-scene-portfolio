import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { AdditiveBlending, DoubleSide, MathUtils, ShaderMaterial } from 'three';
import type { MutableRefObject } from 'react';

/**
 * Thin atmospheric light curtains placed at different *world depths* below
 * the large Cycles light source, rather than a screen-fixed CSS gradient.
 *
 * Their depth tests mean foreground paper naturally occludes the haze. A few
 * procedural bands approximate participating-media shafts without expensive
 * real-time volume ray marching or a fullscreen radial-blur render pass.
 */
const beamVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const beamFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uStrength;
uniform float uLayer;

float smoothBeam(float x) { return smoothstep(0.24, 0.93, x); }
void main() {
  // Shaft fan converges toward the same high source as Blender's
  // "Canopy broad rear luminous sky" area light (X=0, Y≈17, Z≈-25).
  vec2 uv = vUv;
  float angle = atan((uv.x - 0.50) * 1.9, 1.19 - uv.y);
  float wobble = sin(angle * 16.0 + uLayer * 2.13) * 0.05;
  float a = angle + wobble;
  float large = smoothBeam(0.5 + 0.5 * cos(a * 24.0 + 0.8));
  float fine = smoothBeam(0.5 + 0.5 * cos(a * 59.0 - uLayer * 1.7));
  float veil = 0.55 + 0.45 * sin(uv.x * 14.0 + uv.y * 8.0 + uLayer * 2.9);
  float ray = 0.14 + large * 0.63 + fine * 0.27;
  ray *= 0.78 + 0.22 * veil;

  float horizontal = 1.0 - smoothstep(0.34, 0.51, abs(uv.x - 0.50));
  float lower = smoothstep(0.0, 0.34, uv.y);
  float upper = 1.0 - smoothstep(0.90, 1.0, uv.y);
  float beam = ray * horizontal * lower * upper;
  float drift = 0.94 + 0.06 * sin(uTime * 0.14 + uv.x * 13.0 + uLayer * 1.8);
  float strength = beam * drift * uStrength;
  vec3 cool = vec3(0.36, 0.62, 0.72) * (0.82 + 0.47 * uv.y);
  gl_FragColor = vec4(cool * 1.8, strength * 0.30);
}`;

const curtains = [
  // A thin camera-side layer provides forward scattering *over* paper without
  // the ghosting and full-screen cost of radial image blurs.
  { position: [0, 6.5, 6.3], width: 16, height: 17, strength: 0.30 },
  // Deeper layers sit among/behind the paper and respect opaque depth tests.
  { position: [0, 10.0, -4.8], width: 19, height: 19, strength: 0.72 },
  { position: [0, 13.5, -10.5], width: 23, height: 24, strength: 1.08 },
  { position: [0, 17.5, -17.0], width: 27, height: 29, strength: 1.20 },
] as const;

/**
 * Progressive opacity follows the actual camera frame. The effect is strongest
 * in the opening shot, then recedes as we approach legible project surfaces.
 */
export default function CinematicAtmosphere({
  frame,
  reducedMotion,
  quality,
}: {
  frame: MutableRefObject<number>;
  reducedMotion: boolean;
  quality: 'cinema' | 'balanced';
}) {
  const mats = useRef<(ShaderMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const blend = 1 - MathUtils.smoothstep(frame.current, 30, 125);
    const portion = 0.09 + 0.91 * blend;
    for (let i = 0; i < mats.current.length; i++) {
      const mat = mats.current[i];
      if (!mat) continue;
      mat.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime;
      mat.uniforms.uStrength.value = portion * curtains[i].strength;
    }
  });

  // Balanced mode uses only the far atmospheric layer. That layer sits behind
  // most interactive papers and costs only one transparent plane.
  return (
    <group name="WEB | cinematic depth-tested atmosphere">
      {curtains.map((layer, i) => quality === 'cinema' || i === curtains.length - 1 ? (
        <mesh key={i} position={layer.position} renderOrder={i - 9}>
          <planeGeometry args={[layer.width, layer.height]} />
          <shaderMaterial
            ref={(material) => { mats.current[i] = material; }}
            vertexShader={beamVertex}
            fragmentShader={beamFragment}
            uniforms={{
              uTime: { value: 0 },
              uStrength: { value: layer.strength },
              uLayer: { value: i },
            }}
            transparent
            depthTest
            depthWrite={false}
            side={DoubleSide}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ) : null)}
    </group>
  );
}
