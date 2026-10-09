#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";
const app = express();
/** Accepts either the real array/object, or a JSON string that parses to one. */
function coerceJson(inner) {
    return z.preprocess((val) => {
        if (typeof val === "string") {
            try {
                return JSON.parse(val);
            }
            catch {
                return val; // let the inner schema's own validation produce the real error
            }
        }
        return val;
    }, inner);
}
const rawArg = process.argv[2];
if (rawArg && rawArg.trim().startsWith('{')) {
    try {
        const config = JSON.parse(rawArg);
        // If the config matches the multi-account format provided earlier
        const account = config.accounts?.[0] || config;
        if (account.clientId)
            process.env.UIPATH_CLIENT_ID = account.clientId;
        if (account.clientSecret)
            process.env.UIPATH_CLIENT_SECRET = account.clientSecret;
        if (account.baseUrl)
            process.env.UIPATH_BASE_URL = account.baseUrl;
        if (account.org)
            process.env.UIPATH_ORG = account.org;
        if (account.tenant)
            process.env.UIPATH_TENANT = account.tenant;
        if (account.folderId)
            process.env.UIPATH_FOLDER_ID = account.folderId;
        if (account.scopes)
            process.env.UIPATH_SCOPES = account.scopes;
        console.log("Loaded UiPath credentials dynamically from JSON argument.");
    }
    catch (e) {
        console.error("Failed to parse JSON argument:", e);
    }
}
let tokenCache = null;
async function getUiPathToken() {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 30_000)
        return tokenCache.accessToken;
    const clientId = process.env.UIPATH_CLIENT_ID ?? "";
    const clientSecret = process.env.UIPATH_CLIENT_SECRET ?? "";
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    if (!clientId || !clientSecret)
        throw new Error("UIPATH_CLIENT_ID / SECRET not set");
    process.stderr.write(`[mcp-uipath] Fetching fresh OAuth token (cache ${tokenCache ? "expired" : "empty"})\n`);
    const res = await fetch(`${baseUrl}/identity_/connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: process.env.UIPATH_SCOPES ?? "OR.Jobs OR.Robots.Read OR.Execution OR.Folders.Read OR.Queues",
        }).toString(),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`UiPath OAuth2 failed ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json());
    tokenCache = { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
}
// Each connection (stdio run, or SSE client) gets its own McpServer instance —
// the SDK's Protocol/transport pairing is one-shot and throws if you try to
// connect() an already-connected server to a second transport.
function createServer() {
    const server = new McpServer({
        name: "UiPath MCP Server",
        version: "1.0.0",
    });
    // ── Tools ─────────────────────────────────────────────────────────────
    server.tool("trigger_uipath_job", "Trigger a UiPath Automation Cloud job via Orchestrator API. Returns job ID and status. IMPORTANT: Before calling this, ALWAYS call get_uipath_process_arguments first to discover required input arguments, then ask the user what values to fill.", {
    releaseKey: z.string().describe("Release key of the process to run (from UiPath Orchestrator)"),
    arguments: coerceJson(z.record(z.any())).optional().describe("InputArguments JSON to pass to the process"),
    folderId: z.string().optional().describe("Orchestrator folder ID (Modern Folder). Defaults to env UIPATH_FOLDER_ID"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    const url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;
    const body = {
        startInfo: {
            ReleaseKey: args.releaseKey,
            Strategy: "ModernJobsCount",
            JobsCount: 1,
            InputArguments: args.arguments ? JSON.stringify(args.arguments) : "{}",
        },
    };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "X-UIPATH-OrganizationUnitId": folderId,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath StartJobs failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        const json = JSON.parse(text);
        const job = json.value?.[0];
        return {
            content: [
                {
                    type: "text",
                    text: job
                        ? `✅ UiPath job started.\nJob ID: ${job.Id}\nJob Key: ${job.Key}\nState: ${job.State}\nRelease: ${args.releaseKey}`
                        : `Job submitted but no details returned. Raw: ${text.slice(0, 200)}`,
                },
            ],
            // Machine-readable side-channel for the orchestrator's uipath_job_trace
            // write-back hook (engine.ts loadMcpTools). Never surfaced to the LLM —
            // only the `content` text above is ever forwarded into model context.
            ...(job ? { _meta: { jobId: String(job.Id), jobKey: job.Key, state: job.State, releaseKey: args.releaseKey, folderId } } : {}),
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("list_uipath_processes", "List available UiPath processes/releases in the current folder", {
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        const res = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/Releases`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-UIPATH-OrganizationUnitId": folderId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath Releases failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        const data = JSON.parse(text);
        const list = (data.value ?? []).map((r) => {
            let line = `• ${r.Name} (key: ${r.Key})`;
            if (r.Arguments) {
                try {
                    const argsDef = typeof r.Arguments === "string" ? JSON.parse(r.Arguments) : r.Arguments;
                    const safeParse = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") try { return JSON.parse(v); } catch { return []; } return []; };
                    const inputs = safeParse(argsDef.Input).map((a) => {
                        const name = a.Name || a.name;
                        const type = ((a.Type || a.type || "String").split(",")[0].split(".").pop()) || "String";
                        return `${name}: ${type}${(a.Required || a.required) ? " (required)" : ""}`;
                    });
                    if (inputs.length > 0) line += `\n  Input args: ${inputs.join(", ")}`;
                } catch {}
            }
            return line;
        }).join("\n");
        return { content: [{ type: "text", text: list || "No processes found in this folder." }] };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("get_uipath_process_arguments", "Get the input/output argument schema for a UiPath process. ALWAYS call this tool when the user mentions arguments, parameters, input values, or asks what to fill before running/triggering a process. Call this BEFORE trigger_uipath_job so you can ask the user for each required value. If a process appears in the orchestrator diagram, use this to inspect its arguments.", {
    releaseKey: z.string().optional().describe("Release key of the process. If omitted, returns args for ALL processes in the folder."),
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try { token = await getUiPathToken(); }
    catch (e) { return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] }; }
    try {
        let url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/Releases?$select=Name,Key,Arguments,Description`;
        if (args.releaseKey) url += `&$filter=Key eq '${args.releaseKey}'`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, "X-UIPATH-OrganizationUnitId": folderId },
        });
        const text = await res.text();
        if (!res.ok) return { content: [{ type: "text", text: `UiPath Releases failed (${res.status}): ${text.slice(0, 300)}` }] };
        const data = JSON.parse(text);
        const releases = data.value ?? [];
        if (releases.length === 0) return { content: [{ type: "text", text: "No matching process found." }] };
        const output = releases.map((r) => {
            let section = `## ${r.Name}\nRelease Key: ${r.Key}`;
            if (r.Description) section += `\nDescription: ${r.Description}`;
            if (!r.Arguments) { section += "\nArguments: None defined"; return section; }
            try {
                const argsDef = typeof r.Arguments === "string" ? JSON.parse(r.Arguments) : r.Arguments;
                const safeParse = (v) => { if (Array.isArray(v)) return v; if (typeof v === "string") try { return JSON.parse(v); } catch { return []; } return []; };
                const inputs = safeParse(argsDef.Input);
                const outputs = safeParse(argsDef.Output);
                if (inputs.length > 0) {
                    section += "\n\n### Input Arguments (user must provide):";
                    inputs.forEach((a) => {
                        const name = a.Name || a.name;
                        const type = ((a.Type || a.type || "String").split(",")[0].split(".").pop()) || "String";
                        const required = a.Required || a.required || false;
                        section += `\n  - **${name}** (${type})${required ? " [REQUIRED]" : " [optional]"}`;
                        if (a.HasDefault || a.hasDefault) section += ` — default: ${JSON.stringify(a.Default ?? a.default)}`;
                    });
                } else { section += "\n\nInput Arguments: None (process takes no input)"; }
                if (outputs.length > 0) {
                    section += "\n\n### Output Arguments (returned after execution):";
                    outputs.forEach((a) => {
                        const name = a.Name || a.name;
                        const type = ((a.Type || a.type || "String").split(",")[0].split(".").pop()) || "String";
                        section += `\n  - **${name}** (${type})`;
                    });
                }
            } catch (parseErr) { section += `\nArguments: (parse error: ${parseErr.message})\nRaw: ${JSON.stringify(r.Arguments).slice(0, 500)}`; }
            return section;
        }).join("\n\n---\n\n");
        return { content: [{ type: "text", text: output }] };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("list_uipath_jobs", "List recent UiPath jobs in the current folder, optionally filtered by process (ReleaseName)", {
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
    releaseName: z.string().optional().describe("Filter by specific process name (e.g., 'Robot1')"),
    top: z.number().int().max(100).optional().default(10).describe("Number of recent jobs to return")
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        let filter = "";
        if (args.releaseName) {
            filter = `&$filter=ReleaseName eq '${args.releaseName}'`;
        }
        const res = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/Jobs?$top=${args.top}&$orderby=CreationTime desc${filter}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-UIPATH-OrganizationUnitId": folderId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath Jobs failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        const data = JSON.parse(text);
        const list = (data.value ?? []).map((j) => `• Job ID: ${j.Id} (Key: ${j.Key}) | Process: ${j.ReleaseName} | State: ${j.State} | Created: ${j.CreationTime}`).join("\n");
        return { content: [{ type: "text", text: list || "No recent jobs found." }] };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("get_uipath_job_status", "Check the status of a UiPath job by ID", {
    jobId: z.string().describe("Job ID to check"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        const res = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/Jobs(${args.jobId})`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath job lookup failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        const job = JSON.parse(text);
        return {
            content: [
                {
                    type: "text",
                    text: `Job ${args.jobId}:\nState: ${job.State}\nStart: ${job.StartTime ?? "pending"}\nEnd: ${job.EndTime ?? "running"}\nInfo: ${job.Info ?? "none"}`,
                },
            ],
            // Machine-readable side-channel — see trigger_uipath_job for rationale.
            _meta: { jobId: String(args.jobId), state: String(job.State ?? ""), info: job.Info != null ? String(job.Info) : undefined },
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("get_uipath_job_logs", "Fetch detailed process execution logs for a specific UiPath Job", {
    jobId: z.string().describe("Job ID to fetch logs for"),
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
    top: z.number().int().max(100).optional().default(20),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        let jobKey = args.jobId;
        // If jobId is purely numeric, resolve it to a Key first
        if (/^\d+$/.test(args.jobId)) {
            const jobRes = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/Jobs(${args.jobId})`, {
                headers: { Authorization: `Bearer ${token}`, "X-UIPATH-OrganizationUnitId": folderId },
            });
            const jobText = await jobRes.text();
            if (!jobRes.ok) {
                return { content: [{ type: "text", text: `Failed to find Job ${args.jobId} (${jobRes.status}): ${jobText.slice(0, 200)}` }] };
            }
            const jobData = JSON.parse(jobText);
            jobKey = jobData.Key || "";
        }
        if (!jobKey) {
            return { content: [{ type: "text", text: `Job ${args.jobId} has no Key.` }] };
        }
        // 2. Fetch RobotLogs by JobKey
        const res = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/RobotLogs?$filter=JobKey eq ${jobKey}&$top=${args.top}&$orderby=TimeStamp desc`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-UIPATH-OrganizationUnitId": folderId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath job logs lookup failed (${res.status}): ${text.slice(0, 300)}. NOTE: This requires OR.Monitoring or OR.Logs scope in your credentials.` }] };
        }
        const data = JSON.parse(text);
        const list = (data.value ?? []).map((l) => `[${l.TimeStamp}] [${l.Level}] ${l.Message}`).join("\n");
        return { content: [{ type: "text", text: list || "No logs found for this job." }] };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("list_uipath_queues", "List queue definitions available in the current UiPath Orchestrator folder", {
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        const res = await fetch(`${baseUrl}/${org}/${tenant}/orchestrator_/odata/QueueDefinitions`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-UIPATH-OrganizationUnitId": folderId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath QueueDefinitions failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        const data = JSON.parse(text);
        const list = (data.value ?? [])
            .map((q) => {
            const schemaNote = q.SpecificContentSchema ? ` [schema: ${JSON.stringify(q.SpecificContentSchema)}]` : "";
            return `• ${q.Name} (id: ${q.Id})${q.Description ? ` — ${q.Description}` : ""}${schemaNote}`;
        })
            .join("\n");
        return { content: [{ type: "text", text: list || "No queues found in this folder." }] };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("add_uipath_queue_item", "Add a single item to a UiPath Orchestrator queue. " +
    "Pass the row data directly as \"specificContent\" — do NOT nest it under an \"itemData\" wrapper, " +
    "that wrapping is handled internally by this tool. " +
    "Example call: { \"queueName\": \"TestQueue\", \"specificContent\": { \"Email\": \"a@b.com\", \"Name\": \"...\" } }", {
    queueName: z.string().describe("Exact name of the target queue, from list_uipath_queues"),
    specificContent: coerceJson(z.record(z.any())).describe("Key-value payload for this queue item (the actual data row)"),
    priority: z.enum(["Low", "Normal", "High"]).optional().default("Normal"),
    reference: z.string().optional().describe("Optional human-readable reference/identifier for this item"),
    folderId: z.string().optional(),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    const url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/Queues/UiPathODataSvc.AddQueueItem`;
    const body = {
        itemData: {
            Name: args.queueName,
            Priority: args.priority,
            SpecificContent: args.specificContent,
            Reference: args.reference,
        },
    };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "X-UIPATH-OrganizationUnitId": folderId,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath AddQueueItem failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        process.stderr.write(`[mcp-uipath] AddQueueItem raw response: ${text.slice(0, 500)}\n`);
        // AddQueueItem's response is usually a single item object, but may be
        // wrapped in { value: {...} } on some Orchestrator versions.
        const json = JSON.parse(text);
        const item = json && typeof json === "object" && "value" in json && json.value && typeof json.value === "object"
            ? json.value
            : json;
        if (item.Id === undefined) {
            process.stderr.write(`[mcp-uipath] AddQueueItem returned unrecognized shape but HTTP OK. Raw: ${text.slice(0, 500)}\n`);
        }
        return {
            content: [{
                    type: "text",
                    text: `✅ Queue item added to "${args.queueName}".\nItem ID: ${item.Id ?? "unknown (verify in Transactions tab)"}\nStatus: ${item.Status ?? "New"}`,
                }],
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("bulk_add_uipath_queue_items", "Add multiple items to a UiPath Orchestrator queue in a single call. Use this instead of add_uipath_queue_item when you have an array of rows (e.g. from a parsed document or table). " +
    "Each entry in \"items\" is a plain row object — do NOT nest it under an \"itemData\" or \"specificContent\" wrapper, " +
    "that wrapping is handled internally by this tool. " +
    "If a row includes a top-level '_reference' key, it is used as that specific item's Reference field " +
    "(a common convention for uniqueness/tracking), and stripped from SpecificContent before sending. " +
    "Example call: { \"queueName\": \"TestQueue\", \"items\": [ { \"_reference\": \"John_Smith_ITSolutions\", \"Email\": \"a@b.com\", \"Name\": \"John\" }, { \"_reference\": \"Jane_Doe_Acme\", \"Email\": \"c@d.com\", \"Name\": \"Jane\" } ] }", {
    queueName: z.string().describe("Exact name of the target queue, from list_uipath_queues"),
    items: coerceJson(z.array(z.record(z.any())).min(1)).describe("Array of row objects. Each row's fields become queue item SpecificContent. " +
        "If a row includes a top-level '_reference' key, it is used as this specific item's Reference field " +
        "(a common convention for uniqueness/tracking), and stripped from SpecificContent before sending. " +
        "Example: [{\"_reference\": \"John_Smith_ITSolutions\", \"First Name\": \"John\", ...}, ...]"),
    commitType: z.enum(["AllOrNothing", "StopOnFirstFailure"]).optional().default("StopOnFirstFailure"),
    priority: z.enum(["Low", "Normal", "High"]).optional().default("Normal"),
    folderId: z.string().optional(),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    const url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/Queues/UiPathODataSvc.BulkAddQueueItems`;
    const body = {
        queueName: args.queueName,
        commitType: args.commitType,
        queueItems: args.items.map((row) => {
            const { _reference, ...specificContent } = row;
            const item = {
                Priority: args.priority,
                SpecificContent: specificContent,
            };
            if (typeof _reference === "string" && _reference.trim().length > 0) {
                item.Reference = _reference.trim();
            }
            return item;
        }),
    };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "X-UIPATH-OrganizationUnitId": folderId,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath BulkAddQueueItems failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        process.stderr.write(`[mcp-uipath] BulkAddQueueItems raw response: ${text.slice(0, 500)}\n`);
        const json = JSON.parse(text);
        // UiPath's BulkAddQueueItems response varies across Orchestrator versions.
        // Possible shapes we've observed:
        //   - { value: [ { Status, ItemDetail }, ... ] }        // ODataV4-ish
        //   - [ { Status, ItemDetail }, ... ]                    // raw array
        //   - { value: <count> }                                 // count only, on some versions
        let results = [];
        if (Array.isArray(json)) {
            results = json;
        }
        else if (Array.isArray(json?.value)) {
            results = json.value;
        }
        else if (typeof json?.value === "number") {
            return {
                content: [{
                        type: "text",
                        text: `✅ ${json.value} item(s) added to queue "${args.queueName}" (per-item detail not returned by this Orchestrator version).`,
                    }],
            };
        }
        if (results.length === 0) {
            process.stderr.write(`[mcp-uipath] BulkAddQueueItems returned unrecognized shape but HTTP OK. Raw: ${text.slice(0, 500)}\n`);
            return {
                content: [{
                        type: "text",
                        text: `✅ ${args.items.length} item(s) submitted to queue "${args.queueName}" (Orchestrator returned no per-item detail — verify in the Transactions tab).`,
                    }],
            };
        }
        const succeeded = results.filter((r) => r.Status !== "Failed" && r.Status !== "Retried").length;
        const failed = results.length - succeeded;
        return {
            content: [{
                    type: "text",
                    text: failed === 0
                        ? `✅ ${succeeded} item(s) added to queue "${args.queueName}".`
                        : `⚠️ ${succeeded} item(s) added, ${failed} failed. Queue: "${args.queueName}". Raw: ${text.slice(0, 400)}`,
                }],
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("get_uipath_queue_transactions", "List recent transaction items in a UiPath queue, with their processing status (New, InProgress, Successful, Failed, Abandoned, Retried).", {
    queueName: z.string().describe("Exact queue name, from list_uipath_queues"),
    folderId: z.string().optional().describe("Folder ID, defaults to env"),
    top: z.number().int().positive().max(100).optional().default(25),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    const folderId = args.folderId ?? process.env.UIPATH_FOLDER_ID ?? "0";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    const filter = encodeURIComponent(`QueueDefinition/Name eq '${args.queueName.replace(/'/g, "''")}'`);
    const url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/QueueItems?$filter=${filter}&$orderby=CreationTime desc&$top=${args.top}`;
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-UIPATH-OrganizationUnitId": folderId,
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath QueueItems failed (${res.status}): ${text.slice(0, 300)}` }] };
        }
        process.stderr.write(`[mcp-uipath] QueueItems raw response: ${text.slice(0, 500)}\n`);
        const data = JSON.parse(text);
        const items = data.value ?? [];
        const list = items
            .map((it) => `• #${it.Id} [${it.Status}]${it.Reference ? ` ref=${it.Reference}` : ""} created=${it.CreationTime ?? "?"}`)
            .join("\n");
        return {
            content: [{ type: "text", text: items.length ? list : `No transaction items found in queue "${args.queueName}".` }],
            _meta: { queueName: args.queueName, folderId, count: items.length },
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
server.tool("list_uipath_folders", "List all Orchestrator folders (Modern Folders) available in the current tenant. Use this to discover folder names and IDs before calling other tools that require a folderId.", {
    includeSubfolders: z.boolean().optional().default(true).describe("If true, include sub-folders in the result"),
}, async (args) => {
    const baseUrl = process.env.UIPATH_BASE_URL ?? "https://cloud.uipath.com";
    const org = process.env.UIPATH_ORG ?? "";
    const tenant = process.env.UIPATH_TENANT ?? "";
    if (!org || !tenant) {
        return { content: [{ type: "text", text: "Error: UIPATH_ORG and UIPATH_TENANT must be set." }] };
    }
    let token;
    try {
        token = await getUiPathToken();
    }
    catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
    try {
        // Folders endpoint does not require X-UIPATH-OrganizationUnitId header
        // because it is a tenant-level resource listing all folders.
        const url = `${baseUrl}/${org}/${tenant}/orchestrator_/odata/Folders?$orderby=FullyQualifiedName asc`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        const text = await res.text();
        if (!res.ok) {
            return { content: [{ type: "text", text: `UiPath Folders failed (${res.status}): ${text.slice(0, 300)}\n\nNOTE: This tool requires the OR.Folders or OR.Folders.Read scope in your External Application credentials.` }] };
        }
        const data = JSON.parse(text);
        const folders = (data.value ?? []);
        if (folders.length === 0) {
            return { content: [{ type: "text", text: "No folders found. Make sure your External Application has OR.Folders.Read scope." }] };
        }
        // Build a readable tree-like list
        const list = folders.map((f) => {
            const indent = (f.FullyQualifiedName?.split("/").length ?? 1) - 1;
            const prefix = "  ".repeat(indent) + (indent > 0 ? "└─ " : "• ");
            const parentNote = f.ParentId ? ` (parent: ${f.ParentId})` : "";
            return `${prefix}${f.DisplayName ?? f.FullyQualifiedName} (id: ${f.Id})${parentNote}`;
        }).join("\n");
        const summary = `Found ${folders.length} folder(s):\n\n${list}`;
        return {
            content: [{ type: "text", text: summary }],
            _meta: {
                totalFolders: folders.length,
                folders: folders.map((f) => ({ id: f.Id, name: f.DisplayName ?? f.FullyQualifiedName, fullyQualifiedName: f.FullyQualifiedName, parentId: f.ParentId ?? null })),
            },
        };
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? ` (cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)})` : "";
        return { content: [{ type: "text", text: `Network error calling UiPath: ${detail}${cause}` }], isError: true };
    }
});
    return server;
}
const isStdio = process.argv.includes("--stdio");
if (isStdio) {
    const runStdio = async () => {
        const server = createServer();
        const transport = new StdioServerTransport();
        await server.connect(transport);
        process.stderr.write(`[mcp-uipath] UiPath MCP Server running on STDIO\n`);
    };
    runStdio();
}
else {
    // Keyed by SSEServerTransport's own sessionId so multiple concurrent
    // chats (each a separate SSE connection) don't collide on one transport.
    const transports = new Map();
    app.get("/sse", async (_req, res) => {
        const server = createServer();
        const transport = new SSEServerTransport("/messages", res);
        transports.set(transport.sessionId, transport);
        res.on("close", () => {
            transports.delete(transport.sessionId);
        });
        await server.connect(transport);
    });
    app.post("/messages", async (req, res) => {
        const sessionId = req.query.sessionId;
        const transport = transports.get(sessionId);
        if (transport) {
            await transport.handlePostMessage(req, res);
        }
        else {
            res.status(400).send("No transport found for sessionId");
        }
    });
    const PORT = process.env.PORT || 10001;
    app.listen(PORT, () => {
        process.stderr.write(`[mcp-uipath] UiPath MCP Server running on SSE at http://localhost:${PORT}/sse\n`);
    });
}
