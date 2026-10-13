"use client";

import { useEffect, useRef } from "react";
import { holoInput, holoRGB } from "@/lib/holo";

/**
 * HoloCompanion — the one object that follows the reader down the page.
 *
 * It's a fixed, full-viewport canvas behind the content. Sections opt in by
 * carrying a `data-holo-anchor` attribute:
 *
 *   data-holo-anchor="x y size band"
 *     x, y  — where to sit, as fractions of the anchor element's box
 *     size  — radius as a fraction of min(viewport w, h), or "slot" to match
 *             the hero stage's own sizing exactly (for a seamless hand-off)
 *     band  — 0..1, how much of the möbius loop is visible (0 = bare core)
 *   data-holo-anchor-m="…"  — same, used under 768px
 *   data-holo-label="Mission" — shown by BrutalFrame as the section name
 *
 * The object springs toward whichever anchor owns the viewport's midline,
 * blending into the next one over the last third of a section, and its
 * vertical position is clamped into view — so in a tall section it doesn't
 * scroll away, it rides along beside you.
 */

type V4 = [number, number, number, number];
const VERTS: V4[] = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (i < j) EDGES.push([i, j]); }
/* Inner 3-cube of the tesseract (w = -1, vertex indices 0..7), rendered as the
 * logo's opaque cyan→magenta→gold gradient cube inside the white wireframe. */
const CUBE_QUADS: [number, number, number, number][] = [
  [0, 4, 6, 2], // -x
  [1, 3, 7, 5], // +x
  [0, 1, 5, 4], // -y
  [2, 6, 7, 3], // +y
  [0, 2, 3, 1], // -z
  [4, 5, 7, 6], // +z
];
function rot4(v: V4, i: number, j: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang), A = v[i], B = v[j];
  v[i] = A * c - B * s;
  v[j] = A * s + B * c;
}
const MOB_R = 1, MOB_W = 0.44;
function mobius(u: number, v: number, o: [number, number, number]) {
  const h = v * MOB_W, r = MOB_R + h * Math.cos(u / 2);
  o[0] = r * Math.cos(u); o[1] = h * Math.sin(u / 2); o[2] = r * Math.sin(u);
}
const cl01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Anchor { el: HTMLElement; x: number; y: number; size: number | "slot"; band: number; }

function parseAnchor(el: HTMLElement, mobile: boolean): Anchor {
  const raw = (mobile && el.dataset.holoAnchorM) || el.dataset.holoAnchor || "0.5 0.5 0.2 1";
  const [x, y, size, band] = raw.trim().split(/\s+/);
  return {
    el,
    x: parseFloat(x),
    y: parseFloat(y),
    size: size === "slot" ? "slot" : parseFloat(size),
    band: band == null ? 1 : parseFloat(band),
  };
}

export function HoloCompanion() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = holoInput.reducedMotion;

    let W = 0, H = 0, dpr = 1, mobile = false;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      mobile = W < 768;
      dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    // Riding agents — a lighter cousin of the hero swarm, glued to the band.
    const NA = mobile ? 70 : 130;
    const aPhase = new Float32Array(NA), aOff = new Float32Array(NA), aSize = new Float32Array(NA), aHue = new Float32Array(NA);
    for (let i = 0; i < NA; i++) {
      aPhase[i] = Math.random() * Math.PI * 2;
      aOff[i] = (Math.random() * 2 - 1) * 0.9;
      aSize[i] = 0.6 + Math.pow(Math.random(), 2) * 2.2;
      aHue[i] = Math.random();
    }

    // Spring state for position / radius / band visibility.
    let px = W / 2, py = H * 0.35, pr = 120, pb = 1;
    let vx = 0, vy = 0, vr = 0;
    let camA = 0.5, tRX = 0, tRY = 0;
    let flipFrom = 0, flipTo = 0, flipStart = -1, flipAngle = 0, shock = 0;
    let lastScrollY = window.scrollY, spinBoost = 0;

    const onFlip = () => {
      flipFrom = flipAngle; flipTo += Math.PI; flipStart = performance.now(); shock = 1;
    };
    window.addEventListener("holo:flip", onFlip);

    const target = () => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-holo-anchor]"));
      if (!els.length) return null;
      const mid = H * 0.5;
      let idx = 0;
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.top <= mid) idx = i;
      }
      const cur = parseAnchor(els[idx], mobile);
      const next = els[idx + 1] ? parseAnchor(els[idx + 1], mobile) : null;
      // Hand-off is driven by the NEXT section arriving, not by progress
      // through the current one: it begins when the next section's top
      // enters the bottom of the viewport and completes as it reaches the
      // midline. This is independent of section height, so a short hero
      // slot doesn't start drifting away before you've scrolled at all.
      let blend = 0;
      if (next) {
        const nTop = next.el.getBoundingClientRect().top;
        blend = ease(cl01((H * 0.92 - nTop) / (H * 0.42)));
      }

      const resolve = (a: Anchor) => {
        const rr = a.el.getBoundingClientRect();
        const rad = a.size === "slot"
          ? Math.min(rr.width, rr.height) * (mobile ? 0.32 : 0.42)
          : a.size * Math.min(W, H);
        let ty = rr.top + rr.height * a.y;
        let tx = rr.left + rr.width * a.x;
        // Keep the object inside the viewport on BOTH axes: it rides along
        // beside you instead of scrolling off or hanging over the edge.
        const pad = rad * 1.15;
        if (a.size !== "slot") {
          ty = Math.max(pad + 70, Math.min(H - pad, ty));
          tx = Math.max(pad + 14, Math.min(W - pad - 14, tx));
        }
        return { x: tx, y: ty, r: rad, b: a.band };
      };
      const A = resolve(cur);
      if (!next || blend === 0) return A;
      const B = resolve(next);
      return {
        x: A.x + (B.x - A.x) * blend,
        y: A.y + (B.y - A.y) * blend,
        r: A.r + (B.r - A.r) * blend,
        b: A.b + (B.b - A.b) * blend,
      };
    };

    const t0 = performance.now();
    let last = t0, raf = 0;
    const pa: [number, number, number] = [0, 0, 0];
    const o3: [number, number, number] = [0, 0, 0];
    let ca = 1, sa = 0, cb = 1, sb = 0, scale = 1, cx = 0, cy = 0;
    const PERSP = 4.2;
    const proj = (x: number, y: number, z: number) => {
      const x1 = x * ca - z * sa, z1 = x * sa + z * ca, y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      const k = PERSP / (PERSP - z2);
      o3[0] = cx + x1 * k * scale; o3[1] = cy + y1 * k * scale; o3[2] = z2;
      return o3;
    };

    const FRAME_MS = 33; // 30fps cap
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || now - last < FRAME_MS) { if (document.hidden) last = now; return; }
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      const t = (now - t0) / 1000;
      const dark = document.documentElement.classList.contains("dark");

      // ---- follow the anchors with a critically-damped spring ----
      const tg = target();
      // Guard: a zero-size anchor or a large dt can yield NaN, and once the
      // spring state is NaN it never recovers (every gradient call throws).
      if (tg && Number.isFinite(tg.x + tg.y + tg.r + tg.b)) {
        if (!Number.isFinite(px + py + pr + vx + vy + vr)) { px = tg.x; py = tg.y; pr = tg.r; vx = vy = vr = 0; }
        const k = reduced ? 1 : 0.07, d = 0.72;
        if (reduced) { px = tg.x; py = tg.y; pr = tg.r; }
        else {
          vx = (vx + (tg.x - px) * k) * d; px += vx * dt;
          vy = (vy + (tg.y - py) * k) * d; py += vy * dt;
          vr = (vr + (tg.r - pr) * k) * d; pr += vr * dt;
        }
        pb += (tg.b - pb) * 0.06 * dt;
      }

      // Scroll speed spins the object — the parallax "kick".
      const sy = window.scrollY;
      const sv = sy - lastScrollY;
      lastScrollY = sy;
      spinBoost += (Math.max(-60, Math.min(60, sv)) * 0.0016 - spinBoost) * 0.15;

      const tX = holoInput.hasTilt ? holoInput.tiltX : holoInput.pointerActive ? (holoInput.px / W - 0.5) * 2 : 0;
      const tY = holoInput.hasTilt ? holoInput.tiltY : holoInput.pointerActive ? (holoInput.py / H - 0.5) * 2 : 0;
      tRX += (tY * 0.4 - tRX) * 0.055 * dt;
      tRY += (tX * 0.6 - tRY) * 0.055 * dt;
      if (!reduced) camA += (0.0022 + spinBoost) * dt;
      if (flipStart >= 0) {
        const p = cl01((now - flipStart) / 1500);
        flipAngle = flipFrom + (flipTo - flipFrom) * ease(p);
        if (p >= 1) flipStart = -1;
      }
      shock = Math.max(0, shock - 0.018 * dt);

      const yaw = camA + tRY;
      // Velocity tilts the object into the direction of travel.
      const pitch = -0.5 + tRX + (reduced ? 0 : Math.sin(t * 0.21) * 0.07) + Math.max(-0.35, Math.min(0.35, vy * 0.01));
      ca = Math.cos(yaw); sa = Math.sin(yaw); cb = Math.cos(pitch); sb = Math.sin(pitch);
      cx = px; cy = py; scale = pr;
      const intro = reduced ? 1 : cl01(t / 1.8);
      const foil = t * 0.035 + tX * 0.18 + tY * 0.1 + sy * 0.00008;

      const col = (h: number, a: number, wh = 0) => {
        let [r, g, b] = holoRGB(h);
        if (dark) { r += (255 - r) * wh; g += (255 - g) * wh; b += (255 - b) * wh; }
        else { const ink = 0.5 + wh * 0.3; r = r * (1 - ink) + 22 * ink; g = g * (1 - ink) + 22 * ink; b = b * (1 - ink) + 28 * ink; }
        return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // ---- rays ----
      const RAYS = mobile ? 12 : 20;
      for (let i = 0; i < RAYS; i++) {
        const ang = ((i * 2.399) % (Math.PI * 2)) + t * 0.07 * (i % 2 ? 1 : -1);
        const puls = 0.45 + 0.55 * Math.sin(t * (0.5 + (i % 5) * 0.17) + i);
        const len = pr * 3 * (0.35 + 0.65 * puls) * intro;
        const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len * 0.52;
        const g = ctx.createLinearGradient(cx, cy, ex, ey);
        const a = (dark ? 0.12 : 0.05) * puls * intro + shock * 0.1;
        g.addColorStop(0, col(foil + i * 0.05, a));
        g.addColorStop(1, col(foil + i * 0.05, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 1 + puls * (mobile ? 4 : 7);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      }

      // ---- möbius band — ASCII twin spirals ----
      const spin = reduced ? 0 : t * 0.22;
      const bandA = cl01(pb) * intro;
      if (bandA > 0.02) {
        const RAMP = " .:+x*oX08#@";
        const SEG = mobile ? 48 : 80;
        const VPTS = 5;
        const fontSize = mobile ? 10 : 13;
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < SEG; i++) {
          const u = (i / SEG) * Math.PI * 2;
          for (let j = 0; j <= VPTS; j++) {
            const v = (j / VPTS) * 2 - 1;
            mobius(u + spin, v, pa);
            const P = proj(pa[0], pa[1], pa[2]);
            const depth = cl01((P[2] + 1.4) / 2.8);
            const bright = depth * 0.55 + Math.sin(u * 3 + t * 1.2) * 0.2 + 0.25;
            const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(cl01(bright) * (RAMP.length - 1)))];
            if (ch === " ") continue;
            const h = foil + u / (Math.PI * 2);
            ctx.fillStyle = col(h, (0.5 + depth * 0.45) * bandA, bright > 0.6 ? 0.3 : 0);
            ctx.fillText(ch, P[0], P[1]);
          }
        }
      }

      // ---- tesseract nucleus (grows when the band is hidden) ----
      const NUC = 0.42 + (1 - cl01(pb)) * 0.38;
      const pj = new Float64Array(48), v4: V4 = [0, 0, 0, 0];
      const breathe = reduced ? 0.18 : Math.sin(t * 0.35) * 0.22;
      let wMin = 1e9, wMax = -1e9;
      for (let i = 0; i < 16; i++) {
        v4[0] = VERTS[i][0]; v4[1] = VERTS[i][1]; v4[2] = VERTS[i][2]; v4[3] = VERTS[i][3];
        rot4(v4, 0, 3, breathe); rot4(v4, 2, 3, flipAngle); rot4(v4, 0, 1, t * 0.18 + sy * 0.0012);
        const w = v4[3], k4 = 1 / (2.4 - w), P = proj(v4[0] * k4 * NUC, v4[1] * k4 * NUC, v4[2] * k4 * NUC);
        pj[i * 3] = P[0]; pj[i * 3 + 1] = P[1]; pj[i * 3 + 2] = w;
        if (w < wMin) wMin = w; if (w > wMax) wMax = w;
      }
      const span = Math.max(0.001, wMax - wMin), inner = (w: number) => 1 - (w - wMin) / span;
      const nIn = reduced ? 1 : cl01((t - 0.4) / 1);
      {
        const gR = pr * (0.95 + shock * 1.5), g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gR);
        const a = (dark ? 0.3 : 0.14) * nIn + shock * 0.22;
        g.addColorStop(0, col(foil + 0.55, a)); g.addColorStop(0.45, col(foil + 0.2, a * 0.4)); g.addColorStop(1, col(foil, 0));
        ctx.fillStyle = g; ctx.fillRect(cx - gR, cy - gR, gR * 2, gR * 2);
      }
      if (shock > 0.01) {
        const rr = pr * (0.4 + (1 - shock) * 6);
        ctx.lineWidth = 1 + shock * 3;
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = col(foil + k * 0.33, shock * 0.5);
          ctx.beginPath(); ctx.arc(cx, cy, rr * (1 - k * 0.06), k * 2.1, k * 2.1 + Math.PI * 1.4); ctx.stroke();
        }
      }
      {
        // Official nucleus: the three visible faces are ALWAYS cyan / magenta /
        // yellow (one hue per axis), each gradient from a bright white shared
        // corner out to the saturated colour. Colour is tied to the VISIBLE face
        // (back faces culled), so the cube never shows red/green/blue no matter
        // how it is turned — only CMY + white, like the logo. Opaque, both themes.
        const CMY = [
          `rgba(0,229,255,${nIn})`,  // cyan
          `rgba(255,46,220,${nIn})`, // magenta
          `rgba(255,228,40,${nIn})`, // yellow
        ];
        const vis: { q: [number, number, number, number]; axis: number }[] = [];
        const vc = [0, 0, 0, 0, 0, 0, 0, 0];
        CUBE_QUADS.forEach((q, qi) => {
          const [i0, i1, i2, i3] = q;
          const x0 = pj[i0 * 3], y0 = pj[i0 * 3 + 1], x1 = pj[i1 * 3], y1 = pj[i1 * 3 + 1];
          const x2 = pj[i2 * 3], y2 = pj[i2 * 3 + 1], x3 = pj[i3 * 3], y3 = pj[i3 * 3 + 1];
          const area = (x0 * y1 - x1 * y0) + (x1 * y2 - x2 * y1) + (x2 * y3 - x3 * y2) + (x3 * y0 - x0 * y3);
          if (area >= 0) return;
          vis.push({ q, axis: qi >> 1 });
          for (const v of q) vc[v]++;
        });
        let shared = -1;
        for (let v = 0; v < 8; v++) if (vc[v] === 3) { shared = v; break; }
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "source-over";
        ctx.shadowColor = `rgba(255,255,255,${0.2 * nIn})`;
        ctx.shadowBlur = 14;
        for (const { q, axis } of vis) {
          const si = Math.max(0, shared >= 0 ? q.indexOf(shared) : 0); // indexOf may be -1 → q[-1] is undefined → NaN gradient
          const nv = q[si], fv = q[(si + 2) % 4];
          const g = ctx.createLinearGradient(pj[nv * 3], pj[nv * 3 + 1], pj[fv * 3], pj[fv * 3 + 1]);
          g.addColorStop(0, `rgba(255,255,255,${nIn})`);
          g.addColorStop(1, CMY[axis]);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(pj[q[0] * 3], pj[q[0] * 3 + 1]);
          ctx.lineTo(pj[q[1] * 3], pj[q[1] * 3 + 1]);
          ctx.lineTo(pj[q[2] * 3], pj[q[2] * 3 + 1]);
          ctx.lineTo(pj[q[3] * 3], pj[q[3] * 3 + 1]);
          ctx.closePath();
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = prevComp;
      }
      for (let e = 0; e < EDGES.length; e++) {
        const [i, j] = EDGES[e];
        const eIn = reduced ? 1 : ease(cl01((t - 0.45 - e * 0.012) / 0.8)); if (eIn <= 0) continue;
        const X1 = pj[i * 3], Y1 = pj[i * 3 + 1];
        const X2 = X1 + (pj[j * 3] - X1) * eIn, Y2 = Y1 + (pj[j * 3 + 1] - Y1) * eIn;
        const dep = inner((pj[i * 3 + 2] + pj[j * 3 + 2]) / 2);
        ctx.strokeStyle = col(foil + dep * 0.3, 0.9, 0.78 * (1 - dep));
        ctx.globalAlpha = (dark ? 0.16 : 0.08) + shock * 0.2; ctx.lineWidth = mobile ? 4 : 6;
        ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); ctx.stroke();
        ctx.globalAlpha = 0.92; ctx.lineWidth = 1 + dep * 0.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ---- riding agents ----
      if (bandA > 0.02) {
        for (let i = 0; i < NA; i++) {
          if (!reduced) aPhase[i] += (0.006 + aSize[i] * 0.0012 + Math.abs(spinBoost) * 0.4) * dt;
          mobius(aPhase[i] + spin, aOff[i], pa);
          const P = proj(pa[0], pa[1], pa[2]);
          const depth = cl01((P[2] + 1.8) / 3.4);
          const sz = aSize[i] * (0.45 + depth * 0.9) * intro;
          ctx.fillStyle = col(foil + aHue[i] * 0.35 + aPhase[i] / (Math.PI * 2), (0.45 + depth * 0.5) * bandA, sz > 1.8 ? 0.35 : 0);
          ctx.beginPath(); ctx.arc(P[0], P[1], Math.max(0.3, sz), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("holo:flip", onFlip);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none" />;
}
