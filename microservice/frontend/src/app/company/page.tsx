"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import { YoutubeIcon, InstagramIcon, LinkedinIcon } from "@/components/Icons";
import { MarketingHeader } from "@/components/MarketingHeader";
import { MarketingFooter } from "@/components/MarketingFooter";
import { HoloStage } from "@/components/HoloStage";
import { HoloText } from "@/components/HoloText";
import { HoloCompanion } from "@/components/HoloCompanion";
import { BrutalFrame } from "@/components/BrutalFrame";
import { ScrubReveal } from "@/components/Motion";
import { MediaCard } from "@/components/MediaCard";
import { COMPANY, STORY, SERVICES, WORK, LIBRARY } from "@/content/company";
import { VIDEOS, WEBINAR_POSTS, PRESS, MEDIA_SECTION_LABELS } from "@/content/media";

const ACRONYM = ["Autonomous", "Multi", "Agent", "Decision", "Executor", "Unified", "Swarm"];

function StoryThread() {
  const ref = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });

  return (
    <ol ref={ref} className="relative">
      <div className="absolute left-[15px] md:left-[23px] top-2 bottom-2 w-px bg-[var(--holo-wire)]" aria-hidden="true" />
      <motion.div
        className="absolute left-[14px] md:left-[22px] top-2 bottom-2 w-[3px] rounded-full origin-top"
        style={{ background: "var(--holo-foil)", scaleY: reduce ? 1 : progress }}
        aria-hidden="true"
      />
      {STORY.map((ch, i) => {
        const last = i === STORY.length - 1;
        return (
          <li key={ch.title} className="relative pl-12 md:pl-20 pb-14 md:pb-20 last:pb-0">
            <span className="absolute left-0 top-0">
              <span
                className={`flex items-center justify-center rounded-full font-mono text-[12px] md:text-[13px] w-8 h-8 md:w-12 md:h-12 border ${
                  last
                    ? "holo-ring bg-background text-foreground border-transparent"
                    : "bg-background text-slate-500 dark:text-slate-400 border-[var(--holo-wire)]"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </span>
            <p className="text-[13px] text-fuchsia-600 dark:text-fuchsia-400 mb-2 md:pt-3">{ch.when}</p>
            <h3 className={`section-head text-[clamp(1.35rem,2.6vw,2rem)] mb-4 max-w-[30ch] ${last ? "holo-text" : "text-foreground"}`}>
              {ch.title}
            </h3>
            <p className="text-[15px] md:text-[16px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[62ch]">
              {ch.body}
            </p>
            {ch.proof && (
              <p className="mt-5 max-w-[62ch] border-l-2 border-[var(--holo-violet)] pl-4 text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed">
                {ch.proof}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Dynamic section numbering — skips empty groups
function useSectionNumbers() {
  const sections: string[] = ["Story", "What we do", "Flagship", "Work"];
  if (VIDEOS.length > 0) sections.push("Videos");
  if (PRESS.length > 0) sections.push("In the news");
  sections.push("Learn with us", "Founder");
  return (name: string) => {
    const idx = sections.indexOf(name);
    return idx >= 0 ? `${String(idx + 1).padStart(2, "0")} / ${name}` : name;
  };
}

export default function CompanyPage() {
  const work = WORK.filter((w) => !w.draft);
  const sec = useSectionNumbers();
  const [showAllPress, setShowAllPress] = useState(false);
  const [showAllWebinars, setShowAllWebinars] = useState(false);
  const pressVisible = showAllPress ? PRESS : PRESS.slice(0, 6);
  const webinarsVisible = showAllWebinars ? WEBINAR_POSTS : WEBINAR_POSTS.slice(0, 8);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip w-full max-w-[100vw]">
      <HoloCompanion />
      <BrutalFrame />
      <MarketingHeader />

      {/* Hero */}
      <section className="relative pt-[72px] md:pt-24 pb-20 md:pb-28 overflow-hidden holo-void">
        <HoloStage core={false}>
          <div className="max-w-5xl mx-auto px-5 md:px-6 flex flex-col items-center text-center">
            <h1 className="holo-headline mb-8 flex flex-col items-center gap-y-1">
              <span><HoloText delay={0.15}>Science fiction</HoloText></span>
              <span><HoloText variant="foil" delay={0.4} className="font-light">is our final fantasy.</HoloText></span>
            </h1>
            <p className="text-[15px] md:text-[17px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[38rem] mb-10">
              {COMPANY.intro}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-[320px] sm:max-w-none justify-center">
              <a href="#story" className="holo-ring holo-cta">
                Read our story <ArrowRight className="w-4 h-4" />
              </a>
              <a href={COMPANY.links.contact} target="_blank" rel="noreferrer" className="wire-btn">
                Work with us
              </a>
            </div>
          </div>
        </HoloStage>
      </section>

      {/* 01 Story */}
      <section
        id="story"
        className="relative py-16 md:py-28 scroll-mt-24"
        data-holo-anchor="0.86 0.2 0.08 0"
        data-holo-anchor-m="0.88 0.05 0.08 0"
        data-holo-label="Story"
      >
        <div className="max-w-4xl mx-auto px-5 md:px-6">
          <span className="sec-index">{sec("Story")}</span>
          <h2 className="section-head text-3xl md:text-5xl text-foreground mb-5 max-w-[18ch]">
            From a glove to a swarm of agents
          </h2>
          <p className="text-[15px] md:text-[17px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-[56ch] mb-16 md:mb-20">
            Neutrack didn&apos;t start as a company. It started as a class project that refused to stay one.
          </p>
          <StoryThread />
        </div>
      </section>

      {/* 02 Services */}
      <section
        className="relative py-16 md:py-24"
        data-holo-anchor="0.08 0.25 0.06 0"
        data-holo-anchor-m="0.88 0.05 0.08 0"
        data-holo-label="Services"
      >
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <span className="sec-index">{sec("What we do")}</span>
          <h2 className="section-head text-3xl md:text-4xl text-foreground mb-12 max-w-[22ch]">
            We build it, then we teach it
          </h2>
          <ScrubReveal>
            <div className="brutal-panel holo-sheen overflow-hidden">
              {SERVICES.map((s, i) => (
                <div
                  key={s.title}
                  className={`p-6 sm:p-8 md:p-10 grid md:grid-cols-12 gap-3 md:gap-8 ${
                    i !== SERVICES.length - 1 ? "border-b border-slate-200/70 dark:border-white/[0.06]" : ""
                  }`}
                >
                  <h3 className="md:col-span-4 text-xl font-bold text-foreground tracking-tight">{s.title}</h3>
                  <p className="md:col-span-5 text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed">{s.body}</p>
                  <p className="md:col-span-3 text-[13px] text-slate-500 dark:text-slate-500 md:text-right">{s.examples}</p>
                </div>
              ))}
            </div>
          </ScrubReveal>
        </div>
      </section>

      {/* 03 Amadeus */}
      <section
        className="relative py-16 md:py-28 overflow-hidden"
        data-holo-anchor="0.78 0.45 0.16 1"
        data-holo-anchor-m="0.5 0.12 0.22 1"
        data-holo-label="Amadeus"
      >
        <div className="max-w-6xl mx-auto px-5 md:px-6 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <span className="sec-index">{sec("Flagship")}</span>
            <h2 className="section-head text-4xl md:text-6xl mb-6">
              <span className="holo-text">Amadeus</span>
            </h2>
            <p className="font-mono text-[13px] md:text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed mb-8">
              {ACRONYM.map((w) => (
                <span key={w} className="mr-2 inline-block">
                  <span className="text-foreground font-semibold">{w[0]}</span>
                  {w.slice(1)}
                </span>
              ))}
            </p>
            <p className="text-[16px] md:text-[18px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-[52ch] mb-10">
              AI agents are fast but need API access. RPA robots are compliant but can&apos;t talk to anyone. Amadeus puts
              people, agents, and robots in one loop, so the agent decides and the robot executes.
            </p>
            <dl className="grid sm:grid-cols-2 gap-8 mb-10 max-w-[52ch]">
              <div>
                <dt className="font-semibold text-foreground mb-2">Agent Lab</dt>
                <dd className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Design agents in plain language, attach tools over MCP, and test them in the playground.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground mb-2">Robots Lab</dt>
                <dd className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  A lightweight, cross-OS robot runner for screens without APIs, talking to agents over A2A.
                </dd>
              </div>
            </dl>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Link href="/" className="holo-ring holo-cta">
                Explore Amadeus <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/playground" className="wire-btn">Open the playground</Link>
            </div>
          </div>
          <div className="hidden lg:block lg:col-span-5 min-h-[380px]" aria-hidden="true" />
        </div>
      </section>

      {/* 04 Work */}
      <section className="relative py-16 md:py-24" data-holo-label="Work">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <span className="sec-index">{sec("Work")}</span>
          <h2 className="section-head text-3xl md:text-4xl text-foreground mb-12">Selected work</h2>
          <div className="hidden md:grid grid-cols-12 gap-8 pb-4 text-[13px] text-slate-500 border-b border-[var(--holo-wire)]">
            <span className="col-span-3">Project</span>
            <span className="col-span-3">Problem</span>
            <span className="col-span-3">What we built</span>
            <span className="col-span-3">Result</span>
          </div>
          {work.map((w) => (
            <article key={w.name} className="grid md:grid-cols-12 gap-2 md:gap-8 py-8 border-b border-[var(--holo-wire)]">
              <h3 className="md:col-span-3 text-lg font-bold text-foreground">{w.name}</h3>
              <p className="md:col-span-3 text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed">{w.problem}</p>
              <p className="md:col-span-3 text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed">{w.built}</p>
              <p className="md:col-span-3 text-[14px] text-slate-800 dark:text-slate-200 leading-relaxed">{w.result}</p>
            </article>
          ))}
          {VIDEOS.length > 0 && (
            <a
              href="#videos"
              className="mt-8 inline-flex items-center gap-2 text-[14px] text-slate-600 dark:text-slate-300 hover:text-foreground underline underline-offset-4 decoration-[var(--holo-violet)]"
            >
              <YoutubeIcon className="w-4 h-4" /> Watch the demos below
            </a>
          )}
        </div>
      </section>

      {/* 05 Videos */}
      {VIDEOS.length > 0 && (
        <section id="videos" className="relative py-16 md:py-24 scroll-mt-24" data-holo-label="Videos">
          <div className="max-w-6xl mx-auto px-5 md:px-6">
            <span className="sec-index">{sec("Videos")}</span>
            <h2 className="section-head text-3xl md:text-4xl text-foreground mb-12">
              {MEDIA_SECTION_LABELS.videos.heading}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {VIDEOS.map((v, i) => (
                <MediaCard key={v.id} item={v} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 06 Press */}
      {PRESS.length > 0 && (
        <section className="relative py-16 md:py-24" data-holo-label="Press">
          <div className="max-w-6xl mx-auto px-5 md:px-6">
            <span className="sec-index">{sec("In the news")}</span>
            <h2 className="section-head text-3xl md:text-4xl text-foreground mb-12">
              {MEDIA_SECTION_LABELS.press.heading}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {pressVisible.map((p) => (
                <MediaCard key={p.id} item={p} />
              ))}
            </div>
            {PRESS.length > 6 && (
              <button
                onClick={() => setShowAllPress(!showAllPress)}
                aria-expanded={showAllPress}
                className="wire-btn mt-8"
              >
                {showAllPress ? "Show less" : `Show all (${PRESS.length})`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* 07 Learn with us */}
      <section
        className="relative py-16 md:py-24"
        data-holo-anchor="0.1 0.3 0.06 0"
        data-holo-anchor-m="0.88 0.05 0.08 0"
        data-holo-label="Learn"
      >
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <span className="sec-index">{sec("Learn with us")}</span>
          <h2 className="section-head text-3xl md:text-4xl text-foreground mb-12 max-w-[24ch]">
            E-books and webinars from the projects above
          </h2>

          {/* E-books */}
          <div className="grid lg:grid-cols-2 gap-6 mb-12">
            {LIBRARY.map((b) => (
              <div key={b.title} className="brutal-panel p-6 sm:p-8 md:p-10 flex flex-col">
                <BookOpen className="w-6 h-6 text-[var(--holo-violet)] mb-6" />
                <h3 className="section-head text-2xl text-foreground mb-2">{b.title}</h3>
                <p className="text-[14px] text-slate-500 mb-5">by {b.author}</p>
                <p className="text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed mb-8 flex-1">{b.blurb}</p>
                {b.href ? (
                  <a href={b.href} className="holo-ring holo-cta self-start">Get the e-book <ArrowRight className="w-4 h-4" /></a>
                ) : (
                  <span className="text-[14px] text-slate-500">Available soon on neutrack.id</span>
                )}
              </div>
            ))}
          </div>

          {/* Webinars */}
          <h3 className="section-head text-2xl text-foreground mb-6">Webinars</h3>
          {WEBINAR_POSTS.length > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {webinarsVisible.map((w) => (
                  <MediaCard key={w.id} item={w} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-6">
                {WEBINAR_POSTS.length > 8 && (
                  <button
                    onClick={() => setShowAllWebinars(!showAllWebinars)}
                    aria-expanded={showAllWebinars}
                    className="wire-btn"
                  >
                    {showAllWebinars ? "Show less" : `Show all (${WEBINAR_POSTS.length})`}
                  </button>
                )}
                <a
                  href={COMPANY.links.instagram}
                  target="_blank"
                  rel="noreferrer"
                  className="wire-btn inline-flex items-center gap-2"
                >
                  <InstagramIcon className="w-4 h-4" /> Follow @neutrack.id
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed mb-8">
                Machine learning for beginners, self-supervised learning and world models, and building with AI
                coding agents. New sessions are announced on Instagram first.
              </p>
              <a
                href={COMPANY.links.instagram}
                target="_blank"
                rel="noreferrer"
                className="wire-btn inline-flex items-center gap-2"
              >
                <InstagramIcon className="w-4 h-4" /> Follow @neutrack.id
              </a>
            </>
          )}
        </div>
      </section>

      {/* 08 Founder */}
      <section className="relative py-16 md:py-24" data-holo-label="Founder">
        <div className="max-w-4xl mx-auto px-5 md:px-6">
          <span className="sec-index">{sec("Founder")}</span>
          <div className="brutal-panel holo-sheen p-6 sm:p-8 md:p-10 grid md:grid-cols-12 gap-6 md:gap-10 items-start">
            <div className="md:col-span-5">
              <h2 className="section-head text-2xl md:text-3xl text-foreground mb-2">{COMPANY.founder.name}</h2>
              <p className="text-[14px] text-slate-500">{COMPANY.founder.handle}</p>
            </div>
            <div className="md:col-span-7">
              <p className="text-[15px] md:text-[16px] text-slate-600 dark:text-slate-300 leading-relaxed mb-6">{COMPANY.founder.note}</p>
              <div className="flex flex-wrap gap-3">
                <a href={COMPANY.founder.linkedin} target="_blank" rel="noreferrer" className="wire-btn inline-flex items-center gap-2">
                  <LinkedinIcon className="w-4 h-4" /> LinkedIn
                </a>
                <a href={COMPANY.founder.instagram} target="_blank" rel="noreferrer" className="wire-btn inline-flex items-center gap-2">
                  <InstagramIcon className="w-4 h-4" /> Instagram
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
