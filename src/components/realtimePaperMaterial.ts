import {
  DataTexture, DoubleSide, HalfFloatType, NearestFilter, RGBAFormat, ShaderMaterial, Vector2,
} from 'three';
import type { Texture } from 'three';

export type LightingTexture = { texture: DataTexture; size: Vector2 };

export function createLightingTexture(binary: ArrayBuffer): LightingTexture {
  const source = new Uint16Array(binary);
  if (source.length % 3) throw new Error('The surface lighting is incomplete.');
  const width = 1024;
  const height = Math.ceil(source.length / 3 / width);
  const pixels = new Uint16Array(width * height * 4);
  for (let i = 0; i < source.length / 3; i++) {
    pixels.set(source.subarray(i * 3, i * 3 + 3), i * 4);
    pixels[i * 4 + 3] = 0x3c00;
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, HalfFloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, size: new Vector2(width, height) };
}

const vertex = /* glsl */ `
attribute float aLightingOffset;
attribute float aLightingSide;
varying vec2 vUv;
varying float vLightingOffset;
varying float vPaperDepth;
varying float vLightingSide;
void main() {
  vUv = uv;
  vLightingOffset = aLightingOffset;
  vLightingSide = aLightingSide;
  vec4 p = vec4(position,1.0);
  #ifdef V4_INSTANCED
    p = instanceMatrix * p;
  #endif
  vPaperDepth = -(modelMatrix * p).z;
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const fragment = /* glsl */ `
uniform sampler2D uPrint;
uniform sampler2D uIrradiance;
uniform vec2 uLightingSize;
uniform vec2 uGrid;
uniform float uTransmission;
uniform float uFrameBase;
uniform float uNextFrameBase;
uniform float uFrameBlend;
uniform float uFillFrameBase;
uniform float uFillBlend;
varying vec2 vUv;
varying float vLightingOffset;
varying float vPaperDepth;
varying float vLightingSide;
vec3 probeAt(float side, vec2 xy, float frameBase) {
  float offset = vLightingOffset + frameBase + side*uGrid.x*uGrid.y + xy.x + xy.y*uGrid.x;
  vec2 pixel = vec2(mod(offset,uLightingSize.x),floor(offset/uLightingSize.x));
  return texture2D(uIrradiance,(pixel+.5)/uLightingSize).rgb;
}
vec3 probe(float side, vec2 xy) {
  #ifdef V4_HERO
    // All paper lighting coefficients are already baked. Select only the
    // nonzero contributors; these weights are uniform across every fragment.
    // At any authored frame, at most two of the three bases contribute.
    if (uFrameBlend >= 1.0 && uFillBlend >= 1.0)
      return probeAt(side,xy,uFillFrameBase);
    if (uFrameBlend >= 1.0) {
      vec3 reading = probeAt(side,xy,uNextFrameBase);
      if (uFillBlend > 0.0)
        return reading + (probeAt(side,xy,uFillFrameBase)-reading)*uFillBlend;
      return reading;
    }
    vec3 ambient = probeAt(side,xy,uFrameBase);
    if (uFrameBlend <= 0.0 && uFillBlend <= 0.0) return ambient;
    vec3 reading = probeAt(side,xy,uNextFrameBase);
    vec3 value = mix(ambient,reading,uFrameBlend);
    if (uFillBlend > 0.0)
      value += (probeAt(side,xy,uFillFrameBase)-reading)*uFillBlend;
    return value;
  #else
    return probeAt(side,xy,uFrameBase);
  #endif
}
vec3 hemisphere(float side) {
  vec2 lightingUv = vUv;
  #ifdef V4_HERO
    lightingUv.y = 1.0-lightingUv.y;
  #endif
  vec2 position = clamp((lightingUv-.025)/.95,0.0,1.0)*(uGrid-1.0);
  vec2 a = min(floor(position),uGrid-2.0), f = position-a;
  return mix(mix(probe(side,a),probe(side,a+vec2(1.,0.)),f.x),
             mix(probe(side,a+vec2(0.,1.)),probe(side,a+vec2(1.,1.)),f.x),f.y);
}
void main() {
  float side = gl_FrontFacing ? 0.0 : 1.0;
  #ifdef V4_HERO
    side = gl_FrontFacing ? vLightingSide : 1.0-vLightingSide;
  #endif
  vec3 front = hemisphere(side);
  vec3 back = hemisphere(1.0-side);
  float through = uTransmission;
  #ifdef V4_INSTANCED
    through = mix(.36,.70,clamp((vPaperDepth+7.0)/15.0,0.0,1.0));
  #endif
  // V4's solidified cotton has a second shell. Shadow rays crossing that
  // shell transmit 13 percent; omitting it washes out the foreground pages.
  float shell = .13;
  #ifdef V4_HERO
    shell = .48;
  #endif
  vec3 irradiance = front*(1.0-through) + back*through*shell;
  vec3 ink = texture2D(uPrint,vUv).rgb;
  #ifdef V4_INSTANCED
    ink = pow(ink,vec3(1.25));
    ink *= vec3(.85,1.0,1.03);
  #endif
  #ifdef V4_HERO
    // Preserve the baked curvature and reading-light gradient. Neutral
    // cotton and a little more back-shell light soften the unlit face without
    // lifting the printed blacks or brightening the instanced background.
    ink *= vec3(.90,.94,.94);
  #endif
  gl_FragColor = vec4(ink * irradiance,1.0);
  #include <colorspace_fragment>
}`;

export function createPaperMaterial(print: Texture, lighting: LightingTexture,
  grid: [number, number], instanced: boolean, transmission: number, hero = false) {
  return new ShaderMaterial({
    name: 'V4 | Cycles sampled thin paper',
    vertexShader: vertex, fragmentShader: fragment, side: DoubleSide,
    defines: instanced ? { V4_INSTANCED: 1 } : hero ? { V4_HERO: 1 } : {},
    uniforms: {
      uPrint: { value: print }, uIrradiance: { value: lighting.texture },
      uLightingSize: { value: lighting.size }, uGrid: { value: new Vector2(...grid) },
      uTransmission: { value: transmission },
      uFrameBase: { value: 0 }, uNextFrameBase: { value: 0 }, uFrameBlend: { value: 0 },
      uFillFrameBase: { value: 0 }, uFillBlend: { value: 0 },
    },
  });
}
