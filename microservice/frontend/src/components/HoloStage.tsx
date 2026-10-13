"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { holoInput, holoRGB, requestTiltPermission } from "@/lib/holo";

type V4 = [number, number, number, number];

const VERTS: V4[] = Array.from({ length: 16 }, (_, i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
  i & 8 ? 1 : -1,
]);

const EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++)
  for (let b = 0; b < 4; b++) {
    const j = i ^ (1 << b);
    if (i < j) EDGES.push([i, j]);
  }

const CUBE_QUADS: [number, number, number, number][] = [
  [0, 4, 6, 2],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 2, 3, 1],
  [4, 5, 7, 6],
];

function rot4(v: V4, i: number, j: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang), a = v[i], b = v[j];
  v[i] = a * c - b * s;
  v[j] = a * s + b * c;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function HoloStage({ children, core = true }: { children?: React.ReactNode; core?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flipRef = useRef<() => void>(() => {});
  const [flipped, setFlipped] = useState(false);

  const onFlip = useCallback(() => {
    requestTiltPermission();
    flipRef.current();
    window.dispatchEvent(new CustomEvent("holo:flip"));
    setFlipped(true);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const slot = slotRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !slot || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 100, isMobile = false;

    // Swarm — all free-floating, no band-bound particles
    const N_MAX = 60;
    let N = 0;
    let sx = new Float32Array(N_MAX), sy = new Float32Array(N_MAX), sz = new Float32Array(N_MAX);
    let svx = new Float32Array(N_MAX), svy = new Float32Array(N_MAX), svz = new Float32Array(N_MAX);
    let sPhase = new Float32Array(N_MAX), sSize = new Float32Array(N_MAX), sHue = new Float32Array(N_MAX);

    const seedSwarm = () => {
      N = isMobile ? 20 : 50;
      for (let i = 0; i < N; i++) {
        sPhase[i] = Math.random() * Math.PI * 2;
        sSize[i] = 0.5 + Math.pow(Math.random(), 2.2) * 2;
        sHue[i] = Math.random();
        const a = Math.random() * Math.PI * 2;
        const r = 0.8 + Math.random() * 1.0;
        sx[i] = Math.cos(a) * r;
        sy[i] = (Math.random() - 0.5) * 1.6;
        sz[i] = Math.sin(a) * r;
        svx[i] = svy[i] = svz[i] = 0;
      }
    };

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const srect = slot.getBoundingClientRect();
      W = rect.width; H = rect.height;
      isMobile = W < 640;
      dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      cx = srect.left - rect.left + srect.width / 2;
      cy = srect.top - rect.top + srect.height / 2;
      R = Math.min(srect.width, srect.height) * (isMobile ? 0.32 : 0.42);
    };

    measure();
    const reduced = holoInput.reducedMotion;
    seedSwarm();

    const t0 = performance.now();
    let last = t0, camA = 0.5;
    const camB = -0.5;
    let tiltRX = 0, tiltRY = 0;
    let flipFrom = 0, flipTo = 0, flipStart = -1, flipAngle = 0, shock = 0;
    let visible = true, raf = 0;

    let ca = 1, sa = 0, cb = 1, sb = 0, scale = 1;
    const PERSP = 4.2;
    const out3: [number, number, number] = [0, 0, 0];

    function project(x: number, y: number, z: number) {
      const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
      const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      const k = PERSP / (PERSP - z2);
      out3[0] = cx + x1 * k * scale;
      out3[1] = cy + y1 * k * scale;
      out3[2] = z2;
      return out3;
    }

    const draw = (now: number) => {
      const dark = document.documentElement.classList.contains("dark");
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      const t = (now - t0) / 1000;
      const intro = reduced ? 1 : clamp01(t / 1.8);

      const rect = canvas.getBoundingClientRect();
      const mx = holoInput.px - rect.left;
      const my = holoInput.py - rect.top;
      const hasPointer = holoInput.pointerActive && mx > -60 && my > -60 && mx < W + 60 && my < H + 60;
      const tX = holoInput.hasTilt ? holoInput.tiltX : hasPointer ? (mx / W - 0.5) * 2 : 0;
      const tY = holoInput.hasTilt ? holoInput.tiltY : hasPointer ? (my / H - 0.5) * 2 : 0;
      tiltRX += (tY * 0.4 - tiltRX) * 0.055 * dt;
      tiltRY += (tX * 0.6 - tiltRY) * 0.055 * dt;
      const scrollKick = Math.max(-40, Math.min(40, holoInput.scrollV));

      if (!reduced) camA += 0.0022 * dt + scrollKick * 0.0007;
      if (flipStart >= 0) {
        const p = clamp01((now - flipStart) / 1500);
        flipAngle = flipFrom + (flipTo - flipFrom) * easeInOut(p);
        if (p >= 1) flipStart = -1;
      }
      shock = Math.max(0, shock - 0.018 * dt);

      const yaw = camA + tiltRY;
      const pitch = camB + tiltRX + (reduced ? 0 : Math.sin(t * 0.21) * 0.07);
      ca = Math.cos(yaw); sa = Math.sin(yaw);
      cb = Math.cos(pitch); sb = Math.sin(pitch);
      scale = R * (0.86 + 0.14 * intro);

      const foil = t * 0.035 + tX * 0.18 + tY * 0.1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const col = (h: number, a: number, whiten = 0) => {
        let [r, g, b] = holoRGB(h);
        if (dark) { r += (255 - r) * whiten; g += (255 - g) * whiten; b += (255 - b) * whiten; }
        else { const ink = 0.5 + whiten * 0.3; r = r * (1 - ink) + 22 * ink; g = g * (1 - ink) + 22 * ink; b = b * (1 - ink) + 28 * ink; }
        return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
      };

      if (core) {
        /* Tesseract nucleus */
        const proj = new Float64Array(16 * 3);
        const v4: V4 = [0, 0, 0, 0];
        const breathe = reduced ? 0.18 : Math.sin(t * 0.35) * 0.22;
        const NUC = 0.42;
        let wMin = Infinity, wMax = -Infinity;
        for (let i = 0; i < 16; i++) {
          v4[0] = VERTS[i][0]; v4[1] = VERTS[i][1]; v4[2] = VERTS[i][2]; v4[3] = VERTS[i][3];
          rot4(v4, 0, 3, breathe);
          rot4(v4, 2, 3, flipAngle);
          rot4(v4, 0, 1, t * 0.18);
          const w = v4[3], k4 = 1 / (2.4 - w);
          const p = project(v4[0] * k4 * NUC, v4[1] * k4 * NUC, v4[2] * k4 * NUC);
          proj[i * 3] = p[0]; proj[i * 3 + 1] = p[1]; proj[i * 3 + 2] = w;
          if (w < wMin) wMin = w;
          if (w > wMax) wMax = w;
        }
        const wSpan = Math.max(0.001, wMax - wMin);
        const inner = (w: number) => 1 - (w - wMin) / wSpan;

        const nucleusIn = reduced ? 1 : clamp01((t - 0.5) / 1.0);

        // Glow
        {
          const gR = R * (0.95 + shock * 1.5);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR);
          const a = (dark ? 0.34 : 0.17) * nucleusIn + shock * 0.25;
          g.addColorStop(0, col(foil + 0.55, a));
          g.addColorStop(0.45, col(foil + 0.2, a * 0.4));
          g.addColorStop(1, col(foil, 0));
          ctx.fillStyle = g;
          ctx.fillRect(cx - gR, cy - gR, gR * 2, gR * 2);
        }

        // Shock rings
        if (shock > 0.01) {
          const rr = R * (0.4 + (1 - shock) * 6);
          ctx.lineWidth = 1 + shock * 3;
          for (let k = 0; k < 3; k++) {
            ctx.strokeStyle = col(foil + k * 0.33, shock * 0.5);
            ctx.beginPath();
            ctx.arc(cx, cy, rr * (1 - k * 0.06), k * 2.1, k * 2.1 + Math.PI * 1.4);
            ctx.stroke();
          }
        }

        // CMY cube faces
        if (nucleusIn > 0) {
          const CMY = [
            `rgba(0,229,255,${nucleusIn})`,
            `rgba(255,46,220,${nucleusIn})`,
            `rgba(255,228,40,${nucleusIn})`,
          ];
          const vis: { q: [number, number, number, number]; axis: number }[] = [];
          const vc = [0, 0, 0, 0, 0, 0, 0, 0];
          CUBE_QUADS.forEach((q, qi) => {
            const [i0, i1, i2, i3] = q;
            const x0 = proj[i0 * 3], y0 = proj[i0 * 3 + 1], x1 = proj[i1 * 3], y1 = proj[i1 * 3 + 1];
            const x2 = proj[i2 * 3], y2 = proj[i2 * 3 + 1], x3 = proj[i3 * 3], y3 = proj[i3 * 3 + 1];
            const area = (x0 * y1 - x1 * y0) + (x1 * y2 - x2 * y1) + (x2 * y3 - x3 * y2) + (x3 * y0 - x0 * y3);
            if (area >= 0) return;
            vis.push({ q, axis: qi >> 1 });
            for (const v of q) vc[v]++;
          });
          let shared = -1;
          for (let v = 0; v < 8; v++) if (vc[v] === 3) { shared = v; break; }
          const prevComp = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = "source-over";
          ctx.shadowColor = `rgba(255,255,255,${0.2 * nucleusIn})`;
          ctx.shadowBlur = 14;
          for (const { q, axis } of vis) {
            const si = Math.max(0, shared >= 0 ? q.indexOf(shared) : 0);
            const nv = q[si], fv = q[(si + 2) % 4];
            const g = ctx.createLinearGradient(proj[nv * 3], proj[nv * 3 + 1], proj[fv * 3], proj[fv * 3 + 1]);
            g.addColorStop(0, `rgba(255,255,255,${nucleusIn})`);
            g.addColorStop(1, CMY[axis]);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(proj[q[0] * 3], proj[q[0] * 3 + 1]);
            ctx.lineTo(proj[q[1] * 3], proj[q[1] * 3 + 1]);
            ctx.lineTo(proj[q[2] * 3], proj[q[2] * 3 + 1]);
            ctx.lineTo(proj[q[3] * 3], proj[q[3] * 3 + 1]);
            ctx.closePath();
            ctx.fill();
          }
          ctx.shadowBlur = 0;
          ctx.globalCompositeOperation = prevComp;
        }

        // Wireframe edges
        for (let e = 0; e < EDGES.length; e++) {
          const [i, j] = EDGES[e];
          const edgeIn = reduced ? 1 : easeInOut(clamp01((t - 0.5 - e * 0.012) / 0.8));
          if (edgeIn <= 0) continue;
          const ax = proj[i * 3], ay = proj[i * 3 + 1];
          const bx2 = ax + (proj[j * 3] - ax) * edgeIn;
          const by2 = ay + (proj[j * 3 + 1] - ay) * edgeIn;
          const depth = inner((proj[i * 3 + 2] + proj[j * 3 + 2]) / 2);
          ctx.strokeStyle = col(foil + depth * 0.3, 0.9, 0.75 * (1 - depth));
          ctx.globalAlpha = (dark ? 0.18 : 0.09) + shock * 0.2;
          ctx.lineWidth = isMobile ? 4 : 6;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx2, by2);
          ctx.stroke();
          ctx.globalAlpha = 0.92;
          ctx.lineWidth = 1 + depth * 0.5;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      /* Swarm — free-floating particles, no shadowBlur */
      const flowT = t * 0.25;
      const ptrX = hasPointer ? (mx - cx) / scale : 0;
      const ptrY = hasPointer ? (my - cy) / scale : 0;
      const damp = Math.pow(0.9, dt);
      const swarmIn = reduced ? 1 : clamp01((t - 0.8) / 1.2);

      for (let i = 0; i < N; i++) {
        if (!reduced) {
          const fx = Math.sin(sy[i] * 1.6 + flowT) * Math.cos(sz[i] * 1.3 - flowT * 0.7);
          const fy = Math.sin(sz[i] * 1.5 - flowT * 0.9) * Math.cos(sx[i] * 1.2 + flowT);
          const fz = Math.sin(sx[i] * 1.4 + flowT * 0.8) * Math.cos(sy[i] * 1.7 - flowT);
          let ax = fx * 0.005, ay = fy * 0.005, az = fz * 0.005;
          const rad = Math.hypot(sx[i], sz[i]) || 1;
          const pull = (1.2 - rad) * 0.035;
          ax += (sx[i] / rad) * pull;
          az += (sz[i] / rad) * pull;
          ay -= sy[i] * 0.02;
          ax += holoInput.tiltX * 0.012;
          ay += holoInput.tiltY * 0.012;
          ay -= scrollKick * 0.0004;

          if (hasPointer) {
            const dx = sx[i] - ptrX, dy = sy[i] - ptrY;
            const d = Math.hypot(dx, dy, sz[i]) || 1;
            if (holoInput.pointerDown && d < 2.6) {
              const f = (1 - d / 2.6) * 0.05;
              ax -= (dx / d) * f; ay -= (dy / d) * f; az -= (sz[i] / d) * f;
            } else if (!holoInput.pointerDown && d < 1.3) {
              const f = (1 - d / 1.3) * 0.045;
              ax += (dx / d) * f; ay += (dy / d) * f;
            }
          }

          svx[i] = (svx[i] + ax * dt) * damp;
          svy[i] = (svy[i] + ay * dt) * damp;
          svz[i] = (svz[i] + az * dt) * damp;
          sx[i] += svx[i] * dt;
          sy[i] += svy[i] * dt;
          sz[i] += svz[i] * dt;

          const d = Math.hypot(sx[i], sy[i], sz[i]);
          if (d > 1.95) {
            const k = 1.95 / d;
            sx[i] *= k; sy[i] *= k; sz[i] *= k;
            svx[i] *= -0.4; svy[i] *= -0.4; svz[i] *= -0.4;
          }
        }

        const p = project(sx[i], sy[i], sz[i]);
        const X = p[0], Y = p[1];
        const depth = clamp01((p[2] + 1.8) / 3.4);
        const h = foil + sHue[i] * 0.35 + sPhase[i] / (Math.PI * 2);
        const size = sSize[i] * (0.45 + depth * 0.95) * swarmIn;
        const a = (0.3 + depth * 0.4) * 0.5;

        ctx.fillStyle = col(h, a, size > 1.8 ? 0.35 : 0);
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(0.3, size), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
    };

    flipRef.current = () => {
      const now = performance.now();
      flipFrom = flipAngle;
      flipTo = flipTo + Math.PI;
      flipStart = now;
      shock = 1;
      for (let i = 0; i < N; i++) {
        const d = Math.hypot(sx[i], sy[i], sz[i]) || 1;
        const k = 0.05 + Math.random() * 0.1;
        svx[i] += (sx[i] / d) * k;
        svy[i] += (sy[i] / d) * k;
        svz[i] += (sz[i] / d) * k;
      }
      if (reduced) draw(now);
    };

    let lastFrame = 0;
    const FRAME_MS = 42; // ~24fps
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      draw(now);
    };

    if (reduced) draw(performance.now());
    else raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      const prevW = W;
      measure();
      if (Math.abs(prevW - W) > 40) seedSwarm();
      if (reduced) draw(performance.now());
    });
    ro.observe(wrap);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      last = performance.now();
    });
    io.observe(wrap);

    const onVis = () => { visible = !document.hidden; last = performance.now(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [core]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div
        ref={slotRef}
        data-holo-anchor={core ? undefined : "0.5 0.5 slot 1"}
        data-holo-label={core ? undefined : "Hero"}
        className="relative mx-auto h-[clamp(290px,48svh,520px)] w-full max-w-[620px] flex items-end justify-center"
      >
        <button
          type="button"
          onClick={onFlip}
          aria-label="Fold the agent loop through the fourth dimension"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[55%] aspect-square rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--holo-cyan)]"
        />
        <span
          className={`relative mb-1 mt-6 text-[12px] text-slate-500 dark:text-slate-400 transition-opacity duration-700 pointer-events-none ${
            flipped ? "opacity-0" : "opacity-100"
          }`}
        >
          Tap the core to fold the loop
        </span>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
