import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { portfolio } from '../config/portfolio';

export function createMonitorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#dedcd1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#26393b';
  ctx.font = '600 30px Arial, sans-serif';
  ctx.fillText(portfolio.name.toUpperCase() + '  /  PORTFOLIO', 68, 83);
  ctx.textAlign = 'right';
  ctx.font = '22px Arial, sans-serif';
  ctx.fillText('WORKS    ABOUT    CONTACT', 1212, 83);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(39,58,58,.24)';
  ctx.beginPath(); ctx.moveTo(68, 115); ctx.lineTo(1212, 115); ctx.stroke();
  ctx.fillStyle = '#24383a';
  ctx.font = 'bold 87px Georgia, serif';
  ctx.fillText('Ideas in motion.', 65, 317);
  ctx.font = '28px Arial, sans-serif';
  ctx.fillText('Selected projects. An ongoing exploration.', 70, 383);
  const xs = [70, 465, 860];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#8ba3a0', '#a7b5aa', '#cad0c6'][i];
    ctx.fillRect(xs[i], 445, 350, 207);
    ctx.strokeStyle = 'rgba(28,60,65,.35)';
    for (let j = 0; j < 14; j++) {
      ctx.beginPath();
      ctx.moveTo(xs[i] + 10 + j * 25, 457);
      ctx.lineTo(xs[i] + 335 - j * 9, 638);
      ctx.stroke();
    }
    ctx.fillStyle = '#26393b';
    ctx.font = '24px Arial, sans-serif';
    ctx.fillText(i === 0 ? '01  /  FORM' : i === 1 ? '02  /  SYSTEM' : '03  /  MORE', xs[i], 704);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** A small camera-facing optical bloom sprite surrounding the emissive monitor. */
export function createMonitorHaloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(128, 128, 4, 128, 128, 125);
  glow.addColorStop(0, 'rgba(255,243,210,0.34)');
  glow.addColorStop(0.27, 'rgba(236,220,184,0.17)');
  glow.addColorStop(0.65, 'rgba(211,220,212,0.04)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
