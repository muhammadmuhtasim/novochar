import React, { useEffect } from 'react';

// Draws the blink field: a static synthetic reference star grid plus the
// target's measured centroid at each epoch. The current frame is a bright
// glowing marker; earlier epochs fade into a trail. A compass and a scale bar
// make the direction and size of the motion readable at a glance, and the two
// axes share one scale so the trail's angle is astronomically truthful.
function niceLength(mas) {
  if (!(mas > 0)) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(mas)));
  const n = mas / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

function fmtArc(mas) {
  if (!Number.isFinite(mas) || mas <= 0) return '—';
  if (mas < 1000) return `${mas.toFixed(mas < 10 ? 1 : 0)} mas`;
  if (mas < 600_000) return `${(mas / 1000).toFixed(2)}″`;
  return `${(mas / 3.6e6).toFixed(2)}°`;
}

export default function BlinkDraw({ canvasRef, wrapRef, frames, idx }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#050302';
      ctx.fillRect(0, 0, w, h);
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
      grad.addColorStop(0, '#211006');
      grad.addColorStop(1, '#030201');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // static reference faint stars (fixed grid so motion stands out)
      ctx.fillStyle = 'rgba(255,190,120,0.52)';
      for (let i = 0; i < 60; i++) {
        const x = (((i * 37) % 97) / 97) * w;
        const y = (((i * 53) % 89) / 89) * h;
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      const pad = 30;
      if (!frames.length) {
        ctx.fillStyle = 'rgba(255,166,66,0.82)';
        ctx.font = '14px monospace';
        ctx.fillText('NO FRAMES — SELECT A TARGET', w / 2 - 90, h / 2);
        return;
      }

      // Per-frame tangent-plane offsets (mas) relative to the first epoch.
      const f0 = frames[0];
      const dec0 = f0.dec;
      const cosDec = Math.cos((dec0 * Math.PI) / 180) || 1;
      const east = frames.map((f) => (f.ra - f0.ra) * cosDec * 3.6e6);
      const north = frames.map((f) => (f.dec - f0.dec) * 3.6e6);
      let eMin = Math.min(...east), eMax = Math.max(...east);
      let nMin = Math.min(...north), nMax = Math.max(...north);
      if (eMax - eMin < 1e-3) { eMin -= 1; eMax += 1; }
      if (nMax - nMin < 1e-3) { nMin -= 1; nMax += 1; }
      const eMid = (eMin + eMax) / 2;
      const nMid = (nMin + nMax) / 2;
      // One shared scale for both axes -> no distortion of the motion angle.
      const scale = Math.min((w - pad * 2) / (eMax - eMin), (h - pad * 2) / (nMax - nMin));
      const px = (e) => w / 2 + (e - eMid) * scale;
      const py = (n) => h / 2 - (n - nMid) * scale;

      // reference crosshair at the first-epoch position
      ctx.save();
      ctx.strokeStyle = 'rgba(255,196,112,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(px(east[0]), py(north[0]), 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // fading trail: older segments dimmer, current segments bright
      const nSeg = frames.length - 1;
      for (let i = 1; i < frames.length; i++) {
        const a = 0.16 + 0.84 * (i / Math.max(1, nSeg));
        ctx.strokeStyle = `rgba(255,134,24,${a.toFixed(3)})`;
        ctx.lineWidth = i === idx || i - 1 === idx ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.moveTo(px(east[i - 1]), py(north[i - 1]));
        ctx.lineTo(px(east[i]), py(north[i]));
        ctx.stroke();
      }

      // direction arrow from first to last epoch
      if (frames.length > 1) {
        const x0 = px(east[0]), y0 = py(north[0]);
        const x1 = px(east[nSeg]), y1 = py(north[nSeg]);
        if (Math.hypot(x1 - x0, y1 - y0) > 12) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,240,255,0.75)';
          ctx.fillStyle = 'rgba(0,240,255,0.75)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.setLineDash([]);
          const ang = Math.atan2(y1 - y0, x1 - x0);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - 9 * Math.cos(ang - 0.4), y1 - 9 * Math.sin(ang - 0.4));
          ctx.lineTo(x1 - 9 * Math.cos(ang + 0.4), y1 - 9 * Math.sin(ang + 0.4));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // each frame dot
      frames.forEach((f, i) => {
        const cx = px(east[i]), cy = py(north[i]);
        if (i === idx) return;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = f.flagged ? 'rgba(255,240,176,0.8)' : 'rgba(194,106,38,0.75)';
        ctx.fill();
      });

      // current-frame marker on top, with a glow
      const cxi = px(east[idx]), cyi = py(north[idx]);
      ctx.save();
      ctx.shadowColor = '#ff6a00';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(cxi, cyi, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,209,102,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cxi, cyi, 9, 0, Math.PI * 2);
      ctx.stroke();

      // ---- HUD: compass (top-right) --------------------------------------
      ctx.save();
      ctx.strokeStyle = 'rgba(255,180,110,0.8)';
      ctx.fillStyle = 'rgba(255,180,110,0.9)';
      ctx.font = '10px monospace';
      ctx.lineWidth = 1.2;
      const cxp = w - 34, cyp = 32;
      ctx.beginPath();
      ctx.moveTo(cxp, cyp + 9);
      ctx.lineTo(cxp, cyp - 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cxp, cyp - 12);
      ctx.lineTo(cxp - 3.5, cyp - 5);
      ctx.lineTo(cxp + 3.5, cyp - 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillText('N', cxp - 3, cyp - 16);
      ctx.beginPath();
      ctx.moveTo(cxp - 9, cyp + 18);
      ctx.lineTo(cxp + 9, cyp + 18);
      ctx.stroke();
      ctx.fillText('E', cxp + 13, cyp + 22);
      ctx.restore();

      // ---- HUD: scale bar (bottom-left) ----------------------------------
      const fieldMas = (w - pad * 2) / scale;
      const barMas = niceLength(fieldMas * 0.28);
      const barPx = barMas * scale;
      if (barPx > 8) {
        const bx = pad, by = h - 18;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,180,110,0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(bx, by - 4);
        ctx.lineTo(bx, by + 4);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + barPx, by);
        ctx.moveTo(bx + barPx, by - 4);
        ctx.lineTo(bx + barPx, by + 4);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,200,150,0.9)';
        ctx.font = '10px monospace';
        ctx.fillText(fmtArc(barMas), bx + barPx + 6, by + 3);
        ctx.fillStyle = 'rgba(255,166,90,0.7)';
        ctx.fillText(`field ${fmtArc(fieldMas)}`, pad, 16);
        ctx.restore();
      }
    };
    draw();

    const resize = () => draw();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    return () => resizeObserver.disconnect();
  }, [frames, idx, canvasRef, wrapRef]);

  return (
    <div className="blink-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="blink-canvas" />
      <div className="readout">
        frame {frames.length ? idx + 1 : 0}/{frames.length}
        {frames[idx] ? ` · ${frames[idx].passCode} · ${new Date(frames[idx].epochISO).toISOString().slice(0, 10)}` : ''}
      </div>
    </div>
  );
}
