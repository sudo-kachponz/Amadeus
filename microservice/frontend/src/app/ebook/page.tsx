"use client";

import { BookOpen, ArrowRight } from "lucide-react";
import { InstagramIcon } from "@/components/Icons";
import { MarketingHeader } from "@/components/MarketingHeader";
import { MarketingFooter } from "@/components/MarketingFooter";
import { HoloStage } from "@/components/HoloStage";
import { HoloText } from "@/components/HoloText";
import { HoloCompanion } from "@/components/HoloCompanion";
import { BrutalFrame } from "@/components/BrutalFrame";
import { COMPANY, LIBRARY } from "@/content/company";

export default function EbookPage() {
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
              <span><HoloText delay={0.15}>E-books</HoloText></span>
              <span><HoloText variant="foil" delay={0.4} className="font-light">by Neutrack</HoloText></span>
            </h1>
            <p className="text-[15px] md:text-[17px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[38rem] mb-10">
              Every bug we fixed became a lesson. We turned our project stories into interactive e-books
              with per-buyer links, device limits, and built-in workbooks.
            </p>
          </div>
        </HoloStage>
      </section>

      {/* Books */}
      <section className="relative py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-5 md:px-6">
          <div className="flex flex-col gap-10">
            {LIBRARY.map((b) => (
              <article key={b.title} className="brutal-panel holo-sheen p-8 sm:p-10 md:p-14 flex flex-col">
                <BookOpen className="w-8 h-8 text-[var(--holo-violet)] mb-8" />
                <h2 className="section-head text-3xl md:text-4xl text-foreground mb-3">{b.title}</h2>
                <p className="text-[15px] text-slate-500 mb-8">by {b.author}</p>
                <p className="text-[16px] md:text-[18px] text-slate-600 dark:text-slate-300 leading-relaxed mb-10 max-w-[52ch]">
                  {b.blurb}
                </p>
                {b.href ? (
                  <a href={b.href} className="holo-ring holo-cta self-start">
                    Get the e-book <ArrowRight className="w-4 h-4" />
                  </a>
                ) : (
                  <span className="text-[15px] text-slate-500">Available soon on neutrack.id</span>
                )}
              </article>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <p className="text-[15px] text-slate-500 dark:text-slate-400 mb-6">
              New releases announced on Instagram first.
            </p>
            <a
              href={COMPANY.links.instagram}
              target="_blank"
              rel="noreferrer"
              className="wire-btn inline-flex items-center gap-2"
            >
              <InstagramIcon className="w-4 h-4" /> Follow @neutrack.id
            </a>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
