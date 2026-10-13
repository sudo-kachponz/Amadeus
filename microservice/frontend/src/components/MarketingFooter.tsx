"use client";

import Link from "next/link";
import { useState } from "react";
import { GithubIcon, TwitterIcon, LinkedinIcon, YoutubeIcon, InstagramIcon, WhatsappIcon } from "@/components/Icons";
import { MARKETING_NAV_LINKS } from "@/lib/marketingNav";
import { AuroraThread } from "@/components/AuroraThread";
import { ArrowRight, Mail, Send, MessageCircle } from "lucide-react";

const ROLES = ["CEO / Founder", "CTO / VP Engineering", "Head of Operations", "Product Manager", "Developer / Engineer", "Lainnya"];
const COMPANY_SIZES = ["1–10 karyawan", "11–50 karyawan", "51–200 karyawan", "201–1000 karyawan", "1000+ karyawan"];
const CHALLENGES = [
  "Proses manual yang berulang & memakan waktu",
  "Integrasi sistem yang rumit",
  "Otomasi customer support / helpdesk",
  "Monitoring & compliance reporting",
  "Skalabilitas tim operasional",
  "Lainnya",
];

function ContactForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [challenge, setChallenge] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = [
      `Halo, saya tertarik dengan Amadeus!`,
      name && `Nama: ${name}`,
      phone && `No. HP: ${phone}`,
      role && `Peran: ${role}`,
      companySize && `Ukuran perusahaan: ${companySize}`,
      challenge && `Tantangan utama: ${challenge}`,
      notes && `Catatan: ${notes}`,
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/6281359659649?text=${encodeURIComponent(lines)}`, "_blank");
  };

  const inputClass =
    "w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 focus:border-fuchsia-500/40 transition-colors";
  const selectClass =
    "w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 focus:border-fuchsia-500/40 transition-colors appearance-none cursor-pointer";
  const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={labelClass}>Nama / Nama Bisnis <span className="text-slate-400 font-normal">(opsional)</span></label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama Anda atau nama bisnis Anda" className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Nomor WhatsApp / Telepon <span className="text-fuchsia-500">*</span></label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Contoh: 0812-3456-7890" required className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Apa peran Anda? <span className="text-slate-400 font-normal">(opsional)</span></label>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
          <option value="">Pilih peran Anda...</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Ukuran perusahaan <span className="text-slate-400 font-normal">(opsional)</span></label>
        <select value={companySize} onChange={(e) => setCompanySize(e.target.value)} className={selectClass}>
          <option value="">Jumlah karyawan...</option>
          {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Tantangan operasional utama <span className="text-fuchsia-500">*</span></label>
        <select value={challenge} onChange={(e) => setChallenge(e.target.value)} required className={selectClass}>
          <option value="">Pilih yang paling sesuai...</option>
          {CHALLENGES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Catatan tambahan <span className="text-slate-400 font-normal">(opsional)</span></label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Contoh: tim customer support kewalahan menangani chat, ingin otomasi..." className={inputClass + " resize-y"} />
      </div>

      <button type="submit" className="w-full holo-ring holo-cta justify-center !py-3.5 text-base gap-2">
        <MessageCircle className="w-5 h-5" /> Chat via WhatsApp
      </button>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500">Data Anda aman. Kami hanya menghubungi via WhatsApp.</p>
    </form>
  );
}

export function MarketingFooter() {
  return (
    <>
      {/* Contact Section */}
      <section
        id="contact"
        className="relative py-20 md:py-28 overflow-hidden"
        data-holo-anchor="0.5 0.2 0.15 1"
        data-holo-anchor-m="0.5 0.16 0.24 1"
        data-holo-label="Contact"
      >
        <div className="relative z-10 max-w-6xl mx-auto px-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">

            {/* Left — headline + social proof */}
            <div className="space-y-8 lg:sticky lg:top-32">
              <div className="space-y-4">
                <span className="sec-index">09 / Let&apos;s talk</span>
                <h2 className="section-head text-[clamp(1.6rem,4.5vw,2.75rem)] wire-text">
                  Siap Otomasi<br />Operasional Anda?
                </h2>
                <p className="text-[15px] md:text-[17px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-md">
                  Kami mendampingi langsung perusahaan-perusahaan dalam perjalanan AI &amp; otomasi mereka — dari strategi hingga agent yang siap beroperasi penuh. Mari mengobrol.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <a href="mailto:neutracksudo@gmail.com" className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-500/20">
                    <Mail className="w-4 h-4 text-fuchsia-500" />
                  </div>
                  neutracksudo@gmail.com
                </a>
                <a href="https://wa.me/6281359659649" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                    <MessageCircle className="w-4 h-4 text-emerald-500" />
                  </div>
                  +62 813-5965-9649
                </a>
                <a href="https://www.instagram.com/kachponz/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
                    <InstagramIcon className="w-4 h-4 text-pink-500" />
                  </div>
                  @kachponz
                </a>
                <a href="https://www.youtube.com/@NeutrackAIWorld" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                    <YoutubeIcon className="w-4 h-4 text-red-500" />
                  </div>
                  @NeutrackAIWorld
                </a>
              </div>
            </div>

            {/* Right — contact form */}
            <div className="brutal-panel rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-white/[0.06] bg-white/80 dark:bg-white/[0.02] backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6 pb-5 border-b border-slate-100 dark:border-white/[0.06]">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <MessageCircle className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white text-base">Chat dengan kami</h3>
                  <p className="text-xs text-slate-400">Biasanya membalas dalam 1 jam</p>
                </div>
              </div>
              <ContactForm />
            </div>

          </div>
        </div>
        <AuroraThread variant="divider" position="absolute" className="bottom-0 left-0" />
      </section>

      <footer className="relative z-10 bg-white dark:bg-[#030303] pt-16 pb-8 border-t border-slate-200 dark:border-white/[0.06]" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-12">
            <div className="col-span-2 space-y-4">
              <Link href="/" className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/amadeus.svg" alt="Amadeus Logo" className="w-7 h-7 object-contain rounded-md bg-[#1e1b4b] dark:bg-transparent p-0.5 dark:p-0" />
                <span className="font-display font-medium text-sm tracking-[0.12em] text-slate-900 dark:text-white">AMADEUS</span>
              </Link>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs">
                Enterprise agentic orchestration for Trade Finance settlement — coordinating human analysts, AI agents, and RPA robots.
              </p>
              <div className="flex items-center gap-4 text-slate-400 pt-1">
                <a href="https://www.youtube.com/@NeutrackAIWorld" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white transition-colors"><YoutubeIcon className="w-4 h-4" /></a>
                <a href="https://www.instagram.com/kachponz/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white transition-colors"><InstagramIcon className="w-4 h-4" /></a>
                <a href="https://wa.me/6281359659649" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white transition-colors"><WhatsappIcon className="w-4 h-4" /></a>
                <a href="mailto:neutracksudo@gmail.com" className="hover:text-slate-900 dark:hover:text-white transition-colors"><Mail className="w-4 h-4" /></a>
              </div>
            </div>

            <div>
              <p className="ui-label text-slate-400 mb-4">Platform</p>
              <ul className="space-y-2.5">
                {MARKETING_NAV_LINKS.filter((l) => ["/product", "/solutions", "/docs"].includes(l.href)).map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">{label}</Link>
                  </li>
                ))}
                <li><Link href="/playground" className="text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Agent Flow Playground</Link></li>
              </ul>
            </div>

            <div>
              <p className="ui-label text-slate-400 mb-4">Resources</p>
              <ul className="space-y-2.5">
                {MARKETING_NAV_LINKS.filter((l) => ["/resources", "/pricing"].includes(l.href)).map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">{label}</Link>
                  </li>
                ))}
                <li><a href="#contact" className="text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between text-xs font-mono gap-4 pt-8 border-t border-slate-100 dark:border-white/[0.06]">
            <span className="text-slate-500 text-center md:text-left">&copy; {new Date().getFullYear()} Neutrack AI — Amadeus Orchestrator</span>
            <Link href="/docs" className="text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">Docs</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
