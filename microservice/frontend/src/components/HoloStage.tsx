"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { holoInput, holoRGB, requestTiltPermission } from "@/lib/holo";

/* ------------------------------------------------------------------ */
/* Tesseract geometry — the logo's hypercube, at the centre            */
/* ------------------------------------------------------------------ */

type V4 = [number, number, number, number];

const VERTS: V4[] = Array.from({ length: 16 }, (_, i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
  i & 8 ? 1 : -1,
]);

const EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) {
  for (let b = 0; b < 4; b++) {
    const j = i ^ (1 << b);
    if (i < j) EDGES.push([i, j]);
  }
}

/* The inner 3-cube of the tesseract (w = -1, vertex indices 0..7), rendered as
 * the logo's opaque cyan→magenta→gold gradient cube inside the white wireframe. */
const CUBE_QUADS: [number, number, number, number][] = [
  [0, 4, 6, 2], // -x
  [1, 3, 7, 5], // +x
  [0, 1, 5, 4], // -y
  [2, 6, 7, 3], // +y
  [0, 2, 3, 1], // -z
  [4, 5, 7, 6], // +z
];

function rot4(v: V4, i: number, j: number, ang: number) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const a = v[i];
  const b = v[j];
  v[i] = a * c - b * s;
  v[j] = a * s + b * c;
}

/* ------------------------------------------------------------------ */
/* Möbius strip — the agent loop. One surface, one edge, no end: an    */
/* agent walking it returns flipped, having never left the band.       */
/* ------------------------------------------------------------------ */

const MOB_R = 1.0;
const MOB_W = 0.44;

function mobius(u: number, v: number, out: [number, number, number]) {
  const h = v * MOB_W;
  const r = MOB_R + h * Math.cos(u / 2);
  out[0] = r * Math.cos(u);
  out[1] = h * Math.sin(u / 2);
  out[2] = r * Math.sin(u);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* ------------------------------------------------------------------ */

/**
 * `core` — when false, the möbius loop and tesseract are NOT drawn here; the
 * page-level HoloCompanion draws them instead so the object can leave the
 * hero and follow the reader down the page. The hero keeps only the
 * spacetime lattice and the free swarm.
 */
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

    let W = 0;
    let H = 0;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let R = 100;
    let isMobile = false;

    /* ---------------- swarm ---------------- */
    let N = 0;
    let sx = new Float32Array(0);
    let sy = new Float32Array(0);
    let sz = new Float32Array(0);
    let svx = new Float32Array(0);
    let svy = new Float32Array(0);
    let svz = new Float32Array(0);
    let sPhase = new Float32Array(0);
    let sOff = new Float32Array(0);
    let sBound = new Uint8Array(0);
    let sSize = new Float32Array(0);
    let sHue = new Float32Array(0);

    const seedSwarm = () => {
      const area = W * H;
      N = Math.round(Math.min(isMobile ? 100 : 250, Math.max(50, area / (isMobile ? 3000 : 4000))));
      sx = new Float32Array(N);
      sy = new Float32Array(N);
      sz = new Float32Array(N);
      svx = new Float32Array(N);
      svy = new Float32Array(N);
      svz = new Float32Array(N);
      sPhase = new Float32Array(N);
      sOff = new Float32Array(N);
      sBound = new Uint8Array(N);
      sSize = new Float32Array(N);
      sHue = new Float32Array(N);
      const p: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        sBound[i] = core && i % 3 !== 0 ? 1 : 0;
        sPhase[i] = Math.random() * Math.PI * 2;
        sOff[i] = (Math.random() * 2 - 1) * 0.95;
        sSize[i] = 0.5 + Math.pow(Math.random(), 2.2) * (isMobile ? 2.0 : 2.5);
        sHue[i] = Math.random();
        if (sBound[i]) {
          mobius(sPhase[i], sOff[i], p);
          sx[i] = p[0];
          sy[i] = p[1];
          sz[i] = p[2];
        } else {
          const a = Math.random() * Math.PI * 2;
          const r = 1.15 + Math.random() * 1.0;
          sx[i] = Math.cos(a) * r;
          sy[i] = (Math.random() - 0.5) * 1.6;
          sz[i] = Math.sin(a) * r;
        }
      }
    };

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const srect = slot.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      isMobile = W < 640;
      dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.75 : 2);
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
    let last = t0;
    let camA = 0.5;
    const camB = -0.5;
    let tiltRX = 0;
    let tiltRY = 0;
    let flipFrom = 0;
    let flipTo = 0;
    let flipStart = -1;
    let flipAngle = 0;
    let shock = 0;
    let visible = true;
    let raf = 0;

    // ---- shared camera ----
    let ca = 1;
    let sa = 0;
    let cb = 1;
    let sb = 0;
    let scale = 1;
    const PERSP = 4.2;
    const out3: [number, number, number] = [0, 0, 0];

    function project(x: number, y: number, z: number): [number, number, number] {
      const x1 = x * ca - z * sa;
      const z1 = x * sa + z * ca;
      const y1 = y * cb - z1 * sb;
      const z2 = y * sb + z1 * cb;
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
      ca = Math.cos(yaw);
      sa = Math.sin(yaw);
      cb = Math.cos(pitch);
      sb = Math.sin(pitch);
      scale = R * (0.86 + 0.14 * intro);

      const foil = t * 0.035 + tX * 0.18 + tY * 0.1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const col = (h: number, a: number, whiten = 0) => {
        let [r, g, b] = holoRGB(h);
        if (dark) {
          r += (255 - r) * whiten;
          g += (255 - g) * whiten;
          b += (255 - b) * whiten;
        } else {
          const ink = 0.5 + whiten * 0.3;
          r = r * (1 - ink) + 22 * ink;
          g = g * (1 - ink) + 22 * ink;
          b = b * (1 - ink) + 28 * ink;
        }
        return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
      };

      /* 1. Spacetime lattice — a sheet dented by the nucleus's mass. */
      const latticeIn = reduced ? 1 : clamp01((t - 0.15) / 1.4);
      if (latticeIn > 0) {
        const EXT = 2.5;
        const STEP = isMobile ? 0.5 : 0.36;
        const wellDepth = 1.5 + shock * 1.6;
        const dip = (x: number, z: number) => 1.45 + wellDepth / ((x * x + z * z) * 2.2 + 0.6);
        ctx.lineWidth = 1;
        const latAlpha = (dark ? 0.13 : 0.11) * latticeIn;
        for (let pass = 0; pass < 2; pass++) {
          for (let a = -EXT; a <= EXT + 0.001; a += STEP) {
            ctx.beginPath();
            let started = false;
            for (let b = -EXT; b <= EXT + 0.001; b += STEP / 2) {
              const x = pass === 0 ? a : b;
              const z = pass === 0 ? b : a;
              const p = project(x, dip(x, z), z);
              if (!started) {
                ctx.moveTo(p[0], p[1]);
                started = true;
              } else ctx.lineTo(p[0], p[1]);
            }
            const fade = 1 - Math.abs(a) / (EXT + 0.4);
            ctx.strokeStyle = col(foil + a * 0.06, latAlpha * fade * fade);
            ctx.stroke();
          }
        }
      }

      /* 1b. Volumetric rays — light escaping the nucleus through the band. */
      const rayIn = reduced ? 1 : clamp01((t - 0.9) / 1.6);
      if (core && rayIn > 0) {
        const RAYS = isMobile ? 14 : 22;
        const maxLen = R * 3.2;
        ctx.save();
        for (let i = 0; i < RAYS; i++) {
          const seedA = (i * 2.399) % (Math.PI * 2);
          const ang = seedA + t * 0.07 * (i % 2 ? 1 : -1);
          // Each ray breathes on its own period so they never pulse in unison.
          const puls = 0.45 + 0.55 * Math.sin(t * (0.5 + (i % 5) * 0.17) + i);
          const len = maxLen * (0.35 + 0.65 * puls) * rayIn;
          const ex = cx + Math.cos(ang) * len;
          const ey = cy + Math.sin(ang) * len * 0.52; // squashed: the band is near-horizontal
          const g = ctx.createLinearGradient(cx, cy, ex, ey);
          const a = (dark ? 0.16 : 0.07) * puls * rayIn + shock * 0.12;
          g.addColorStop(0, col(foil + i * 0.05, a));
          g.addColorStop(1, col(foil + i * 0.05, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 1 + puls * (isMobile ? 5 : 9);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 2. Möbius band — ASCII twin spirals */
      const bandIn = reduced ? 1 : clamp01((t - 0.35) / 1.5);
      const spin = reduced ? 0 : t * 0.22;
      const pa: [number, number, number] = [0, 0, 0];

      if (core && bandIn > 0) {
        const HEX = "0123456789ABCDEF";
        const MSEG = isMobile ? 64 : 120;
        const fontSize = isMobile ? 9 : 11;
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const reach = Math.PI * 2 * bandIn;
        for (let edge = 0; edge < 2; edge++) {
          const v = edge === 0 ? -1 : 1;
          for (let i = 0; i < MSEG; i++) {
            const u = (i / MSEG) * Math.PI * 2;
            if (u > reach) break;
            mobius(u + spin, v, pa);
            const p = project(pa[0], pa[1], pa[2]);
            const depth = clamp01((p[2] + 1.4) / 2.8);
            const idx = Math.floor((u / (Math.PI * 2) * 7 + t * 2 + edge * 8) % HEX.length);
            const ch = HEX[idx];
            const h = foil + u / (Math.PI * 2);
            ctx.fillStyle = col(h, (0.55 + depth * 0.4) * bandIn, depth > 0.5 ? 0.35 : 0);
            ctx.fillText(ch, p[0], p[1]);
          }
        }
      }

      if (core) {
      /* 3. Tesseract nucleus at the centre of the loop. */
      const proj = new Float64Array(16 * 3);
      const v4: V4 = [0, 0, 0, 0];
      const breathe = reduced ? 0.18 : Math.sin(t * 0.35) * 0.22;
      const NUC = 0.42;
      let wMin = Infinity;
      let wMax = -Infinity;
      for (let i = 0; i < 16; i++) {
        v4[0] = VERTS[i][0];
        v4[1] = VERTS[i][1];
        v4[2] = VERTS[i][2];
        v4[3] = VERTS[i][3];
        rot4(v4, 0, 3, breathe);
        rot4(v4, 2, 3, flipAngle);
        rot4(v4, 0, 1, t * 0.18);
        const w = v4[3];
        const k4 = 1 / (2.4 - w);
        const p = project(v4[0] * k4 * NUC, v4[1] * k4 * NUC, v4[2] * k4 * NUC);
        proj[i * 3] = p[0];
        proj[i * 3 + 1] = p[1];
        proj[i * 3 + 2] = w;
        if (w < wMin) wMin = w;
        if (w > wMax) wMax = w;
      }
      const wSpan = Math.max(0.001, wMax - wMin);
      const inner = (w: number) => 1 - (w - wMin) / wSpan;

      const nucleusIn = reduced ? 1 : clamp01((t - 0.5) / 1.0);
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

      if (nucleusIn > 0) {
        // Official nucleus: the three visible faces are ALWAYS cyan / magenta /
        // yellow (one hue per axis), each gradient from a bright white shared
        // corner out to the saturated colour. Colour is tied to the VISIBLE face
        // (back faces culled), so the cube never shows red/green/blue no matter
        // how it is turned — only CMY + white, like the logo. Opaque, both themes.
        const CMY = [
          `rgba(0,229,255,${nucleusIn})`,  // cyan
          `rgba(255,46,220,${nucleusIn})`, // magenta
          `rgba(255,228,40,${nucleusIn})`, // yellow
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
          const si = Math.max(0, shared >= 0 ? q.indexOf(shared) : 0); // indexOf may be -1 → q[-1] is undefined → NaN gradient
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

      /* 4. Agent swarm — two thirds ride the loop, the rest drift. */
      const flowT = t * 0.25;
      const ptrX = hasPointer ? (mx - cx) / scale : 0;
      const ptrY = hasPointer ? (my - cy) / scale : 0;
      const damp = Math.pow(0.9, dt);
      const tgt: [number, number, number] = [0, 0, 0];
      const swarmIn = reduced ? 1 : clamp01((t - 0.8) / 1.2);
      const linkR = isMobile ? 110 : 160;
      let links = 0;
      const maxLinks = isMobile ? 12 : 20;

      for (let i = 0; i < N; i++) {
        if (!reduced) {
          let ax = 0;
          let ay = 0;
          let az = 0;

          if (sBound[i]) {
            sPhase[i] += (0.006 + sSize[i] * 0.0012) * dt;
            mobius(sPhase[i] + spin, sOff[i], tgt);
            ax += (tgt[0] - sx[i]) * 0.09;
            ay += (tgt[1] - sy[i]) * 0.09;
            az += (tgt[2] - sz[i]) * 0.09;
          } else {
            const fx = Math.sin(sy[i] * 1.6 + flowT) * Math.cos(sz[i] * 1.3 - flowT * 0.7);
            const fy = Math.sin(sz[i] * 1.5 - flowT * 0.9) * Math.cos(sx[i] * 1.2 + flowT);
            const fz = Math.sin(sx[i] * 1.4 + flowT * 0.8) * Math.cos(sy[i] * 1.7 - flowT);
            ax += fx * 0.005;
            ay += fy * 0.005;
            az += fz * 0.005;
            const rad = Math.hypot(sx[i], sz[i]) || 1;
            const pull = (MOB_R * 1.4 - rad) * 0.035;
            ax += (sx[i] / rad) * pull;
            az += (sz[i] / rad) * pull;
            ay -= sy[i] * 0.02;
          }

          ax += holoInput.tiltX * 0.012;
          ay += holoInput.tiltY * 0.012;
          ay -= scrollKick * 0.0004;

          if (hasPointer) {
            const dx = sx[i] - ptrX;
            const dy = sy[i] - ptrY;
            const d = Math.hypot(dx, dy, sz[i]) || 1;
            if (holoInput.pointerDown) {
              if (d < 2.6) {
                const f = (1 - d / 2.6) * 0.05;
                ax -= (dx / d) * f;
                ay -= (dy / d) * f;
                az -= (sz[i] / d) * f;
              }
            } else if (d < 1.3) {
              const f = (1 - d / 1.3) * 0.045;
              ax += (dx / d) * f;
              ay += (dy / d) * f;
            }
          }

          svx[i] = (svx[i] + ax * dt) * damp;
          svy[i] = (svy[i] + ay * dt) * damp;
          svz[i] = (svz[i] + az * dt) * damp;
          sx[i] += svx[i] * dt;
          sy[i] += svy[i] * dt;
          sz[i] += svz[i] * dt;

          if (!sBound[i]) {
            const d = Math.hypot(sx[i], sy[i], sz[i]);
            if (d > 1.95) {
              const k = 1.95 / d;
              sx[i] *= k;
              sy[i] *= k;
              sz[i] *= k;
              svx[i] *= -0.4;
              svy[i] *= -0.4;
              svz[i] *= -0.4;
            }
          }
        }

        let p = project(sx[i], sy[i], sz[i]);
        const X = p[0];
        const Y = p[1];
        const depth = clamp01((p[2] + 1.8) / 3.4);
        const speed = Math.hypot(svx[i], svy[i], svz[i]);
        const h = foil + sHue[i] * 0.35 + sPhase[i] / (Math.PI * 2);
        const size = sSize[i] * (0.45 + depth * 0.95) * swarmIn;
        const a = (0.4 + depth * 0.55) * (sBound[i] ? 1 : 0.5);

        if (speed > 0.012) {
          p = project(sx[i] - svx[i] * 2.5, sy[i] - svy[i] * 2.5, sz[i] - svz[i] * 2.5);
          // Clamp the trail in screen space — a fast particle near the camera
          // would otherwise smear a full-width streak across the hero.
          let tx = p[0] - X;
          let ty = p[1] - Y;
          const tl = Math.hypot(tx, ty);
          const maxTrail = 17;
          if (tl > maxTrail) {
            tx = (tx / tl) * maxTrail;
            ty = (ty / tl) * maxTrail;
          }
          ctx.strokeStyle = col(h, a);
          ctx.lineWidth = Math.max(0.4, size);
          ctx.beginPath();
          ctx.moveTo(X, Y);
          ctx.lineTo(X + tx, Y + ty);
          ctx.stroke();
        } else {
          ctx.fillStyle = col(h, a, size > 1.8 ? 0.35 : 0);
          ctx.beginPath();
          ctx.arc(X, Y, Math.max(0.3, size), 0, Math.PI * 2);
          ctx.fill();
        }

        if (hasPointer && links < maxLinks) {
          const q = Math.hypot(X - mx, Y - my);
          if (q < linkR) {
            links++;
            ctx.strokeStyle = col(h, (1 - q / linkR) * (dark ? 0.22 : 0.15));
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(X, Y);
            ctx.lineTo(mx, my);
            ctx.stroke();
          }
        }
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
    const FRAME_MS = 33; // 30fps cap
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

    const onVis = () => {
      visible = !document.hidden;
      last = performance.now();
    };
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
