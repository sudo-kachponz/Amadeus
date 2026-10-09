"use client";

import { useEffect, useRef, useState } from "react";
import { onTick } from "@/lib/ticker";

/**
 * The hero console — the product, shown working.
 *
 * Three lanes (Human, Agent, Robot) carry one transaction left to right.
 * A pulse travels the wire; each node lights as the pulse reaches it, and
 * the right-hand panel counts what that step actually cost. The story is
 * orchestration: no single lane finishes the job alone.
 *
 * Everything is scripted DOM/SVG on the shared ticker — no flow library, no
 * network, no per-node React state. One subscriber drives the whole thing.
 */

type Lane = "human" | "agent" | "robot";

interface Step {
  id: string;
  lane: Lane;
  label: string;
  sub: string;
  /** Seconds into the loop when this step begins. */
  at: number;
  /** Log line emitted when the step fires. */
  log: string;
  /** Metric deltas applied when the step fires. */
  cost?: { tokens?: number; calls?: number; ms?: number };
}

interface Persona {
  id: string;
  who: string;
  can: string;
  /** The human instruction that kicked the run off. */
  prompt: string;
  steps: Step[];
}

const PERSONAS: Persona[] = [
  {
    id: "report",
    who: "Financial analyst",
    can: "Pull IDX reports via chat",
    prompt: "Tarik laporan keuangan BBRI tahun 2024 periode TW3, jenis laporan tahunan",
    steps: [
      { id: "r1", lane: "agent", label: "Parse request", sub: "argument discovery", at: 0.4, log: "[AGENT] get_uipath_process_arguments → 5 inputs found", cost: { tokens: 420, calls: 1, ms: 600 } },
      { id: "r2", lane: "robot", label: "Trigger UiPath", sub: "Penarikan Laporan", at: 1.5, log: "[ROBOT] trigger_uipath_job → Job #127311175 started", cost: { ms: 340 } },
      { id: "r3", lane: "robot", label: "Extract report", sub: "IDX scraper", at: 2.8, log: "[ROBOT] navigating IDX portal · downloading PDF", cost: { ms: 4200 } },
      { id: "r4", lane: "agent", label: "Summarize", sub: "analysis", at: 4.2, log: "[AGENT] report extracted · generating summary", cost: { tokens: 1860, calls: 1, ms: 1100 } },
      { id: "r5", lane: "human", label: "Review result", sub: "analyst", at: 5.4, log: "[HUMAN] report verified · forwarded to team", cost: { ms: 800 } },
    ],
  },
  {
    id: "compliance",
    who: "Compliance",
    can: "Screen SWIFT for APU/PPT flags",
    prompt: "Analisis 25 transaksi SWIFT MT terbaru, deteksi indikasi APU/PPT",
    steps: [
      { id: "c1", lane: "robot", label: "Push to queue", sub: "25 transactions", at: 0.4, log: "[ROBOT] bulk_add_queue_items → 25 items queued", cost: { ms: 280 } },
      { id: "c2", lane: "agent", label: "Analyze patterns", sub: "fraud detection", at: 1.6, log: "[AGENT] 3 suspicious patterns flagged", cost: { tokens: 2100, calls: 1, ms: 1400 } },
      { id: "c3", lane: "robot", label: "Run scanner", sub: "UiPath APU bot", at: 3.0, log: "[ROBOT] APU/PPT screening completed · 2 alerts", cost: { ms: 3800 } },
      { id: "c4", lane: "human", label: "Verify alerts", sub: "compliance officer", at: 4.8, log: "[HUMAN] 2 alerts reviewed · 1 escalated to PPATK", cost: { ms: 1200 } },
    ],
  },
  {
    id: "ops",
    who: "Operations",
    can: "Automate bulk data ops via Sheets",
    prompt: "Upload 50 nasabah baru ke Google Sheets dan kirim laporan via Gmail",
    steps: [
      { id: "o1", lane: "agent", label: "Validate data", sub: "schema check", at: 0.4, log: "[AGENT] 50 records validated · 2 duplicates removed", cost: { tokens: 680, calls: 1, ms: 500 } },
      { id: "o2", lane: "robot", label: "Write to Sheets", sub: "Google Sheets MCP", at: 1.6, log: "[ROBOT] 48 rows appended to Nasabah sheet", cost: { ms: 1200 } },
      { id: "o3", lane: "robot", label: "Send report", sub: "Gmail MCP", at: 3.0, log: "[ROBOT] email sent to compliance@bank.co.id", cost: { ms: 400 } },
      { id: "o4", lane: "human", label: "Confirm delivery", sub: "ops manager", at: 4.2, log: "[HUMAN] report received · acknowledged", cost: { ms: 600 } },
    ],
  },
];

const LANES: { id: Lane; name: string; tone: string }[] = [
  { id: "human", name: "Human", tone: "#ffe36e" },
  { id: "agent", name: "Agent", tone: "#ff4fd8" },
  { id: "robot", name: "Robot", tone: "#3df2ff" },
];

const LOOP = 7; // seconds

export function HeroConsole() {
  const [personaIdx, setPersonaIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const persona = PERSONAS[personaIdx];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const steps = persona.steps;
    const nodes = steps.map((s) => root.querySelector<HTMLElement>(`[data-node="${s.id}"]`));
    const pulse = root.querySelector<SVGCircleElement>("[data-pulse]");
    const wire = root.querySelector<SVGPathElement>("[data-wire-lit]");
    const wireBase = root.querySelector<SVGPathElement>("[data-wire]");
    const logEl = root.querySelector<HTMLElement>("[data-log]");
    const mTokens = root.querySelector<HTMLElement>("[data-m-tokens]");
    const mCalls = root.querySelector<HTMLElement>("[data-m-calls]");
    const mMs = root.querySelector<HTMLElement>("[data-m-ms]");
    const mDet = root.querySelector<HTMLElement>("[data-m-det]");
    const bar = root.querySelector<HTMLElement>("[data-det-bar]");

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.05 });
    io.observe(root);

    const t0 = performance.now();
    let fired = -1;
    let tokens = 0;
    let calls = 0;
    let ms = 0;
    const logs: string[] = [];

    const reset = () => {
      fired = -1;
      tokens = 0;
      calls = 0;
      ms = 0;
      logs.length = 0;
      nodes.forEach((n) => n?.classList.remove("hc-on"));
      if (logEl) logEl.textContent = "";
    };

    const render = () => {
      // Deterministic share: steps that cost no tokens.
      const done = fired + 1;
      const det = done === 0 ? 100 : Math.round(((done - calls) / done) * 100);
      if (mTokens) mTokens.textContent = tokens.toLocaleString();
      if (mCalls) mCalls.textContent = String(calls);
      if (mMs) mMs.textContent = `${(ms / 1000).toFixed(1)}s`;
      if (mDet) mDet.textContent = `${det}%`;
      if (bar) bar.style.width = `${det}%`;
      if (logEl) logEl.textContent = logs.slice(-5).join("\n");
    };

    if (reduced) {
      // Show the finished state rather than animating it.
      steps.forEach((s, i) => {
        fired = i;
        tokens += s.cost?.tokens ?? 0;
        calls += s.cost?.calls ?? 0;
        ms += s.cost?.ms ?? 0;
        logs.push(s.log);
        nodes[i]?.classList.add("hc-on");
      });
      render();
      if (pulse) pulse.style.opacity = "0";
      if (wire) wire.style.strokeDasharray = "none";
      return () => io.disconnect();
    }

    const len = wireBase?.getTotalLength?.() ?? 0;
    if (wire && len) {
      wire.style.strokeDasharray = `${len}`;
      wire.style.strokeDashoffset = `${len}`;
    }

    const tick = (now: number) => {
      if (!visible) return;
      const t = ((now - t0) / 1000) % LOOP;

      // Loop restart
      if (t < 0.2 && fired >= 0) reset();

      let changed = false;
      for (let i = 0; i < steps.length; i++) {
        if (i > fired && t >= steps[i].at) {
          fired = i;
          const c = steps[i].cost;
          tokens += c?.tokens ?? 0;
          calls += c?.calls ?? 0;
          ms += c?.ms ?? 0;
          logs.push(steps[i].log);
          nodes[i]?.classList.add("hc-on");
          changed = true;
        }
      }
      if (changed) render();

      // Pulse rides the wire across the active window.
      const span = steps[steps.length - 1].at + 0.9;
      const p = Math.max(0, Math.min(1, (t - steps[0].at + 0.3) / span));
      if (wire && len) wire.style.strokeDashoffset = `${len * (1 - p)}`;
      if (pulse && wireBase && len) {
        const pt = wireBase.getPointAtLength(len * p);
        pulse.setAttribute("cx", String(pt.x));
        pulse.setAttribute("cy", String(pt.y));
        pulse.style.opacity = p > 0.001 && p < 0.999 ? "1" : "0";
      }
    };

    render();
    const off = onTick(tick, 25);
    return () => {
      off();
      io.disconnect();
    };
  }, [persona]);

  return (
    <div ref={rootRef} data-hero-console className="w-full max-w-[1120px] mx-auto">
      {/* Persona tabs — five words on who this is for */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x" role="tablist" aria-label="Who it's for">
        {PERSONAS.map((p, i) => {
          const on = i === personaIdx;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={on}
              onClick={() => setPersonaIdx(i)}
              className={`snap-start shrink-0 text-left rounded-md border px-4 py-3 min-w-[190px] transition-colors ${
                on
                  ? "border-[#8b7bff]/50 bg-[#8b7bff]/[0.09]"
                  : "border-slate-200 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20"
              }`}
            >
              <span className="block font-display text-[13px] tracking-wide text-slate-900 dark:text-white">
                {p.who} <span className="text-slate-400 dark:text-slate-500 font-normal">can</span>
              </span>
              <span className="block mt-1 text-[12px] leading-snug text-slate-600 dark:text-slate-400">{p.can}</span>
            </button>
          );
        })}
      </div>

      {/* Console */}
      <div className="mt-3 brutal-panel overflow-hidden">
        <div className="flex items-center gap-2 h-9 px-4 border-b border-slate-200 dark:border-white/[0.07]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 hc-live" />
          <span className="font-mono text-[10.5px] tracking-wider text-slate-500 dark:text-slate-400">
            amadeus / orchestrator — live
          </span>
        </div>

        {/* The instruction that starts the run — one human sentence */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-white/[0.07]">
          <span className="font-mono text-[11px] text-[#8b7bff] shrink-0">&gt;</span>
          <p className="min-w-0 truncate text-[13px] text-slate-700 dark:text-slate-300">{persona.prompt}</p>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] tracking-wider uppercase text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5">
            dispatched
          </span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
          {/* Flow */}
          {/* Phones: the same run as a vertical list — a 5-node horizontal
              graph cannot be read at 390px without clipping. */}
          <div className="sm:hidden grid-paper p-4 space-y-2">
            {persona.steps.map((s2) => {
              const tone = LANES.find((l) => l.id === s2.lane)!.tone;
              return (
                <div
                  key={s2.id}
                  data-node={s2.id}
                  className="hc-row"
                  style={{ ["--tone" as string]: tone }}
                >
                  <span className="hc-lane-chip" style={{ color: tone, borderColor: tone }}>
                    {s2.lane}
                  </span>
                  <span className="min-w-0">
                    <span className="hc-node-label !whitespace-normal">{s2.label}</span>
                    <span className="hc-node-sub !whitespace-normal">{s2.sub}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="hidden sm:block grid-paper p-4 sm:p-6 relative min-h-[300px]">
            <div className="hc-lanes">
              {LANES.map((l) => (
                <div key={l.id} className="hc-lane">
                  <span className="hc-lane-name" style={{ color: l.tone }}>
                    {l.name}
                  </span>
                </div>
              ))}
            </div>

            <svg viewBox="0 0 640 240" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
              <path data-wire d={wirePath(persona.steps)} fill="none" stroke="currentColor" className="text-slate-300 dark:text-white/10" strokeWidth="1.5" />
              <path data-wire-lit d={wirePath(persona.steps)} fill="none" stroke="url(#hcGrad)" strokeWidth="2" strokeLinecap="round" />
              <circle data-pulse r="4" fill="#fff" style={{ filter: "drop-shadow(0 0 6px #8b7bff)" }} />
              <defs>
                <linearGradient id="hcGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#3df2ff" />
                  <stop offset="50%" stopColor="#ff4fd8" />
                  <stop offset="100%" stopColor="#ffe36e" />
                </linearGradient>
              </defs>
            </svg>

            <div className="relative" style={{ height: 240 }}>
              {persona.steps.map((s, i) => {
                const tone = LANES.find((l) => l.id === s.lane)!.tone;
                const { x, y } = nodePos(i, persona.steps.length, s.lane);
                return (
                  <div
                    key={s.id}
                    data-node={s.id}
                    className="hc-node"
                    style={{ left: `${x}%`, top: `${y}px`, ["--tone" as string]: tone }}
                  >
                    <span className="hc-node-label">{s.label}</span>
                    <span className="hc-node-sub">{s.sub}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live metrics — the agent-invoke side panel, condensed */}
          <aside className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-white/[0.07] p-4 sm:p-5 flex flex-col gap-4">
            <div>
              <span className="hc-metric-label">Deterministic steps</span>
              <div className="flex items-baseline gap-2">
                <span data-m-det className="font-mono text-2xl text-slate-900 dark:text-white tabular-nums">
                  100%
                </span>
                <span className="text-[11px] text-slate-500">no model call</span>
              </div>
              <div className="hc-bar mt-2">
                <span data-det-bar className="hc-bar-fill" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ["Tokens", "data-m-tokens", "0"],
                ["Vision", "data-m-calls", "0"],
                ["Elapsed", "data-m-ms", "0.0s"],
              ].map(([label, attr, init]) => (
                <div key={label}>
                  <span className="hc-metric-label">{label}</span>
                  <span {...{ [attr]: true }} className="block font-mono text-[15px] text-slate-800 dark:text-slate-100 tabular-nums">
                    {init}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex-1 min-h-[112px]">
              <span className="hc-metric-label">Trail</span>
              <pre
                data-log
                className="mt-1 h-[108px] overflow-hidden whitespace-pre-wrap break-words rounded border border-slate-200 dark:border-white/[0.07] bg-slate-50/70 dark:bg-black/40 p-2 font-mono text-[10px] leading-[1.5] text-slate-600 dark:text-slate-400"
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* Node placement: evenly across x, lane decides y. */
function nodePos(i: number, n: number, lane: Lane) {
  const laneY: Record<Lane, number> = { human: 16, agent: 96, robot: 176 };
  const x = n === 1 ? 50 : 6 + (i / (n - 1)) * 82;
  return { x, y: laneY[lane] };
}

/* The wire threads the nodes in order, in the SVG's 640×240 space. */
function wirePath(steps: Step[]) {
  const laneY: Record<Lane, number> = { human: 42, agent: 122, robot: 202 };
  const pts = steps.map((s, i) => {
    const { x } = nodePos(i, steps.length, s.lane);
    return { x: (x / 100) * 640 + 56, y: laneY[s.lane] };
  });
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}
