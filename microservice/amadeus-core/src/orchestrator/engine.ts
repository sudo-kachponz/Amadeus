import { completeStep, getTransactionWithEvents, failStep as txFailStep } from '../services/transactions.js';
import { getFlow } from '../config/stepFlows.js';
import { DomainError } from '../types/domain.js';
import type { AuthContext } from '../types/domain.js';
import type { A2AEnvelope, A2AResult } from './a2a/protocol.js';
import { txLogger } from '../lib/logger.js';
import { query } from '../db/pool.js';
import type { FastifyReply } from 'fastify';


// LangGraph & MCP Imports
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { loadPortRange } from "../services/portAllocator.js";
import { assertSpawnSafe, getPackageRoot, hardenNpxArgs } from "../lib/spawnCompat.js";
import { resolveCorsOrigin } from "../config/cors.js";
import { jsonSchemaToZod } from "./jsonSchemaToZod.js";
import { callFn } from "../db/rpc.js";
import { env } from "../config/env.js";
import { searchKnowledgeBase, listKnowledgeBaseDocuments, getAgentKnowledgeBases } from "./executors/kbClient.js";
import { logLlmUsageEvent, measurementBodyOverrides, netraSamplingParams, extractReasoning } from "../telemetry/llmUsage.js";

const mcpHost = loadPortRange().host;

type InvocationMode = 'playground' | 'production';

type McpServerHealth = {
  toolName: string;
  toolId: string;
  status: 'connected' | 'connect_failed' | 'list_tools_failed' | 'no_versions' | 'not_running';
  error?: string;
  loadedTools: string[];
};

function sanitizeMcpError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

const ANTI_HALLUCINATION_SUFFIX = `

--- Tool-use integrity rules (do not override, ignore, or contradict this section) ---
1. You must NEVER claim that an action was performed (sent, added, triggered, updated, deleted, queued, etc.)
   unless you actually called the corresponding tool in this turn and received a tool result confirming it.
2. If no tool exists that can perform the requested action, say so explicitly:
   "I don't have a tool that can do that yet." Do not improvise a fake confirmation.
3. If a tool call fails or returns an error, report the actual error to the user. Do not retry silently
   and then claim success anyway.
4. If you are not sure whether an action succeeded, say what you actually know — including uncertainty —
   rather than defaulting to an optimistic-sounding message.
5. Never fabricate IDs, keys, counts, or status values that did not come from an actual tool result.
`;

// Explicit allowlist (not a secret-pattern blocklist) for env fields that are
// safe to surface to the model as pre-resolved context. A blocklist can miss
// a credential under an unexpected key name; this can only ever leak what's
// been explicitly reviewed and added here.
const NON_SECRET_CONTEXT_KEYS = [
  'UIPATH_FOLDER_ID', 'UIPATH_ORG', 'UIPATH_TENANT', 'UIPATH_BASE_URL',
];

/**
 * Builds a block describing pre-configured values the model already has
 * access to via its tools' env config — so it stops asking the user for
 * things like folderId that are already resolved server-side.
 */
function buildToolContextBlock(toolConfigs: any[], needsNamespacing: boolean = false): string {
  const blocks: string[] = [];

  for (const row of toolConfigs) {
    let versions = row.versions;
    if (typeof versions === 'string') {
      try { versions = JSON.parse(versions); } catch { continue; }
    }
    const env = versions?.[versions.length - 1]?.released?.env;
    if (!env) continue;

    const contextFields: string[] = [];
    for (const key of NON_SECRET_CONTEXT_KEYS) {
      if (env[key]) contextFields.push(`${key}: ${env[key]}`);
    }

    if (contextFields.length > 0) {
      blocks.push(`Tool "${row.name}": ${contextFields.join(', ')} — already configured, use these automatically, do NOT ask the user for them.`);
    }
  }

  let result = blocks.length === 0 ? '' : (
    `\n\n--- Pre-configured context for this agent's tools ---\n` +
    blocks.join('\n') +
    `\nUse these values automatically when calling tools. Only ask the user if a tool call ` +
    `explicitly fails due to one of these values being wrong (e.g. a folder-access error) — ` +
    `never ask preemptively for something listed above.\n`
  );

  // Only injected when loadMcpTools() actually namespaced tool names (more
  // than one tool config attached) — a single-server agent's prompt stays
  // untouched.
  if (needsNamespacing) {
    result += `\n\n--- Multi-server tool naming ---\n` +
      `Catatan: agent ini terhubung ke lebih dari satu MCP server dengan tool yang mirip ` +
      `namanya. Prefix sebelum "__" menunjukkan sumbernya — misalnya ` +
      `"uipath_folder_a__trigger_uipath_job" adalah tool trigger_uipath_job dari server ` +
      `"UiPath Folder A", BUKAN dari server lain. Selalu perhatikan prefix ini untuk ` +
      `memastikan kamu memanggil server yang benar.\n`;
  }

  return result;
}

function buildSystemPrompt(agentStyle: string | null | undefined, toolContext: string): string {
  const base = agentStyle?.trim() || "You are a helpful assistant.";
  return `${base}${toolContext}\n${ANTI_HALLUCINATION_SUFFIX}`;
}

/**
 * Bounds a single runAgenticStep invoke/stream call to a hard wall-clock
 * ceiling, paired with recursionLimit so a stuck multi-step UiPath chain
 * can't hold a connection or burn tokens indefinitely. Races the caller's
 * promise against a timeout rejection — this stops the caller from waiting
 * past `ms`, it does not abort the underlying LangGraph call in-flight.
 */
function withWallClockTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DomainError('AGENT_TIMEOUT', `${label} exceeded the ${ms}ms wall-clock timeout`, 504));
    }, ms);
    fn().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** 1 initial attempt + 3 retries with exponential backoff (200ms, 600ms, 1800ms). */
async function withMcpRetry<T>(fn: () => Promise<T>): Promise<T> {
  const backoffMs = [200, 600, 1800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < backoffMs.length) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }
  throw lastErr;
}

/**
 * Inti orchestrator (Layer 2/3).
 *
 * Menerima A2A envelope dari agent/robot, menerjemahkannya ke operasi state
 * tracker, dan menghitung HANDOFF: step berikutnya + siapa (hint) yang mengambil.
 */
export async function handleA2A(
  auth: AuthContext,
  env: A2AEnvelope,
): Promise<A2AResult> {
  const log = txLogger(env.transactionId);

  if (env.protocol !== 'amadeus.a2a/0') {
    throw new DomainError('PROTOCOL_UNSUPPORTED', `Protokol tidak didukung: ${env.protocol}`, 400);
  }

  switch (env.type) {
    case 'task.complete':
      return completeAndHandoff(auth, env, log);
    case 'task.failed':
      return failStepFromEnvelope(auth, env, log);
    case 'task.status':
      return statusOf(env);
    case 'task.assign':
      return statusOf(env);
    default:
      throw new DomainError('BAD_MESSAGE_TYPE', `Tipe pesan A2A tidak dikenal`, 400);
  }
}

async function completeAndHandoff(
  auth: AuthContext,
  env: A2AEnvelope,
  log: ReturnType<typeof txLogger>,
): Promise<A2AResult> {
  const result = await completeStep(auth, env.transactionId, {
    step: env.step,
    idempotencyKey: env.idempotencyKey,
    reason: env.reason,
    payload: env.data,
    targetStep: env.targetStep,
  });

  const flow = getFlow(result.transaction.type);
  const nextStep = result.transaction.status === 'completed'
    ? null
    : flow?.steps[result.transaction.current_step]
      ? result.transaction.current_step
      : null;
  const nextActorHint = nextStep ? (flow?.steps[nextStep]?.actorHint ?? null) : null;

  log.info(
    { correlationId: env.correlationId, nextStep, nextActorHint },
    'A2A handoff computed',
  );

  return {
    accepted: true,
    transactionId: result.transaction.id,
    currentStep: result.transaction.current_step,
    status: result.transaction.status,
    nextStep,
    nextActorHint,
    idempotentReplay: result.idempotentReplay,
  };
}

export async function computeHandoffAfterTaskCompletion(
  auth: AuthContext,
  transactionId: string,
  taskId: string,
  step: string,
  correlationId: string,
  data?: Record<string, unknown>
): Promise<A2AResult> {
  const log = txLogger(transactionId);
  const result = await completeStep(auth, transactionId, {
    step,
    idempotencyKey: `task-completion-${taskId}`,
    payload: data,
  });

  const flow = getFlow(result.transaction.type);
  const nextStep = result.transaction.status === 'completed'
    ? null
    : flow?.steps[result.transaction.current_step]
      ? result.transaction.current_step
      : null;
  const nextActorHint = nextStep ? (flow?.steps[nextStep]?.actorHint ?? null) : null;

  log.info(
    { correlationId, nextStep, nextActorHint },
    'A2A handoff computed from task completion',
  );

  return {
    accepted: true,
    transactionId: result.transaction.id,
    currentStep: result.transaction.current_step,
    status: result.transaction.status,
    nextStep,
    nextActorHint,
    idempotentReplay: result.idempotentReplay,
  };
}

// A2A-envelope adapter over the authoritative domain op (transactions.ts
// failStep, imported as txFailStep). NOT a second implementation — it unwraps
// the A2AEnvelope, delegates, and re-wraps the result as an A2AResult. Renamed
// from failStep to remove the misleading name collision. (refactor FASE 3 D2)
async function failStepFromEnvelope(
  auth: AuthContext,
  env: A2AEnvelope,
  log: ReturnType<typeof txLogger>,
): Promise<A2AResult> {
  if (!env.reason) {
    throw new DomainError('REASON_REQUIRED', 'task.failed wajib menyertakan reason', 422);
  }

  const result = await txFailStep(auth, env.transactionId, {
    step: env.step,
    idempotencyKey: env.idempotencyKey,
    reason: env.reason,
    payload: env.data,
  });

  return {
    accepted: true,
    transactionId: result.transaction.id,
    currentStep: result.transaction.current_step,
    status: result.transaction.status,
    nextStep: result.transaction.current_step,
    nextActorHint: null,
    idempotentReplay: result.idempotentReplay,
  };
}

async function statusOf(env: A2AEnvelope): Promise<A2AResult> {
  const { transaction } = await getTransactionWithEvents(env.transactionId);
  const flow = getFlow(transaction.type);
  const nextActorHint =
    flow?.steps[transaction.current_step]?.actorHint ?? null;
  return {
    accepted: true,
    transactionId: transaction.id,
    currentStep: transaction.current_step,
    status: transaction.status,
    nextStep: transaction.status === 'completed' ? null : transaction.current_step,
    nextActorHint,
    idempotentReplay: false,
  };
}

/**
 * Pulls the structured job-trace side channel off a tool result's `_meta`
 * (attached server-side by mcp-uipath, never part of `content` — so it never
 * reaches the LLM's context). Only trigger_uipath_job/get_uipath_job_status/
 * wait_for_uipath_job carry a jobId, which is what uipath_job_trace is keyed on; queue-item tools
 * have no job to key a NOT-NULL/UNIQUE job_id column on, so they're not wired
 * into this table.
 */
export function extractJobTraceMeta(
  toolName: string,
  meta: Record<string, unknown> | undefined,
): { jobId: string; jobKey: string | null; releaseKey: string | null; folderId: string | null; state: string; info: string | null } | null {
  if (!meta) return null;
  if (toolName !== 'trigger_uipath_job' && toolName !== 'get_uipath_job_status' && toolName !== 'wait_for_uipath_job') return null;
  const jobId = meta.jobId;
  if (typeof jobId !== 'string' || !jobId) return null;
  return {
    jobId,
    jobKey: typeof meta.jobKey === 'string' ? meta.jobKey : null,
    releaseKey: typeof meta.releaseKey === 'string' ? meta.releaseKey : null,
    folderId: typeof meta.folderId === 'string' ? meta.folderId : null,
    state: typeof meta.state === 'string' && meta.state ? meta.state : 'Pending',
    info: typeof meta.info === 'string' ? meta.info : null,
  };
}

/**
 * Sanitizes a tool registration's human label into a namespace prefix safe
 * for use in a LangChain tool name (models are picky about tool name charsets).
 */
function sanitizeToolPrefix(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40); // keep it bounded — very long tool names are unwieldy for the model
}

/**
 * MCP Integration: Loads tools dynamically for the LangGraph Agent.
 * This also implements the STATE TRACKING constraint by wrapping tool execution.
 */
async function loadMcpTools(
  toolConfigs: any[],
  log: ReturnType<typeof txLogger>,
  agentId?: string,
  sessionLabel?: string,
): Promise<{ tools: any[]; clients: Client[]; report: McpServerHealth[]; needsNamespacing: boolean }> {
  const langchainTools: any[] = [];
  const clients: Client[] = [];
  const report: McpServerHealth[] = [];

  // Two attached tool registrations can expose identically-named MCP tools
  // (e.g. two mcp-uipath instances pointed at different orgs/tenants both
  // register `trigger_uipath_job`). Merged into one flat langchainTools
  // array, those collide and the model can't address one specifically.
  // Only prefix when there's more than one tool config attached — a
  // single-tool agent (the common case) keeps unprefixed names exactly as
  // before, so this is non-breaking for every existing agent.
  const needsNamespacing = toolConfigs.length > 1;

  for (const config of toolConfigs) {
    const toolName: string = config.name || 'unknown';
    const toolId: string = config.tool_id || '';
    const namePrefix = needsNamespacing ? `${sanitizeToolPrefix(toolName)}__` : '';

    if (config.on_status === "Offline" || config.on_status === false) {
      report.push({ toolName, toolId, status: 'no_versions', error: 'Tool is Offline', loadedTools: [] });
      continue;
    }

    let versions = config.versions;
    if (typeof versions === "string") {
      try { versions = JSON.parse(versions); } catch (e) { }
    }

    if (!versions || versions.length === 0) {
      report.push({ toolName, toolId, status: 'no_versions', error: 'No versions configured', loadedTools: [] });
      continue;
    }
    const release = versions[versions.length - 1]?.released;
    if (!release) {
      report.push({ toolName, toolId, status: 'no_versions', error: 'No released config', loadedTools: [] });
      continue;
    }

    // Legacy rows may still have `args` as a single concatenated string and
    // no `command` (the exact shape that caused bugfix1.md Bug 1). Do NOT
    // silently fall back to an empty args array here — for stdio that spawns
    // a bare `node` process with no script, which hangs forever waiting for
    // an MCP handshake that will never come. Fail fast instead.
    if (typeof release.args === 'string' || !release.command) {
      report.push({
        toolName,
        toolId,
        status: 'connect_failed',
        error: 'Legacy args string detected — re-save this tool via /tools to migrate to the structured {command, args[]} format',
        loadedTools: [],
      });
      continue;
    }

    if (release.method !== "sse" && release.method !== "stdio") {
      report.push({ toolName, toolId, status: 'no_versions', error: 'Unsupported or missing transport method', loadedTools: [] });
      continue;
    }

    // Security: the stdio transport spawns release.command directly (via the
    // SDK's StdioClientTransport). That command/args come from DB tool config
    // (set via /tools) and must pass the SAME allowlist mcpAutoManager uses —
    // otherwise a tenant could register an arbitrary command and get RCE on
    // this host (security-audit.md #1). Fail closed on a non-allowlisted cmd.
    if (release.method === "stdio") {
      try {
        assertSpawnSafe(release.command, Array.isArray(release.args) ? release.args : []);
      } catch (e) {
        report.push({ toolName, toolId, status: 'connect_failed', error: sanitizeMcpError(e), loadedTools: [] });
        continue;
      }
    }

    // For SSE, the only source of truth for "where is this tool actually
    // listening right now" is mcp_runtime_state — it's written exclusively by
    // the process manager that spawned (or failed to spawn) this exact
    // process. tools.versions[...].released.port is legacy/display only and
    // must never be used to build a connection URL.
    let ssePort: number | null = null;
    if (release.method === "sse") {
      // Marks the tool as recently used (mcpAutoManager.ts's MCP_IDLE_TIMEOUT_MS
      // sweep reads this) and, if it was previously idle-stopped, signals the
      // manager's next sync tick to respawn it — see fn_touch_mcp_runtime.sql.
      await callFn('fn_touch_mcp_runtime', [toolId]).catch(() => {});

      const runtime = await query<{ port: number | null; status: string; last_error: string | null }>(
        `SELECT port, status, last_error FROM mcp_runtime_state WHERE tool_id = $1`,
        [toolId],
      );
      let row = runtime.rows[0];

      // SSE Ready-Wait: give mcpAutoManager.ts a grace period instead of
      // immediately failing the agent invoke. 'starting' = already mid-spawn,
      // usually ready within ~1-2s. A 'stopped' row is only worth waiting on
      // when last_error marks it as idle-stopped (see IDLE_STOP_REASON in
      // mcpAutoManager.ts) — the touch above just asked the manager to wake
      // it, which takes up to its ~10s sync tick plus startup time. A
      // 'stopped'/'crashed' tool for any other reason should still fail
      // fast, unchanged from today.
      const isWakingFromIdle = row?.status === 'stopped' && row.last_error === 'idle-timeout';
      for (
        let attempt = 0;
        (row?.status === 'starting' || (attempt === 0 && isWakingFromIdle)) && attempt < 4;
        attempt++
      ) {
        await new Promise((r) => setTimeout(r, isWakingFromIdle ? 3000 : 1000));
        const retry = await query<{ port: number | null; status: string; last_error: string | null }>(
          `SELECT port, status, last_error FROM mcp_runtime_state WHERE tool_id = $1`,
          [toolId],
        );
        row = retry.rows[0];
      }

      if (!row || row.status !== 'running' || !row.port) {
        report.push({ toolName, toolId, status: 'not_running', error: 'SSE server is not currently running', loadedTools: [] });
        continue;
      }
      ssePort = row.port;
    }

    const buildTransport = () => {
      if (release.method === "sse") {
        const url = `http://${mcpHost}:${ssePort}/sse`;
        return new SSEClientTransport(new URL(url));
      }
      if (release.method === "stdio") {
        // No Windows-specific handling needed here: StdioClientTransport spawns
        // via the SDK's own `cross-spawn` dependency (see
        // node_modules/@modelcontextprotocol/sdk .../client/stdio.js), which
        // already resolves .cmd/.bat shims (npx/npm) correctly cross-platform.
        return new StdioClientTransport({
          command: release.command || "node",
          // Harden npx + pin cwd, same as mcpAutoManager (security-audit.md #1, A2).
          args: hardenNpxArgs(release.command || "node", Array.isArray(release.args) ? release.args : []),
          env: { ...process.env, ...(release.env || {}) },
          cwd: getPackageRoot(),
        });
      }
      return null;
    };

    // The SDK's Client throws "Already connected to a transport" if connect()
    // is called twice on the same instance — even after a failed attempt. So
    // each retry attempt must build a brand new Client + transport pair.
    let mcpClient: Client;
    try {
      mcpClient = await withMcpRetry(async () => {
        const client = new Client({ name: "amadeus-orchestrator", version: "2.0.0" });
        const attemptTransport = buildTransport()!;
        await client.connect(attemptTransport);
        return client;
      });
    } catch (e) {
      log.warn({ toolConfig: config.name, error: e }, `[MCP] Failed to connect to tool server`);
      report.push({ toolName, toolId, status: 'connect_failed', error: sanitizeMcpError(e), loadedTools: [] });
      continue;
    }

    // Only track the client for cleanup once it's actually connected.
    clients.push(mcpClient);

    try {
      const { tools: mcpTools } = await withMcpRetry(() => mcpClient.listTools());
      const loadedNames: string[] = [];

      for (const mcpTool of mcpTools) {
        loadedNames.push(mcpTool.name);
        // The MCP server's listTools() response carries the tool's real input
        // contract in inputSchema. Bind against that instead of a blanket
        // passthrough — without it, models get zero structural guidance and
        // guess at parameter names/shapes (see jsonah.md for the failure mode).
        const realSchema = mcpTool.inputSchema
          ? jsonSchemaToZod(mcpTool.inputSchema)
          : z.record(z.any()); // fallback only if the server genuinely provides no schema
        log.debug(
          { tool: mcpTool.name, schema: (realSchema as any).shape ? Object.keys((realSchema as any).shape) : 'passthrough' },
          'MCP tool schema bound',
        );
        // Prefixed name is what the LLM sees and calls; the underlying MCP
        // callTool() below must keep using mcpTool.name (unprefixed) — that's
        // the only name the actual MCP server understands.
        const langchainToolName = `${namePrefix}${mcpTool.name}`;
        langchainTools.push(
          new DynamicStructuredTool({
            name: langchainToolName,
            description: needsNamespacing
              ? `[${toolName}] ${mcpTool.description || "MCP Tool"}`
              : (mcpTool.description || "MCP Tool"),
            schema: realSchema,
            func: async (args: any) => {
              // 1. Transaction Tracker Integration: Update state BEFORE tool yields
              log.info({ tool: mcpTool.name, prefixedName: langchainToolName, action: "DRAFT_TO_PROCESSING" }, "🔌 Yielding to external MCP tool");

              // 2. Execute MCP Server logic
              const res = await mcpClient.callTool({
                name: mcpTool.name,
                arguments: args
              });

              // 3. Transaction Tracker Integration: Update state AFTER tool yields
              log.info({ tool: mcpTool.name, action: "PROCESSING_TO_AWAITING_CALLBACK" }, "🔌 External MCP tool completed");

              // UiPath job trace write-back: reads only res._meta (never res.content),
              // so this can never leak into what the LLM sees.
              const trace = extractJobTraceMeta(mcpTool.name, (res as any)._meta as Record<string, unknown> | undefined);
              if (trace) {
                try {
                  await callFn('fn_upsert_uipath_job_trace', [
                    agentId ?? null,
                    toolId || null,
                    sessionLabel ?? null,
                    trace.jobId,
                    trace.jobKey,
                    trace.releaseKey,
                    null, // process_name — not available from trigger/status responses
                    trace.folderId,
                    null, // queue_name — not available from trigger/status responses
                    trace.state,
                    trace.info,
                  ]);
                } catch (e) {
                  log.warn({ err: e, jobId: trace.jobId }, 'Failed to persist uipath_job_trace');
                }
              }

              return (res as any).content.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c)).join("\n");
            },
          })
        );
      }
      report.push({ toolName, toolId, status: 'connected', loadedTools: loadedNames });
    } catch (e) {
      log.warn({ toolConfig: config.name, error: e }, `[MCP] Failed to list tools from server`);
      report.push({ toolName, toolId, status: 'list_tools_failed', error: sanitizeMcpError(e), loadedTools: [] });
    }
  }

  // Only fall back to a noop tool when the agent has NO tools registered on
  // purpose (pure chat agent). If tools WERE registered but all failed to
  // connect, the caller must fail loud (NO_TOOLS_AVAILABLE) instead of
  // silently degrading to a useless placeholder.
  if (toolConfigs.length === 0) {
    langchainTools.push(
      new DynamicStructuredTool({
        name: "noop_tool",
        description: "A placeholder tool since no real tools are attached.",
        schema: z.object({}),
        func: async () => "No operations available.",
      })
    );
  }

  return { tools: langchainTools, clients, report, needsNamespacing };
}

/**
 * Builds KB tools for an agent: search + list documents.
 * Returns empty array when the agent has no knowledge bases attached.
 */
async function loadKnowledgeBaseTools(agentId: string): Promise<DynamicStructuredTool[]> {
  const kbs = await getAgentKnowledgeBases(agentId);
  if (kbs.length === 0) return [];

  const kbList = kbs.map((kb) => `${kb.kb_id} (${kb.name})`).join(', ');

  return [
    new DynamicStructuredTool({
      name: "search_knowledge_base",
      description:
        `Search this agent's attached knowledge base(s) for relevant reference entries ` +
        `(e.g. SDN/sanctions list, high-risk country list, sanctioned bank list). ` +
        `Call this once per party name detected in the transaction message before giving a verdict. ` +
        `Available kb_id values: ${kbList}.`,
      schema: z.object({
        query: z.string().describe("The party name or term to look up in the knowledge base"),
        kb_id: z.string().describe("Which attached knowledge base to search"),
      }),
      func: async ({ query: searchQuery, kb_id }: { query: string; kb_id: string }) => {
        const results = await searchKnowledgeBase(kb_id, searchQuery);
        if (results.length === 0) return `No matches found in knowledge base ${kb_id} for "${searchQuery}".`;
        return results
          .map((r) => `[${r.filename}] (relevance ${r.rank.toFixed(3)}) ${r.snippet}`)
          .join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: "list_knowledge_base_documents",
      description:
        `List all documents stored in a knowledge base. Use this to see what reference data is available ` +
        `before searching. Available kb_id values: ${kbList}.`,
      schema: z.object({
        kb_id: z.string().describe("Which knowledge base to list documents from"),
      }),
      func: async ({ kb_id }: { kb_id: string }) => {
        const docs = await listKnowledgeBaseDocuments(kb_id);
        if (docs.length === 0) return `No documents found in knowledge base ${kb_id}.`;
        return docs
          .map((d) => `- ${d.filename} [${d.file_type}] (${d.status}, ${d.text_length} chars)`)
          .join('\n');
      },
    }),
  ];
}

export type UipathContextSummary = {
  toolId: string;
  toolName: string;
  processes: string[];
  queues: { name: string; pendingCount: number | null; logs?: string }[];
  recentJobs?: { id: string; key: string; processName: string; state: string; createdAt: string; logs?: string }[];
  agentLogs?: string;
  error?: string;
  /** Set when `error` is an OAuth failure classified by mcp-uipath's getUiPathToken
   * (see amadeus-uipath-mcp's formatAuthError) — lets the frontend show "network"
   * vs "credentials" at a glance instead of the raw "Auth failed: fetch failed" string. */
  authFailureCause?: 'network' | 'credentials' | 'server' | 'rate_limit';
};

/**
 * mcp-uipath's tool handlers emit "Auth failed (network): ..." / "Auth failed
 * (credentials): ..." etc. (via its formatAuthError helper) when getUiPathToken
 * throws a classified error. Parses that prefix back out so it can ride along
 * as a structured field instead of being buried in a free-text error string.
 */
function extractAuthFailureCause(message: string): UipathContextSummary['authFailureCause'] {
  const m = /Auth failed \((network|credentials|server|rate_limit)\)/.exec(message);
  return m ? (m[1] as UipathContextSummary['authFailureCause']) : undefined;
}

/**
 * Connects a short-lived MCP client to a single tool row (SSE via its
 * currently-live mcp_runtime_state port, or stdio spawned fresh) — the same
 * connect logic loadMcpTools() uses per tool, factored out so one-off reads
 * (context panel, dashboard drill-down) don't need a full agent run. Caller
 * owns closing the returned client.
 */
export async function connectToMcpToolById(toolId: string, clientName: string): Promise<Client> {
  const toolRes = await query<any>('SELECT * FROM tools WHERE tool_id = $1', [toolId]);
  const toolRow = toolRes.rows[0];
  if (!toolRow) throw new Error('Tool not found');

  let versions = toolRow.versions;
  if (typeof versions === 'string') {
    try { versions = JSON.parse(versions); } catch { /* falls through to the release check below */ }
  }
  const release = versions?.[versions.length - 1]?.released;
  if (!release || typeof release.args === 'string' || !release.command || (release.method !== 'sse' && release.method !== 'stdio')) {
    throw new Error('Tool not connectable (unsupported/legacy config)');
  }

  // Same allowlist gate as loadMcpTools() (see the assertSpawnSafe call in that
  // fn) — this is the THIRD stdio spawn call site (recipe executor, context
  // panel, robots dashboard all reach it) and without this check it is a direct
  // bypass of finding #1's allowlist. Fail closed on a non-allowlisted command.
  if (release.method === 'stdio') {
    assertSpawnSafe(release.command, Array.isArray(release.args) ? release.args : []);
  }

  let ssePort: number | null = null;
  if (release.method === 'sse') {
    // See fn_touch_mcp_runtime.sql: marks recent use (resets the idle-timeout
    // clock) and wakes an idle-stopped tool on the manager's next sync tick.
    // No ready-wait here (unlike loadMcpTools' SSE branch) — this path backs
    // a frequently-polled one-off read, so a wake-in-progress just resolves
    // on a later poll instead of blocking this call.
    await callFn('fn_touch_mcp_runtime', [toolId]).catch(() => {});

    const runtime = await query<{ port: number | null; status: string }>(
      `SELECT port, status FROM mcp_runtime_state WHERE tool_id = $1`,
      [toolId],
    );
    const row = runtime.rows[0];
    if (!row || row.status !== 'running' || !row.port) throw new Error('SSE server is not currently running');
    ssePort = row.port;
  }

  // No Windows-specific handling needed: StdioClientTransport spawns via the
  // SDK's own `cross-spawn` dependency, which already resolves .cmd/.bat
  // shims (npx/npm) correctly cross-platform.
  const buildTransport = () =>
    release.method === 'sse'
      ? new SSEClientTransport(new URL(`http://${mcpHost}:${ssePort}/sse`))
      : new StdioClientTransport({
          command: release.command || 'node',
          // Harden npx + pin cwd, same as mcpAutoManager (security-audit.md #1, A2).
          args: hardenNpxArgs(release.command || 'node', Array.isArray(release.args) ? release.args : []),
          env: { ...process.env, ...(release.env || {}) },
          cwd: getPackageRoot(),
        });

  return withMcpRetry(async () => {
    const c = new Client({ name: clientName, version: '1.0.0' });
    await c.connect(buildTransport());
    return c;
  });
}

/**
 * Proactive context fetch for the agent-invoke sidebar (Part 2.3): connects to
 * every UiPath-type tool linked to an agent and pulls processes + queues (with a
 * pending-item count for the first few queues) — a pure data fetch, no LLM
 * reasoning, so it doesn't cost a conversational turn. Reuses the same
 * connect/transport logic as loadMcpTools() rather than duplicating the raw
 * UiPath HTTP calls a second time.
 */
// ── Context panel cache ─────────────────────────────────────────────────────
// UiPathLiveGraph polls every 4 seconds. Without a cache, every tick spawns
// a fresh MCP connection (or hammers the SSE server) and hits the UiPath API.
// 30 seconds is long enough to be cheap, short enough to feel live.
const _uipathContextCache = new Map<string, { data: UipathContextSummary[]; ts: number }>();
const CONTEXT_TTL_MS = 30_000;

export async function fetchAgentUipathContext(agentId: string): Promise<UipathContextSummary[]> {
  // Serve from cache if fresh — prevents 4-second poll from hammering UiPath API
  const cached = _uipathContextCache.get(agentId);
  if (cached && Date.now() - cached.ts < CONTEXT_TTL_MS) return cached.data;

  const agentRes = await query<{ tools: string[] | null }>(
    'SELECT tools FROM agents WHERE agent_id = $1',
    [agentId],
  );
  const agentRow = agentRes.rows[0];
  if (!agentRow?.tools || agentRow.tools.length === 0) return [];

  // With the 30-second cache in place, it is safe to allow STDIO tools here.
  // We will only spawn a short-lived Node process once every 30 seconds per agent
  // instead of every 4 seconds, satisfying the user requirement that STDIO tools
  // should also fully support the Live Graph and Context Panel.
  const toolsRes = await query<any>(
    `SELECT * FROM tools
     WHERE tool_id = ANY($1::uuid[])
       AND name ILIKE '%uipath%'`,
    [agentRow.tools],
  );

  const log = txLogger(`uipath-context:${agentId}`);
  const results: UipathContextSummary[] = [];

  for (const toolRow of toolsRes.rows) {
    const toolId: string = toolRow.tool_id;
    const toolName: string = toolRow.name;

    let client: Client;
    try {
      client = await connectToMcpToolById(toolId, 'amadeus-context-panel');
    } catch (e) {
      const errorMsg = sanitizeMcpError(e);
      results.push({ toolId, toolName, processes: [], queues: [], error: errorMsg, authFailureCause: extractAuthFailureCause(errorMsg) });
      continue;
    }

    try {
      const asText = (res: any) => (res?.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('\n');

      // Guard: MCP tools return error messages as plain text content (not exceptions).
      // Without this, 'Error: UIPATH_ORG must be set.' — or an OAuth failure like
      // 'Auth failed (network): ...' from mcp-uipath's getUiPathToken — propagates
      // into allProcesses[0] and renders as the 'Name' field in UiPathLiveGraph
      // instead of being surfaced as a real error.
      const assertNotMcpError = (text: string, label: string) => {
        if (text.trim().startsWith('Error:') || text.trim().startsWith('Auth failed') || /must be set/i.test(text)) {
          throw new Error(`${label} returned credential error: ${text.trim().slice(0, 200)}`);
        }
      };

      let simulatedAgentLogs = `[${new Date().toISOString()}] Amadeus MCP connected to UiPath Orchestrator...\n`;

      const processesText = asText(await client.callTool({ name: 'list_uipath_processes', arguments: {} }));
      assertNotMcpError(processesText, 'list_uipath_processes');
      simulatedAgentLogs += `[${new Date().toISOString()}] [MCP] callTool list_uipath_processes (Success)\n`;
      const processes = processesText
        .split('\n')
        .filter((l: string) => l.trimStart().startsWith('•'))
        .map((l: string) => (l.replace(/^•\s*/, '').split(' (key:')[0] ?? '').trim())
        .filter((l: string) => l && !/^No processes found/.test(l));

      const queuesText = asText(await client.callTool({ name: 'list_uipath_queues', arguments: {} }));
      assertNotMcpError(queuesText, 'list_uipath_queues');
      simulatedAgentLogs += `[${new Date().toISOString()}] [MCP] callTool list_uipath_queues (Success)\n`;
      const queueNames = [...queuesText.matchAll(/^•\s*(.+?)\s*\(id:/gm)].map((m) => m[1] as string);

      const queues: { name: string; pendingCount: number | null; logs?: string }[] = [];
      const MAX_QUEUES_WITH_COUNT = 5;
      for (const qName of queueNames.slice(0, MAX_QUEUES_WITH_COUNT)) {
        try {
          const txText = asText(await client.callTool({ name: 'get_uipath_queue_transactions', arguments: { queueName: qName, top: 100 } }));
          simulatedAgentLogs += `[${new Date().toISOString()}] [MCP] callTool get_uipath_queue_transactions for queue: ${qName} (Success)\n`;
          queues.push({ name: qName, pendingCount: (txText.match(/\[New\]/g) || []).length, logs: txText || 'No pending transactions found.' });
        } catch {
          queues.push({ name: qName, pendingCount: null, logs: 'Failed to fetch queue transactions.' });
        }
      }
      for (const qName of queueNames.slice(MAX_QUEUES_WITH_COUNT)) {
        queues.push({ name: qName, pendingCount: null, logs: 'Queue not inspected (rate limit).' });
      }

      const jobsText = asText(await client.callTool({ name: 'list_uipath_jobs', arguments: { top: 30 } }));
      simulatedAgentLogs += `[${new Date().toISOString()}] [MCP] callTool list_uipath_jobs (Success)\n`;
      const recentJobs = jobsText.split('\n')
        .filter((l: string) => l.startsWith('• Job ID:'))
        .map((l: string) => {
          const match = l.match(/Job ID: (\d+) \(Key: ([^)]+)\) \| Process: (.*?) \| State: (\w+) \| Created: (.*)/);
          if (!match) return null;
          return { id: match[1], key: match[2], processName: match[3], state: match[4], createdAt: match[5], logs: '' };
        })
        .filter(Boolean) as { id: string; key: string; processName: string; state: string; createdAt: string; logs: string }[];

      // Fetch real-time logs for the latest job of each unique process
      const uniqueProcesses = new Set();
      let logFetchCount = 0;
      for (const job of recentJobs) {
        if (!uniqueProcesses.has(job.processName)) {
          uniqueProcesses.add(job.processName);
          try {
            const logsText = asText(await client.callTool({ name: 'get_uipath_job_logs', arguments: { jobId: job.key, top: 15 } }));
            job.logs = logsText || 'No logs found.';
            logFetchCount++;
          } catch {
            job.logs = 'Failed to fetch logs.';
          }
        }
      }
      if (logFetchCount > 0) {
        simulatedAgentLogs += `[${new Date().toISOString()}] [MCP] callTool get_uipath_job_logs for ${logFetchCount} jobs (Success)\n`;
      }
      simulatedAgentLogs += `[${new Date().toISOString()}] Trace completed.\n`;

      results.push({
        toolId,
        toolName,
        processes,
        queues,
        recentJobs,
        agentLogs: simulatedAgentLogs
      });
    } catch (e) {
      log.warn({ toolId, error: e }, 'Failed to fetch UiPath context');
      const errorMsg = sanitizeMcpError(e);
      results.push({ toolId, toolName, processes: [], queues: [], error: errorMsg, authFailureCause: extractAuthFailureCause(errorMsg) });
    } finally {
      try { await client.close(); } catch { /* best effort */ }
    }
  }

  // Store in cache — even a partial/empty result is cached to avoid stampedes
  _uipathContextCache.set(agentId, { data: results, ts: Date.now() });
  return results;
}

type QueueTransactionItem = { id: number; status: string; reference: string | null; createdAt: string | null };

/**
 * Backs the Robots dashboard's row-expand ("show queue items for this job's
 * queue") — a one-off MCP call against the tool that triggered the job,
 * parsing get_uipath_queue_transactions' text response into structured rows.
 */
export async function fetchQueueTransactionsForTool(
  toolId: string,
  queueName: string,
  folderId?: string | null,
): Promise<QueueTransactionItem[]> {
  const client = await connectToMcpToolById(toolId, 'amadeus-robots-dashboard');
  try {
    const res = await client.callTool({
      name: 'get_uipath_queue_transactions',
      arguments: { queueName, top: 25, ...(folderId ? { folderId } : {}) },
    });
    const text = ((res as any)?.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('\n');
    const items: QueueTransactionItem[] = [];
    for (const m of text.matchAll(/^•\s*#(\d+)\s*\[([^\]]+)\](?:\s*ref=(\S+))?\s*created=(\S+)/gm)) {
      items.push({
        id: Number(m[1]),
        status: m[2] as string,
        reference: (m[3] as string | undefined) ?? null,
        createdAt: (m[4] as string) === '?' ? null : (m[4] as string),
      });
    }
    return items;
  } finally {
    try { await client.close(); } catch { /* best effort */ }
  }
}

/**
 * Universal LangGraph Engine.
 * Dynamically builds and runs a createReactAgent from a JSON Configuration.
 * Fully replaces the legacy Python dynamic eval generator.
 *
 * mode='playground': never touches the `transactions` table (no lookup, no
 * completeStep/failStep writes) — used by the test-drive UI where the caller
 * has no real backing transaction row.
 * mode='production': `transactionId` must reference an existing transaction;
 * behaves like the legacy flow (completeAndHandoff / failStep on the real row).
 */
export async function runAgenticStep(
  auth: AuthContext,
  transactionId: string | undefined,
  idempotencyKey: string,
  prompt?: string,
  messagesHistory?: any[],
  agentId?: string,
  mode: InvocationMode = 'playground',
  sessionLabel?: string,
  runtime: 'cloud' | 'on_prem' = 'cloud',
): Promise<A2AResult & { mcpHealth?: McpServerHealth[]; agentOutput?: unknown }> {
  let txId: string;
  let step: string;

  if (mode === 'production') {
    if (!transactionId) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'mode=production memerlukan transactionId', 400);
    }
    let transaction;
    try {
      ({ transaction } = await getTransactionWithEvents(transactionId));
    } catch (e) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaksi tidak ditemukan', 400, { transactionId });
    }
    txId = transaction.id;
    step = transaction.current_step;
  } else {
    // playground: synthetic id for logging only, never written to the DB.
    txId = `playground-${randomUUID()}`;
    step = 'playground';
  }

  const log = txLogger(txId);
  log.info({ mode }, "🤖 Starting Universal LangGraph Engine");

  // 1. Resolve Agent Configuration from Database
  // If agentId is passed, use it. In production mode without an agentId, fall
  // back to treating `step` as either an agent UUID or a name/description match.
  let agentConfig;
  if (agentId) {
    const agentRes = await query("SELECT * FROM agents WHERE agent_id = $1 LIMIT 1", [agentId]);
    agentConfig = agentRes.rows[0];
  } else if (mode === 'production') {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(step);
    if (isUuid) {
      const agentRes = await query("SELECT * FROM agents WHERE agent_id = $1 LIMIT 1", [step]);
      agentConfig = agentRes.rows[0];
    } else {
      const agentRes = await query("SELECT * FROM agents WHERE agent_name ILIKE $1 OR description ILIKE $1 LIMIT 1", [`%${step}%`]);
      agentConfig = agentRes.rows[0];
    }
  }

  if (!agentConfig) {
    throw new DomainError(
      'NO_AGENT',
      `Tidak ada agent config di database untuk agent_id/step ${agentId || step}`,
      404,
    );
  }

  // 2. Resolve Tool Configurations
  let toolConfigs: any[] = [];
  if (agentConfig.tools && agentConfig.tools.length > 0) {
    const toolsRes = await query("SELECT * FROM tools WHERE tool_id = ANY($1::uuid[])", [agentConfig.tools]);
    toolConfigs = toolsRes.rows;
  }

  // 3. Construct MCP Tools (Dynamic Adapters) + connection health report
  const { tools, clients, report, needsNamespacing } = await loadMcpTools(toolConfigs, log, agentConfig.agent_id, sessionLabel);

  // Fail loud: the agent had tools registered, but none of them connected.
  if (toolConfigs.length > 0 && tools.length === 0) {
    for (const client of clients) { try { await client.close(); } catch { /* best effort */ } }
    throw new DomainError(
      'NO_TOOLS_AVAILABLE',
      "None of the agent's registered MCP servers are reachable",
      424,
      { report },
    );
  }

  tools.push(...await loadKnowledgeBaseTools(agentConfig.agent_id));

  try {
    const inputMessages = messagesHistory && messagesHistory.length > 0
      ? messagesHistory
      : [{ role: "user", content: prompt || `Execute step ${step} for transaction ${txId}` }];

    // Only the CURRENT turn decides whether vision is needed — an image
    // earlier in the conversation (e.g. a PDF extracted three turns ago)
    // must not permanently pin every later text-only turn to the vision
    // model, which doesn't emit tool calls the same way and would silently
    // break MCP tool use for the rest of the conversation.
    const latestMessage = inputMessages[inputMessages.length - 1];
    const requiresVision = Array.isArray(latestMessage?.content)
      && latestMessage.content.some((p: any) => p.type === 'image_url');

    const resolvedModel = agentConfig.model && agentConfig.model !== "gpt-4o"
      ? agentConfig.model
      : (requiresVision ? env.NETRA_VL_MODEL : env.NETRA_LLM_MODEL);

    // Netra Runtime API (NETRA_BASE_URL + NETRA_API_KEY from .env)
    const apiKey = env.NETRA_API_KEY ?? '';
    const baseURL = env.NETRA_BASE_URL;

    // Telemetry (owo.md LANJUTAN C): one ReAct iteration = one fetch call to
    // /chat/completions here, so a fetch wrapper gives us step_index for free.
    // Reads the raw JSON before LangChain's own parsing consumes the body
    // (via .clone()) so provider/reasoning_tokens — fields LangChain's OpenAI
    // wrapper doesn't surface — can be captured without changing behavior.
    let reactStepIndex = 0;
    const agentIdForTelemetry: string | undefined = agentConfig.agent_id;
    const telemetryFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (env.LLM_USAGE_TELEMETRY) {
        reactStepIndex += 1;
        const stepIndex = reactStepIndex;
        res
          .clone()
          .json()
          .then((json: any) => {
            void logLlmUsageEvent({
              requestId: txId,
              agentId: agentIdForTelemetry,
              stepIndex,
              callSite: 'engine.react',
              modelSlug: json?.model ?? resolvedModel,
              modelKind: requiresVision ? 'vision' : 'text',
              provider: json?.provider ?? 'netra',
              thinkingEnabled: env.LLM_MEASUREMENT_REASONING
                ? env.LLM_MEASUREMENT_REASONING === 'on'
                : undefined,
              promptTokens: json?.usage?.prompt_tokens,
              completionTokens: json?.usage?.completion_tokens,
              totalTokens: json?.usage?.total_tokens,
              reasoningTokens: json?.usage?.completion_tokens_details?.reasoning_tokens,
              toolsAttachedCount: tools.length,
              finishReason: json?.choices?.[0]?.finish_reason,
              stream: false,
            });
          })
          .catch(() => {
            /* best-effort telemetry only, never affects the real response */
          });
      }
      return res;
    };

    // 4. Instantiate LangGraph createReactAgent In-Memory
    const llm = new ChatOpenAI({
      modelName: resolvedModel,
      temperature: 1,
      topP: 1,
      modelKwargs: { ...netraSamplingParams(), ...measurementBodyOverrides() },
      apiKey,
      configuration: {
        baseURL,
        fetch: env.LLM_USAGE_TELEMETRY ? telemetryFetch : undefined,
      }
    });

    const toolContext = buildToolContextBlock(toolConfigs, needsNamespacing);

    const agent = createReactAgent({
      llm,
      tools,
      stateModifier: buildSystemPrompt(agentConfig.agent_style, toolContext),
    });

    // 5. Invoke LangGraph — recursionLimit raised for multi-step UiPath chains
    // (plan -> trigger -> wait -> verify per step easily exceeds the default
    // of 25), paired with a wall-clock ceiling so a stuck chain can't run
    // forever.
    const result = await withWallClockTimeout(
      () => agent.invoke({ messages: inputMessages }, { recursionLimit: 75 }),
      env.AGENT_WALL_CLOCK_TIMEOUT_MS,
      'runAgenticStep',
    );

    const finalMessage = result.messages[result.messages.length - 1] as BaseMessage;

    // 6. Complete and Handoff back to tracker — production mode only.
    // Playground mode never writes to the DB.
    if (mode !== 'production') {
      return {
        accepted: true,
        transactionId: txId,
        currentStep: step,
        status: 'playground',
        nextStep: null,
        nextActorHint: null,
        idempotentReplay: false,
        mcpHealth: report,
        // Non-streaming playground callers (e.g. POST /agents/:id/screen)
        // otherwise have no way to read the agent's answer — the streaming
        // path (runAgenticStepStream) writes deltas straight to the SSE
        // response instead, so this field is only meaningful here.
        agentOutput: finalMessage.content,
      };
    }

    const handoffResult = await completeAndHandoff(
      auth,
      {
        protocol: 'amadeus.a2a/0',
        type: 'task.complete',
        transactionId: txId,
        step,
        idempotencyKey,
        correlationId: `agentic:${agentConfig?.agent_id || step}`,
        reason: "LangGraph execution successful",
        targetStep: undefined, // Defaults to next step in flow
        data: {
          agent_output: finalMessage.content
        },
        sentAt: new Date().toISOString(),
      },
      log,
    );
    return { ...handoffResult, mcpHealth: report };
  } catch (err: any) {
    log.error({ err }, "🤖 LangGraph execution failed");

    if (mode !== 'production') {
      // No DB writes in playground mode — surface the failure directly.
      if (err instanceof DomainError) throw err;
      throw new DomainError('AGENT_EXECUTION_FAILED', err.message || "Unknown LangGraph execution failure", 500);
    }

    // Convert failure into a failed step in the transaction tracker
    return failStepFromEnvelope(
      auth,
      {
        protocol: 'amadeus.a2a/0',
        type: 'task.failed',
        transactionId: txId,
        step,
        idempotencyKey,
        correlationId: `agentic:${agentConfig?.agent_id || step}`,
        reason: err.message || "Unknown LangGraph execution failure",
        data: {},
        sentAt: new Date().toISOString(),
      },
      log,
    );
  } finally {
    // 7. Graceful Cleanup of MCP SDK Clients
    for (const client of clients) {
      try { await client.close(); } catch (e) { }
    }
  }
}

/**
 * Universal LangGraph Streaming Engine.
 * Streams node execution and agent updates chunk-by-chunk to the client using SSE.
 *
 * Agent config + tool resolution + MCP health checks all happen BEFORE any
 * response bytes are written, so failure cases (unknown production
 * transactionId, no agent found, all MCP tools unreachable) can return a
 * normal JSON error response instead of having to fake it inside an SSE
 * stream whose headers were already flushed.
 */
export async function runAgenticStepStream(
  auth: AuthContext,
  transactionId: string | undefined,
  idempotencyKey: string,
  prompt: string | undefined,
  messagesHistory: any[] | undefined,
  agentId: string | undefined,
  mode: InvocationMode,
  reply: FastifyReply,
  sessionLabel?: string,
  runtime: 'cloud' | 'on_prem' = 'cloud',
): Promise<void> {
  // reply.hijack() (called by the route handler before this function runs)
  // takes the raw response out of Fastify's control, so @fastify/cors's
  // onRequest hook — which only *stages* headers on the Fastify reply
  // wrapper for Fastify's own send flow — never gets flushed here. Every
  // direct reply.raw write in this function must set CORS headers itself,
  // or the browser reports a plain "Failed to fetch" for what was actually
  // a normal, readable error response (e.g. NO_AGENT, NO_TOOLS_AVAILABLE).
  const corsOrigin = resolveCorsOrigin(reply.request.headers.origin);
  const writeJsonError = (status: number, code: string, message: string, extra?: Record<string, unknown>) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers['Vary'] = 'Origin';
    }
    reply.raw.writeHead(status, headers);
    reply.raw.end(JSON.stringify({ error: { code, message, ...extra } }));
  };

  let txId: string;
  let step: string;

  if (mode === 'production') {
    if (!transactionId) {
      writeJsonError(400, 'TRANSACTION_NOT_FOUND', 'mode=production memerlukan transactionId');
      return;
    }
    const res = await query("SELECT current_step FROM transactions WHERE id = $1", [transactionId]);
    if (!res.rows[0]) {
      writeJsonError(400, 'TRANSACTION_NOT_FOUND', 'Transaksi tidak ditemukan', { transactionId });
      return;
    }
    txId = transactionId;
    step = res.rows[0].current_step;
  } else {
    txId = `playground-${randomUUID()}`;
    step = 'playground';
  }

  const log = txLogger(txId);
  log.info({ mode }, "🤖 Starting Universal LangGraph Engine in STREAMING mode");

  let agentConfig;
  if (agentId) {
    const agentRes = await query("SELECT * FROM agents WHERE agent_id = $1 LIMIT 1", [agentId]);
    agentConfig = agentRes.rows[0];
  } else if (mode === 'production') {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(step);
    if (isUuid) {
      const agentRes = await query("SELECT * FROM agents WHERE agent_id = $1 LIMIT 1", [step]);
      agentConfig = agentRes.rows[0];
    } else {
      const agentRes = await query("SELECT * FROM agents WHERE agent_name ILIKE $1 OR description ILIKE $1 LIMIT 1", [`%${step}%`]);
      agentConfig = agentRes.rows[0];
    }
  }

  if (!agentConfig) {
    writeJsonError(404, 'NO_AGENT', `Agent not found for ${agentId || step}`);
    return;
  }

  let toolConfigs: any[] = [];
  if (agentConfig.tools && agentConfig.tools.length > 0) {
    const toolsRes = await query("SELECT * FROM tools WHERE tool_id = ANY($1::uuid[])", [agentConfig.tools]);
    toolConfigs = toolsRes.rows;
  }

  const { tools, clients, report, needsNamespacing } = await loadMcpTools(toolConfigs, log, agentConfig.agent_id, sessionLabel);

  // Fail loud: the agent had tools registered, but none of them connected.
  if (toolConfigs.length > 0 && tools.length === 0) {
    for (const client of clients) { try { await client.close(); } catch { /* best effort */ } }
    writeJsonError(424, 'NO_TOOLS_AVAILABLE', "None of the agent's registered MCP servers are reachable", { report });
    return;
  }

  tools.push(...await loadKnowledgeBaseTools(agentConfig.agent_id));

  // Only now do we commit to opening the SSE stream.
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  if (corsOrigin) {
    reply.raw.setHeader('Access-Control-Allow-Origin', corsOrigin);
    reply.raw.setHeader('Vary', 'Origin');
  }
  reply.raw.flushHeaders();

  reply.raw.write(`event: mcp_health\ndata: ${JSON.stringify({ servers: report })}\n\n`);
  if ((reply.raw as any).flush) {
    (reply.raw as any).flush();
  }

  try {
    const inputMessages = messagesHistory && messagesHistory.length > 0
      ? messagesHistory
      : [{ role: "user", content: prompt || `Execute step ${step} for transaction ${txId}` }];

    // Only the CURRENT turn decides whether vision is needed — an image
    // earlier in the conversation (e.g. a PDF extracted three turns ago)
    // must not permanently pin every later text-only turn to the vision
    // model, which doesn't emit tool calls the same way and would silently
    // break MCP tool use for the rest of the conversation.
    const latestMessage = inputMessages[inputMessages.length - 1];
    const requiresVision = Array.isArray(latestMessage?.content)
      && latestMessage.content.some((p: any) => p.type === 'image_url');

    const resolvedModel = agentConfig.model && agentConfig.model !== "gpt-4o"
      ? agentConfig.model
      : (requiresVision ? env.NETRA_VL_MODEL : env.NETRA_LLM_MODEL);

    // Netra Runtime API (NETRA_BASE_URL + NETRA_API_KEY from .env)
    const apiKey = env.NETRA_API_KEY ?? '';
    const baseURL = env.NETRA_BASE_URL;

    const modelInitStart = Date.now();
    const llm = new ChatOpenAI({
      modelName: resolvedModel,
      temperature: 1,
      topP: 1,
      // Keep in sync with the invoke path above: same sampling params AND the
      // measurement overrides (previously missing here — the known drift).
      modelKwargs: { ...netraSamplingParams(), ...measurementBodyOverrides() },
      apiKey,
      configuration: {
        baseURL,
      },
      streaming: true
    });
    const modelInitTime = (Date.now() - modelInitStart) / 1000;

    const toolContext = buildToolContextBlock(toolConfigs, needsNamespacing);

    const agentInitStart = Date.now();
    const agent = createReactAgent({
      llm,
      tools,
      stateModifier: buildSystemPrompt(agentConfig.agent_style, toolContext),
    });
    const agentInitTime = (Date.now() - agentInitStart) / 1000;

    reply.raw.write(`event: metrics\ndata: ${JSON.stringify({ modelInit: modelInitTime, agentInit: agentInitTime })}\n\n`);
    if ((reply.raw as any).flush) {
      (reply.raw as any).flush();
    }

    const responseStart = Date.now();

    let finalAgentOutput = "";

    // recursionLimit raised for multi-step UiPath chains, paired with a
    // wall-clock ceiling wrapping the entire stream + consume loop (that's
    // what actually blocks on the LLM/tool calls) so a stuck chain can't
    // hold the SSE connection open forever.
    await withWallClockTimeout(async () => {
      const stream = await agent.stream({ messages: inputMessages }, { recursionLimit: 75 });

      for await (const chunk of stream) {
        const isAgent = !!chunk.agent;
        const isTools = !!chunk.tools;
        const messages = (chunk.agent?.messages || chunk.tools?.messages || []) as any[];
        const lastMsg = messages[messages.length - 1];

        let payload: any = {
          node: isAgent ? 'agent' : isTools ? 'tools' : 'unknown',
        };

        if (lastMsg) {
          payload.message = {
            role: lastMsg._getType() === 'ai' ? 'assistant' : lastMsg._getType() === 'tool' ? 'tool' : 'user',
            content: lastMsg.content,
            name: lastMsg.name,
          };

          // Netra reasoning (3 shapes) stays on its OWN channel — never folded
          // into message.content. LangChain stows provider extras in
          // additional_kwargs.
          const reasoning = extractReasoning(lastMsg.additional_kwargs);
          if (reasoning) payload.reasoning = reasoning;

          if (isAgent && lastMsg._getType() === 'ai') {
            finalAgentOutput = lastMsg.content;
          }

          if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
            payload.toolCalls = lastMsg.tool_calls;
          }
        }

        reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        if ((reply.raw as any).flush) {
          (reply.raw as any).flush();
        }
      }
    }, env.AGENT_WALL_CLOCK_TIMEOUT_MS, 'runAgenticStepStream');

    // Complete step in the DB — production mode only.
    if (mode === 'production') {
      try {
        await completeAndHandoff(
          auth,
          {
            protocol: 'amadeus.a2a/0',
            type: 'task.complete',
            transactionId: txId,
            step,
            idempotencyKey,
            correlationId: `agentic:${agentConfig?.agent_id || step}`,
            reason: "LangGraph streaming execution successful",
            targetStep: undefined,
            data: {
              agent_output: finalAgentOutput
            },
            sentAt: new Date().toISOString(),
          },
          log,
        );
      } catch (dbErr: any) {
        log.warn({ err: dbErr }, "Failed to complete transaction in DB, but stream succeeded");
        // We do not throw here, so the stream can finish cleanly
      }
    }

    const responseTime = (Date.now() - responseStart) / 1000;
    reply.raw.write(`event: metrics\ndata: ${JSON.stringify({ modelInit: modelInitTime, agentInit: agentInitTime, responseTime })}\n\n`);
    reply.raw.write(`event: complete\ndata: ${JSON.stringify({ output: finalAgentOutput })}\n\n`);
    reply.raw.end();
  } catch (err: any) {
    log.error({ err }, "🤖 LangGraph streaming execution failed");

    if (mode === 'production') {
      try {
        await failStepFromEnvelope(
          auth,
          {
            protocol: 'amadeus.a2a/0',
            type: 'task.failed',
            transactionId: txId,
            step,
            idempotencyKey,
            correlationId: `agentic:${agentConfig?.agent_id || step}`,
            reason: err.message || "Unknown LangGraph streaming execution failure",
            data: {},
            sentAt: new Date().toISOString(),
          },
          log,
        );
      } catch (e) {
        log.error({ err: e }, "Failed to record failStep for LangGraph stream");
      }
    }

    reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    reply.raw.end();
  } finally {
    for (const client of clients) {
      try { await client.close(); } catch (e) { }
    }
  }
}

