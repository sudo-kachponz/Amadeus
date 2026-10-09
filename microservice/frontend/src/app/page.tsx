"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { TransactionGraph } from "@/components/TransactionGraph";
import {
  ShieldCheck,
  Lock,
  Server,
  FileCheck,
  Database,
  ArrowRight,
  BookOpen,
  Cpu,
  Layers,
  Send,
  ChevronDown,
  Bot,
  Monitor,
  Plug
} from "lucide-react";
import { FiUser, FiCpu, FiTool } from "react-icons/fi";
import { MarketingHeader } from "@/components/MarketingHeader";
import { MarketingFooter } from "@/components/MarketingFooter";
import { HoloStage } from "@/components/HoloStage";
import { HeroConsole } from "@/components/HeroConsole";
import { HoloText } from "@/components/HoloText";
import { HoloCompanion } from "@/components/HoloCompanion";
import { AsciiTagline } from "@/components/AsciiTagline";
import { BrutalFrame } from "@/components/BrutalFrame";
import { Parallax, ScrubReveal, Marquee } from "@/components/Motion";
import { FeatureShowcase } from "@/components/FeatureShowcase";
import { BenchmarkSection } from "@/components/BenchmarkSection";
import { AuroraBackground } from "@/components/AuroraBackground";
import { AuroraDivider } from "@/components/AuroraDivider";
import { AuroraThread } from "@/components/AuroraThread";

const EMPTY_EVENTS: any[] = [];

const FAQ_DATA = [
  {
    question: "What does Amadeus do?",
    answer: "Amadeus is an agentic orchestration platform that connects AI agents to enterprise robots (UiPath, Power Automate) via MCP. You chat with an agent — it triggers UiPath processes, pushes queue items, extracts reports, and screens transactions, all while you watch the orchestrator map in real-time."
  },
  {
    question: "Who is Amadeus for?",
    answer: "Amadeus is built for operations teams, compliance analysts, and any enterprise that already uses RPA. If you have UiPath, Power Automate, or Automation Anywhere robots, Amadeus lets your team trigger and monitor them through natural language — no more manually filling orchestrator forms."
  },
  {
    question: "Why integrate AI Agents with RPA?",
    answer: "AI agents are great at reasoning but can't click buttons on legacy apps. RPA robots can click anything but don't understand context. Amadeus bridges both — the agent decides what to do (e.g. pull BBRI annual report), then triggers the UiPath robot to actually do it, complete with the right input arguments."
  },
  {
    question: "How does Amadeus handle regulatory compliance?",
    answer: "Every agent action and robot execution is logged with full audit trails. The orchestrator map shows real-time process states, job IDs, and execution logs — so compliance teams can trace exactly what happened, when, and why. Built with Indonesian financial regulations (OJK/BI) in mind."
  },
  {
    question: "Can Amadeus reduce processing costs and latency?",
    answer: "Yes. Instead of manually navigating UiPath Orchestrator, filling in arguments, and waiting — your team simply tells the agent what they need. The agent discovers process arguments, fills them in, triggers the job, and reports back. What used to take 15 minutes of clicking becomes one chat message."
  }
];

// Import LC state machine — drives the live ticker
const LC_STEPS = [
  "queue_item_added",
  "robot_assigned",
  "process_running",
  "data_extracted",
  "agent_analyzing",
  "report_generated",
  "human_reviewed",
  "completed",
];

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [tickerActive, setTickerActive] = useState(0);

  // Ticker: advance active step every 1.5s
  useEffect(() => {
    const id = setInterval(() => {
      setTickerActive((prev) => (prev + 1) % LC_STEPS.length);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // Scroll reveal + benchmark viewport trigger for count-up
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-active");
          }
        });
      },
      { threshold: 0.1 }
    );
    const elements = document.querySelectorAll(".scroll-reveal");
    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, []);



  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip w-full max-w-[100vw]">
      <HoloCompanion />
      <BrutalFrame />
      <MarketingHeader />

      {/* Hero — the logo comes alive: a 4D tesseract in a responsive particle field */}
      <section className="relative pt-[72px] md:pt-24 pb-16 md:pb-24 overflow-hidden holo-void flex flex-col items-center text-center">
        <HoloStage core={false}>
          <div className="max-w-5xl mx-auto px-6 md:px-6 flex flex-col items-center">
            <h1 className="holo-headline mt-2 mb-6 md:mb-8 flex flex-col items-center gap-y-1 w-full">
              <span>
                <HoloText delay={0.15}>Human </HoloText>
                <HoloText variant="foil" delay={0.3} className="font-light">whoops,</HoloText>
              </span>
              <span>
                <HoloText delay={0.45}>Agent </HoloText>
                <HoloText variant="foil" delay={0.6} className="font-light">loops,</HoloText>
              </span>
              <span>
                <HoloText delay={0.75}>Robot </HoloText>
                <HoloText variant="foil" delay={0.9} className="font-light">shoots.</HoloText>
              </span>
            </h1>

            <p className="text-[15px] md:text-[17px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[38rem] mb-8 md:mb-10">
              The agentic orchestration platform that connects AI agents to your enterprise robots. Automate report extraction, compliance screening, and operational workflows — all from one chat.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 mb-12 md:mb-16 w-full max-w-[320px] sm:max-w-none">
              <Link href="/playground" data-magnetic className="holo-ring holo-cta transition-transform duration-200 will-change-transform">
                Open the playground <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="#demo" data-magnetic className="wire-btn transition-transform duration-200 will-change-transform">
                Watch demo
              </Link>
            </div>
          </div>
        </HoloStage>

        {/* The product, shown working — orchestration across the three lanes */}
        <div className="w-full px-6 md:px-6 relative z-10 mt-6 md:mt-10">
          <HeroConsole />
        </div>

        {/* Bottom Fade to blend into next section */}
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-background to-transparent pointer-events-none z-20" />
      </section>

      <Marquee items={["Humans", "AI agents", "UiPath", "MCP", "Queue automation", "APU/PPT screening", "IDX reports", "Live orchestrator"]} />

      {/* Section 1.5: The Philosophy */}
      <section
        className="bg-transparent py-16 md:py-28 relative z-10"
        data-holo-anchor="0.8 0.22 0.17 1"
        data-holo-anchor-m="0.82 0.06 0.12 1"
        data-holo-label="Mission"
      >
        <div className="max-w-[1200px] mx-auto px-6 lg:px-12 space-y-16">

          {/* Row 1: The Thesis (Asymmetric 65/35) */}
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-24 items-center">
            <div className="w-full lg:w-[65%]">
              <span className="sec-index">02 / Mission</span>
              <Parallax speed={-0.08}>
              <div className="relative pl-8 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-gradient-to-b before:from-[#3df2ff] before:via-[#ff4fd8] before:to-[#ffe36e]">
                <h3 className="text-[clamp(1.5rem,3vw,2.2rem)] font-semibold text-foreground leading-snug tracking-tight">
                  AI doesn't fix a disorganized company, it transforms your disorganization into a system. We built Amadeus to bridge the critical gap between humans, intelligent agents, and rigid robots.
                </h3>
              </div>
              </Parallax>
            </div>

            {/* The companion object docks into this column (see data-holo-anchor). */}
            <div className="hidden lg:block w-full lg:w-[35%] min-h-[320px]" aria-hidden="true" />
          </div>

          {/* Row 2: The Three Actors */}
          <ScrubReveal>
          <div className="w-full brutal-panel holo-sheen overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-fuchsia-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col">
              {[
                {
                  icon: FiUser,
                  title: "Humans",
                  desc: "Want automation. Demand compliance.",
                  iconClass: "text-pink-500",
                  gradientClass: "from-pink-500/0 via-pink-500/10",
                },
                {
                  icon: FiCpu,
                  title: "AI Agents",
                  desc: "Connect via MCP. High automation — compliance trade-off.",
                  iconClass: "text-yellow-500",
                  gradientClass: "from-yellow-500/0 via-yellow-500/10",
                },
                {
                  icon: FiTool,
                  title: "Robots (RPA)",
                  desc: "Operate via UI. High compliance — flexibility trade-off.",
                  iconClass: "text-cyan-500",
                  gradientClass: "from-cyan-500/0 via-cyan-500/10",
                }
              ].map((item, idx) => (
                <div key={item.title} className={`p-6 sm:p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 relative group ${idx !== 2 ? 'border-b border-b-slate-200/70 dark:border-b-white/[0.06]' : ''}`}>
                  {/* Subtle hover gradient */}
                  <div className={`absolute inset-0 bg-gradient-to-r ${item.gradientClass} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} />

                  <div className="flex items-center gap-6 md:w-1/3 flex-shrink-0 relative z-10">
                    <item.icon className={`w-6 h-6 ${item.iconClass}`} />
                    <h4 className="text-xl font-bold text-foreground tracking-tight">{item.title}</h4>
                  </div>
                  <div className="md:w-2/3 relative z-10">
                    <p className="text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </ScrubReveal>

          <div className="mt-16 flex justify-center">
            {/* ASCII rendering of: RPA + Agents = Agentic Process Automation (APA) */}
            <div className="relative w-full max-w-[680px] h-14 md:h-[72px]">
              <AsciiTagline className="absolute inset-0 w-full h-full" />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Live Flow Ticker */}
      <section
        className="bg-transparent py-16 md:py-24 relative z-10"
        data-holo-anchor="0.05 0.3 0.06 0"
        data-holo-anchor-m="0.86 0.05 0.09 0"
        data-holo-label="Laboratory"
      >
        <div className="max-w-6xl mx-auto px-6">

          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <span className="sec-index">03 / Laboratory</span>
              <h2 className="section-head text-2xl md:text-4xl text-foreground mb-3">Your enterprise-grade agent laboratory</h2>
              <p className="text-slate-500 text-sm max-w-xl leading-relaxed">
                From pulling IDX financial reports to screening SWIFT transactions for APU/PPT compliance — orchestrate AI agents, UiPath robots, and human analysts in one live pipeline.
              </p>
            </div>

            <div className="holo-glass rounded-2xl px-5 py-3 flex flex-col sm:flex-row items-center gap-4">
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 text-center sm:text-left">We Support<br />A2A Communication</span>
              <div className="hidden sm:block w-px h-8 bg-slate-300 dark:bg-slate-800" />
              <div className="flex flex-wrap justify-center items-center gap-4 md:gap-6">
                <img src="/1uipath.png" alt="UiPath" className="h-6 md:h-7 w-auto object-contain transition-all duration-300 opacity-80 hover:opacity-100 cursor-pointer" title="UiPath" />
                <img src="/2powerautomate.png" alt="Power Automate" className="h-6 md:h-7 w-auto object-contain transition-all duration-300 opacity-80 hover:opacity-100 cursor-pointer" title="Microsoft Power Automate" />
                <img src="/3automationanyywhere.png" alt="Automation Anywhere" className="h-6 md:h-7 w-auto object-contain transition-all duration-300 opacity-80 hover:opacity-100 cursor-pointer" title="Automation Anywhere" />
              </div>
            </div>
          </div>

          <ScrubReveal>
          <div className="w-full h-[420px] md:h-[520px] brutal-panel p-2 md:p-3 dark:shadow-[0_30px_100px_-40px_rgba(61,242,255,0.3)] overflow-hidden relative">
            <TransactionGraph
              tx={{
                current_step: LC_STEPS[tickerActive],
                status: tickerActive === LC_STEPS.length - 1 ? 'completed' : 'pending'
              }}
              events={EMPTY_EVENTS}
            />
          </div>
          </ScrubReveal>
          <p className="text-xs text-slate-400 mt-4 text-center">
            Each step is executed by AI agents or UiPath robots via MCP. The orchestrator tracks state transitions in real-time.
          </p>
        </div>
      </section>

      {/* Section 3: Feature Showcase */}
      <FeatureShowcase />

      <Marquee reverse items={["Agent architect", "Tools registry", "Flow playground", "Agent gallery", "Knowledge bases", "Recipes"]} />

      {/* Section 3.5: Benchmark Section */}
      <BenchmarkSection />

      {/* Section 4 & 5: FAQ and Security */}
      <section
        className="bg-transparent py-16 md:py-24 relative overflow-hidden z-10"
        data-holo-anchor="0.96 0.5 0.055 0"
        data-holo-anchor-m="0.86 0.04 0.08 0"
        data-holo-label="Trust"
      >
        <div className="max-w-[1400px] mx-auto px-6 sm:px-6 lg:px-12 relative">

          {/* Unified Container */}
          <ScrubReveal>
          <div className="relative brutal-panel holo-sheen p-6 sm:p-10 lg:p-16 overflow-hidden">
            {/* Top-Right subtle Aurora mesh glow */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-[#ff4fd8]/10 via-[#3df2ff]/5 to-transparent rounded-full blur-3xl -mt-48 -mr-48 pointer-events-none" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 xl:gap-24 relative z-10">

              {/* Left Column: FAQ */}
              <div className="space-y-10">
                <div className="space-y-4">
                  <span className="sec-index">06 / Questions</span>
                  <h3 className="section-head text-3xl md:text-4xl text-foreground">FAQ</h3>
                </div>

                <div className="space-y-2">
                  {FAQ_DATA.map((faq, index) => {
                    const isOpen = openFaq === index;
                    return (
                      <div key={index} className="flex flex-col group relative">
                        <button
                          onClick={() => setOpenFaq(isOpen ? null : index)}
                          className="w-full flex items-center justify-between py-6 text-left focus:outline-none"
                        >
                          <span className={`text-[17px] font-semibold pr-8 transition-colors duration-300 ${isOpen ? 'text-slate-900 dark:text-white' : 'text-slate-600 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-slate-200'}`}>
                            {faq.question}
                          </span>
                          <ChevronDown className={`w-5 h-5 text-fuchsia-500 transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-in-out relative ${isOpen ? 'max-h-96 opacity-100 mb-6' : 'max-h-0 opacity-0'}`}
                        >
                          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-cyan-400 via-fuchsia-500 to-yellow-400" />
                          <p className="text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed pl-6">
                            {faq.answer}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Security */}
              <div className="space-y-10">
                <div className="space-y-4">
                  <span className="sec-index">07 / Compliance</span>
                  <h3 className="section-head text-3xl md:text-4xl text-foreground">Compliance &amp; Security</h3>
                </div>

                <div className="relative">
                  {[
                    { icon: ShieldCheck, name: "ISO 27001 Ready", note: "Information security management aligned to certification controls." },
                    { icon: Lock, name: "HMAC-SHA512", note: "Financial step transitions are request-signed and tamper-evident." },
                    { icon: Server, name: "Air-Gapped Node", note: "On-premise deployment with zero outbound database exposure." },
                    { icon: FileCheck, name: "OJK / BI Compliant", note: "Meets Indonesian regulatory requirements for trade finance." },
                    { icon: Database, name: "Immutable Audit", note: "Append-only ledger with cryptographic proof of every mutation." },
                  ].map(({ icon: Icon, name, note }, i) => (
                    <div key={name} className="relative">
                      {i !== 0 && (
                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-cyan-500/0 via-fuchsia-500/20 to-yellow-500/0" />
                      )}
                      <div
                        className="grid grid-cols-12 gap-4 items-center py-6 group hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors -mx-4 px-4 rounded-xl"
                      >
                        <div className="col-span-2 md:col-span-1">
                          <span className="font-mono font-medium text-fuchsia-500 text-lg transition-colors">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <div className="col-span-10 md:col-span-11 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                          <div className="flex items-center gap-2.5 sm:w-2/5 flex-shrink-0">
                            <Icon className="w-[18px] h-[18px] text-[#8b5cf6] transition-colors flex-shrink-0" />
                            <span className="font-semibold text-[15px] text-slate-800 dark:text-slate-200">{name}</span>
                          </div>
                          <div className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed sm:w-3/5">
                            {note}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </ScrubReveal>
        </div>
      </section>

      {/* System Architecture at a Glance */}
      <section
        className="py-16 md:py-28 bg-transparent relative z-10"
        data-holo-anchor="0.82 0.16 0.11 1"
        data-holo-anchor-m="0.84 0.05 0.1 1"
        data-holo-label="Architecture"
      >
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 space-y-16">
          <div className="text-left space-y-4 max-w-2xl">
            <span className="sec-index">08 / System map</span>
            <h2 className="section-head text-3xl md:text-4xl text-foreground">Architecture at a glance</h2>
            <p className="text-slate-400 text-lg leading-relaxed">
              Amadeus is strictly divided into four specialized layers to ensure scalability and separation of concerns. From the interactive canvas to the persistent storage, every layer is built for enterprise orchestration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 [&>*:nth-child(2)]:lg:translate-y-10 [&>*:nth-child(4)]:lg:translate-y-10">

            {/* Presentation Layer */}
            <div className="group relative brutal-panel rounded-md p-6 md:p-8 h-full hover:border-cyan-500/50 transition-colors overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl -mt-16 -mr-16 pointer-events-none group-hover:bg-cyan-500/20 transition-colors" />
              <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                  <Monitor className="w-6 h-6 text-cyan-500 dark:text-cyan-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">1. Canvas</h3>
                <p className="text-[14px] text-cyan-600 dark:text-cyan-500 font-mono tracking-wide">Presentation Layer</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                  The interactive interface where users configure agents and test them. Features the Agent Architect UI and Agent Flow Playground.
                </p>
                <div className="pt-4 flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/50 text-xs font-mono text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">React / Next.js</span>
                </div>
              </div>
            </div>

            {/* Orchestration Core */}
            <div className="group relative brutal-panel rounded-md p-6 md:p-8 h-full hover:border-fuchsia-500/50 transition-colors overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-fuchsia-500/10 rounded-full blur-2xl -mt-16 -mr-16 pointer-events-none group-hover:bg-fuchsia-500/20 transition-colors" />
              <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-500/20">
                  <Cpu className="w-6 h-6 text-fuchsia-500 dark:text-fuchsia-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">2. Brain</h3>
                <p className="text-[14px] text-fuchsia-600 dark:text-fuchsia-500 font-mono tracking-wide">Orchestration Core</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                  The reasoning engine that manages agent states and tool selection. Handles LLM Routing and Session Memory.
                </p>
                <div className="pt-4 flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/50 text-xs font-mono text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">Node.js / LangGraph</span>
                </div>
              </div>
            </div>

            {/* Integration Layer */}
            <div className="group relative brutal-panel rounded-md p-6 md:p-8 h-full hover:border-yellow-400/50 transition-colors overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-400/10 rounded-full blur-2xl -mt-16 -mr-16 pointer-events-none group-hover:bg-yellow-400/20 transition-colors" />
              <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-yellow-400/10 flex items-center justify-center border border-yellow-400/20">
                  <Plug className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">3. Hands</h3>
                <p className="text-[14px] text-yellow-600 dark:text-yellow-400 font-mono tracking-wide">Integration Layer</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                  The standardized protocol layer for tool execution. Bridges external APIs and enables dynamic tool discovery.
                </p>
                <div className="pt-4 flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/50 text-xs font-mono text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">MCP Adapters</span>
                </div>
              </div>
            </div>

            {/* Data Layer */}
            <div className="group relative brutal-panel rounded-md p-6 md:p-8 h-full hover:border-emerald-400/50 transition-colors overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full blur-2xl -mt-16 -mr-16 pointer-events-none group-hover:bg-emerald-400/20 transition-colors" />
              <div className="relative z-10 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-400/10 flex items-center justify-center border border-emerald-400/20">
                  <Database className="w-6 h-6 text-emerald-500 dark:text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">4. Storage</h3>
                <p className="text-[14px] text-emerald-600 dark:text-emerald-400 font-mono tracking-wide">Data Layer</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pt-2">
                  The persistent memory and configuration storage. Stores Agent configurations, Tool schemas, and Chat history.
                </p>
                <div className="pt-4 flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/50 text-xs font-mono text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">PostgreSQL</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Section 6: Footer */}
      <MarketingFooter />
    </div>
  );
}
