"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Wrench, Wand2, Zap } from "lucide-react";
import { Tilt } from "@/components/Motion";

const FEATURES = [
  {
    id: "agent-creator",
    title: "Agent Architect",
    description:
      "Describe the agent you need in plain language, then edit the generated config directly — system prompt, tools, and loop recipe.",
    bullets: [
      "Attach any MCP-compatible tool — UiPath, Power Automate, custom APIs",
      "Configure a Loop Mode recipe per agent for multi-step, self-correcting runs",
      "Each agent has its own system prompt — behavior doesn't leak across agents",
    ],
    icon: Wand2,
    href: "/agent-creator",
  },
  {
    id: "tools",
    title: "Tools Registry",
    description:
      "Register the tools your agents can call — internal APIs, external services, or legacy RPA robots — connected over MCP (stdio or SSE).",
    bullets: [
      "Register MCP servers over stdio or SSE — from UiPath robots to internal REST APIs",
      "Credentials stored server-side in the tool's DB record, never in process arguments",
      "Restart a tool from the registry after updating its config or credentials",
    ],
    icon: Wrench,
    href: "/tools",
  },
  {
    id: "playground",
    title: "Agent Flow Playground",
    description: "Chat with an agent live and watch each MCP tool call and transaction state change as it happens.",
    bullets: ["Live reasoning streamed via Server-Sent Events (SSE)"],
    icon: Zap,
    href: "/playground",
  },
  {
    id: "agents",
    title: "Agent Gallery",
    description: "Every agent in one place — edit its system prompt, attached tools, and loop recipe, or turn it off.",
    bullets: ["Create, edit, or disable an agent without touching code"],
    icon: Bot,
    href: "/agents",
  },
] as const;

type FeatureId = (typeof FEATURES)[number]["id"];

/* ------------------------------------------------------------------ */
/* Live product mockups — these replace the placeholder videos. Each   */
/* one shows the real screen's shape with a looping micro-animation.   */
/* ------------------------------------------------------------------ */

function Chrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="brutal-panel overflow-hidden shadow-[0_30px_90px_-40px_rgba(139,123,255,0.45)]">
      <div className="flex items-center gap-2 px-4 h-9 border-b border-slate-200 dark:border-white/[0.07]">
        <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-white/15" />
        <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-white/15" />
        <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-white/15" />
        <span className="ml-3 font-mono text-[10.5px] tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
      </div>
      <div className="grid-paper p-4 sm:p-5 min-h-[300px] sm:min-h-[340px] text-[12.5px]">{children}</div>
    </div>
  );
}

function ArchitectMock() {
  return (
    <Chrome title="amadeus / agent-architect">
      <div className="rounded-md border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-3 py-2.5 mb-4 font-mono text-slate-700 dark:text-slate-200">
        <span className="mock-type">Pull IDX financial reports by emiten code and generate compliance summaries</span>
        <span className="cursor-blink ml-0.5">▍</span>
      </div>
      <div className="space-y-2 font-mono text-[11.5px]">
        {[
          ["name", '"emiten-report-agent"'],
          ["model", '"claude-sonnet-4"'],
          ["tools", '["uipath.penarikan-laporan", "uipath.test-queue"]'],
          ["loop", '{ max_iter: 4, on_fault: "retry" }'],
        ].map(([k, v], i) => (
          <div key={k} className="mock-line flex gap-3" style={{ animationDelay: `${1.6 + i * 0.35}s` }}>
            <span className="text-[#8b7bff] w-12 shrink-0">{k}</span>
            <span className="text-slate-600 dark:text-slate-300 break-all">{v}</span>
          </div>
        ))}
      </div>
      <div className="mock-line mt-5 flex gap-2 flex-wrap" style={{ animationDelay: "3.2s" }}>
        <span className="px-2.5 py-1 rounded border border-[#3df2ff]/40 text-[#0e7490] dark:text-[#3df2ff] font-mono text-[10.5px]">Generated</span>
        <span className="px-2.5 py-1 rounded border border-slate-300 dark:border-white/15 text-slate-500 dark:text-slate-400 font-mono text-[10.5px]">Editable</span>
      </div>
    </Chrome>
  );
}

function ToolsMock() {
  const rows = [
    { name: "UiPath — IDX Report Puller", proto: "stdio", state: "live" },
    { name: "UiPath — SWIFT APU/PPT Scanner", proto: "stdio", state: "live" },
    { name: "Google Sheets — Nasabah Data", proto: "SSE", state: "live" },
    { name: "Gmail — Compliance Reporter", proto: "SSE", state: "idle" },
  ];
  return (
    <Chrome title="amadeus / tools-registry">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div
            key={r.name}
            className="mock-line flex items-center gap-3 rounded-md border border-slate-200 dark:border-white/[0.08] bg-white/70 dark:bg-white/[0.025] px-3 py-3"
            style={{ animationDelay: `${0.2 + i * 0.25}s` }}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                r.state === "live" ? "bg-emerald-400 mock-pulse" : r.state === "idle" ? "bg-slate-400" : "bg-[#ffe36e] mock-pulse"
              }`}
            />
            <span className="flex-1 min-w-0 truncate text-slate-800 dark:text-slate-100">{r.name}</span>
            <span className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5">
              {r.proto}
            </span>
          </div>
        ))}
      </div>
      <p className="mock-line mt-4 font-mono text-[10.5px] text-slate-500 dark:text-slate-500" style={{ animationDelay: "1.4s" }}>
        credentials: stored server-side · never in argv
      </p>
    </Chrome>
  );
}

function PlaygroundMock() {
  return (
    <Chrome title="amadeus / playground — stream">
      <div className="space-y-3">
        <div className="mock-line flex justify-end" style={{ animationDelay: "0.2s" }}>
          <div className="max-w-[80%] rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-2">
            Tarik laporan keuangan BBRI tahun 2024 periode TW3
          </div>
        </div>
        <div className="mock-line font-mono text-[11px] text-slate-500 dark:text-slate-400" style={{ animationDelay: "0.9s" }}>
          → tool_call trigger_uipath_job(Penarikan Laporan Keuangan IDX)
        </div>
        <div className="mock-line font-mono text-[11px] text-[#eab308]" style={{ animationDelay: "1.5s" }}>
          ◎ Job #127311175 — Pending → Running
        </div>
        <div className="mock-line font-mono text-[11px] text-[#0e7490] dark:text-[#3df2ff]" style={{ animationDelay: "2.1s" }}>
          ✓ Robot completed — report extracted successfully
        </div>
        <div className="mock-line max-w-[85%] rounded-lg border border-[#8b7bff]/30 bg-[#8b7bff]/[0.07] px-3 py-2 text-slate-700 dark:text-slate-200" style={{ animationDelay: "2.7s" }}>
          Laporan keuangan BBRI TW3 2024 berhasil diambil dari IDX.
        </div>
      </div>
    </Chrome>
  );
}

function GalleryMock() {
  const agents = [
    ["EmitenReportAgent", true],
    ["SwiftAPU Detector", true],
    ["BulkBuddy Gmail", false],
    ["FraudDetector", true],
  ] as const;
  return (
    <Chrome title="amadeus / agent-gallery">
      <div className="grid grid-cols-2 gap-2.5">
        {agents.map(([name, on], i) => (
          <div
            key={name}
            className="mock-line rounded-md border border-slate-200 dark:border-white/[0.08] bg-white/70 dark:bg-white/[0.025] p-3"
            style={{ animationDelay: `${0.2 + i * 0.2}s` }}
          >
            <div className="flex items-center justify-between mb-6">
              <Bot className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span className={`w-7 h-4 rounded-full relative ${on ? "bg-gradient-to-r from-[#3df2ff] to-[#ff4fd8]" : "bg-slate-300 dark:bg-white/15"}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
              </span>
            </div>
            <div className="text-slate-800 dark:text-slate-100 text-[12px] font-medium truncate">{name}</div>
            <div className="font-mono text-[10px] text-slate-500 mt-0.5">{on ? "enabled" : "disabled"}</div>
          </div>
        ))}
      </div>
    </Chrome>
  );
}

const MOCKS: Record<FeatureId, () => React.ReactElement> = {
  "agent-creator": ArchitectMock,
  tools: ToolsMock,
  playground: PlaygroundMock,
  agents: GalleryMock,
};

export function FeatureShowcase() {
  const [active, setActive] = useState<FeatureId>(FEATURES[0].id);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id as FeatureId);
        });
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    document.querySelectorAll(".feature-section").forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const ActiveMock = MOCKS[active];

  return (
    <section
      className="bg-transparent py-16 md:py-28 relative z-10"
      data-holo-anchor="0.05 0.25 0.06 0"
      data-holo-anchor-m="0.86 0.08 0.1 0"
      data-holo-label="Platform"
    >
      <div className="max-w-[1300px] mx-auto px-6 sm:px-8 lg:px-12">
        <div className="mb-14 md:mb-20 max-w-2xl">
          <span className="sec-index">04 / Capabilities</span>
          <h2 className="section-head text-3xl md:text-5xl text-foreground">Explore the platform</h2>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-10 lg:gap-20">
          {/* Scrolling copy */}
          <div className="space-y-24 md:space-y-32 lg:space-y-0">
            {FEATURES.map((f, i) => {
              const Mock = MOCKS[f.id];
              const on = active === f.id;
              return (
                <div key={f.id} id={f.id} className="feature-section scroll-mt-40 lg:min-h-[78vh] lg:flex lg:flex-col lg:justify-center">
                  <div className={`transition-opacity duration-500 ${on ? "opacity-100" : "lg:opacity-35"}`}>
                    <span className="font-mono text-[11px] tracking-wider text-slate-500">
                      {String(i + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
                    </span>
                    <div className="flex items-center gap-4 mt-3 mb-5">
                      <span className="holo-ring rounded-xl w-12 h-12 flex items-center justify-center shrink-0 bg-white/70 dark:bg-white/[0.03]">
                        <f.icon className="w-5 h-5 text-slate-800 dark:text-white relative z-10" />
                      </span>
                      <h3 className="section-head text-2xl md:text-[2.1rem] text-foreground">{f.title}</h3>
                    </div>
                    <p className="text-base md:text-lg text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">{f.description}</p>
                    <ul className="space-y-3 mt-6">
                      {f.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3 text-slate-700 dark:text-slate-300">
                          <span className="mt-2 w-3 h-px bg-[#8b7bff] shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href={f.href} className="wire-btn mt-8 !py-3 !px-6 !text-[14px]">
                      Open {f.title} <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                  {/* Mobile: the mock sits inline under its copy */}
                  <div className="lg:hidden mt-8">
                    <Mock />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: one pinned stage that swaps mocks as you scroll */}
          <div className="hidden lg:block">
            <div className="sticky top-[18vh]">
              <Tilt className="rounded-md">
                <div key={active} className="mock-swap">
                  <ActiveMock />
                </div>
              </Tilt>
              <div className="mt-5 flex gap-1.5">
                {FEATURES.map((f) => (
                  <span
                    key={f.id}
                    className={`h-[3px] flex-1 rounded-full transition-all duration-500 ${
                      active === f.id ? "bg-gradient-to-r from-[#3df2ff] via-[#8b7bff] to-[#ff4fd8]" : "bg-slate-200 dark:bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
