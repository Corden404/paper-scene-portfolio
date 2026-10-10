import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

/**
 * Cheap atmospheric backlight for WebGL. The Blender source lights a real
 * volumetric medium with large area emitters; a feathered, depth-tested halo
 * recreates the bright opening without expensive per-pixel ray marching.
 */
export function createSkyGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const bloom = ctx.createRadialGradient(256, 235, 0, 256, 235, 245);
  bloom.addColorStop(0, 'rgba(225,249,250,0.94)');
  bloom.addColorStop(0.2, 'rgba(170,213,221,0.67)');
  bloom.addColorStop(0.48, 'rgba(124,181,195,0.27)');
  bloom.addColorStop(0.78, 'rgba(87,139,150,0.06)');
  bloom.addColorStop(1, 'rgba(74,118,129,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
