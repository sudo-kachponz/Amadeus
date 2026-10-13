"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { BookOpen, ArrowRight, CheckCircle, Copy, Upload, X, ShieldCheck } from "lucide-react";
import { InstagramIcon } from "@/components/Icons";
import { MarketingHeader } from "@/components/MarketingHeader";
import { MarketingFooter } from "@/components/MarketingFooter";
import { HoloStage } from "@/components/HoloStage";
import { HoloText } from "@/components/HoloText";
import { HoloCompanion } from "@/components/HoloCompanion";
import { BrutalFrame } from "@/components/BrutalFrame";
import { COMPANY, LIBRARY } from "@/content/company";
import QRCode from "qrcode";

const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");

const ACCEPTED_EXT = /\.(jpe?g|png|webp|heic|heif|gif|pdf)$/i;
const MAX_BYTES = 25 * 1024 * 1024;

type QrisOrder = {
  orderRef: string;
  uploadUrl: string;
  baseAmount: number;
  uniqueCode: number;
  finalAmount: number;
  expiresAt: string;
};

export default function EbookPage() {
  const book = LIBRARY[0];
  const discountPct = Math.round((1 - book.price / book.compareAt) * 100);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  // Checkout state
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerWhatsapp, setBuyerWhatsapp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // QRIS popup state
  const [qrisOrder, setQrisOrder] = useState<QrisOrder | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrisDynamic, setQrisDynamic] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [paidDone, setPaidDone] = useState(false);

  const scrollToCheckout = () => {
    checkoutRef.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => document.getElementById("buyer-name")?.focus(), 500);
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!buyerName.trim()) { setError("Nama lengkap wajib diisi"); return; }
    if (!buyerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      setError("Email tidak valid"); return;
    }
    const digits = buyerWhatsapp.replace(/\D/g, "");
    if (digits.length < 9) { setError("Nomor WhatsApp tidak valid"); return; }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/ebook/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: book.productSlug,
          buyerName,
          buyerEmail,
          buyerWhatsapp: digits,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal memproses pesanan");
        return;
      }

      // Generate QR
      if (data.qrisPayload) {
        setQrDataUrl(await QRCode.toDataURL(data.qrisPayload, { width: 320, margin: 1 }));
        setQrisDynamic(!!data.qrisIsDynamic);
      }

      setPaidDone(false);
      setProofFile(null);
      setProofPreview(null);
      setQrisOrder({
        orderRef: data.orderRef,
        uploadUrl: data.uploadUrl,
        baseAmount: data.baseAmount,
        uniqueCode: data.uniqueCode,
        finalAmount: data.finalAmount,
        expiresAt: data.expiresAt,
      });
    } catch {
      setError("Gagal memproses pembayaran. Coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyText = (text: string) =>
    navigator.clipboard.writeText(text).catch(() => {});

  const onPickProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ACCEPTED_EXT.test(f.name)) { setError("Format harus JPG, PNG, WEBP, atau PDF"); return; }
    if (f.size > MAX_BYTES) { setError("Ukuran file maksimal 25 MB"); return; }
    setProofFile(f);
    setProofPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const uploadProof = async () => {
    if (!qrisOrder || !proofFile) return;
    try {
      setUploading(true);
      setUploadProgress(5);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", qrisOrder.uploadUrl);
        xhr.setRequestHeader("Content-Type", proofFile.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject());
        xhr.onerror = () => reject();
        xhr.send(proofFile);
      });
      setPaidDone(true);
    } catch {
      setError("Gagal mengunggah bukti. Coba lagi.");
    } finally {
      setUploading(false);
    }
  };

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
              <span><HoloText delay={0.15}>E-book Store</HoloText></span>
              <span><HoloText variant="foil" delay={0.4} className="font-light">by Neutrack</HoloText></span>
            </h1>
            <p className="text-[15px] md:text-[17px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[38rem] mb-10">
              Interactive e-books with per-buyer links, device limits, and built-in workbooks.
              Every bug we fixed became a lesson worth sharing.
            </p>
          </div>
        </HoloStage>
      </section>

      {/* Product showcase */}
      <section className="relative py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-16 items-start">
            {/* Cover */}
            <div className="flex justify-center">
              <div className="relative w-[280px] md:w-[340px] rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src={book.cover}
                  alt={book.title}
                  width={680}
                  height={1020}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>

            {/* Info */}
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--holo-violet)]/10 px-2.5 py-1 text-xs font-bold text-[var(--holo-violet)]">
                  E-Book
                </span>
                {discountPct > 0 && (
                  <span className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    DISKON {discountPct}%
                  </span>
                )}
              </div>

              <h2 className="section-head text-3xl md:text-4xl text-foreground">
                {book.title}
              </h2>
              <p className="text-[14px] text-slate-500">by {book.author}</p>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg text-slate-500 line-through">{rp(book.compareAt)}</span>
                <span className="text-3xl font-bold holo-text">{rp(book.price)}</span>
              </div>

              <p className="text-[16px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-[52ch]">
                {book.blurb}
              </p>

              {/* Chapters */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-3">Daftar Isi — {book.chapters.length} Chapter</h3>
                <ul className="space-y-2">
                  {book.chapters.map((ch, i) => (
                    <li key={ch} className="flex items-center gap-3 text-[14px] text-slate-600 dark:text-slate-400">
                      <span className="flex-none w-7 h-7 rounded-full bg-[var(--holo-wire)] flex items-center justify-center text-[11px] font-mono text-slate-500">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {ch}
                    </li>
                  ))}
                </ul>
              </div>

              <ul className="space-y-2 pt-2">
                {[
                  "Interactive workbook — tulis langsung di e-book",
                  "Per-buyer unique link — anti-sharing",
                  "Device lock — maks 2 perangkat per pembeli",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-[14px] text-foreground">
                    <CheckCircle className="w-5 h-5 flex-none text-[var(--holo-violet)]" />
                    {f}
                  </li>
                ))}
              </ul>

              <button onClick={scrollToCheckout} className="holo-ring holo-cta">
                Beli E-Book Sekarang <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Chapter preview image */}
      <section className="relative py-12 md:py-20">
        <div className="max-w-3xl mx-auto px-5 md:px-6">
          <h2 className="section-head text-2xl md:text-3xl text-foreground mb-8 text-center">
            Preview Ilustrasi per Chapter
          </h2>
          <div className="brutal-panel holo-sheen p-4 md:p-8 flex justify-center">
            <Image
              src="/ebook-chapters.png"
              alt="Chapter illustrations preview"
              width={800}
              height={600}
              className="w-full h-auto rounded-lg"
            />
          </div>
        </div>
      </section>

      {/* Checkout */}
      <section ref={checkoutRef} className="relative py-16 md:py-24 scroll-mt-24">
        <div className="max-w-4xl mx-auto px-5 md:px-6">
          <div className="brutal-panel holo-sheen p-6 sm:p-8 md:p-12">
            <h2 className="section-head text-2xl md:text-3xl text-foreground mb-2">Pembelian E-Book</h2>
            <p className="text-[14px] text-slate-500 mb-8">Isi data di bawah. Link akses dikirim ke WhatsApp setelah pembayaran diverifikasi.</p>

            {error && (
              <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-[14px] text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleCheckout} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label htmlFor="buyer-name" className="text-sm font-semibold text-foreground">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="buyer-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Masukkan nama lengkap"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-background px-4 py-3 text-foreground text-[14px] focus:border-[var(--holo-violet)] focus:ring-2 focus:ring-[var(--holo-violet)]/20 outline-none transition-colors"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="buyer-whatsapp" className="text-sm font-semibold text-foreground">
                    Nomor WhatsApp <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="buyer-whatsapp"
                    type="tel"
                    autoComplete="tel"
                    placeholder="08xx xxxx xxxx"
                    value={buyerWhatsapp}
                    onChange={(e) => setBuyerWhatsapp(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-background px-4 py-3 text-foreground text-[14px] focus:border-[var(--holo-violet)] focus:ring-2 focus:ring-[var(--holo-violet)]/20 outline-none transition-colors"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="buyer-email" className="text-sm font-semibold text-foreground">
                  Alamat Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  placeholder="email@contoh.com"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-background px-4 py-3 text-foreground text-[14px] focus:border-[var(--holo-violet)] focus:ring-2 focus:ring-[var(--holo-violet)]/20 outline-none transition-colors"
                  required
                />
                <p className="text-[12px] text-slate-500">E-book akan dikaitkan dengan email ini untuk akses membaca.</p>
              </div>

              {/* Price summary */}
              <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06] p-4 space-y-2 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Harga E-Book</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 line-through">{rp(book.compareAt)}</span>
                    <span className="font-semibold text-foreground">{rp(book.price)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>+ kode unik 3 digit</span>
                  <span>ditambahkan saat checkout</span>
                </div>
                <div className="flex items-center justify-between border-t border-dashed border-slate-200 dark:border-white/10 pt-2.5 text-base font-bold">
                  <span className="text-foreground">Total Bayar</span>
                  <span className="holo-text">{rp(book.price)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="holo-ring holo-cta w-full justify-center h-14 text-base"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Memproses...
                  </span>
                ) : (
                  <>Lanjut ke Pembayaran QRIS <ArrowRight className="w-4 h-4" /></>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--holo-violet)]" />
                Pembayaran aman via QRIS
              </p>
            </form>
          </div>
        </div>
      </section>

      {/* QRIS Payment Modal */}
      {qrisOrder && !paidDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md bg-background rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setQrisOrder(null)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="section-head text-xl text-foreground mb-2">Pembayaran QRIS</h3>
            <p className="text-[13px] text-slate-500 mb-6">
              Ref: <span className="font-mono">{qrisOrder.orderRef}</span>
            </p>

            {/* QR Code */}
            {qrDataUrl ? (
              <div className="flex flex-col items-center mb-6">
                <div className="bg-white p-3 rounded-xl mb-3">
                  <img src={qrDataUrl} alt="QRIS QR Code" className="w-56 h-56" />
                </div>
                {qrisDynamic ? (
                  <p className="text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Nominal otomatis terisi di aplikasi
                  </p>
                ) : (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400">
                    Masukkan nominal PERSIS seperti di bawah
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500 text-sm mb-6">
                QRIS belum dikonfigurasi. Hubungi admin.
              </div>
            )}

            {/* Amount */}
            <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/[0.06] p-4 mb-6 space-y-1.5 text-[14px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Harga</span>
                <span>{rp(qrisOrder.baseAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kode unik</span>
                <span>+{qrisOrder.uniqueCode}</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-slate-200 dark:border-white/10 pt-2 font-bold text-lg">
                <span>Total</span>
                <button
                  type="button"
                  onClick={() => copyText(String(qrisOrder.finalAmount))}
                  className="flex items-center gap-1.5 holo-text"
                >
                  {rp(qrisOrder.finalAmount)}
                  <Copy className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>

            {/* Upload proof */}
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-foreground">Upload Bukti Pembayaran</p>

              <input
                ref={proofInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={onPickProof}
                className="hidden"
              />

              {proofPreview ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-white/10">
                  <img src={proofPreview} alt="Bukti" className="w-full max-h-48 object-contain bg-slate-50 dark:bg-white/[0.03]" />
                  <button
                    onClick={() => { setProofFile(null); setProofPreview(null); }}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : proofFile ? (
                <div className="flex items-center gap-2 text-[13px] text-foreground p-3 rounded-lg border border-slate-200 dark:border-white/10">
                  <Upload className="w-4 h-4" />
                  {proofFile.name}
                  <button onClick={() => setProofFile(null)} className="ml-auto text-slate-400 hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => proofInputRef.current?.click()}
                  className="w-full py-8 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 text-slate-500 hover:border-[var(--holo-violet)] hover:text-[var(--holo-violet)] transition-colors flex flex-col items-center gap-2"
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-[13px]">Tap untuk pilih foto/screenshot</span>
                </button>
              )}

              {uploading && (
                <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-[var(--holo-violet)] transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={uploadProof}
                disabled={!proofFile || uploading}
                className="holo-ring holo-cta w-full justify-center h-12 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? "Mengunggah..." : "Kirim Bukti Pembayaran"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {paidDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-background rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="section-head text-xl text-foreground mb-3">Bukti Terkirim!</h3>
            <p className="text-[14px] text-slate-500 leading-relaxed mb-6">
              Pembayaran Anda sedang diverifikasi. Link akses e-book akan dikirim ke WhatsApp Anda
              (maks 1x24 jam).
            </p>
            <p className="text-[13px] text-slate-400 mb-6">
              Ref: <span className="font-mono">{qrisOrder?.orderRef}</span>
            </p>
            <button
              onClick={() => { setQrisOrder(null); setPaidDone(false); }}
              className="wire-btn"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* CTA footer */}
      <section className="relative py-12">
        <div className="max-w-4xl mx-auto px-5 md:px-6 text-center">
          <p className="text-[15px] text-slate-500 dark:text-slate-400 mb-6">
            E-book baru dan webinar diumumkan di Instagram.
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
      </section>

      <MarketingFooter />
    </div>
  );
}
