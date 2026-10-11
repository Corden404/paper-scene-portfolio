import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { BlendFunction, Effect } from 'postprocessing';
import { LinearFilter, SRGBColorSpace, Uniform } from 'three';
import type { Texture } from 'three';

const fragment = /* glsl */ `
uniform sampler2D sourceGrade;
vec3 gradeSlice(vec3 p,float slice) {
  vec2 uv=vec2((p.x+slice*48.0+.5)/(48.0*48.0),(p.y+.5)/48.0);
  return texture2D(sourceGrade,uv).rgb;
}
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor) {
  vec3 p=clamp((log2(max(inputColor.rgb,vec3(exp2(-12.0))))+12.0)/18.0,0.0,1.0)*47.0;
  float slice=floor(p.z);
  vec3 color=mix(gradeSlice(p,slice),gradeSlice(p,min(47.0,slice+1.0)),fract(p.z));
  outputColor=vec4(color,inputColor.a);
}`;

class SourceGradeEffect extends Effect {
  constructor(texture: Texture) {
    super('V4SourceAgX', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['sourceGrade', new Uniform(texture)]]),
    });
  }
}

export default function RealtimeGrade({ version }: { version: string }) {
  const texture=useTexture(`/assets/realtime/source-grade.png?v=${version}`);
  texture.colorSpace=SRGBColorSpace;
  texture.minFilter=texture.magFilter=LinearFilter;
  texture.generateMipmaps=false;
  const effect=useMemo(()=>new SourceGradeEffect(texture),[texture]);
  return <primitive object={effect} />;
}
