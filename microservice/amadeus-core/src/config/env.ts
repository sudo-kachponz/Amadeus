import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Vitest sets NODE_ENV=test. Point the test suite at its own database so
// `truncateAll()` in test/helpers.ts never wipes the shared dev DB that the
// frontend/curl testing uses (see docs/task4-mcp-uipath-audit.md incident).
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test', override: true });
}

/**
 * Startup env validation (fail-fast).
 *
 * CISO Code Security Review #40: connection string tidak boleh hardcoded di
 * source; hanya dibaca dari environment. CISO #34: informasi sensitif tidak
 * disimpan plaintext di source. Semua secret masuk lewat env di sini, satu
 * pintu, dan divalidasi sebelum proses menerima trafik.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  // Server
  HOST: z.string().default('127.0.0.1'), // bind localhost; TLS terminasi di reverse proxy
  PORT: z.coerce.number().int().positive().default(8080),

  // Database (on-prem PostgreSQL). WAJIB di-set, tidak ada default.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL wajib di-set (contoh: postgres://user:pass@host:5432/amadeus)')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL harus koneksi PostgreSQL on-prem, bukan URL layanan cloud pihak ketiga',
    }),

  // Pool tuning
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Financial signature layer (HMAC-SHA512). Per-robot secret sebenarnya
  // disimpan di service_accounts.signing_secret_hash; nilai ini hanya pepper
  // opsional untuk memperkuat. Optional supaya dev tanpa step finansial tetap jalan.
  SIGNATURE_PEPPER: z.string().min(16).optional(),

  // Log level
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ─── Rate limiting per kelas route (security-audit.md finding #5) ──────────
  // Semua threshold via env supaya bisa disetel tanpa deploy ulang. Default
  // konservatif dulu (ketat), perketat/perlonggar setelah lihat trafik nyata.
  // Keyed per-IP (req.ip; lihat trustProxy: 'loopback' di server.ts).
  //  - GLOBAL: default longgar untuk polling/read frontend.
  //  - LLM   : ketat untuk route yang memanggil LLM (run-agentic, architect, rag).
  //  - LOGIN : paling ketat, anti brute-force /auth/login.
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(240),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_LLM_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_LLM_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Feature flag: alur LC/SKBDN/SBLC transaction tracking (route
  // `/transactions/*`) di-deprioritize demi Agent Playground, tapi kodenya
  // tetap ada dan tetap bisa dites lokal dengan flag ini diaktifkan manual.
  // Default false: route tidak terdaftar sama sekali (404 natural dari
  // Fastify). `GET /health` TIDAK terpengaruh flag ini — selalu aktif.
  ENABLE_TRANSACTION_ROUTES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Feature flag: subsistem A2A v1 (task DB + JSON-RPC + agent card publik).
  // DITUNDA — kodenya dipertahankan tapi rutenya DIMATIKAN karena state machine
  // sisi-agen belum lengkap (markTask* tak pernah dipanggil → task nyangkut di
  // 'submitted') sementara agent card publik mengiklankan kapabilitas settlement
  // Trade Finance yang tak bisa diselesaikan. Default false: keempat rute
  // (agent card, /a2a, /a2a/rpc, /a2a/tasks/:id/stream) TIDAK didaftarkan sama
  // sekali (404 natural), bukan sekadar 404 dari dalam handler.
  // (security-audit.md finding #4-A2A; docs/refactor-inventory.md Temuan A)
  A2A_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Skew toleransi timestamp signature (detik) — anti-replay window.
  // Default 60 dtk: robot ada di jaringan bank ber-NTP, jadi 60 dtk aman dan
  // mempersempit jendela replay (belum ada nonce — finding #7). Tetap
  // konfigurabel via env; kalau klien sah kena signature-expired, NAIKKAN
  // nilainya, jangan diam-diam balik ke 300. (security-audit.md finding #7)
  SIGNATURE_MAX_SKEW_SEC: z.coerce.number().int().positive().default(60),

  // Endpoint LLM Air-gapped (mis. model via Ollama/vLLM)
  // Opsional. Jika kosong, agent akan menggunakan fallback deterministik.
  AGENT_LLM_URL: z.string().url().optional(),

  // OAUTH2 JWT Secret (Untuk verifikasi token Bearer stateless)
  OAUTH2_JWT_SECRET: z.string().min(16).optional(),

  // ─── Netra Runtime (LLM/VLM) — OpenAI-compatible on-prem inference ──
  // OpenAI-compatible endpoint: https://api.netraruntime.com/v1
  // VL model: deepseek/deepseek-v4.1-flash (multimodal — vision + text)
  // LLM model: deepseek/deepseek-v4-flash-0731 (text-only, cost-efficient)
  NETRA_BASE_URL: z.string().url().default('https://api.netraruntime.com/v1'),
  NETRA_API_KEY: z.string().optional(),
  NETRA_VL_MODEL: z.string().default('deepseek/deepseek-v4.1-flash'),
  NETRA_LLM_MODEL: z.string().default('deepseek/deepseek-v4-flash-0731'),
  NETRA_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Netra sampling knobs the OpenAI SDK types don't declare — spread into the
  // request body via netraSamplingParams() (telemetry/llmUsage.ts).
  // reasoning.effort is the shape Netra accepts (confirmed working live).
  NETRA_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  NETRA_TOP_K: z.coerce.number().int().default(40),
  NETRA_MIN_P: z.coerce.number().default(0),

  // ─── Embeddings (RAG) ───────────────────────────────────────────────
  // STAYS on OpenRouter: Netra has NO embeddings model (/embeddings → 404).
  // Separate base URL/key from Netra so RAG embedding keeps working against
  // its own provider. EMBEDDING_DIM must match the `vector(N)` column in
  // migrations/1795000000000_add_rag.ts if this model is ever changed —
  // qwen/qwen3-embedding-4b's native output is larger than 1024 dims, but
  // OpenRouter's /embeddings endpoint accepts a `dimensions` request field
  // that truncates it to exactly EMBEDDING_DIM (confirmed live).
  EMBEDDING_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('qwen/qwen3-embedding-4b'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),

  // Local-disk file storage for RAG uploads. No object-storage abstraction
  // (S3/Supabase Storage) exists anywhere in amadeus-core today — this repo
  // is on-prem Postgres only — so RAG source files live on local disk,
  // addressed by file_id rather than a bucket path.
  RAG_STORAGE_DIR: z.string().default('./data/rag-files'),

  // ─── RAG retrieval tuning ──────────────────────────────────────────
  RAG_BM25_WEIGHT: z.coerce.number().default(0.4),
  RAG_MIN_SIMILARITY: z.coerce.number().default(0.3),
  RAG_MAX_CHUNKS_PER_DOC: z.coerce.number().int().default(3),
  RAG_RETRIEVAL_CANDIDATES: z.coerce.number().int().default(20),
  RAG_RRF_K: z.coerce.number().int().default(60),
  RAG_CHUNK_MAX_CHARS: z.coerce.number().int().default(1500),
  RAG_CHUNK_OVERLAP_CHARS: z.coerce.number().int().default(200),
  RAG_RERANK_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  RAG_RERANK_CANDIDATES: z.coerce.number().int().default(10),
  RAG_DECOMPOSE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  RAG_MULTIHOP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Hard wall-clock ceiling on a single runAgenticStep call (invoke or
  // stream). Paired with recursionLimit so a stuck multi-step UiPath chain
  // can't burn tokens/hold a connection indefinitely. 15 min default is
  // generous for one disposable-email→login→OTP→survey chain + one retry.
  AGENT_WALL_CLOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60_000),

  // ─── UiPath Automation Cloud ────────────────────────────────────────
  // These env vars are ONLY needed for the legacy direct UiPath executor
  // (non-MCP path, e.g. uipathExecutor.ts). For MCP-based invocation,
  // credentials are stored per-tool in the database `tools.versions[].released.env`
  // and injected at spawn time by mcpAutoManager.ts.
  UIPATH_BASE_URL: z.string().url().default('https://cloud.uipath.com'),
  UIPATH_ORG: z.string().optional(),
  UIPATH_TENANT: z.string().optional(),
  UIPATH_CLIENT_ID: z.string().optional(),
  UIPATH_CLIENT_SECRET: z.string().optional(),
  UIPATH_SCOPES: z.string().default('OR.Jobs OR.Robots.Read OR.Execution'),
  UIPATH_FOLDER_ID: z.string().default('0'),
  /**
   * Allowlist host outbound untuk endpoint "Test & List Folders"
   * (/orchestrator/uipath/folders), comma-separated. Bila diisi, HANYA host di
   * daftar ini yang boleh dihubungi — pertahanan SSRF paling ketat.
   * Bila kosong, fallback ke blocklist RFC1918 (loopback/link-local/metadata
   * diblok, alamat privat lain diizinkan) untuk UiPath on-prem.
   * Contoh: "cloud.uipath.com,orchestrator.internal.corp"
   * (security-audit.md finding #3)
   */
  UIPATH_ALLOWED_HOSTS: z.string().optional(),
  /**
   * Peta step→releaseKey, format: "step:type=releaseKey;step2=releaseKey2"
   * Contoh: "mt_converted:import_lc=abc-123;swift_released=def-456"
   */
  UIPATH_RELEASE_MAP: z.string().optional(),

  // ─── Power Automate Desktop ─────────────────────────────────────────
  PAD_DISPATCH_MODE: z
    .enum(['power_automate_http', 'custom_bridge', 'queued_only'])
    .default('queued_only'),
  PAD_DISPATCH_URL: z.string().url().optional(),
  PAD_DISPATCH_AUTH_HEADER: z.string().optional(),
  PAD_DISPATCH_AUTH_VALUE: z.string().optional(),

  // ─── MCP SSE dynamic port allocation ────────────────────────────────
  // Overrides for config/port_range.json — same defaults as the legacy
  // Python get_free_port() implementation.
  MCP_HOST: z.string().optional(),
  MCP_START_PORT: z.coerce.number().int().positive().optional(),
  MCP_END_PORT: z.coerce.number().int().positive().optional(),

  // Resource ceiling for small VPS deployments. Both optional/unset by
  // default = today's behavior (unlimited concurrent 'sse' tools, never
  // idle-stopped). Read directly from process.env by
  // scripts/mcpAutoManager.ts (that script is a standalone entry point and
  // doesn't import this module) — declared here too so the full set of
  // recognized env vars stays documented in one schema.
  MCP_MAX_LIVE_TOOLS: z.coerce.number().int().positive().optional(),
  MCP_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  // ─── AML/CFT alert outbox email worker (apu.md Task 5) ──────────────
  // scripts/mcpAutoManager.ts's pollAlertOutbox() reads alert_outbox and
  // emails these addresses depending on verdict. All optional — if SMTP_HOST
  // is unset the poller logs a warning and leaves rows pending instead of
  // crashing the daemon (same posture as UIPATH_* being optional).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('aml-alerts@amadeus.local'),
  COMPLIANCE_ALERT_EMAIL: z.string().optional(),
  OPS_ALERT_EMAIL: z.string().optional(),

  // ─── LLM usage telemetry (token/GPU sizing measurement — owo.md/tok.md) ──
  // Passive, numeric-only instrumentation writing to `llm_usage_events`.
  // Default off: zero behavior change and zero DB writes unless explicitly
  // turned on for a measurement session.
  LLM_USAGE_TELEMETRY: z.enum(['on', 'off']).default('off').transform((v) => v === 'on'),
  // LEGACY / measurement-only: these two vars are OpenRouter-shaped
  // (provider.order / reasoning.enabled) and may NOT be honored by Netra —
  // Netra uses reasoning.effort (see NETRA_REASONING_EFFORT). Kept for the
  // sizing-measurement harness only; not part of the normal Netra request path.
  // Optional provider pin (e.g. 'coreweave', 'deepinfra'). Unset =
  // no `provider` field sent.
  LLM_MEASUREMENT_PROVIDER: z.string().optional(),
  // Optional force of reasoning/thinking on|off via `reasoning.enabled`.
  LLM_MEASUREMENT_REASONING: z.enum(['on', 'off']).optional(),
  // Tags telemetry rows with a scenario label (S1..S5) during the sizing
  // exercise. Unset in normal operation.
  LLM_MEASUREMENT_SCENARIO: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Jangan bocorkan nilai; hanya nama field + pesan. (CISO #32)
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`[env] Validasi environment gagal:\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();
