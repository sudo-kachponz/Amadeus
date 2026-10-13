import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDynamicQris } from "@/lib/qris";

export const dynamic = "force-dynamic";

const ORDER_EXPIRY_MINUTES = 24 * 60;
const MAX_PENDING_PER_EMAIL = 3;
const MAX_CODE_ATTEMPTS = 12;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.productId || !body?.buyerEmail || !body?.buyerName || !body?.buyerWhatsapp) {
      return NextResponse.json({ error: "Semua field wajib diisi" }, { status: 400 });
    }

    const { productId, buyerEmail, buyerName, buyerWhatsapp } = body;
    const normalizedEmail = buyerEmail.trim().toLowerCase();
    const supabase = getSupabaseAdmin();

    // Check product — accept both UUID and slug
    const isUuid = /^[0-9a-f]{8}-/.test(productId);
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq(isUuid ? "id" : "slug", productId)
      .single();
    if (productError || !product) {
      return NextResponse.json({ error: "Produk tidak ditemukan" }, { status: 404 });
    }

    // Check existing entitlement
    const { data: existing } = await supabase
      .from("entitlements")
      .select("id")
      .eq("buyer_email", normalizedEmail)
      .eq("product_id", product.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "Anda sudah memiliki e-book ini.", alreadyOwned: true }, { status: 409 });
    }

    // Anti-spam
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("buyer_email", normalizedEmail)
      .eq("status", "awaiting_verification");
    if ((count ?? 0) >= MAX_PENDING_PER_EMAIL) {
      return NextResponse.json({ error: "Anda punya pesanan yang masih menunggu verifikasi." }, { status: 429 });
    }

    const baseAmount = product.price;
    const orderRef = `NT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const proofPath = `proofs/${orderRef}`;
    const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60_000).toISOString();

    // Allocate unique code
    let uniqueCode = 0;
    let finalAmount = 0;
    let inserted = false;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      uniqueCode = Math.floor(Math.random() * 900) + 100;
      finalAmount = baseAmount + uniqueCode;

      const { error } = await supabase.from("orders").insert({
        order_ref: orderRef,
        product_id: product.id,
        buyer_email: normalizedEmail,
        buyer_name: buyerName,
        buyer_whatsapp: buyerWhatsapp,
        amount: finalAmount,
        base_amount: baseAmount,
        final_amount: finalAmount,
        unique_code: uniqueCode,
        service_fee: 0,
        payment_method: "qris",
        status: "awaiting_verification",
        proof_path: proofPath,
        expires_at: expiresAt,
      });
      if (!error) { inserted = true; break; }
      if (error.code !== "23505") throw error;
    }
    if (!inserted) {
      return NextResponse.json({ error: "Sistem sedang sibuk. Coba lagi." }, { status: 503 });
    }

    // Signed upload URL for proof
    const { data: signed, error: signError } = await supabase.storage
      .from("payment-proofs")
      .createSignedUploadUrl(proofPath);
    if (signError || !signed) throw signError || new Error("Gagal membuat URL unggah");

    // Build QRIS
    let qrisPayload: string | undefined;
    let qrisIsDynamic = false;
    const staticPayload = (process.env.QRIS_STATIC_PAYLOAD || "").trim();
    if (staticPayload) {
      qrisPayload = staticPayload;
      if (process.env.QRIS_DYNAMIC_ENABLED === "true") {
        try {
          qrisPayload = buildDynamicQris(staticPayload, finalAmount);
          qrisIsDynamic = true;
        } catch { /* fallback to static */ }
      }
    }

    return NextResponse.json({
      orderRef,
      uploadUrl: signed.signedUrl,
      baseAmount,
      serviceFee: 0,
      uniqueCode,
      finalAmount,
      expiresAt,
      ...(qrisPayload ? { qrisPayload, qrisIsDynamic } : {}),
    });
  } catch (err) {
    console.error("[ebook/create-order]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
