import React, { useEffect, useRef, useState } from 'react';

// Draws the blink field: a static synthetic reference star grid plus the
// target's measured centroid at each epoch. Bright marker at the current frame,
// with a faint trail showing cumulative differential motion.
export default function BlinkDraw({ canvasRef, wrapRef, frames, idx }) {
  const [hover, setHover] = useState(null);

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
      const refs = 60;
      for (let i = 0; i < refs; i++) {
        const x = ((i * 37) % 97) / 97 * w;
        const y = ((i * 53) % 89) / 89 * h;
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!frames.length) {
        ctx.fillStyle = 'rgba(255,166,66,0.82)';
        ctx.font = '14px monospace';
        ctx.fillText('NO FRAMES — SELECT A TARGET', w / 2 - 90, h / 2);
        return;
      }

      // Plot target centroids, normalising the tiny coordinate offsets to fill box.
      const ra0 = frames[0].ra, dec0 = frames[0].dec;
      const pad = 28;
      const xs = frames.map((f) => f.ra - ra0);
      const ys = frames.map((f) => f.dec - dec0);
      let minX = Math.min(...xs), maxX = Math.max(...xs);
      let minY = Math.min(...ys), maxY = Math.max(...ys);
      if (maxX - minX < 1e-6) { minX -= 1e-6; maxX += 1e-6; }
      if (maxY - minY < 1e-6) { minY -= 1e-6; maxY += 1e-6; }
      const sx = (x) => pad + (x - minX) / (maxX - minX) * (w - pad * 2);
      const sy = (y) => h - pad - (y - minY) / (maxY - minY) * (h - pad * 2);

      // reference crosshair at first-epoch position
      ctx.save();
      ctx.strokeStyle = 'rgba(255,196,112,0.62)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx(ra0), sy(dec0), 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // trail
      ctx.strokeStyle = '#ff8618';
      ctx.lineWidth = 2;
      ctx.beginPath();
      frames.forEach((f, i) => {
        const px = sx(f.ra - ra0), py = sy(f.dec - dec0);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // each frame dot
      frames.forEach((f, i) => {
        const px = sx(f.ra - ra0), py = sy(f.dec - dec0);
        ctx.beginPath();
        ctx.arc(px, py, i === idx ? 5 : 2.4, 0, Math.PI * 2);
        ctx.fillStyle = i === idx ? '#ffd166' : (f.flagged ? '#fff0b0' : '#c26a26');
        ctx.fill();
        if (i === idx) {
          ctx.save();
          ctx.shadowColor = '#ff6a00';
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(px, py, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    };
    draw();

    const onMove = (e) => {
      const r = wrap.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setHover(null);
    };
    const onLeave = () => setHover(null);
    const resize = () => draw();

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      resizeObserver.disconnect();
    };
  }, [frames, idx, canvasRef, wrapRef]);

  return (
    <div className="blink-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="blink-canvas" />
      <div className="readout">
        frame {frames.length ? idx + 1 : 0}/{frames.length}
        {frames[idx] ? ` · ${frames[idx].passCode}` : ''}
      </div>
    </div>
  );
}