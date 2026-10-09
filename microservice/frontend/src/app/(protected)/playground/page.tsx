"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Bot,
  Send,
  Settings2,
  Trash2,
  Search,
  X,
  Cpu,
  AlertTriangle,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Menu,
  Share2
} from 'lucide-react';
import { Select } from '@/components/Select';
import { EditableJsonTable } from '@/components/EditableJsonTable';
import MarkdownViewer from '@/components/MarkdownViewer';
import dynamic from 'next/dynamic';
import { AgentContextPanel } from '@/components/AgentContextPanel';
const UiPathLiveGraph = dynamic(() => import('@/components/UiPathLiveGraph'), { ssr: false });
import { McpManagerBanner } from '@/components/McpManagerBanner';
import { MessageSquarePlus, MessageSquare } from 'lucide-react';
import { ShareModal } from '@/components/ShareModal';

export interface ChatSession {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
  createdAt: number;
}


interface Message {
  role: 'system' | 'bot' | 'user' | 'error';
  content: string;
  apiContent?: any;
  attachments?: { name: string, type: string, preview: string | null }[];
  unverifiedClaim?: boolean;
}

interface Attachment {
  file: File;
  preview: string | null;
  name: string;
  type: string;
  extractedText?: string;
}

// Mirrors backend RecipeRunState (src/orchestrator/recipes/types.ts) — the
// Recipe Executor's Loop Mode progress snapshot, streamed over SSE.
interface RecipeRunState {
  recipeId: string;
  runId: string;
  agentId: string;
  currentIteration: number;
  currentStepIndex: number;
  currentVariant: number;
  resolved: Record<string, Record<string, string>>;
  activeStepId: string | null;
  lastStepOutput: Record<string, unknown>;
  iterationResults: { iteration: number; status: 'success' | 'failed' | 'aborted'; detail: string }[];
  status: 'running' | 'completed' | 'failed' | 'awaiting_llm_decision';
  error?: string;
}

// Mirrors backend RecipeDef (src/orchestrator/recipes/types.ts) — only the
// fields the progress view needs (label, per-step labels).
interface AgentRecipe {
  id: string;
  label: string;
  steps: { id: string; label: string }[];
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const groups: Record<string, ChatSession[]> = {
    'Today': [],
    'Yesterday': [],
    'Previous 7 Days': [],
    'Previous 30 Days': [],
    'Older': []
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const last7Days = new Date(today);
  last7Days.setDate(today.getDate() - 7);
  const last30Days = new Date(today);
  last30Days.setDate(today.getDate() - 30);

  sessions.forEach(session => {
    const d = new Date(session.createdAt);
    if (d >= today) {
      groups['Today'].push(session);
    } else if (d >= yesterday) {
      groups['Yesterday'].push(session);
    } else if (d >= last7Days) {
      groups['Previous 7 Days'].push(session);
    } else if (d >= last30Days) {
      groups['Previous 30 Days'].push(session);
    } else {
      groups['Older'].push(session);
    }
  });

  return groups;
}

export default function Playground() {
  return (
    <Suspense fallback={null}>
      <PlaygroundInner />
    </Suspense>
  );
}

function PlaygroundInner() {
  const searchParams = useSearchParams();
  const preselectAgent = searchParams.get('agent');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState('UPLINK: STABLE');
  const [transactionId, setTransactionId] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [toolsList, setToolsList] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [modelInit, setModelInit] = useState<string | null>(null);
  const [agentInit, setAgentInit] = useState<string | null>(null);
  const [responseTime, setResponseTime] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Both panels are overlay drawers under lg and in-flow columns above it.
  // Start them closed on a phone so the chat column owns the whole viewport.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(480);
  const isDraggingRight = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = (wide: boolean) => {
      setIsSidebarOpen(wide);
      setIsRightSidebarOpen(wide);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [runtimeMode, setRuntimeMode] = useState<'cloud' | 'on_prem'>('cloud');

  // Typing indicator — true from the moment a message is sent until the
  // first token/chunk of the agent's reply streams in (or the request
  // errors out). Prompt #14 Part B.
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  // Follow-up suggestion chips shown below the latest assistant message —
  // best-effort, fire-and-forget; empty array renders nothing. Prompt #14 Part C.
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);

  // Loop Mode — drives the Recipe Executor's deterministic run instead of the
  // conversational ReAct agent. Kept as separate state from the chat flow
  // above: this is a progress tracker, not a conversation (loop.md Step 5).
  const [loopMode, setLoopMode] = useState(false);
  const [loopIterations, setLoopIterations] = useState(3);
  const [loopPrompt, setLoopPrompt] = useState('');
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopResults, setLoopResults] = useState<{ iteration: number; status: string; detail: string }[]>([]);
  const [loopStatus, setLoopStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [recipeState, setRecipeState] = useState<RecipeRunState | null>(null);
  const [recipeRunning, setRecipeRunning] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [agentRecipe, setAgentRecipe] = useState<AgentRecipe | null>(null);

  // Loop Mode is a property of whichever agent has a recipe configured
  // (creatoroop.md Step 5), not a Danantara-only special case — fetch it
  // whenever the selected agent changes, and hide/reset the toggle for an
  // agent with none.
  useEffect(() => {
    if (!selectedAgent) {
      setAgentRecipe(null);
      setLoopMode(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/orchestrator/agents/${selectedAgent}/recipe`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setAgentRecipe(await res.json());
        } else {
          setAgentRecipe(null);
          setLoopMode(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentRecipe(null);
          setLoopMode(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedAgent]);

  // Server-side chat session persistence
  const syncTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const syncSessionToServer = useCallback((session: ChatSession) => {
    if (syncTimers.current[session.id]) clearTimeout(syncTimers.current[session.id]);
    syncTimers.current[session.id] = setTimeout(() => {
      fetch(`/api/chat-sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: session.title, messages: session.messages, agentId: session.agentId }),
      }).catch(() => {});
    }, 800);
  }, []);

  useEffect(() => {
    (async () => {
      // Migrate localStorage → server (one-time)
      const localRaw = localStorage.getItem('agent-sessions');
      if (localRaw) {
        try {
          const localSessions: ChatSession[] = JSON.parse(localRaw);
          for (const ls of localSessions) {
            if (ls.messages.length === 0) continue;
            const res = await fetch('/api/chat-sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId: ls.agentId, title: ls.title }),
            });
            if (res.ok) {
              const created = await res.json();
              await fetch(`/api/chat-sessions/${created.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: ls.messages }),
              });
            }
          }
          localStorage.removeItem('agent-sessions');
        } catch {}
      }

      // Load from server
      const r = await fetch('/api/chat-sessions');
      const serverSessions: any[] = r.ok ? await r.json() : [];
      if (serverSessions.length === 0) return;
      const full = await Promise.all(
        serverSessions.map((s: any) =>
          fetch(`/api/chat-sessions/${s.id}`).then(r2 => r2.ok ? r2.json() : null)
        )
      );
      const parsed: ChatSession[] = full.filter(Boolean).map((s: any) => ({
        id: s.id,
        title: s.title,
        agentId: s.agent_id || '',
        messages: s.messages || [],
        createdAt: new Date(s.created_at).getTime(),
      }));
      if (parsed.length > 0) {
        setSessions(parsed);
        if (!currentSessionId) switchSession(parsed[0].id, parsed);
      }
    })();
  }, []);

  const saveSessions = (newSessions: ChatSession[]) => {
    setSessions(newSessions);
  };

  const switchSession = useCallback((id: string, fromSessions?: ChatSession[]) => {
    setCurrentSessionId(id);
    const source = fromSessions;
    if (source) {
      const session = source.find(s => s.id === id);
      if (session) {
        setMessages(session.messages);
        setSelectedAgent(session.agentId);
        setInput('');
        setAttachments([]);
      }
      return;
    }
    fetch(`/api/chat-sessions/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then((s: any) => {
        if (s) {
          setMessages(s.messages || []);
          setSelectedAgent(s.agent_id || '');
          setInput('');
          setAttachments([]);
        }
      })
      .catch(() => {});
  }, []);

  const startNewSession = async () => {
    try {
      const res = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgent, title: `Chat ${new Date().toLocaleDateString()}` }),
      });
      if (!res.ok) return;
      const created = await res.json();
      const newSession: ChatSession = {
        id: created.id,
        title: created.title,
        agentId: selectedAgent,
        messages: [],
        createdAt: new Date(created.created_at).getTime(),
      };
      setCurrentSessionId(created.id);
      setMessages([]);
      saveSessions([newSession, ...sessions]);
    } catch {}
  };


  const selectedAgentObj = agents.find(a => a.agent_id === selectedAgent);
  const connectedTools = selectedAgentObj
    ? (selectedAgentObj.tools || []).map((tid: string) => toolsList.find(t => t.tool_id === tid)).filter(Boolean)
    : [];

  const formatMessageContent = (content: string) => {
    if (!content) return null;
    const parts = content.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="font-semibold text-slate-900 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <strong key={index} className="font-semibold text-slate-900 dark:text-white">{part.slice(1, -1)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={index} className="font-mono bg-slate-100 dark:bg-slate-800 text-rose-600 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-xs font-semibold mx-0.5">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  // This console always runs in playground mode (no DB writes). The "Ref ID"
  // field is optional and only meaningful if the caller wants to correlate
  // logs — it is intentionally NOT auto-generated and NOT sent as a fake
  // transactionId (that used to trigger false "Transaksi tidak ditemukan"
  // warnings server-side for every single invoke).
  const [mcpHealth, setMcpHealth] = useState<{ toolName: string; toolId: string; status: string; error?: string; loadedTools: string[] }[]>([]);

  useEffect(() => {
    const fetchAgentsAndTools = async () => {
      try {
        const [agentsRes, toolsRes] = await Promise.all([
          fetch("/api/agents"),
          fetch("/api/tools"),
        ]);
        if (agentsRes.ok) {
          const data = await agentsRes.json();
          setAgents(data || []);
        }
        if (toolsRes.ok) {
          const data = await toolsRes.json();
          setToolsList(data || []);
        }
      } catch (err) {
        console.error("Failed to load agents or tools", err);
      }
    };
    fetchAgentsAndTools();
  }, []);

  // Pre-select agent from ?agent= query param (e.g. /playground?agent=orchestrator)
  // by loose name match, since we don't know the generated agent_id ahead of time.
  useEffect(() => {
    if (!preselectAgent || selectedAgent || agents.length === 0) return;
    const match = agents.find((a) =>
      a.agent_name?.toLowerCase().includes(preselectAgent.toLowerCase())
    );
    if (match) setSelectedAgent(match.agent_id);
  }, [preselectAgent, agents, selectedAgent]);

  const extractPdfAsImages = async (file: File): Promise<string[]> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    
    const maxPages = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      await page.render({ canvasContext: ctx, viewport } as any).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    return images;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const f of files) {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachments(prev => [...prev, {
            file: f,
            preview: ev.target?.result as string,
            name: f.name,
            type: 'image'
          }]);
        };
        reader.readAsDataURL(f);
      } else if (f.type === 'application/pdf') {
        try {
          const base64Images = await extractPdfAsImages(f);
          const newAtts = base64Images.map((b64, idx) => ({
            file: f,
            preview: b64,
            name: `${f.name} (Pg ${idx + 1})`,
            type: 'image'
          }));
          setAttachments(prev => [...prev, ...newAtts]);
        } catch (err) {
          console.error("Failed to parse PDF as images", err);
          alert("Failed to read PDF file.");
        }
      } else if (f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt')) {
        // Plain chat attachment — separate from the /knowledge-base ingestion
        // flow. Read as text and inlined into the prompt (no vision model
        // involved), unlike image/PDF attachments above.
        try {
          const text = await f.text();
          setAttachments(prev => [...prev, {
            file: f,
            preview: null,
            name: f.name,
            type: 'text',
            extractedText: text,
          }]);
        } catch (err) {
          console.error("Failed to read text file", err);
          alert("Failed to read text file.");
        }
      } else {
        alert("Unsupported file type: " + f.name);
      }
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const deleteSession = async (id: string) => {
    fetch(`/api/chat-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    const updatedSessions = sessions.filter(session => session.id !== id);
    if (updatedSessions.length === 0) {
      await startNewSession();
    } else {
      saveSessions(updatedSessions);
      if (currentSessionId === id) {
        switchSession(updatedSessions[0].id, updatedSessions);
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (overrideInput?: string) => {
    const effectiveInput = overrideInput ?? input;
    if (!effectiveInput.trim() && attachments.length === 0) {
      return;
    }

    // Auto-create a server-side session if none exists yet
    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      try {
        const title = effectiveInput.trim().length > 30
          ? effectiveInput.trim().substring(0, 30) + '...'
          : effectiveInput.trim() || `Chat ${new Date().toLocaleDateString()}`;
        const res = await fetch('/api/chat-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: selectedAgent, title }),
        });
        if (res.ok) {
          const created = await res.json();
          activeSessionId = created.id;
          const newSession: ChatSession = {
            id: created.id,
            title: created.title,
            agentId: selectedAgent,
            messages: [],
            createdAt: new Date(created.created_at).getTime(),
          };
          setCurrentSessionId(created.id);
          setSessions(prev => [newSession, ...prev]);
        }
      } catch {}
    }

    // Session's very first turn — the chat-title fetch only fires once,
    // right after this turn's assistant response completes (Part D).
    const wasFirstTurn = messages.length === 0;
    const currentInputDisplay = effectiveInput.trim();
    const imageAttachments = attachments.filter(a => a.type === 'image');
    const textFileAttachments = attachments.filter(a => a.type === 'text');
    // Text attachments aren't images — no vision model needed, so they're
    // inlined into the prompt text directly instead of triggering the
    // image-reading system instruction below.
    const systemInstruction = imageAttachments.length > 0
      ? `\n\n[SYSTEM INSTRUCTION: Baca gambar lampiran secara langsung menggunakan kemampuan vision Anda (JANGAN memanggil fungsi/tools eksternal apapun untuk membaca dokumen ini). Jika terdapat data tabel, form, atau kolom pada dokumen, tulis ulang data tersebut HANYA berupa JSON Array of Objects di dalam blok \`\`\`json (tanpa teks lain). SANGAT PENTING: Anda TIDAK BOLEH mengubah format penulisan header/kolom (jangan menghilangkan spasi, jangan mengubah huruf besar/kecil). Jika di dokumen tertulis "First Name", tulis key sebagai "First Name" BUKAN "FirstName". Ekstrak apa adanya sesuai yang tertera secara visual. Jangan memanggil fungsi apapun. Contoh: \`\`\`json\n[{"First Name": "A", "Company Name": "B"}]\n\`\`\`]`
      : ``;
    const textFilesBlock = textFileAttachments.length > 0
      ? '\n\n' + textFileAttachments.map(a => `[Attached file: ${a.name}]\n${a.extractedText ?? ''}`).join('\n\n')
      : ``;
    const promptToSend = currentInputDisplay + textFilesBlock + systemInstruction;

    let apiContent: any;
    if (imageAttachments.length > 0) {
      apiContent = [
        { type: 'text', text: promptToSend },
        ...imageAttachments.map(a => ({
          type: 'image_url',
          image_url: { url: a.preview }
        }))
      ];
    } else {
      apiContent = promptToSend;
    }

    const userMessage: Message = { 
      role: 'user', 
      content: currentInputDisplay || "Attached File(s)", 
      apiContent: apiContent, 
      attachments: attachments.map(a => ({ name: a.name, type: a.type, preview: a.preview })) 
    };

    setMessages(prev => {
      const newMsgs = [...prev, userMessage];
      // update session
      if (activeSessionId) {
        setSessions(s => {
          const newTitle = wasFirstTurn && currentInputDisplay
            ? (currentInputDisplay.length > 30 ? currentInputDisplay.substring(0, 30) + '...' : currentInputDisplay)
            : undefined;

          const exists = s.find(session => session.id === activeSessionId);
          const updated = exists
            ? s.map(session =>
                session.id === activeSessionId ? {
                  ...session,
                  messages: newMsgs,
                  title: newTitle || session.title
                } : session
              )
            : [{ id: activeSessionId, title: newTitle || `Chat ${new Date().toLocaleDateString()}`, agentId: selectedAgent, messages: newMsgs, createdAt: Date.now() }, ...s];
          const match = updated.find(s => s.id === activeSessionId); if (match) syncSessionToServer(match);
          return updated;
        });
      }
      return newMsgs;
    });
    setInput('');
    setAttachments([]);
    setStatus('Processing...');
    setModelInit(null);
    setAgentInit(null);
    setResponseTime(null);
    setMcpHealth([]);
    setFollowUpSuggestions([]);
    setIsAgentTyping(true);

    try {
      const res = await fetch("/api/orchestrator/run-agentic", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Never send a fabricated UUID with no backing row — only forward
          // transactionId if the user explicitly typed one in.
          transactionId: transactionId.trim() || undefined,
          agentId: selectedAgent || undefined,
          idempotencyKey: `invoke-${Date.now()}`,
          prompt: promptToSend,
          messages: [...messages, userMessage]
            .filter(m => m.role === 'user' || m.role === 'bot')
            // Cap history length — unbounded history sent on every turn scales badly.
            .slice(-20)
            .map((m, i, arr) => {
              const isCurrentTurn = i === arr.length - 1;
              let content = m.apiContent || m.content;
              // Prior turns' apiContent can carry full base64 image/PDF data.
              // The model already extracted that data in its own turn — echoing
              // it back on every subsequent turn blows past the server's
              // bodyLimit and surfaces as a bare "Failed to fetch". Only the
              // current turn needs the actual attachment bytes.
              if (!isCurrentTurn && Array.isArray(content)) {
                const textPart = content.find((c: any) => c.type === 'text');
                const imageCount = content.filter((c: any) => c.type === 'image_url').length;
                content = (textPart?.text ?? m.content ?? '') +
                  (imageCount > 0 ? `\n[${imageCount} attachment(s) from this turn already processed — not re-sent]` : '');
              }
              return {
                role: m.role === 'bot' ? 'assistant' : 'user',
                content
              };
            }),
          stream: true,
          mode: 'playground',
          runtime: runtimeMode,
          sessionLabel: currentSessionId ?? undefined,
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error?.message || `Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) {
        throw new Error('Readable stream not supported on response.');
      }

      // Add a temporary bot message that we will append to
      setMessages(prev => [...prev, { role: 'bot', content: '' }]);

      let accumulatedResponse = '';
      let buffer = '';
      let currentEvent = 'update';
      let toolCallsThisTurn = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (currentEvent === 'mcp_health') {
                setMcpHealth(data.servers || []);
              } else if (currentEvent === 'metrics') {
                if (data.modelInit !== undefined) setModelInit(`${data.modelInit.toFixed(3)}s`);
                if (data.agentInit !== undefined) setAgentInit(`${data.agentInit.toFixed(3)}s`);
                if (data.responseTime !== undefined) setResponseTime(`${data.responseTime.toFixed(3)}s`);
              } else if (currentEvent === 'complete') {
                setStatus('Stream Complete');
                const claimWithoutToolCall = toolCallsThisTurn === 0 && /\b(sent|added|queued|triggered|completed|updated|deleted)\b/i.test(accumulatedResponse);
                if (claimWithoutToolCall) {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0 && next[lastIdx].role === 'bot') {
                      next[lastIdx] = { ...next[lastIdx], unverifiedClaim: true };
                    }
                    return next;
                  });
                }
              } else if (currentEvent === 'error') {
                throw new Error(data.message || data.error || 'Stream processing error');
              } else {
                if (data.message && data.message.content) {
                  if (data.node === 'agent' && data.message.role === 'assistant') {
                    accumulatedResponse = data.message.content;
                    // First real token has arrived — the typing indicator's
                    // job is done, regardless of when the stream itself ends.
                    setIsAgentTyping(false);
                    setMessages(prev => {
                      const next = [...prev];
                      if (next.length > 0) {
                        next[next.length - 1] = {
                          role: 'bot',
                          content: accumulatedResponse
                        };
                      }
                      
                      // sync to localstorage
                      if (currentSessionId) {
                        setSessions(s => {
                          const updated = s.map(session => session.id === currentSessionId ? { ...session, messages: next } : session);
                          const match = updated.find(s => s.id === currentSessionId); if (match) syncSessionToServer(match);
                          return updated;
                        });
                      }
                      
                      return next;
                    });
                  }
                }
                // If there are tool calls, show a system thinking log
                if (data.toolCalls && data.toolCalls.length > 0) {
                  toolCallsThisTurn += data.toolCalls.length;
                  const toolsCalled = data.toolCalls.map((t: any) => `${t.name}(${JSON.stringify(t.args)})`).join(', ');
                  setStatus(`Running tool: ${data.toolCalls[0].name}...`);
                  setMessages(prev => {
                    const next = [...prev];
                    const botMsg = next.pop(); // temporary remove bot message
                    next.push({ role: 'system', content: `⚙️ [Agent Call] Using tool ${toolsCalled}` });
                    if (botMsg) next.push(botMsg); // restore bot message
                    return next;
                  });
                }
              }
            } catch (e: any) {
              if (currentEvent === 'error') throw new Error(e.message || 'Stream execution failed');
              console.error('Failed to parse SSE data', e);
            }
          }
        }
      }
      setStatus('UPLINK: STABLE');
      // Safety net — if the stream ended with zero content (e.g. an empty
      // reply), the typing indicator would otherwise never clear.
      setIsAgentTyping(false);

      // Both calls below are fire-and-forget, best-effort enhancements —
      // neither is awaited, and neither can delay or fail the chat flow
      // that already completed above.
      const conversationTail = [...messages, userMessage, { role: 'bot' as const, content: accumulatedResponse }]
        .filter(m => m.role === 'user' || m.role === 'bot')
        .slice(-6)
        .map(m => ({ ...m, role: m.role === 'bot' ? 'assistant' : m.role }))
        .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content }));

      fetch('/api/orchestrator/chat/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationTail }),
      })
        .then(r => (r.ok ? r.json() : { suggestions: [] }))
        .then(data => setFollowUpSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []))
        .catch(() => setFollowUpSuggestions([]));

      if (wasFirstTurn && currentSessionId) {
        fetch('/api/orchestrator/chat/title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: conversationTail }),
        })
          .then(r => (r.ok ? r.json() : null))
          .then(data => {
            if (!data?.title) return;
            setSessions(s => {
              const updated = s.map(session =>
                session.id === currentSessionId ? { ...session, title: data.title } : session
              );
              const match = updated.find(s => s.id === currentSessionId); if (match) syncSessionToServer(match);
              return updated;
            });
          })
          .catch(() => {});
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'error',
        content: `Error: ${err.message}`
      }]);
      setStatus('UPLINK: ERROR');
      setIsAgentTyping(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setStatus('UPLINK: STABLE');
    setMcpHealth([]);
  };

  const handleRunLoopWithPrompt = async () => {
    if (!selectedAgent) { alert('Select an agent first!'); return; }
    if (!loopPrompt.trim()) { alert('Please enter a prompt for the loop.'); return; }
    setLoopRunning(true);
    setLoopStatus('running');
    setLoopResults([]);
    try {
      const res = await fetch(`/api/orchestrator/agents/${selectedAgent}/loop/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: loopPrompt.trim(), iterations: loopIterations, runtime: runtimeMode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `Server error: ${res.status}`);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) throw new Error('Stream not supported');
      let buffer = '';
      let currentEvent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'iteration_done') {
                setLoopResults(prev => [...prev, { iteration: data.iteration, status: data.status, detail: data.detail }]);
              } else if (currentEvent === 'loop_complete') {
                setLoopStatus('completed');
              }
            } catch {}
          }
        }
      }
      setLoopStatus('completed');
    } catch (err: any) {
      setLoopStatus('failed');
    } finally {
      setLoopRunning(false);
    }
  };

  const handleRunRecipe = async () => {
    if (!selectedAgent) {
      alert('Select an agent first!');
      return;
    }
    setRecipeRunning(true);
    setRecipeError(null);
    setRecipeState(null);

    try {
      const res = await fetch(`/api/orchestrator/agents/${selectedAgent}/recipe/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ iterations: loopIterations }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || data.message || `Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) {
        throw new Error('Readable stream not supported on response.');
      }

      let buffer = '';
      let currentEvent = 'state';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === 'state' || currentEvent === 'complete') {
                setRecipeState(data);
              } else if (currentEvent === 'error') {
                setRecipeError(data.message || 'Recipe run failed');
              }
            } catch (e) {
              console.error('Failed to parse recipe SSE data', e);
            }
          }
        }
      }
    } catch (err: any) {
      setRecipeError(err.message);
    } finally {
      setRecipeRunning(false);
    }
  };

  return (
    <div className="flex h-full text-slate-900 dark:text-white overflow-hidden bg-[#FAFAFA] dark:bg-[var(--background)]">

      {/* Sessions Sidebar (Far Left) */}
      {/* Backdrop — drawer mode only (under lg) */}
      {(isSidebarOpen || isRightSidebarOpen) && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => { setIsSidebarOpen(false); setIsRightSidebarOpen(false); }}
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      )}

      <aside className={`bg-slate-50 dark:bg-slate-800/50 border-r border-slate-200 dark:border-slate-700 flex flex-col z-40 transition-transform duration-300 fixed top-0 bottom-[68px] left-0 w-[82vw] max-w-[20rem] md:inset-y-0 md:bottom-0 md:static md:z-10 md:shrink-0 md:translate-x-0 md:transition-all ${isSidebarOpen ? 'translate-x-0 md:w-64' : '-translate-x-full md:w-0 md:overflow-hidden md:border-r-0'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 whitespace-nowrap flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close chat list"
            className="md:hidden shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
          <button onClick={startNewSession} className="w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm text-slate-700 dark:text-slate-300 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 dark:bg-slate-800/50 transition-colors">
            <MessageSquarePlus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {Object.entries(groupSessionsByDate(sessions)).map(([groupName, groupSessions]) => {
            if (groupSessions.length === 0) return null;
            return (
              <div key={groupName} className="space-y-1">
                <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {groupName}
                </div>
                {groupSessions.map(session => (
                  <div key={session.id} className="relative group px-1">
                    <button
                      onClick={() => {
                        switchSession(session.id);
                        if (window.matchMedia("(max-width: 1023px)").matches) setIsSidebarOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] transition-colors flex items-center gap-2 pr-8 ${currentSessionId === session.id ? 'bg-indigo-50/50 dark:bg-slate-800/80 text-indigo-700 dark:text-slate-200 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                    >
                      <div className="flex-1 min-w-0 truncate" title={session.title}>
                        {session.title}
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 rounded-lg transition-opacity ${currentSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      title="Delete Chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      
      {/* Main Split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Area — Stream Console */}
        <main className="flex-1 flex flex-col relative bg-[#FAFAFA] dark:bg-[var(--background)] min-w-0">

          {/* Chat Header / Amadeus Console Top Bar */}
          <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col sticky top-0 z-20 w-full shrink-0 shadow-sm">
            {/* Top Row: Title & Basic Info */}
            <div className="h-11 flex items-center justify-between px-3 md:px-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 backdrop-blur">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="p-2.5 -ml-1 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors rounded-lg"
                  title="Toggle Sidebar"
                >
                  <Menu className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-4">
                {selectedAgentObj && (
                  <span className="ui-label text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{selectedAgentObj.agent_name}</span>
                )}
                <button onClick={clearChat} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20" title="Clear Chat">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className={`p-1.5 transition-colors rounded-lg ${isRightSidebarOpen ? 'text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`} title="Toggle A2A Orchestrator Sidebar">
                  <Cpu className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bottom Row: Controls */}
            <div className="px-6 py-2.5 flex items-center gap-6 overflow-x-auto scrollbar-hide">
              
              {/* Agent Select */}
              <div className="flex items-center gap-3 shrink-0">
                <label className="ui-label text-slate-500 dark:text-slate-400">Active Node</label>
                <div className="w-48 relative rounded-md p-[1px] overflow-hidden">
                  <div className={`absolute inset-0 vibrant-rainbow-border ${selectedAgent ? 'animate-border-spin opacity-70' : 'opacity-25'}`} />
                  <Select
                    value={selectedAgent}
                    onChange={(val) => {
                      setSelectedAgent(val);
                      if (currentSessionId) {
                        setSessions(s => {
                          const updated = s.map(session => session.id === currentSessionId ? { ...session, agentId: val } : session);
                          const match = updated.find(s => s.id === currentSessionId); if (match) syncSessionToServer(match);
                          return updated;
                        });
                      }
                    }}
                    placeholder={agents.length === 0 ? "Loading agents..." : "Select an agent"}
                    options={agents.map((agent) => ({ value: agent.agent_id, label: agent.agent_name }))}
                    className="relative z-10 !py-1 text-xs !bg-transparent"
                    triggerClassName="rounded-[5px] border-transparent !bg-white/90 dark:!bg-slate-900/90 text-slate-800 dark:text-white backdrop-blur-sm shadow-sm"
                  />
                </div>
                <button
                  onClick={() => {
                    if (selectedAgent) setIsInspectOpen(true);
                    else alert("Select an agent first!");
                  }}
                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-cyan-600 transition-colors rounded-md hover:bg-cyan-50 dark:bg-cyan-900/30"
                  title="Inspect Node"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (selectedAgent) setIsShareOpen(true);
                    else alert("Select an agent first!");
                  }}
                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-fuchsia-600 transition-colors rounded-md hover:bg-fuchsia-50 dark:bg-fuchsia-900/30"
                  title="Share Agent"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </div>

              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

              {/* Runtime Mode Select */}
              <div className="flex items-center gap-3 shrink-0">
                <label className="ui-label text-slate-500 dark:text-slate-400">Model</label>
                <div className="w-44 relative rounded-md p-[1px] overflow-hidden bg-slate-200 dark:bg-slate-700">
                  <Select
                    value={runtimeMode}
                    onChange={(val: any) => setRuntimeMode(val)}
                    options={[
                      { value: 'cloud', label: 'Netra (Cloud)' },
                      { value: 'on_prem', label: 'Netra (On-Prem)' }
                    ]}
                    className="relative z-10 !py-1 text-xs !bg-transparent"
                    triggerClassName="rounded-[5px] border-transparent !bg-white/90 dark:!bg-slate-900/90 text-slate-800 dark:text-white backdrop-blur-sm shadow-sm"
                  />
                </div>
              </div>

              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

              {/* Loop Mode toggle — always visible for all agents so users
                  can run any agent in a deterministic loop without needing
                  a recipe configured. */}
              <div className="flex items-center gap-2 shrink-0">
                <label className="ui-label text-slate-500 dark:text-slate-400">Loop Mode</label>
                <button
                  onClick={() => setLoopMode((v) => !v)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${loopMode ? 'bg-cyan-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                  title="Toggle Loop Mode — run this agent multiple times in sequence"
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-slate-900 rounded-full shadow transition-transform ${loopMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

              {/* Session Settings */}
              <div className="flex items-center gap-3 shrink-0">
                <label className="ui-label text-slate-500 dark:text-slate-400">Ref ID</label>
                <input
                  type="text"
                  placeholder="Tx UUID"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  className="w-32 px-3 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:border-cyan-400 transition-colors"
                />
              </div>

              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

              {/* Telemetry */}
              <div className="flex items-center gap-4 shrink-0">
                <span className="ui-label text-slate-500 dark:text-slate-400">Telemetry <span className="text-[8px] text-white vibrant-rainbow-bg px-1 py-[1px] rounded ml-1">LIVE</span></span>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-slate-400 dark:text-slate-500">Init: <span key={`a-${agentInit}`} className={`text-slate-800 dark:text-slate-200 font-mono ${agentInit ? 'stream-in' : ''}`}>{agentInit ?? '—'}</span></span>
                  <span className="text-slate-400 dark:text-slate-500">Resp: <span key={`r-${responseTime}`} className={`text-slate-800 dark:text-slate-200 font-mono ${responseTime ? 'stream-in' : ''}`}>{responseTime ?? '—'}</span></span>
                </div>
              </div>
            </div>
          </div>
          
          
{loopMode ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto w-full space-y-4">

              {/* Header card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Loop Mode</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ketik instruksimu sekali — agent akan menjalankannya N kali berturut-turut.</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${
                    loopStatus === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    loopStatus === 'failed' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 border-red-200 dark:border-red-500/30' :
                    loopStatus === 'running' ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse' :
                    'bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}>
                    {loopStatus === 'running' ? `Running... ${loopResults.length}/${loopIterations}` : loopStatus}
                  </span>
                </div>

                {/* Prompt input */}
                <div className="mb-4">
                  <label className="ui-label text-slate-500 dark:text-slate-400 mb-1.5 block">Instruksi / Prompt</label>
                  <textarea
                    value={loopPrompt}
                    onChange={(e) => setLoopPrompt(e.target.value)}
                    disabled={loopRunning}
                    placeholder="Contoh: Buka aplikasi CX100, buat transaksi baru dengan nomor antrian berikutnya, lalu tutup."
                    rows={4}
                    className="w-full px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition-all resize-none disabled:opacity-50 placeholder:text-slate-300"
                  />
                </div>

                {/* Iterations + Start */}
                <div className="flex items-center gap-3">
                  <label className="ui-label text-slate-500 dark:text-slate-400 shrink-0">Iterasi</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={loopIterations}
                    onChange={(e) => setLoopIterations(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    disabled={loopRunning}
                    className="w-20 px-3 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:border-cyan-400 transition-colors disabled:opacity-50"
                  />
                  <button
                    onClick={handleRunLoopWithPrompt}
                    disabled={loopRunning || !selectedAgent || !loopPrompt.trim()}
                    className="relative px-5 py-1.5 rounded-lg overflow-hidden disabled:opacity-40 text-xs font-semibold text-white"
                  >
                    <div className="absolute inset-0 vibrant-rainbow-bg" />
                    <span className="relative z-10">{loopRunning ? `Running ${loopResults.length}/${loopIterations}…` : '▶ Start Loop'}</span>
                  </button>
                  {loopStatus !== 'idle' && (
                    <button
                      onClick={() => { setLoopResults([]); setLoopStatus('idle'); }}
                      disabled={loopRunning}
                      className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:text-slate-400 transition-colors disabled:opacity-30"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Live results */}
              {loopResults.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-2">
                  <span className="ui-label text-slate-500 dark:text-slate-400 block mb-3">Hasil per Iterasi</span>
                  {loopResults.map((r) => (
                    <div
                      key={r.iteration}
                      className={`rounded-xl border p-3 text-xs flex gap-3 ${
                        r.status === 'success' ? 'border-emerald-100 bg-emerald-50' :
                        r.status === 'failed' ? 'border-red-100 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20' :
                        'border-amber-100 bg-amber-50'
                      }`}
                    >
                      <span className={`font-mono font-medium shrink-0 w-8 text-center ${
                        r.status === 'success' ? 'text-emerald-700' : r.status === 'failed' ? 'text-red-700' : 'text-amber-700'
                      }`}>#{r.iteration}</span>
                      <span className="flex-1 text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all">{r.detail}</span>
                      <span className={`shrink-0 text-[9px] font-semibold uppercase ${
                        r.status === 'success' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'
                      }`}>{r.status}</span>
                    </div>
                  ))}
                  {loopRunning && loopResults.length < loopIterations && (
                    <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs flex gap-3 items-center">
                      <span className="font-mono font-medium text-slate-400 dark:text-slate-500 w-8 text-center">#{loopResults.length + 1}</span>
                      <span className="text-slate-400 dark:text-slate-500 animate-pulse">Agent sedang berpikir…</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
{/* Messages */}
          <div className="flex-1 overflow-y-auto pt-6 p-6 space-y-6">
            <div className="max-w-3xl mx-auto w-full">
              <McpManagerBanner />
            </div>
            {mcpHealth.length > 0 && (
              <div className="max-w-3xl mx-auto w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-wrap gap-2">
                {mcpHealth.map((h) => {
                  const ok = h.status === 'connected';
                  const neutral = h.status === 'no_versions' || h.status === 'not_running';
                  const dotColor = ok ? 'bg-emerald-500' : neutral ? 'bg-slate-400' : 'bg-red-50 dark:bg-red-900/200';
                  return (
                    <span
                      key={h.toolId || h.toolName}
                      title={h.error || (ok ? `Tools: ${h.loadedTools.join(', ')}` : h.status)}
                      className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg border ${ok ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : neutral ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400' : 'border-red-100 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 text-red-700'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                      {h.toolName}: {h.status}
                    </span>
                  );
                })}
              </div>
            )}
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden relative mb-4">
                  <div className="absolute inset-0 vibrant-rainbow-border animate-border-spin opacity-90" />
                  <div className="absolute inset-[2px] bg-white dark:bg-slate-900 rounded-[14px] flex items-center justify-center">
                    <Bot className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  </div>
                </div>
                <p className="text-lg font-semibold text-slate-800 dark:text-slate-200">Start a conversation</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                  Select an agent and send a prompt to begin streaming its reasoning.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                if (msg.role === 'system') {
                  if (msg.content.startsWith('⚙️ [Agent Call]')) {
                    const match = msg.content.match(/⚙️ \[Agent Call\] Using tool ([^(]+)\((.*)\)/);
                    const toolName = match ? match[1] : 'Unknown Tool';
                    const toolArgs = match ? match[2] : '';

                    return (
                      <div key={idx} className="flex gap-4 max-w-3xl mx-auto justify-start w-full stream-in">
                        <div className="w-full relative overflow-hidden rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm">
                          <div className="relative z-10 p-5 flex flex-col gap-3">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                              <div className="flex items-center gap-2.5">
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                <span className="ui-label text-slate-500 dark:text-slate-400">Agent Call Execution</span>
                              </div>
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center border border-amber-100 text-amber-600">
                                <Cpu className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="ui-label text-slate-400 dark:text-slate-500 block">Invoking MCP Tool</span>
                                <span className="font-mono text-xs text-amber-700 font-semibold">{toolName}</span>
                              </div>
                            </div>

                            {toolArgs && (
                              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                                <span className="ui-label text-slate-400 dark:text-slate-500 block mb-1">Parameters</span>
                                <pre className="font-mono text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
                                  {toolArgs}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={idx} className="flex gap-4 max-w-3xl mx-auto justify-start w-full">
                      <div className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs p-3 rounded-lg w-full flex justify-between items-center">
                        <span>{msg.content}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                }

                if (msg.role === 'error') {
                  return (
                    <div key={idx} className="flex gap-4 max-w-3xl mx-auto justify-start w-full stream-in">
                      <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-700 p-4 rounded-xl text-sm flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                        <p>{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                if (msg.role === 'user') {
                  return (
                    <div key={idx} className="flex gap-3 max-w-3xl mx-auto justify-end items-start mt-4 mb-2">
                      <div className="flex flex-col min-w-0 max-w-[85%] items-end">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">You</span>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3 justify-end">
                            {msg.attachments.map((att, i) => (
                              <div key={i} className="shrink-0 group">
                                {att.preview ? (
                                  <img src={att.preview} alt={att.name} className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm" />
                                ) : (
                                  <div className="w-16 h-16 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
                                    <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                                    <span className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5 truncate w-14 text-center px-1" title={att.name}>{att.name}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <span className="text-sm leading-relaxed whitespace-pre-wrap block text-slate-800 dark:text-slate-200 text-right">
                          {formatMessageContent(msg.content)}
                        </span>
                      </div>
                    </div>
                  );
                }

                if (msg.role === 'bot') {
                  let contentToRender = msg.content;
                  let jsonArray: any = null;
                  
                  const jsonStart = contentToRender.indexOf('```json');
                  if (jsonStart !== -1) {
                    const jsonEnd = contentToRender.indexOf('```', jsonStart + 7);
                    if (jsonEnd !== -1) {
                      const jsonStr = contentToRender.substring(jsonStart + 7, jsonEnd).trim();
                      try {
                        jsonArray = JSON.parse(jsonStr);
                        contentToRender = (contentToRender.substring(0, jsonStart) + contentToRender.substring(jsonEnd + 3)).trim();
                      } catch(e) {}
                    }
                  }

                  return (
                    <div key={idx} className="flex gap-3 max-w-3xl mx-auto justify-start stream-in">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 relative overflow-hidden p-[1.5px]">
                        <div className="absolute inset-0 vibrant-rainbow-border animate-border-spin opacity-90" />
                        <div className="relative z-10 w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                        </div>
                      </div>
                      <div className="flex flex-col min-w-0 w-full">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Amadeus</span>

                        {msg.unverifiedClaim && (
                          <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg mb-2">
                            <AlertTriangle className="w-3 h-3" />
                            No tool was called this turn — verify this claim.
                          </span>
                        )}

                        {!contentToRender && isAgentTyping && idx === messages.length - 1 ? (
                          <div className="flex items-center gap-1 text-sm text-slate-400 dark:text-slate-500 px-1 py-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.15s]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.3s]" />
                          </div>
                        ) : contentToRender && (
                          <div className="w-full markdown-container">
                            <MarkdownViewer content={contentToRender} />
                          </div>
                        )}

                        {idx === messages.length - 1 && followUpSuggestions.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {followUpSuggestions.map((s, si) => (
                              <button
                                key={si}
                                onClick={() => { setFollowUpSuggestions([]); handleSend(s); }}
                                className="text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 hover:border-cyan-300 hover:text-cyan-600 hover:bg-cyan-50 dark:bg-cyan-900/30 transition-colors"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}

                        {Array.isArray(jsonArray) && jsonArray.length > 0 && typeof jsonArray[0] === 'object' && (
                           <EditableJsonTable 
                             initialData={jsonArray}
                             onSave={(newDataStr) => {
                               setMessages(prev => {
                                  const next = [...prev];
                                  const msg = next[idx];
                                  const jStart = msg.content.indexOf('```json');
                                  const jEnd = msg.content.indexOf('```', jStart + 7);
                                  if (jStart !== -1 && jEnd !== -1) {
                                     msg.content = msg.content.substring(0, jStart) + '```json\n' + newDataStr + '\n' + msg.content.substring(jEnd);
                                  }
                                  
                                  // sync to localstorage
                                  if (currentSessionId) {
                                    setSessions(s => {
                                      const updated = s.map(session => session.id === currentSessionId ? { ...session, messages: next } : session);
                                      const match = updated.find(s => s.id === currentSessionId); if (match) syncSessionToServer(match);
                                      return updated;
                                    });
                                  }
                                  return next;
                               });
                             }}
                           />
                        )}
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })
            )}
          </div>

          {/* Input */}
          <div className="p-6 bg-[#FAFAFA] dark:bg-[var(--background)] border-t border-slate-200 dark:border-slate-700">
            {attachments.length > 0 && (
              <div className="max-w-3xl mx-auto mb-3 flex gap-2 overflow-x-auto pb-1">
                {attachments.map((att, i) => (
                  <div key={i} className="relative shrink-0 group">
                    {att.preview ? (
                      <img src={att.preview} alt={att.name} className="w-16 h-16 rounded-xl object-cover border-2 border-slate-200 dark:border-slate-700 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
                        <FileText className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        <span className="text-[8px] text-slate-400 dark:text-slate-500 mt-1 truncate w-14 text-center px-1" title={att.name}>{att.name}</span>
                      </div>
                    )}
                    <button onClick={() => removeAttachment(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-50 dark:bg-red-900/200 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="max-w-3xl mx-auto relative flex items-end bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-900/5 transition-all p-2 shadow-sm">
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt" className="hidden" onChange={handleFileSelect} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 p-3 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:bg-slate-800/50 transition-colors mr-1"
                title="Attach files (Image/PDF/TXT)"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData.items);
                  const images = items.filter(i => i.type.startsWith('image/'));
                  if (images.length === 0) return;
                  e.preventDefault();
                  for (const item of images) {
                    const blob = item.getAsFile();
                    if (!blob) continue;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      setAttachments(prev => [...prev, {
                        file: blob,
                        preview: ev.target?.result as string,
                        name: `clipboard-${Date.now()}.png`,
                        type: 'image'
                      }]);
                    };
                    reader.readAsDataURL(blob);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message the agent…"
                className="flex-1 bg-transparent py-2 px-2 text-sm text-slate-900 dark:text-white focus:outline-none resize-none placeholder:text-slate-400 dark:text-slate-500 max-h-40"
              />

              <button
                onClick={() => handleSend()}
                disabled={!input.trim() && attachments.length === 0}
                className="relative p-3 rounded-xl overflow-hidden disabled:opacity-40 ml-2 group"
              >
                <div className="absolute inset-0 vibrant-rainbow-bg" />
                <Send className="relative z-10 w-4 h-4 text-white" />
              </button>
            </div>
            <div className="text-center mt-3">
              <span className="ui-label text-slate-400 dark:text-slate-500">
                ⏎ send · shift+⏎ newline
              </span>
            </div>
          </div>
        </>
        )}

          {isInspectOpen && selectedAgentObj && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                  <span className="terminal-dot bg-red-400" />
                  <span className="terminal-dot bg-amber-400" />
                  <span className="terminal-dot bg-emerald-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white ml-2 flex-1 truncate">Inspect Node: {selectedAgentObj.agent_name}</span>
                  <button onClick={() => setIsInspectOpen(false)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                  <div>
                    <h4 className="ui-label text-slate-400 dark:text-slate-500 mb-2">Agent Details</h4>
                    <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-xs">
                      <div>
                        <span className="ui-label text-slate-400 dark:text-slate-500 block">Agent ID</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300 font-medium break-all">{selectedAgentObj.agent_id}</span>
                      </div>
                      <div>
                        <span className="ui-label text-slate-400 dark:text-slate-500 block">Status</span>
                        <span className="text-slate-700 dark:text-slate-300 font-medium">
                          {selectedAgentObj.on_status ? '🟢 Online / Active' : '⚪ Offline'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="ui-label text-slate-400 dark:text-slate-500 mb-2">System Personality Prompt</h4>
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm text-slate-600 dark:text-slate-400 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                      {selectedAgentObj.agent_style || "No personality style configured."}
                    </div>
                  </div>

                  <div>
                    <h4 className="ui-label text-slate-400 dark:text-slate-500 mb-2">Connected Model Context Protocols (MCP)</h4>
                    {connectedTools.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4">No tools connected.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 border-y border-slate-100 dark:border-slate-800">
                        {connectedTools.map((tool: any) => (
                          <div key={tool.tool_id} className="py-4 space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-50 dark:bg-cyan-900/300" />
                                {tool.name}
                              </span>
                              <span className={`badge text-[9px] px-2 py-0.5 rounded-full ${tool.on_status === 'Online' ? 'badge-green' : 'badge-slate'}`}>
                                {tool.on_status || 'Offline'}
                              </span>
                            </div>
                            {tool.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{tool.description}</p>
                            )}
                            <div>
                              <span className="ui-label text-slate-400 dark:text-slate-500 block mb-1">MCP Connection Schema</span>
                              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3.5 font-mono text-[11px] overflow-x-auto max-h-40 border border-slate-800">
                                {JSON.stringify(tool.versions, null, 2)}
                              </pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50 dark:bg-slate-800/50">
                  <button onClick={() => setIsInspectOpen(false)} className="btn-primary text-xs rounded-xl py-2.5 px-4">
                    Close Inspector
                  </button>
                </div>
              </div>
            </div>
          )}

          {isShareOpen && selectedAgentObj && (
            <ShareModal
              agentId={selectedAgentObj.agent_id}
              resourceName={selectedAgentObj.agent_name}
              onClose={() => setIsShareOpen(false)}
            />
          )}


        </main>

        {/* Resize handle */}
        {isRightSidebarOpen && (
          <div
            className="hidden md:flex items-center justify-center w-1.5 cursor-col-resize hover:bg-indigo-500/20 active:bg-indigo-500/30 transition-colors shrink-0 z-20"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRight.current = true;
              const startX = e.clientX;
              const startW = rightPanelWidth;
              const onMove = (ev: MouseEvent) => {
                if (!isDraggingRight.current) return;
                const delta = startX - ev.clientX;
                setRightPanelWidth(Math.max(320, Math.min(startW + delta, window.innerWidth * 0.6)));
              };
              const onUp = () => {
                isDraggingRight.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
              };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          >
            <div className="w-0.5 h-8 rounded-full bg-slate-300 dark:bg-slate-600" />
          </div>
        )}

        {/* Right Sidebar — UiPathLiveGraph */}
        <aside
          style={isRightSidebarOpen ? { width: rightPanelWidth } : undefined}
          className={`bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden z-40 transition-transform duration-300 fixed top-0 bottom-[68px] right-0 w-[88vw] max-w-none md:inset-y-0 md:bottom-0 md:static md:z-10 md:shrink-0 md:translate-x-0 ${isRightSidebarOpen ? 'translate-x-0' : 'translate-x-full md:w-0 md:border-l-0 md:min-w-0'}`}
        >
          <UiPathLiveGraph sessionLabel={currentSessionId} agentId={selectedAgent} />
        </aside>
      </div>

    </div>
  );
}
