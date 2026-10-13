import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { env as appEnv } from '../config/env.js';
import { authenticateRobot, verifyFinancialSignature } from '../middleware/auth.js';
import { handleA2A, runAgenticStep, runAgenticStepStream, fetchAgentUipathContext, fetchQueueTransactionsForTool } from './engine.js';
import { registry } from './agents/base.js';
import { docExamAgent } from './agents/docExamAgent.js';
import { executorRegistry } from './executors/base.js';
import { registerDefaultExecutors } from './executors/executorMap.js';
import { explainRoute } from './executors/router.js';
import { dispatchCurrentStep } from './executors/dispatchBridge.js';
import type { A2AEnvelope } from './a2a/protocol.js';
import { handleRpc } from './a2a/rpcHandler.js';
import { streamHandler } from './a2a/streamHandler.js';
import { buildAgentCard } from './a2a/agentCard.js';
import { getMcpManagerState } from './mcpManagerState.js';
import { resetUiPathTokenCache } from '../lib/uipathAuth.js';
import { getRecipeForAgent, upsertRecipeForAgent, deleteRecipeForAgent } from './recipes/store.js';
import { runRecipeStream } from './recipes/executor.js';
import type { RecipeDef } from './recipes/types.js';
import { DomainError } from '../types/domain.js';
import { toMcpStatus, type McpStatus, type McpMethod } from '../types/mcpStatus.js';
import { suggestFieldValue } from './executors/autofillClient.js';
import { suggestFollowUps } from './executors/recommendationClient.js';
import { suggestChatTitle } from './executors/chatTitleClient.js';
import { retrievalWithRerank, generateRagResponse, ingestFile, ingestDocumentSmart, deleteFileChunks, type RagResponse } from './executors/ragClient.js';
import { submitFeedback, getAdaptiveThreshold } from './executors/ragRetrieval.js';
import { saveFile, replaceFile, deleteFiles as deleteStoredFiles } from '../lib/ragStorage.js';

// Daftarkan agent bawaan sekali saat modul dimuat.
try {
  registry.register(docExamAgent);
} catch {
  /* sudah terdaftar (hot reload) */
}
// Daftarkan executor bawaan (Netra, UiPath, PAD) sekali saat modul dimuat.
registerDefaultExecutors();

const SAFE_SLUG = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const IDEM = z.string().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);

const A2AEnvelopeSchema = z
  .object({
    protocol: z.literal('amadeus.a2a/0'),
    type: z.enum(['task.assign', 'task.complete', 'task.failed', 'task.status']),
    transactionId: z.string().uuid(),
    step: SAFE_SLUG,
    idempotencyKey: IDEM,
    correlationId: z.string().min(1).max(200),
    reason: z.string().min(1).max(500).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    sentAt: z.string().datetime(),
  })
  .strict();

const RunAgenticSchema = z
  .object({
    transactionId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    idempotencyKey: IDEM,
    prompt: z.string().optional(),
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      content: z.union([z.string(), z.array(z.any())])
    })).optional(),
    stream: z.boolean().optional(),
    // 'playground' (default) never touches the `transactions` table — used by
    // the test-drive UI. 'production' requires a real, existing transactionId.
    mode: z.enum(['playground', 'production']).default('playground'),
    // Client-generated chat-session id (agent-invoke's `agent-sessions` localStorage
    // key), forwarded so uipath_job_trace rows can be correlated back to a chat.
    // Best-effort only — never validated against a server-side session table.
    sessionLabel: z.string().max(200).optional(),
    runtime: z.enum(['cloud', 'on_prem']).optional(),
  })
  .strict();

// Zod mirror of RecipeDef/RecipeStepDef (recipes/types.ts) — creatoroop.md's
// generalized, tool-agnostic Recipe schema. `agentId`/`id` in the body are
// ignored on write (the URL param and existing/generated id win instead).
const ArgsTemplateSchema = z.record(z.string(), z.unknown());

const RecipeResolverSchema = z.object({
  id: z.string().min(1).max(64),
  toolName: z.string().min(1).max(200),
  argsTemplate: ArgsTemplateSchema,
  extract: z.union([
    z.object({
      kind: z.literal('text_lines'),
      itemPattern: z.string().min(1),
      nameGroup: z.number().int().min(0),
      valueGroup: z.number().int().min(0),
    }).strict(),
    z.object({
      kind: z.literal('meta_array'),
      metaField: z.string().min(1),
      nameField: z.string().min(1),
      valueField: z.string().min(1),
    }).strict(),
  ]),
}).strict();

const RecipeStepSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  toolName: z.string().min(1).max(200),
  argsTemplate: ArgsTemplateSchema,
  variantCount: z.number().int().min(1).max(20).optional(),
  resolve: z.object({
    resolverId: z.string().min(1).max(64),
    nameTemplate: z.string().min(1).max(200),
  }).strict().optional(),
  pollFor: z.object({
    toolName: z.string().min(1).max(200),
    argsTemplate: ArgsTemplateSchema,
    terminalField: z.string().min(1).max(100),
    terminalValues: z.array(z.string().min(1)).min(1),
    successValues: z.array(z.string().min(1)).optional(),
    timeoutSeconds: z.number().int().min(1).max(3600),
    pollIntervalSeconds: z.number().int().min(1).max(300),
  }).strict().optional(),
  verify: z.object({
    toolName: z.string().min(1).max(200),
    argsTemplate: ArgsTemplateSchema,
    checkField: z.string().min(1).max(100),
    mustBeNonEmpty: z.boolean(),
  }).strict().optional(),
  onFault: z.enum(['rotate_variant', 'abort_iteration', 'abort_recipe']),
}).strict();

const RecipeDefSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  agentId: z.string().uuid().optional(),
  label: z.string().min(1).max(200),
  steps: z.array(RecipeStepSchema).min(1),
  iterations: z.number().int().min(1).max(20),
  maxConcurrentJobs: z.literal(1).optional(),
  resolvers: z.array(RecipeResolverSchema).optional(),
}).strict();

// Prompt #14 — Magic Pen Autofill / Chat Recommendation / Real Chat
// Summaries. All three are lightweight netraChat() text calls.
const AutofillSuggestSchema = z.object({
  fieldName: z.string().min(1).max(100),
  fieldContext: z.record(z.string(), z.unknown()).default({}),
  currentValue: z.string().max(4000).optional(),
}).strict();

const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().max(8000),
}).strict();

const ChatRecommendationsSchema = z.object({
  conversationTail: z.array(ConversationMessageSchema).min(1).max(10),
}).strict();

const ChatTitleSchema = z.object({
  messages: z.array(ConversationMessageSchema).min(1).max(20),
}).strict();

const RagQuerySchema = z.object({
  query: z.string().min(1).max(4000),
  history: z.array(z.object({ role: z.string(), content: z.string() })).max(10).optional(),
});

const RagRemoveFileSchema = z.object({
  file_ids: z.array(z.string().min(1)).min(1).max(100),
}).strict();

export async function registerOrchestratorRoutes(app: FastifyInstance): Promise<void> {
  // A2A v1 DITUNDA (security-audit.md finding #4-A2A; refactor-inventory Temuan A):
  // state machine sisi-agen belum lengkap, jadi keempat rute A2A TIDAK
  // didaftarkan saat A2A_ENABLED=false (default). Bukan 404-dari-handler — benar-
  // benar tidak terdaftar, termasuk agent card publik di bawah yang tanpa auth
  // mengiklankan kapabilitas settlement Trade Finance yang belum bisa dipenuhi.
  if (appEnv.A2A_ENABLED) {
    // GET /.well-known/amadeus-agent-card.json (Public discovery)
    app.get('/.well-known/amadeus-agent-card.json', async (_req, reply) => {
      return reply.send(buildAgentCard());
    });
  }

  app.register(async (secured) => {
    secured.addHook('preHandler', authenticateRobot);
    secured.addHook('preHandler', verifyFinancialSignature);

    const typedSecured = secured.withTypeProvider<ZodTypeProvider>();

    // Limit KETAT (env-driven) untuk route yang memanggil LLM — run-agentic dan
    // RAG ingest/query. Override limiter global loose dari server.ts.
    // (security-audit.md finding #5)
    const llmRateLimit = {
      rateLimit: {
        max: appEnv.RATE_LIMIT_LLM_MAX,
        timeWindow: appEnv.RATE_LIMIT_LLM_WINDOW_MS,
      },
    };

    // A2A v1 rute (DITUNDA) — didaftarkan hanya saat A2A_ENABLED=true. Lihat
    // komentar di registerOrchestratorRoutes() + security-audit.md finding #4-A2A.
    if (appEnv.A2A_ENABLED) {
      // POST /a2a — terima envelope A2A dari robot/agent.
      // Legacy amadeus.a2a/0 — dipertahankan untuk backwards compat.
      typedSecured.post('/a2a', {
        schema: { body: A2AEnvelopeSchema }
      }, async (req, reply) => {
        const env = req.body as A2AEnvelope;
        const result = await handleA2A(req.auth!, env);
        return reply.send(result);
      });

      // POST /a2a/rpc — Endpoint utama amadeus.a2a/1 (JSON-RPC 2.0)
      typedSecured.post('/a2a/rpc', async (req, reply) => {
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        const result = await handleRpc(req.body as any, req.auth!, rawBody);
        // Ensure HTTP status is 200 for JSON-RPC even if it contains a JSON-RPC error
        return reply.code(200).send(result);
      });

      // GET /a2a/tasks/:id/stream — SSE endpoint untuk task update
      typedSecured.get('/a2a/tasks/:id/stream', streamHandler);
    }

    // POST /orchestrator/run-agentic — jalankan agent agentic in-process
    // untuk current_step transaksi (mis. Document Examination Agent).
    typedSecured.post('/orchestrator/run-agentic', {
      schema: { body: RunAgenticSchema },
      config: llmRateLimit,
    }, async (req, reply) => {
      const body = req.body as { transactionId?: string; agentId?: string; idempotencyKey: string; prompt?: string; messages?: any[]; stream?: boolean; mode: 'playground' | 'production'; sessionLabel?: string; runtime?: 'cloud' | 'on_prem' };
      if (body.stream) {
        reply.hijack();
        await runAgenticStepStream(req.auth!, body.transactionId, body.idempotencyKey, body.prompt, body.messages, body.agentId, body.mode, reply, body.sessionLabel, body.runtime);
        return;
      }
      const result = await runAgenticStep(req.auth!, body.transactionId, body.idempotencyKey, body.prompt, body.messages, body.agentId, body.mode, body.sessionLabel, body.runtime);
      return reply.send(result);
    });

    // GET/PUT/DELETE /orchestrator/agents/:agentId/recipe — creatoroop.md's
    // generalized Recipe Executor (Loop Mode) config, per agent. Zero-or-one
    // per agent; not every agent has one, and agents with none are
    // unaffected (404, not an error).
    typedSecured.get('/orchestrator/agents/:agentId/recipe', {
      schema: { params: z.object({ agentId: z.string().uuid() }).strict() },
    }, async (req, reply) => {
      const { agentId } = req.params as { agentId: string };
      const recipe = await getRecipeForAgent(agentId);
      if (!recipe) {
        throw new DomainError('RECIPE_NOT_FOUND', `No recipe configured for agent ${agentId}`, 404);
      }
      return reply.send(recipe);
    });

    typedSecured.put('/orchestrator/agents/:agentId/recipe', {
      schema: {
        params: z.object({ agentId: z.string().uuid() }).strict(),
        body: RecipeDefSchema,
      },
    }, async (req, reply) => {
      const { agentId } = req.params as { agentId: string };
      const body = req.body as z.infer<typeof RecipeDefSchema>;

      const agentRes = await query('SELECT 1 FROM agents WHERE agent_id = $1', [agentId]);
      if (agentRes.rowCount === 0) {
        throw new DomainError('AGENT_NOT_FOUND', `No agent with id ${agentId}`, 404);
      }

      // Server owns agentId/id — never trust the client's copy of either.
      const recipe: RecipeDef = {
        ...body,
        id: body.id ?? `agent_${agentId}`,
        agentId,
        maxConcurrentJobs: 1,
      };
      const saved = await upsertRecipeForAgent(agentId, recipe);
      return reply.send(saved);
    });

    typedSecured.delete('/orchestrator/agents/:agentId/recipe', {
      schema: { params: z.object({ agentId: z.string().uuid() }).strict() },
    }, async (req, reply) => {
      const { agentId } = req.params as { agentId: string };
      await deleteRecipeForAgent(agentId);
      return reply.code(204).send();
    });

    // POST /orchestrator/agents/:agentId/recipe/run — Recipe Executor
    // (Loop Mode). A separate, additive execution path from
    // /orchestrator/run-agentic: a deterministic state machine runs the
    // mechanical trigger->wait->verify chain with no LLM call, calling the
    // model only at bounded fault-classification decision points. See
    // loop.md/creatoroop.md for the full rationale.
    typedSecured.post('/orchestrator/agents/:agentId/recipe/run', {
      schema: {
        params: z.object({ agentId: z.string().uuid() }).strict(),
        body: z.object({ iterations: z.number().int().min(1).max(20).optional() }).strict(),
      },
    }, async (req, reply) => {
      const { agentId } = req.params as { agentId: string };
      const body = req.body as { iterations?: number };

      // Load BEFORE hijacking the reply, so a missing recipe returns a
      // clean 404 JSON response instead of a broken SSE stream.
      const recipe = await getRecipeForAgent(agentId);
      if (!recipe) {
        throw new DomainError('RECIPE_NOT_FOUND', `No recipe configured for agent ${agentId}`, 404);
      }

      reply.hijack();
      await runRecipeStream(recipe, { agentId, iterations: body.iterations ?? recipe.iterations }, reply);
    });

    // POST /orchestrator/agents/:agentId/loop/run — Prompt-Driven Loop Mode.
    // Runs the agent N times using a user-supplied prompt. Each iteration is
    // a fresh agentic call; results are streamed as SSE events so the frontend
    // can display live per-iteration progress without needing a recipe.
    typedSecured.post('/orchestrator/agents/:agentId/loop/run', {
      schema: {
        params: z.object({ agentId: z.string().uuid() }).strict(),
        body: z.object({
          prompt: z.string().min(1).max(4000),
          iterations: z.number().int().min(1).max(50).optional().default(3),
          runtime: z.enum(['cloud', 'on_prem']).optional(),
        }).strict(),
      },
    }, async (req, reply) => {
      const { agentId } = req.params as { agentId: string };
      const { prompt, iterations, runtime } = req.body as { prompt: string; iterations: number; runtime?: 'cloud' | 'on_prem' };

      // Verify agent exists before hijacking reply
      const agentCheck = await query('SELECT 1 FROM agents WHERE agent_id = $1', [agentId]);
      if (agentCheck.rowCount === 0) {
        throw new DomainError('AGENT_NOT_FOUND', `No agent with id ${agentId}`, 404);
      }

      const raw = reply.raw;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache, no-transform');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.flushHeaders?.();
      reply.hijack();

      const sendEvent = (event: string, data: object) => {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent('loop_start', { totalIterations: iterations, prompt });

      for (let i = 1; i <= iterations; i++) {
        sendEvent('iteration_start', { iteration: i, totalIterations: iterations });
        try {
          // Collect chunks from the streaming step into a single result string
          let resultText = '';
          // Use idempotency key unique per iteration
          const idemKey = `loop-${agentId}-iter${i}-${Date.now()}`;

          // We need a synchronous result so we call the non-streaming variant
          const result = await runAgenticStep(
            req.auth!,
            undefined,
            idemKey,
            `[Iteration ${i}/${iterations}] ${prompt}`,
            undefined,
            agentId,
            'playground',
            undefined,
            runtime,
          );

          resultText = typeof result === 'string'
            ? result
            : (result as any)?.answer ?? (result as any)?.response ?? JSON.stringify(result);

          sendEvent('iteration_done', {
            iteration: i,
            totalIterations: iterations,
            status: 'success',
            detail: resultText.substring(0, 500), // truncate for SSE safety
          });
        } catch (err: any) {
          sendEvent('iteration_done', {
            iteration: i,
            totalIterations: iterations,
            status: 'failed',
            detail: err.message ?? 'Unknown error',
          });
        }
      }

      sendEvent('loop_complete', { totalIterations: iterations, status: 'completed' });
      raw.end();
    });

    // GET /orchestrator/agents — daftar agent terdaftar & kapabilitasnya.
    typedSecured.get('/orchestrator/agents', async (_req, reply) => {
      return reply.send({
        agents: registry.all().map((a) => a.descriptor),
      });
    });

    // GET /orchestrator/mcp/status — live process state for every registered
    // MCP tool. LEFT JOINs mcp_runtime_state rather than INNER JOINing it
    // (the old shape) because that table only ever gets a row for 'sse'
    // tools — the daemon (scripts/mcpAutoManager.ts) explicitly skips
    // writing one for 'stdio' tools, which are spawned on-demand per
    // connection by StdioClientTransport (engine.ts) and have no
    // port/pid/daemon-tracked process to report. Under the old INNER JOIN,
    // stdio tools simply didn't appear in this endpoint's response at all;
    // now they appear with a status that says what's actually true instead
    // of being indistinguishable from "never started".
    typedSecured.get('/orchestrator/mcp/status', async (_req, reply) => {
      const res = await query<{
        tool_id: string;
        tool_name: string;
        versions: unknown;
        mrs_method: string | null;
        port: number | null;
        status: string | null;
        pid: number | null;
        started_at: string | null;
        updated_at: string | null;
        last_error: string | null;
      }>(
        `SELECT t.tool_id, t.name AS tool_name, t.versions,
                mrs.method AS mrs_method, mrs.port, mrs.status, mrs.pid,
                mrs.started_at, mrs.updated_at, mrs.last_error
         FROM tools t
         LEFT JOIN mcp_runtime_state mrs ON mrs.tool_id = t.tool_id
         ORDER BY t.name ASC`,
      );
      return reply.send(
        res.rows.map((r) => {
          let versions: any = r.versions;
          if (typeof versions === 'string') {
            try { versions = JSON.parse(versions); } catch { versions = null; }
          }
          const release = versions?.[versions.length - 1]?.released;
          // mrs.method (actual runtime-recorded value) takes priority over the
          // tool's stored config — it's the ground truth for what's currently
          // live, and could momentarily differ from a since-edited tool row.
          const rawMethod: string | null = r.mrs_method ?? release?.method ?? null;
          const method: McpMethod | null =
            rawMethod === 'stdio' || rawMethod === 'sse' ? rawMethod : null;

          // `method` and `status` are returned as two SEPARATE fields — the
          // API never composes a UI sentence (that's the frontend's job).
          //  - stdio tools are spawned per-call and have no persistent process
          //    or runtime row, so their status is the dedicated 'on-demand'
          //    category rather than a fake running/stopped.
          //  - an sse tool with a runtime row reports that row's status.
          //  - an sse tool with NO row has genuinely never started; that is
          //    'unknown' (no data), NOT 'stopped' — only an explicit stop is
          //    'stopped'. toMcpStatus() also coerces any unrecognised DB value
          //    to 'unknown' so a bad row can't mislabel a tool as running.
          let status: McpStatus;
          if (method === 'stdio') {
            status = 'on-demand';
          } else if (r.status != null) {
            status = toMcpStatus(r.status);
          } else {
            status = 'unknown';
          }

          return {
            toolId: r.tool_id,
            toolName: r.tool_name,
            method,
            port: r.port,
            status,
            pid: r.pid,
            startedAt: r.started_at,
            // Raw last-write timestamp so the UI can show "checked Xs ago" and
            // make a stale reading visibly stale. NOTE: this is NOT yet a
            // heartbeat — fn_reserve_mcp_port only bumps updated_at on a state
            // TRANSITION, so a healthy long-running tool's updated_at just
            // ages. Auto-downgrading stale 'running' -> 'unknown' must wait for
            // the periodic re-probe that writes last_checked_at (fe.md item 3).
            updatedAt: r.updated_at,
            lastError: r.last_error,
          };
        }),
      );
    });

    // GET /orchestrator/mcp/manager-status — is the mcpAutoManager child
    // process (spawned by server.ts) actually alive? If it crashed at boot
    // (e.g. a broken import), no MCP tool server is ever spawned and every
    // tool call fails with a generic connection error — this endpoint lets
    // the frontend surface that immediately instead of the user discovering
    // it three tool calls into a chat.
    typedSecured.get('/orchestrator/mcp/manager-status', async (_req, reply) => {
      return reply.send(getMcpManagerState());
    });

    // POST /orchestrator/mcp/:toolId/restart — manual restart escape hatch for
    // cases the mtime-based auto-restart in mcpAutoManager can't catch (e.g.
    // env var / DB config changes with no entry-file change). Kills the
    // currently-tracked process by pid (works cross-process since the daemon
    // that actually spawned it lives in a separate node process from this
    // API server) and clears its runtime row; the daemon's next sync tick
    // (≤10s) sees the tool is no longer running and respawns it fresh.
    typedSecured.post('/orchestrator/mcp/:toolId/restart', {
      schema: { params: z.object({ toolId: z.string().uuid() }) },
    }, async (req, reply) => {
      const { toolId } = req.params as { toolId: string };

      const res = await query<{ pid: number | null }>(
        `SELECT pid FROM mcp_runtime_state WHERE tool_id = $1`,
        [toolId],
      );
      const row = res.rows[0];
      if (!row) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No runtime state for this tool' } });
      }

      const { pid } = row;
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already dead — fine, we just want it gone either way.
        }
      }

      await query(
        `UPDATE mcp_runtime_state SET status = 'stopped', pid = NULL, updated_at = now() WHERE tool_id = $1`,
        [toolId],
      );

      return reply.code(202).send({ status: 'restarting' });
    });

    // POST /orchestrator/uipath-auth/reset — clears getUiPathToken's success
    // AND negative-failure cache (src/lib/uipathAuth.ts) for a cacheKey (or
    // every key if omitted), so Jandy can force a fresh token fetch right
    // after fixing UIPATH_CLIENT_ID/SECRET without waiting out the 60s
    // credentials negative-cache window or restarting the process.
    typedSecured.post('/orchestrator/uipath-auth/reset', {
      schema: { body: z.object({ cacheKey: z.string().min(1).optional() }).strict().optional() },
    }, async (req, reply) => {
      const body = req.body as { cacheKey?: string } | undefined;
      resetUiPathTokenCache(body?.cacheKey);
      return reply.send({ reset: true, cacheKey: body?.cacheKey ?? 'all' });
    });

    // ── EXECUTOR endpoints (meta-orchestrator: LLM + UiPath + PAD) ──────
    // GET /orchestrator/executors — semua executor terdaftar.
    typedSecured.get('/orchestrator/executors', async (_req, reply) => {
      return reply.send({
        executors: executorRegistry.all().map((e) => e.descriptor),
      });
    });

    // GET /orchestrator/route?step=&type= — introspeksi keputusan router.
    typedSecured.get('/orchestrator/route', {
      schema: {
        querystring: z.object({ step: SAFE_SLUG, type: SAFE_SLUG }).strict(),
      },
    }, async (req, reply) => {
      const q = req.query as { step: string; type: string };
      const decision = explainRoute(q.step, q.type);
      if (!decision) return reply.code(404).send({ error: { code: 'NO_EXECUTOR', message: 'Tidak ada executor cocok' } });
      return reply.send(decision);
    });

    // GET /orchestrator/uipath-jobs — recent uipath_job_trace rows, joined with
    // agent name, for the Robots dashboard (frontend/dashboard/robots). Plain
    // SELECT — this is a simple read, no conditional write-path logic, so no
    // RPC function per the "don't convert simple reads" convention.
    typedSecured.get('/orchestrator/uipath-jobs', {
      schema: {
        querystring: z.object({
          agentId: z.string().uuid().optional(),
          state: z.enum(['Pending', 'Running', 'Successful', 'Faulted', 'Stopped']).optional(),
          sessionLabel: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }).strict(),
      },
    }, async (req, reply) => {
      const q = req.query as { agentId?: string; state?: string; sessionLabel?: string; limit: number };
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (q.agentId) { params.push(q.agentId); conditions.push(`ujt.agent_id = $${params.length}`); }
      if (q.state) { params.push(q.state); conditions.push(`ujt.state = $${params.length}`); }
      if (q.sessionLabel) { params.push(q.sessionLabel); conditions.push(`ujt.session_label = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);
      const res = await query(
        `SELECT ujt.*, a.agent_name
         FROM uipath_job_trace ujt
         LEFT JOIN agents a ON a.agent_id = ujt.agent_id
         ${where}
         ORDER BY ujt.triggered_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return reply.send({ items: res.rows, count: res.rows.length });
    });

    // GET /orchestrator/tools/:toolId/uipath-queue-transactions — row-expand
    // drill-down on the Robots dashboard: live queue items for the queue a
    // given job trace row was associated with.
    typedSecured.get('/orchestrator/tools/:toolId/uipath-queue-transactions', {
      schema: {
        params: z.object({ toolId: z.string().uuid() }).strict(),
        querystring: z.object({ queueName: z.string().min(1), folderId: z.string().optional() }).strict(),
      },
    }, async (req, reply) => {
      const { toolId } = req.params as { toolId: string };
      const { queueName, folderId } = req.query as { queueName: string; folderId?: string };
      try {
        const items = await fetchQueueTransactionsForTool(toolId, queueName, folderId);
        return reply.send({ items });
      } catch (e) {
        return reply.code(502).send({ error: { code: 'UIPATH_QUEUE_FETCH_FAILED', message: e instanceof Error ? e.message : String(e) } });
      }
    });

    // GET /orchestrator/agents/:id/uipath-context — proactive sidebar summary
    // (Part 2.3): processes + queues for every UiPath tool linked to this agent,
    // fetched live through the already-connected MCP client, no LLM turn spent.
    typedSecured.get('/orchestrator/agents/:id/uipath-context', {
      schema: { params: z.object({ id: z.string().uuid() }).strict() },
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const context = await fetchAgentUipathContext(id);
      return reply.send({ agentId: id, tools: context });
    });

    // POST /orchestrator/uipath/folders — one-time "Test & List Folders" call
    // used by the Tools registration form (Part 2.2). Credentials are the
    // request body, never a query string, so they never land in access logs /
    // browser history / proxy logs.
    // SSRF defense (security-audit.md finding #3). Two tiers:
    //  1. If UIPATH_ALLOWED_HOSTS is set, ONLY those exact hostnames pass —
    //     the tightest posture, no private range is implicitly trusted.
    //  2. If it's empty, fall back to a blocklist: block the highest-value SSRF
    //     targets (loopback, link-local, cloud metadata) but still allow private
    //     RFC1918 addresses, since an on-prem UiPath Orchestrator legitimately
    //     lives on an internal IP. Not a full DNS-rebinding defense.
    const allowedHosts = (appEnv.UIPATH_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);
    const assertSafeOutboundHost = (rawUrl: string): void => {
      const host = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (allowedHosts.length > 0) {
        if (!allowedHosts.includes(host)) {
          throw new DomainError('UNSAFE_URL', 'baseUrl menunjuk ke host yang tidak ada di allowlist', 400);
        }
        return;
      }
      const blockedNames = ['localhost', '0.0.0.0', '::1', 'metadata.google.internal', '100.100.100.200'];
      const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
      const isLoopback = m && m[1] === '127';
      const isLinkLocal = m && m[1] === '169' && m[2] === '254'; // covers 169.254.169.254
      if (blockedNames.includes(host) || host.endsWith('.localhost') || isLoopback || isLinkLocal) {
        throw new DomainError('UNSAFE_URL', 'baseUrl menunjuk ke alamat yang tidak diizinkan', 400);
      }
    };

    typedSecured.post('/orchestrator/uipath/folders', {
      schema: {
        body: z.object({
          clientId: z.string().min(1),
          clientSecret: z.string().min(1),
          baseUrl: z.string().url().default('https://cloud.uipath.com'),
          org: z.string().min(1),
          tenant: z.string().min(1),
        }).strict(),
      },
    }, async (req, reply) => {
      const b = req.body as { clientId: string; clientSecret: string; baseUrl: string; org: string; tenant: string };
      assertSafeOutboundHost(b.baseUrl);
      try {
        const tokenRes = await fetch(`${b.baseUrl}/identity_/connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: b.clientId,
            client_secret: b.clientSecret,
            scope: 'OR.Folders.Read',
          }).toString(),
        });
        const tokenText = await tokenRes.text();
        // Don't reflect the upstream body to the client — it would turn this
        // into an SSRF oracle. Log server-side, return status only. (audit #3)
        if (!tokenRes.ok) {
          req.log.warn({ status: tokenRes.status, body: tokenText.slice(0, 300) }, 'UiPath folder-test OAuth failed');
          return reply.code(502).send({ error: { code: 'UIPATH_AUTH_FAILED', message: `UiPath OAuth2 gagal (status ${tokenRes.status})` } });
        }
        const { access_token } = JSON.parse(tokenText) as { access_token: string };

        const foldersRes = await fetch(`${b.baseUrl}/${b.org}/${b.tenant}/orchestrator_/odata/Folders`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const foldersText = await foldersRes.text();
        req.log.info({ status: foldersRes.status }, 'UiPath Folders response');
        if (!foldersRes.ok) {
          req.log.warn({ status: foldersRes.status, body: foldersText.slice(0, 300) }, 'UiPath Folders failed');
          return reply.code(502).send({ error: { code: 'UIPATH_FOLDERS_FAILED', message: `UiPath Folders gagal (status ${foldersRes.status})` } });
        }
        const data = JSON.parse(foldersText) as { value?: Array<{ Id: number; FullyQualifiedName?: string; DisplayName?: string }> };
        const folders = (data.value ?? []).map((f) => ({ id: String(f.Id), fullyQualifiedName: f.FullyQualifiedName ?? f.DisplayName ?? String(f.Id) }));
        return reply.send({ folders });
      } catch (e) {
        req.log.warn({ err: e }, 'UiPath folder-test request failed');
        return reply.code(502).send({ error: { code: 'UIPATH_REQUEST_FAILED', message: 'Gagal menghubungi UiPath' } });
      }
    });

    // POST /orchestrator/autofill/suggest — Magic Pen: LLM-generated
    // suggestion for a single Agent Creator form field, given the other
    // fields already filled in as context. The frontend always shows this
    // as an editable suggestion — never auto-applies it.
    typedSecured.post('/orchestrator/autofill/suggest', {
      schema: { body: AutofillSuggestSchema },
    }, async (req, reply) => {
      const body = req.body as z.infer<typeof AutofillSuggestSchema>;
      const value = await suggestFieldValue(body);
      return reply.send({ value });
    });

    // POST /orchestrator/chat/recommendations — 2-4 tappable follow-up
    // suggestions shown after an assistant turn. suggestFollowUps() never
    // throws (fails quietly to []), so this route can't break the chat flow.
    typedSecured.post('/orchestrator/chat/recommendations', {
      schema: { body: ChatRecommendationsSchema },
    }, async (req, reply) => {
      const body = req.body as z.infer<typeof ChatRecommendationsSchema>;
      const suggestions = await suggestFollowUps(body.conversationTail);
      return reply.send({ suggestions });
    });

    // POST /orchestrator/chat/title — real LLM-generated 3-4 word chat
    // title, replacing the old client-side truncation of the first message.
    typedSecured.post('/orchestrator/chat/title', {
      schema: { body: ChatTitleSchema },
    }, async (req, reply) => {
      const body = req.body as z.infer<typeof ChatTitleSchema>;
      const title = await suggestChatTitle(body.messages);
      return reply.send({ title });
    });

    // POST /orchestrator/dispatch — jalankan step saat ini via executor terpilih.
    typedSecured.post('/orchestrator/dispatch', {
      schema: { body: RunAgenticSchema },
    }, async (req, reply) => {
      const body = req.body as { transactionId: string; idempotencyKey: string };
      const result = await dispatchCurrentStep(req.auth!, body.transactionId, body.idempotencyKey);
      return reply.send(result);
    });

    // ─── RAG (pgvector) — port of legacy microservice/rag/routes/rag.py ──
    // File bytes are treated as UTF-8 text (no PDF/DOCX extraction) and
    // chunked with simple fixed-size+overlap (ragClient.ts chunkText) —
    // matches feature.md's explicit non-goal of a sophisticated chunker.
    // Files themselves live on local disk (lib/ragStorage.ts), since no
    // object-storage client exists elsewhere in this on-prem-only repo.

    // POST /orchestrator/rag/upload_file — heading-aware ingestion with metadata
    secured.post('/orchestrator/rag/upload_file', { config: llmRateLimit }, async (req, reply) => {
      const data = await req.file();
      if (!data) {
        throw new DomainError('VALIDATION_ERROR', 'file wajib disertakan (multipart field "file")', 400);
      }
      const buffer = await data.toBuffer();
      const userIdField = data.fields.user_id as { value?: string } | undefined;

      const fileId = await saveFile(buffer);
      const result = await ingestDocumentSmart(fileId, userIdField?.value ?? null, buffer, data.filename);
      return reply.code(201).send({ file_id: fileId, filename: data.filename, chunks: result.chunks, doc_title: result.docTitle });
    });

    // PUT /orchestrator/rag/update_file — full swap: replace stored bytes,
    // drop old chunks for file_id, re-chunk/re-embed.
    secured.put('/orchestrator/rag/update_file', async (req, reply) => {
      const data = await req.file();
      if (!data) {
        throw new DomainError('VALIDATION_ERROR', 'file wajib disertakan (multipart field "file")', 400);
      }
      const fileIdField = data.fields.file_id as { value?: string } | undefined;
      const fileId = fileIdField?.value;
      if (!fileId) {
        throw new DomainError('VALIDATION_ERROR', 'file_id wajib disertakan sebagai form field', 400);
      }
      const buffer = await data.toBuffer();
      const userIdField = data.fields.user_id as { value?: string } | undefined;

      await replaceFile(fileId, buffer);
      await deleteFileChunks([fileId]);
      const result = await ingestDocumentSmart(fileId, userIdField?.value ?? null, buffer, data.filename);
      return reply.send({ file_id: fileId, chunks: result.chunks, doc_title: result.docTitle });
    });

    // DELETE /orchestrator/rag/remove_file
    typedSecured.delete('/orchestrator/rag/remove_file', {
      schema: { body: RagRemoveFileSchema },
    }, async (req, reply) => {
      const { file_ids } = req.body as z.infer<typeof RagRemoveFileSchema>;
      await deleteStoredFiles(file_ids);
      await deleteFileChunks(file_ids);
      return reply.code(204).send();
    });

    // POST /orchestrator/rag/query — hybrid retrieval + generation with citations
    typedSecured.post('/orchestrator/rag/query', {
      schema: { body: RagQuerySchema },
      config: llmRateLimit,
    }, async (req, reply) => {
      const { query: userQuery, history } = req.body as z.infer<typeof RagQuerySchema>;
      const result = await generateRagResponse(userQuery, undefined, history);
      if (typeof result === 'string') {
        return reply.send({ query: userQuery, response: result });
      }
      return reply.send({
        query: userQuery,
        response: result.answer,
        citations: result.citations,
        fallback: result.fallback,
        confident: result.retrieval.confident,
        top_similarity: result.retrieval.topSimilarity,
        decomposed: result.retrieval.decomposed,
        multi_hop_query: result.retrieval.multiHopQuery,
      });
    });

    // POST /orchestrator/rag/feedback — user feedback on retrieval quality
    typedSecured.post('/orchestrator/rag/feedback', {
      schema: {
        body: z.object({
          log_id: z.string().uuid(),
          feedback: z.number().int().min(-1).max(1),
        }).strict(),
      },
    }, async (req, reply) => {
      const { log_id, feedback } = req.body as { log_id: string; feedback: number };
      await submitFeedback(log_id, feedback);
      return reply.code(204).send();
    });

    // GET /orchestrator/rag/threshold — adaptive threshold from feedback data
    secured.get('/orchestrator/rag/threshold', async (_req, reply) => {
      const threshold = await getAdaptiveThreshold();
      return reply.send({ threshold, default: appEnv.RAG_MIN_SIMILARITY });
    });
  });
}
