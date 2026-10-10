import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  SRGBColorSpace,
} from 'three';
import type { PortfolioProject } from '../config/portfolio';

const W = 1792;
const H = 1344;
const serif = 'Georgia, Times New Roman, serif';
const sans = 'Arial, Helvetica, sans-serif';

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawArtwork(ctx: CanvasRenderingContext2D, project: PortfolioProject) {
  ctx.save();
  const px = 96, py = 400, w = 1598, h = 580;
  ctx.beginPath(); ctx.rect(px, py, w, h); ctx.clip();
  ctx.fillStyle = '#cdd6d1'; ctx.fillRect(px, py, w, h);
  ctx.strokeStyle = 'rgba(51,81,81,.33)';
  ctx.lineWidth = 1.4;

  if (project.style === 'contour') {
    // Technical contours feel printed, rather than pasted on as photographs.
    for (let i = 0; i < 46; i++) {
      ctx.beginPath();
      for (let j = 0; j <= 145; j++) {
        const x = px - 50 + j * 12;
        const u = j / 145;
        const y = py + 282 + (i - 23) * 9
          + Math.sin(u * 9.6 + i * .085) * (45 + i * 1.5)
          + Math.sin(u * 20.4 - i * .16) * 14;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(34,74,77,.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(px + 785, py + 298, 240, 164, -.32, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.translate(px + w / 2, py + h / 2);
    for (let i = 0; i < 28; i++) {
      const angle = (i * Math.PI) / 14;
      ctx.save(); ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 165 + i * 11, 75 + i * 3.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 23; i++) {
      ctx.beginPath();
      ctx.arc(Math.cos(i * 2.4) * (160 + i * 14), Math.sin(i * 2.4) * (90 + i * 8), i % 4 + 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46,80,84,.5)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(25,66,73,.7)';
    ctx.lineWidth = 3;
    line(ctx, -740, 0, 740, 0);
    line(ctx, 0, -250, 0, 250);
  }
  ctx.restore();
}

export function createPaperTexture(project: PortfolioProject) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Warm fibrous paper base + tiny ink noise. Never emissive.
  ctx.fillStyle = '#dddcd1'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(66,76,70,.025)';
  for (let i = 0; i < 7300; i++) {
    const x = (i * 827 + 137) % W;
    const y = (i * 479 + 59) % H;
    ctx.fillRect(x, y, 1.5 + (i % 3), 1.5);
  }

  ctx.fillStyle = '#263c3e';
  ctx.font = '600 26px ' + sans;
  ctx.letterSpacing = '5px';
  ctx.fillText('LQ / SELECTED WORK', 96, 104);
  ctx.textAlign = 'right';
  ctx.fillText(project.number + '  /  02', 1696, 104);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(34,55,56,.36)';
  ctx.lineWidth = 2;
  line(ctx, 96, 133, 1696, 133);

  ctx.letterSpacing = '3px';
  ctx.font = '600 25px ' + sans;
  ctx.fillStyle = '#5f7472';
  ctx.fillText(project.category + '   /   ' + project.year, 96, 218);

  const titleLines = project.title.split('\n');
  ctx.fillStyle = '#263737';
  ctx.letterSpacing = '-2px';
  ctx.font = 'bold 88px ' + serif;
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], 94, 300 + i * 91);
  }

  drawArtwork(ctx, project);
  line(ctx, 96, 1037, 1696, 1037);
  ctx.fillStyle = '#344749';
  ctx.letterSpacing = '0px';
  ctx.font = '40px ' + serif;
  ctx.fillText(project.subtitle, 96, 1132);
  ctx.font = '26px ' + sans;
  ctx.fillStyle = '#5e706d';
  ctx.fillText(project.keywords.join('   /   '), 96, 1218);
  ctx.textAlign = 'right';
  ctx.font = '600 29px ' + sans;
  ctx.fillText(project.number, 1696, 1230);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
