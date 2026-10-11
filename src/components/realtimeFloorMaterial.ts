import type { MeshStandardMaterial, Vector3 } from 'three';

const configured = new WeakSet<MeshStandardMaterial>();

// Both quality tiers use the same concrete and monitor response. Only Cinema
// adds the cached planar reflection; Lite allocates no reflection target.
export function configureFloorMaterial(material: MeshStandardMaterial, screen: Vector3, reflected: boolean) {
  // Effects may be replayed in StrictMode; never stack shader injections.
  if (configured.has(material)) return;
  configured.add(material);
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.v4Screen = { value: screen };
    shader.vertexShader = 'varying vec3 v4Ground;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nv4Ground = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = 'uniform vec3 v4Screen;\nvarying vec3 v4Ground;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
      'vec3 totalDiffuse = .16*reflectedLight.directDiffuse + .3*reflectedLight.indirectDiffuse;');
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
      'vec3 totalSpecular = .06*reflectedLight.directSpecular + .3*reflectedLight.indirectSpecular;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
      /* glsl */ `
      #include <opaque_fragment>
      vec3 floorView = normalize(cameraPosition-v4Ground);
      vec3 reflectedRay = reflect(-floorView,vec3(0.0,1.0,0.0));
      vec3 screenDirection = normalize(v4Screen-v4Ground);
      // Rough microfacets spread the reflected monitor along the ground.
      // Angular slopes keep the response tied to the camera and world light,
      // rather than a fixed patch on the floor or a screen-space overlay.
      vec2 slope = reflectedRay.xz/max(reflectedRay.y,.04)
                 - screenDirection.xz/max(screenDirection.y,.04);
      // Longitudinal slope differences grow rapidly at grazing angles;
      // keep a narrow cross-floor response while letting it reach the viewer.
      vec2 spread = slope/vec2(.19,4.6);
      float screenLobe = exp(-dot(spread,spread));
      float grain = .5+.5*sin(v4Ground.z*76.0+sin(v4Ground.x*29.0)*2.0);
      float breakup = .74+.16*sin(v4Ground.z*8.0+v4Ground.x*11.0)+.10*grain;
      float frontOfScreen = smoothstep(-.2,.5,v4Ground.z-v4Screen.z);
      float groundFresnel = .075+.16*pow(1.0-abs(floorView.y),2.0);
      gl_FragColor.rgb += vec3(1.0,.84,.62)*screenLobe*.24*breakup*frontOfScreen;
      ` + (reflected ? 'gl_FragColor.rgb += max(newMerge.rgb,vec3(0.0))*groundFresnel*(.7+.3*grain);\n' : ''));
  };
  material.customProgramCacheKey = () => `v4-concrete-world-reflection-${reflected ? 'cinema' : 'lite'}`;
  material.needsUpdate = true;
}
