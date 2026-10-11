import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Data3DTexture, HalfFloatType, LinearFilter, Matrix4, RGBAFormat, Uniform, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

export type AtmosphereData = {
  sourceSha256: string; grid: [number, number, number]; min: number[]; max: number[]; albedo: number[]; phase: number;
};
export function createAtmosphere(data: AtmosphereData, binary: ArrayBuffer) {
  const values = new Uint16Array(binary);
  const count = data.grid.reduce((a, b) => a * b, 1);
  if (values.length !== count * 16) throw new Error('The atmosphere data is incomplete.');
  const textures = Array.from({ length: 4 }, (_, coefficient) => {
    const pixels = new Uint16Array(count * 4);
    for (let i = 0; i < count; i++) pixels.set(values.subarray(i * 16 + coefficient * 4, i * 16 + coefficient * 4 + 4), i * 4);
    const texture = new Data3DTexture(pixels, ...data.grid);
    texture.type = HalfFloatType; texture.format = RGBAFormat;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.unpackAlignment = 1; texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  });
  return { data, textures };
}
type Atmosphere = ReturnType<typeof createAtmosphere>;

// Integrate original V4 density and Cycles-sampled light in world space.
// Geometry depth terminates each ray, and lighting remains fixed in the hall.
const fragment = /* glsl */ `
precision highp sampler3D;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform sampler3D lightZero;
uniform sampler3D lightX;
uniform sampler3D lightY;
uniform sampler3D lightZ;
uniform vec3 fieldMin;
uniform vec3 fieldMax;
uniform vec3 fieldGrid;
uniform vec3 albedo;
uniform float phase;
uniform vec3 eye;
uniform float steps;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float depth = readDepth(uv);
  vec4 v = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 endpoint = (cameraWorld * vec4(v.xyz / v.w, 1.0)).xyz;
  vec3 ray = endpoint - eye;
  float distanceToSurface = min(length(ray), 34.0);
  vec3 direction = normalize(ray);
  float stride = distanceToSurface / steps;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
  float transmission = 1.0;
  vec3 scattering = vec3(0.0);
  // The authored camera path stays inside this convex box. Once an interior
  // ray exits it, no later sample can contribute to the volume.
  bool eyeInside = all(greaterThanEqual(eye,fieldMin)) && all(lessThanEqual(eye,fieldMax));
  for (int i=0; i<48; i++) {
    if (float(i) >= steps) break;
    vec3 p = eye + direction * (float(i)+jitter) * stride;
    vec3 field = (p-fieldMin)/(fieldMax-fieldMin);
    if (any(lessThan(field,vec3(0.0))) || any(greaterThan(field,vec3(1.0)))) {
      if (eyeInside) break;
      continue;
    }
    field = (field*(fieldGrid-1.0)+.5)/fieldGrid;
    vec4 zero = texture(lightZero,field);
    float density = zero.a;
    float loss = 1.0-exp(-density*stride);
    vec3 bx = texture(lightX,field).rgb;
    vec3 by = texture(lightY,field).rgb;
    vec3 bz = texture(lightZ,field).rgb;
    vec3 weights = vec3(.2126,.7152,.0722);
    vec3 dominant = vec3(dot(bx,weights),dot(by,weights),dot(bz,weights));
    vec3 axis = dominant/max(length(dominant),.00001);
    vec3 direct = min(zero.rgb,sqrt(bx*bx+by*by+bz*bz)/3.0);
    float cosine = dot(direction,axis);
    float hg = (1.0-phase*phase)/pow(1.0+phase*phase-2.0*phase*cosine,1.5);
    // Keep authored density and directional shafts. Broad isotropic light
    // veils the pages; weighting it by the field's directional coherence
    // separates the lit upper volume from the quieter lower hall.
    float coherence = clamp(length(dominant)/max(dot(zero.rgb,weights)*3.0,.00001),0.0,1.0);
    float diffuseWeight = mix(.48,.64,coherence);
    vec3 illumination = max(vec3(0.0),zero.rgb-direct)*diffuseWeight + direct*hg*.76;
    scattering += transmission * loss * albedo * illumination;
    transmission *= 1.0-loss;
  }
  outputColor = vec4(inputColor.rgb * transmission + scattering, inputColor.a);
}`;

class FogEffect extends Effect {
  constructor(field: Atmosphere) {
    super('V4WorldFog', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['inverseProjection', new Uniform(new Matrix4())],
        ['cameraWorld', new Uniform(new Matrix4())],
        ['lightZero', new Uniform(field.textures[0])],
        ['lightX', new Uniform(field.textures[1])],
        ['lightY', new Uniform(field.textures[2])],
        ['lightZ', new Uniform(field.textures[3])],
        ['fieldMin', new Uniform(new Vector3().fromArray(field.data.min))],
        ['fieldMax', new Uniform(new Vector3().fromArray(field.data.max))],
        ['fieldGrid', new Uniform(new Vector3(...field.data.grid))],
        ['albedo', new Uniform(new Vector3().fromArray(field.data.albedo))],
        ['phase', new Uniform(field.data.phase)],
        ['eye', new Uniform(new Vector3())],
        ['steps', new Uniform(40)],
      ]),
    });
  }
}

export default function RealtimeFog({ field, quality }: {
  field: Atmosphere;
  quality: 'cinema' | 'balanced';
}) {
  const { camera } = useThree();
  const effect = useMemo(() => new FogEffect(field), [field]);
  useFrame(() => {
    const uniforms = effect.uniforms;
    (uniforms.get('inverseProjection')!.value as Matrix4).copy((camera as PerspectiveCamera).projectionMatrixInverse);
    (uniforms.get('cameraWorld')!.value as Matrix4).copy(camera.matrixWorld);
    (uniforms.get('eye')!.value as Vector3).copy(camera.position);
    uniforms.get('steps')!.value = quality === 'cinema' ? 40 : 20;
  });
  return <primitive object={effect} dispose={null} />;
}
