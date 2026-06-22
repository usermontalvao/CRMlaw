import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Inbox, Send, FileText, Flame, Trash2, Search, Paperclip, Reply, Forward,
  Mail, MailOpen, RefreshCw, PenSquare, Loader2, AlertOctagon, RotateCcw, ReplyAll,
  Settings, Type, Printer, PenLine, SlidersHorizontal, ShieldCheck, Plus, X,
  Bold, Italic, Underline, List, ListOrdered, Link2,
  Strikethrough, AlignLeft, AlignCenter, AlignRight, Quote, RemoveFormatting, Palette, ChevronDown,
  AlertCircle, ChevronLeft,
} from 'lucide-react';
import { emailService } from '../services/email.service';
import { supabase } from '../config/supabase';
import type { EmailFolder, EmailMessage, EmailSignature, SendEmailDTO, EmailSpamRule, SpamRuleKind, SpamRuleMatch } from '../types/email.types';
import { Modal, ModalBody, ModalFooter, Button, Input, Label } from './ui';

const FOLDERS: { key: EmailFolder; label: string; Icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Caixa de entrada', Icon: Inbox },
  { key: 'drafts', label: 'Rascunhos', Icon: FileText },
  { key: 'sent', label: 'Enviados', Icon: Send },
  { key: 'spam', label: 'Spam', Icon: Flame },
  { key: 'trash', label: 'Lixeira', Icon: Trash2 },
];

const MATCH_LABEL: Record<SpamRuleMatch, string> = {
  address: 'endereço',
  domain: 'domínio',
  from_regex: 'remetente~',
  subject_regex: 'assunto~',
  body_regex: 'corpo~',
};

const LS_FOLDERS_W = 'email:foldersW';
const LS_LIST_W = 'email:listW';
const LS_PREFS = 'email:prefs';

// Conta da caixa (remetente fixo — 1 conta). Usado p/ excluir a si mesmo no "Responder a todos".
const MAILBOX_ADDRESS = 'pedro@advcuiaba.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Extrai o endereço de um item que pode vir como "Nome <email>" ou só "email".
function addressOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}
function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(addressOf(raw).toLowerCase());
}
// Quebra uma lista "a@x.com, Nome <b@y.com>; c@z.com" em endereços individuais.
function parseRecipients(s: string): string[] {
  return s.split(/[,;]+/).map((e) => e.trim()).filter(Boolean);
}
// Lista de endereços (lowercased) a partir de um campo to/cc, p/ montar Responder a todos.
function extractAddresses(text: string | null): string[] {
  if (!text) return [];
  return parseRecipients(text).map((p) => addressOf(p).toLowerCase()).filter(Boolean);
}

interface EmailPrefs {
  perPage: number;
  autoMarkRead: boolean;
}

const DEFAULT_PREFS: EmailPrefs = { perPage: 50, autoMarkRead: true };

function loadPrefs(): EmailPrefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function senderName(m: EmailMessage): string {
  const t = m.direction === 'outbound' ? m.to_text : (m.from_text || m.from_address);
  if (!t) return '(sem remetente)';
  const match = t.match(/^\s*"?([^"<]+?)"?\s*</);
  return (match ? match[1] : t).trim();
}

// Prévia do corpo (snippet) p/ a lista. Prefere texto puro; se só houver HTML,
// remove tags de forma leve (regex, sem montar DOM por item) e colapsa espaços.
function snippet(m: EmailMessage, max = 100): string {
  let s = m.body_text?.trim() || '';
  if (!s && m.body_html) {
    s = m.body_html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Agrupa a lista (já ordenada desc) por faixa de data, com cabeçalho por grupo.
function dateBucket(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: 'sem-data', label: 'Sem data' };
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return { key: 'hoje', label: 'Hoje' };
  if (diffDays === 1) return { key: 'ontem', label: 'Ontem' };
  if (diffDays < 7) return { key: 'semana', label: 'Esta semana' };
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return { key: 'mes', label: 'Este mês' };
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = d.toLocaleDateString('pt-BR', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

// Paleta quente (sem azul, alinhada à marca) p/ avatares da lista/leitura.
const AVATAR_COLORS = [
  'bg-amber-100 text-amber-800', 'bg-orange-100 text-orange-800', 'bg-rose-100 text-rose-800',
  'bg-emerald-100 text-emerald-800', 'bg-stone-200 text-stone-700', 'bg-yellow-100 text-yellow-800',
  'bg-red-100 text-red-800', 'bg-teal-100 text-teal-800',
];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface ComposeAttachment {
  filename: string;
  content: string; // base64 (sem prefixo data:)
  contentType?: string;
  size: number;
}

interface ComposeState {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  showCc: boolean;
  inReplyTo?: string;
  threadKey?: string;
  clientId?: string;
  attachments: ComposeAttachment[];
}

const emptyCompose: ComposeState = {
  to: '', cc: '', bcc: '', subject: '', bodyHtml: '', showCc: false, attachments: [],
};

// Assinatura dos campos relevantes do compose — usada p/ detectar "sujou"
// (mudou desde que abriu) e disparar o autosave do rascunho.
function composeKey(c: ComposeState): string {
  return [c.to, c.cc, c.bcc, c.subject, c.bodyHtml].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Assinatura deve ser um FRAGMENTO inline. Se o usuário colar um documento HTML
// completo (DOCTYPE/<html>/<head>/<body>), extrai só o conteúdo do <body> e
// descarta a moldura de página — senão o wrapper (background/padding/centralização)
// quebra o layout do compose e vira um "card no meio".
function stripHtmlDocument(html: string): string {
  let s = html;
  const bodyMatch = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];
  return s
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .trim();
}

function sigToHtml(sig: EmailSignature | null): string {
  if (!sig) return '';
  if (sig.signature_html?.trim()) return stripHtmlDocument(sig.signature_html);
  if (sig.signature_text?.trim()) return `<div>${escapeHtml(sig.signature_text).replace(/\n/g, '<br>')}</div>`;
  return '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve(res.includes(',') ? res.slice(res.indexOf(',') + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailModule() {
  const [folder, setFolder] = useState<EmailFolder>('inbox');
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [thread, setThread] = useState<EmailMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);

  const [limit, setLimit] = useState(() => loadPrefs().perPage);
  const [hasMore, setHasMore] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [trashScope, setTrashScope] = useState<'all' | 'read' | 'unread'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const [foldersW, setFoldersW] = useState(() => Number(localStorage.getItem(LS_FOLDERS_W)) || 160);
  const [listW, setListW] = useState(() => Number(localStorage.getItem(LS_LIST_W)) || 320);

  // Responsivo: < md (768px) vira single-pane (lista OU leitura), pastas viram
  // barra horizontal no topo e as colunas arrastáveis somem.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Rascunho: id da linha sendo editada, último estado salvo e estado inicial
  // (para não criar rascunho só por abrir o compose sem digitar nada).
  const draftIdRef = useRef<string | undefined>(undefined);
  const lastSavedKeyRef = useRef('');
  const initialComposeKeyRef = useRef('');
  const [draftStatus, setDraftStatus] = useState<'' | 'saving' | 'saved'>('');

  const [signature, setSignature] = useState<EmailSignature | null>(null);
  const [savingSig, setSavingSig] = useState(false);

  const [prefs, setPrefs] = useState<EmailPrefs>(() => loadPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'geral' | 'assinatura' | 'antispam'>('geral');
  const [prefsDraft, setPrefsDraft] = useState<EmailPrefs>(prefs);
  const [sigDraft, setSigDraft] = useState<EmailSignature>({ user_id: '', name: '', signature_text: '', signature_html: '', use_html: false });

  const [spamRules, setSpamRules] = useState<EmailSpamRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState<{ kind: SpamRuleKind; match_type: SpamRuleMatch; value: string }>({
    kind: 'whitelist', match_type: 'address', value: '',
  });

  // `silent`: recarrega sem trocar a lista por spinner (fluido). O spinner só
  // aparece no 1º carregamento (lista vazia); refresh/realtime não "piscam".
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, count] = await Promise.all([
        emailService.listMessages(folder, search, limit, onlyUnread),
        emailService.countUnread('inbox'),
      ]);
      setMessages(list);
      setHasMore(list.length >= limit);
      setUnread(count);
      setSelected((prev) => (prev && list.some((m) => m.id === prev.id) ? prev : null));
      setChecked((prev) => new Set([...prev].filter((id) => list.some((m) => m.id === id))));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [folder, search, limit, onlyUnread]);

  useEffect(() => { load(); }, [load]);
  // Ao trocar de pasta/busca/filtro, volta ao tamanho de página inicial e limpa seleção.
  useEffect(() => { setLimit(prefs.perPage); setChecked(new Set()); }, [folder, search, prefs.perPage, onlyUnread]);
  useEffect(() => { emailService.getSignature().then((s) => { if (s) setSignature(s); }).catch(() => {}); }, []);

  // Atualização automática ao vivo: novo email chega -> recarrega (sem piscar).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Debounce: rajadas (ex.: backfill de milhares) colapsam numa única recarga silenciosa.
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadRef.current(true); }, 1200);
    };
    const ch = supabase
      .channel('email-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages' }, scheduleReload)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  const openMessage = async (m: EmailMessage) => {
    setSelected(m);
    setFocusedId(m.id);
    // Carrega a conversa (thread) para a leitura encadeada.
    if (m.thread_key) {
      setThreadLoading(true);
      emailService.listThread(m.thread_key)
        .then((msgs) => setThread(msgs.length ? msgs : [m]))
        .catch(() => setThread([m]))
        .finally(() => setThreadLoading(false));
    } else {
      setThread([m]);
    }
    if (prefs.autoMarkRead && !m.is_read && m.direction === 'inbound') {
      try {
        await emailService.markRead(m.id, true);
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch { /* noop */ }
    }
  };

  const dropFromList = (id: string) => {
    setMessages((prev) => prev.filter((x) => x.id !== id));
    setSelected((prev) => (prev?.id === id ? null : prev));
    setChecked((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  // ── Seleção múltipla ────────────────────────────────────────────────────
  const toggleChecked = (id: string) => {
    setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const allChecked = messages.length > 0 && checked.size === messages.length;
  const toggleCheckAll = () => {
    setChecked(allChecked ? new Set() : new Set(messages.map((m) => m.id)));
  };

  const bulkTrash = async () => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkMoveToTrash(ids);
    setMessages((prev) => prev.filter((m) => !checked.has(m.id)));
    setSelected((prev) => (prev && checked.has(prev.id) ? null : prev));
    setChecked(new Set());
  };
  const bulkMarkRead = async (isRead: boolean) => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkMarkRead(ids, isRead);
    setMessages((prev) => prev.map((m) => (checked.has(m.id) ? { ...m, is_read: isRead } : m)));
    void load(true);
  };

  const onEmptyTrash = async () => {
    const labels = { all: 'TODOS os itens', read: 'os itens LIDOS', unread: 'os itens NÃO LIDOS' };
    if (!window.confirm(`Esvaziar lixeira: excluir permanentemente ${labels[trashScope]}? Esta ação não pode ser desfeita.`)) return;
    setEmptyingTrash(true);
    try {
      const n = await emailService.emptyTrash(trashScope);
      window.alert(`${n} item(ns) excluído(s) permanentemente.`);
      if (folder === 'trash') void load(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao esvaziar a lixeira.');
    } finally {
      setEmptyingTrash(false);
    }
  };

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  // ↑/↓ navega · Enter abre · Del exclui · Ctrl/Cmd+A seleciona tudo · Esc limpa
  // r responder · f encaminhar · e alterna lido
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;

      if (composeOpen) {
        if (e.key === 'Escape' && !typing) { e.preventDefault(); setComposeOpen(false); }
        return;
      }
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setChecked((prev) => (prev.size === messages.length ? new Set() : new Set(messages.map((m) => m.id))));
        return;
      }
      if (e.key === 'Escape') {
        if (checked.size > 0) { setChecked(new Set()); return; }
        if (selected) setSelected(null);
        return;
      }
      if (!messages.length) return;

      // Navegação parte do item ATUALMENTE selecionado (ou em foco).
      const idx = messages.findIndex((m) => m.id === (selected?.id ?? focusedId));
      const focusedMsg = selected ?? messages.find((x) => x.id === focusedId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = messages[idx < 0 ? 0 : Math.min(messages.length - 1, idx + 1)];
        if (next) void openMessage(next); // muda seleção + atualiza preview
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = messages[idx < 0 ? 0 : Math.max(0, idx - 1)];
        if (prev) void openMessage(prev);
      } else if (e.key === 'Enter') {
        const m = messages.find((x) => x.id === focusedId) ?? selected;
        if (m) { e.preventDefault(); void openMessage(m); }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (folder === 'trash') return; // na lixeira use "Esvaziar lixeira"
        if (checked.size > 0) { void bulkTrash(); return; }
        const id = focusedId ?? selected?.id;
        if (id) { void emailService.moveToTrash(id).then(() => dropFromList(id)); }
      } else if (e.key.toLowerCase() === 'r' && selected) {
        e.preventDefault(); onReply();
      } else if (e.key.toLowerCase() === 'f' && selected) {
        e.preventDefault(); onForward();
      } else if (e.key.toLowerCase() === 'e' && focusedMsg) {
        e.preventDefault();
        void emailService.markRead(focusedMsg.id, !focusedMsg.is_read).then(() => {
          setMessages((prev) => prev.map((x) => (x.id === focusedMsg.id ? { ...x, is_read: !focusedMsg.is_read } : x)));
          if (selected?.id === focusedMsg.id) setSelected({ ...focusedMsg, is_read: !focusedMsg.is_read });
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messages, focusedId, checked, selected, composeOpen, settingsOpen, folder]);

  const onMarkAllRead = async () => {
    const n = await emailService.markAllRead(folder);
    if (n > 0) void load(true);
  };

  // Mantém o email selecionado visível na lista (scroll automático ao navegar).
  useEffect(() => {
    if (!selected) return;
    const el = listScrollRef.current?.querySelector<HTMLElement>(`[data-email-id="${selected.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);

  const toggleRead = async () => {
    if (!selected) return;
    const next = !selected.is_read;
    await emailService.markRead(selected.id, next);
    setMessages((prev) => prev.map((x) => (x.id === selected.id ? { ...x, is_read: next } : x)));
    setSelected({ ...selected, is_read: next });
    setUnread((u) => (next ? Math.max(0, u - 1) : u + 1));
  };

  const onSpam = async () => {
    if (!selected) return;
    await emailService.markSpam(selected, true);
    dropFromList(selected.id);
  };
  const onNotSpam = async () => {
    if (!selected) return;
    await emailService.unmarkSpam(selected, true);
    dropFromList(selected.id);
  };
  const onTrash = async () => {
    if (!selected) return;
    await emailService.moveToTrash(selected.id);
    dropFromList(selected.id);
  };
  const onRestore = async () => {
    if (!selected) return;
    await emailService.restoreFromTrash(selected.id);
    dropFromList(selected.id);
  };

  // Monta o corpo inicial do editor: espaço p/ digitar + assinatura + (citação).
  // Duas linhas em branco no topo dão respiro para escrever; um separador sutil
  // (estilo webmail) divide a mensagem da assinatura.
  const buildInitialBody = (quoteHtml = '') => {
    const sig = sigToHtml(signature);
    const sigBlock = sig
      ? `<p><br></p><div data-signature style="border-top:1px solid #ececec;padding-top:12px;margin-top:8px">${sig}</div>`
      : '';
    return `<p><br></p><p><br></p>${sigBlock}${quoteHtml}`;
  };

  const startCompose = (preset?: Partial<ComposeState>) => {
    const next = { ...emptyCompose, bodyHtml: buildInitialBody(), ...preset };
    // Novo compose: zera o rastreio de rascunho. Não há rascunho até o usuário digitar.
    draftIdRef.current = undefined;
    initialComposeKeyRef.current = composeKey(next);
    lastSavedKeyRef.current = composeKey(next);
    setDraftStatus('');
    setCompose(next);
    setSendError(null);
    setComposeOpen(true);
  };

  // Abre um rascunho existente no compose para continuar editando.
  const openDraft = (m: EmailMessage) => {
    const next: ComposeState = {
      ...emptyCompose,
      to: m.to_text ?? '',
      cc: m.cc_text ?? '',
      bcc: m.bcc_text ?? '',
      subject: m.subject ?? '',
      bodyHtml: m.body_html || buildInitialBody(),
      showCc: !!(m.cc_text || m.bcc_text),
      inReplyTo: m.in_reply_to ?? undefined,
      threadKey: m.thread_key ?? undefined,
      clientId: m.client_id ?? undefined,
    };
    draftIdRef.current = m.id;
    initialComposeKeyRef.current = composeKey(next);
    lastSavedKeyRef.current = composeKey(next);
    setDraftStatus('saved');
    setCompose(next);
    setSendError(null);
    setComposeOpen(true);
  };

  // Autosave do rascunho: salva 1,5s após parar de digitar, só se mudou desde a abertura.
  useEffect(() => {
    if (!composeOpen || sending) return;
    const key = composeKey(compose);
    if (key === initialComposeKeyRef.current || key === lastSavedKeyRef.current) return;
    setDraftStatus('saving');
    const t = setTimeout(async () => {
      try {
        const id = await emailService.saveDraft({
          id: draftIdRef.current,
          to: compose.to, cc: compose.cc, bcc: compose.bcc,
          subject: compose.subject, html: compose.bodyHtml,
          inReplyTo: compose.inReplyTo, threadKey: compose.threadKey, clientId: compose.clientId,
        });
        draftIdRef.current = id;
        lastSavedKeyRef.current = key;
        setDraftStatus('saved');
        if (folder === 'drafts') void load(true);
      } catch {
        setDraftStatus('');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [compose, composeOpen, sending, folder, load]);

  const onReply = () => {
    if (!selected) return;
    const original = selected.body_html
      ? `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${selected.body_html}</blockquote>`
      : `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</blockquote>`;
    const quote = `<br><div style="color:#888;font-size:13px">Em ${escapeHtml(formatTime(selected.sent_at))}, ${escapeHtml(senderName(selected))} escreveu:</div>${original}`;
    startCompose({
      to: selected.from_address ?? '',
      subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`,
      inReplyTo: selected.message_id,
      threadKey: selected.thread_key ?? selected.message_id,
      clientId: selected.client_id ?? undefined,
      bodyHtml: buildInitialBody(quote),
    });
  };

  const onReplyAll = () => {
    if (!selected) return;
    const original = selected.body_html
      ? `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${selected.body_html}</blockquote>`
      : `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</blockquote>`;
    const quote = `<br><div style="color:#888;font-size:13px">Em ${escapeHtml(formatTime(selected.sent_at))}, ${escapeHtml(senderName(selected))} escreveu:</div>${original}`;
    // To = remetente original; Cc = demais destinatários (To+Cc) menos a própria conta e o remetente.
    const me = MAILBOX_ADDRESS.toLowerCase();
    const fromAddr = (selected.from_address ?? '').toLowerCase();
    const others = [...extractAddresses(selected.to_text), ...extractAddresses(selected.cc_text)]
      .filter((a) => a !== me && a !== fromAddr);
    const ccUnique = Array.from(new Set(others));
    startCompose({
      to: selected.from_address ?? '',
      cc: ccUnique.join(', '),
      showCc: ccUnique.length > 0,
      subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`,
      inReplyTo: selected.message_id,
      threadKey: selected.thread_key ?? selected.message_id,
      clientId: selected.client_id ?? undefined,
      bodyHtml: buildInitialBody(quote),
    });
  };

  const onForward = () => {
    if (!selected) return;
    const body = selected.body_html
      ? selected.body_html
      : `<div>${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</div>`;
    const fwd = `<br><div style="color:#888;font-size:13px">---------- Mensagem encaminhada ----------<br>` +
      `De: ${escapeHtml(selected.from_text ?? selected.from_address ?? '')}<br>` +
      `Assunto: ${escapeHtml(selected.subject ?? '')}</div><br>${body}`;
    startCompose({
      subject: selected.subject?.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject ?? ''}`,
      bodyHtml: buildInitialBody(fwd),
    });
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const loaded = await Promise.all(
      Array.from(files).map(async (f) => ({
        filename: f.name,
        content: await fileToBase64(f),
        contentType: f.type || undefined,
        size: f.size,
      })),
    );
    setCompose((c) => ({ ...c, attachments: [...c.attachments, ...loaded] }));
  };

  const stripHtml = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent ?? '').trim();
  };

  const doSend = async () => {
    const toList = parseRecipients(compose.to);
    if (!toList.length || !compose.subject || !stripHtml(compose.bodyHtml)) {
      setSendError('Preencha destinatário, assunto e mensagem.');
      return;
    }
    const allRecipients = [...toList, ...parseRecipients(compose.cc), ...parseRecipients(compose.bcc)];
    const invalid = allRecipients.filter((e) => !isValidEmail(e));
    if (invalid.length) {
      setSendError(`Endereço inválido: ${invalid.map(addressOf).join(', ')}`);
      return;
    }
    const dto: SendEmailDTO = {
      to: compose.to,
      cc: compose.cc.trim() || undefined,
      bcc: compose.bcc.trim() || undefined,
      subject: compose.subject,
      html: compose.bodyHtml,
      inReplyTo: compose.inReplyTo,
      threadKey: compose.threadKey,
      clientId: compose.clientId,
      attachments: compose.attachments.length
        ? compose.attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType }))
        : undefined,
    };
    setSending(true);
    setSendError(null);
    try {
      await emailService.sendEmail(dto);
      setComposeOpen(false);
      await load();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  };

  const loadSpamRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      setSpamRules(await emailService.listSpamRules());
    } catch { /* noop */ } finally {
      setRulesLoading(false);
    }
  }, []);

  const openSettings = (tab: 'geral' | 'assinatura' | 'antispam' = 'geral') => {
    setPrefsDraft(prefs);
    setSigDraft(signature ?? { user_id: '', name: '', signature_text: '', signature_html: '', use_html: false });
    setSettingsTab(tab);
    setSettingsOpen(true);
    void loadSpamRules();
  };

  const addRule = async () => {
    if (!ruleForm.value.trim()) return;
    await emailService.addSpamRule(ruleForm.kind, ruleForm.match_type, ruleForm.value);
    setRuleForm({ ...ruleForm, value: '' });
    await loadSpamRules();
  };
  const removeRule = async (id: string) => {
    await emailService.deleteSpamRule(id);
    await loadSpamRules();
  };
  const toggleRule = async (r: EmailSpamRule) => {
    await emailService.setSpamRuleEnabled(r.id, !r.enabled);
    await loadSpamRules();
  };

  const trustSender = async () => {
    if (!selected?.from_address) return;
    await emailService.addSpamRule('whitelist', 'address', selected.from_address);
    if (selected.is_spam) {
      await emailService.unmarkSpam(selected, true);
      dropFromList(selected.id);
    } else {
      setSelected({ ...selected, is_spam: false, spam_reason: 'Remetente na whitelist' });
    }
  };

  const saveSettings = async () => {
    setSavingSig(true);
    try {
      // Geral (prefs) — persistido por navegador
      const nextPrefs: EmailPrefs = {
        perPage: clamp(Math.round(prefsDraft.perPage) || DEFAULT_PREFS.perPage, 10, 500),
        autoMarkRead: prefsDraft.autoMarkRead,
      };
      localStorage.setItem(LS_PREFS, JSON.stringify(nextPrefs));
      setPrefs(nextPrefs);
      // Assinatura — persistida no banco por usuário
      await emailService.saveSignature(sigDraft);
      setSignature(sigDraft);
      setSettingsOpen(false);
    } finally {
      setSavingSig(false);
    }
  };

  const printSelected = () => {
    if (!selected) return;
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = `
      <h2 style="margin:0 0 4px;font-size:18px">${esc(selected.subject || '(sem assunto)')}</h2>
      <div style="color:#555;font-size:13px;margin-bottom:2px"><b>De:</b> ${esc(selected.from_text || selected.from_address || '—')}</div>
      <div style="color:#555;font-size:13px;margin-bottom:2px"><b>Para:</b> ${esc(selected.to_text || '—')}</div>
      <div style="color:#888;font-size:12px;margin-bottom:12px">${esc(formatTime(selected.sent_at || selected.created_at))}</div>
      <hr style="border:none;border-top:1px solid #ddd;margin:0 0 12px">`;
    const content = selected.body_html
      ? selected.body_html
      : `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(selected.body_text || '')}</pre>`;
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(selected.subject || 'Email')}</title>` +
        `<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}img{max-width:100%}</style></head>` +
        `<body>${meta}${content}<script>window.onload=function(){setTimeout(function(){window.print();},250);};</script></body></html>`,
    );
    win.document.close();
  };

  // ── Redimensionamento das colunas (arrastar) ───────────────────────────
  const dragging = useRef<{ which: 'folders' | 'list'; startX: number; startW: number } | null>(null);
  const onGutterDown = (which: 'folders' | 'list') => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { which, startX: e.clientX, startW: which === 'folders' ? foldersW : listW };
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      const w = d.startW + (e.clientX - d.startX);
      if (d.which === 'folders') setFoldersW(clamp(w, 120, 280));
      else setListW(clamp(w, 220, 540));
    };
    const onUp = () => {
      if (dragging.current) {
        localStorage.setItem(LS_FOLDERS_W, String(foldersW));
        localStorage.setItem(LS_LIST_W, String(listW));
      }
      dragging.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [foldersW, listW]);

  const folderInfo = useMemo(() => FOLDERS.find((f) => f.key === folder), [folder]);

  return (
    <div className="relative flex h-full flex-col bg-[#f5f5f3] p-3 dark:bg-zinc-950 sm:p-4">
      {/* Pastas no mobile — barra horizontal (a coluna de pastas fica oculta < md) */}
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1 md:hidden">
        {FOLDERS.map(({ key, label, Icon }) => {
          const active = folder === key;
          return (
            <button key={key} onClick={() => { setFolder(key); setSelected(null); }}
              className={`flex flex-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] ${active ? 'bg-amber-50 font-medium text-amber-800' : 'border border-[#e7e5df] bg-white text-zinc-600'}`}>
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-amber-600' : 'text-zinc-400'}`} />
              {label}
              {key === 'inbox' && unread > 0 && (
                <span className="rounded-full bg-amber-600 px-1.5 text-[10px] font-medium text-white">{unread}</span>
              )}
            </button>
          );
        })}
        <button onClick={() => openSettings('geral')}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-1.5 text-[12px] text-zinc-600">
          <Settings className="h-3.5 w-3.5 text-zinc-400" /> Configurações
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[#e7e5df] bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Pastas (desktop) */}
        <div style={{ width: foldersW }} className="hidden flex-none border-r border-[#e7e5df] p-2 dark:border-zinc-800 md:block">
          {FOLDERS.map(({ key, label, Icon }) => {
            const active = folder === key;
            return (
              <button key={key} onClick={() => setFolder(key)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] ${active ? 'bg-amber-50 font-medium text-amber-800' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                <Icon className={`h-4 w-4 flex-none ${active ? 'text-amber-600' : 'text-zinc-400'}`} />
                <span className="flex-1 truncate text-left">{label}</span>
                {key === 'inbox' && unread > 0 && (
                  <span className="rounded-full bg-amber-600 px-1.5 text-[11px] font-medium text-white">{unread}</span>
                )}
              </button>
            );
          })}

          {/* Configurações — abaixo da Lixeira */}
          <div className="my-1 border-t border-[#f0efe9]" />
          <button onClick={() => openSettings('geral')}
            className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50">
            <Settings className="h-4 w-4 flex-none text-zinc-400" />
            <span className="flex-1 truncate text-left">Configurações</span>
          </button>
        </div>

        <div onMouseDown={onGutterDown('folders')} className="hidden w-1.5 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-amber-300 md:block" />

        {/* Lista — full-width no mobile; some quando há mensagem aberta (single-pane) */}
        <div style={isNarrow ? undefined : { width: listW }}
          className={`${selected && isNarrow ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col border-r border-[#e7e5df] dark:border-zinc-800 md:flex md:flex-none`}>
          <div className="flex items-center gap-2 border-b border-[#e7e5df] p-2 dark:border-zinc-800">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#e7e5df] px-2.5 py-1.5">
              <Search className="h-4 w-4 text-zinc-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar…"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400" />
            </div>
            <button onClick={() => load()} title="Atualizar"
              className="flex-none rounded-lg border border-[#e7e5df] p-1.5 text-zinc-500 hover:bg-zinc-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Barra de seleção / filtros */}
          {(messages.length > 0 || onlyUnread) && (
            <div className="flex items-center gap-2 border-b border-[#f0efe9] px-3 py-1.5 dark:border-zinc-800">
              <input type="checkbox" checked={allChecked} onChange={toggleCheckAll} disabled={messages.length === 0}
                ref={(el) => { if (el) el.indeterminate = checked.size > 0 && !allChecked; }}
                title="Selecionar todos (Ctrl+A)" />
              {checked.size > 0 ? (
                <>
                  <span className="text-[12px] text-zinc-500">{checked.size} selecionado(s)</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => bulkMarkRead(true)} title="Marcar como lido" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><MailOpen className="h-4 w-4" /></button>
                    <button onClick={() => bulkMarkRead(false)} title="Marcar como não lido" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><Mail className="h-4 w-4" /></button>
                    {folder !== 'trash' && (
                      <button onClick={bulkTrash} title="Mover para lixeira (Del)" className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </>
              ) : (
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setOnlyUnread((v) => !v)}
                    className={`rounded-md px-2 py-0.5 text-[12px] ${onlyUnread ? 'bg-amber-100 font-medium text-amber-800' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                    Não lidas
                  </button>
                  {unread > 0 && (folder === 'inbox') && (
                    <button onClick={onMarkAllRead} title="Marcar todas como lidas"
                      className="rounded-md px-2 py-0.5 text-[12px] text-zinc-500 hover:bg-zinc-100">
                      Marcar todas lidas
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {loading && messages.length === 0 ? (
              <EmailListSkeleton />
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                {folderInfo && <folderInfo.Icon className="mb-2 h-8 w-8 text-zinc-300" />}
                <p className="text-[13px] font-medium text-zinc-500">
                  {onlyUnread ? 'Nenhuma mensagem não lida.'
                    : folder === 'drafts' ? 'Sem rascunhos.'
                    : folder === 'trash' ? 'Lixeira vazia.'
                    : folder === 'spam' ? 'Nenhum spam por aqui.'
                    : search ? 'Nada encontrado para a busca.'
                    : 'Nenhuma mensagem.'}
                </p>
                {search && (
                  <button onClick={() => setSearch('')} className="mt-1.5 text-[12px] text-amber-700 hover:underline">
                    Limpar busca
                  </button>
                )}
              </div>
            ) : (
              <>
                {(() => { let lastKey = ''; return messages.map((m) => {
                  const isUnread = !m.is_read && m.direction === 'inbound';
                  const isSel = selected?.id === m.id;
                  const isFocused = focusedId === m.id;
                  const isChk = checked.has(m.id);
                  const bucket = dateBucket(m.sent_at || m.created_at);
                  const showHeader = bucket.key !== lastKey;
                  lastKey = bucket.key;
                  const name = senderName(m);
                  const preview = snippet(m);
                  return (
                    <div key={m.id}>
                      {showHeader && (
                        <div className="sticky top-0 z-[1] bg-white/95 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 backdrop-blur dark:bg-zinc-900/95">
                          {bucket.label}
                        </div>
                      )}
                      <div data-email-id={m.id} role="button" tabIndex={0} onClick={() => openMessage(m)}
                        className={`group flex w-full items-start gap-2.5 border-b border-[#f0efe9] px-3 py-2.5 text-left dark:border-zinc-800 ${isSel ? 'bg-amber-50' : isChk ? 'bg-amber-50/40' : 'hover:bg-zinc-50'} ${isFocused && !isSel ? 'ring-1 ring-inset ring-amber-300' : ''}`}>
                        <div className="relative mt-0.5 flex-none">
                          <input type="checkbox" checked={isChk}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleChecked(m.id)}
                            className={`absolute inset-0 z-10 m-auto h-4 w-4 ${isChk ? '' : 'opacity-0 group-hover:opacity-100'}`} />
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium ${avatarColor(name)} ${isChk ? 'opacity-0' : 'group-hover:opacity-0'}`}>
                            {name.charAt(0).toUpperCase() || '?'}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`truncate text-[13px] ${isUnread ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600'}`}>{name}</span>
                            <span className="flex-none text-[11px] text-zinc-400">{formatTime(m.sent_at || m.created_at)}</span>
                          </div>
                          <div className={`mt-0.5 flex items-center gap-1.5 truncate text-[13px] ${isUnread ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-600'}`}>
                            {isUnread && <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />}
                            {m.attachments?.length > 0 && <Paperclip className="h-3 w-3 flex-none text-zinc-400" />}
                            <span className="truncate">{m.subject || '(sem assunto)'}</span>
                          </div>
                          {preview && <div className="mt-0.5 truncate text-[12px] text-zinc-400">{preview}</div>}
                        </div>
                      </div>
                    </div>
                  );
                }); })()}
                {/* Paginação: carregar mais */}
                <div className="p-2 text-center">
                  {hasMore ? (
                    <button onClick={() => setLimit((l) => l + prefs.perPage)} disabled={loading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-60">
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Carregar mais
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-400">{messages.length} mensagem(ns)</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div onMouseDown={onGutterDown('list')} className="hidden w-1.5 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-amber-300 md:block" />

        {/* Leitura — full-width no mobile; oculta quando nenhuma mensagem aberta */}
        <div className={`${!selected && isNarrow ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center text-zinc-400">
              <Mail className="mb-2 h-8 w-8" />
              <p className="text-[13px]">Selecione uma mensagem em {folderInfo?.label}.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-[#e7e5df] p-2 dark:border-zinc-800">
                <button onClick={() => setSelected(null)}
                  className="mr-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-100 md:hidden">
                  <ChevronLeft className="h-4 w-4" /> Voltar
                </button>
                <ToolBtn onClick={onReply} Icon={Reply}>Responder</ToolBtn>
                <ToolBtn onClick={onReplyAll} Icon={ReplyAll}>Responder a todos</ToolBtn>
                <ToolBtn onClick={onForward} Icon={Forward}>Encaminhar</ToolBtn>
                <ToolBtn onClick={printSelected} Icon={Printer}>Imprimir</ToolBtn>
                <ToolBtn onClick={toggleRead} Icon={selected.is_read ? Mail : MailOpen}>
                  {selected.is_read ? 'Marcar não lido' : 'Marcar lido'}
                </ToolBtn>
                {folder === 'spam' ? (
                  <ToolBtn onClick={onNotSpam} Icon={Inbox}>Não é spam</ToolBtn>
                ) : (
                  <ToolBtn onClick={onSpam} Icon={AlertOctagon} danger>Spam</ToolBtn>
                )}
                {folder === 'trash' ? (
                  <ToolBtn onClick={onRestore} Icon={RotateCcw}>Restaurar</ToolBtn>
                ) : (
                  <ToolBtn onClick={onTrash} Icon={Trash2} danger>Excluir</ToolBtn>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-[16px] font-medium text-zinc-900 dark:text-zinc-100">{selected.subject || '(sem assunto)'}</h3>
                  {thread.length > 1 && (
                    <span className="flex-none rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                      {thread.length} mensagens
                    </span>
                  )}
                </div>

                {(selected.is_spam || (selected.spam_reason && (selected.spam_score ?? 0) > 0)) && (
                  <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${selected.is_spam ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <ShieldCheck className="h-4 w-4 flex-none" />
                    <span className="font-medium">{selected.is_spam ? 'Marcado como spam' : 'Sinais de spam'}</span>
                    {selected.spam_score != null && <span>· score {Number(selected.spam_score).toFixed(2)}</span>}
                    {selected.spam_reason && <span className="text-zinc-500">· {selected.spam_reason}</span>}
                    {selected.from_address && (
                      <button onClick={trustSender} className="ml-auto rounded-md border border-current px-2 py-0.5 hover:bg-white/40">
                        Confiar no remetente
                      </button>
                    )}
                  </div>
                )}

                {threadLoading && thread.length <= 1 ? (
                  <div className="flex h-20 items-center justify-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : (
                  (thread.length ? thread : [selected]).map((m, idx, arr) => (
                    <MessageView key={m.id} m={m} single={arr.length === 1} defaultOpen={idx === arr.length - 1} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Botão flutuante "Escrever" — acima do widget Mensagens (canto inferior direito) */}
      {!composeOpen && (
        <button onClick={() => startCompose()} title="Escrever" aria-label="Escrever"
          className="fixed bottom-[88px] right-5 z-[9990] flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-[0_8px_24px_-4px_rgba(217,119,6,.55)] ring-1 ring-white/20 transition-transform hover:scale-105 hover:bg-amber-700 active:scale-95 sm:right-6">
          <PenSquare className="h-6 w-6" />
        </button>
      )}

      {/* Compose em página (não-modal): cobre toda a área do módulo. */}
      {composeOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#f5f5f3] p-3 dark:bg-zinc-950 sm:p-4"
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) void doSend(); } }}>
          {/* Barra superior */}
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <PenSquare className="h-5 w-5 text-amber-600" />
              <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">
                {compose.subject || 'Nova mensagem'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setComposeOpen(false)}
                className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-50">
                Cancelar
              </button>
              <button onClick={doSend} disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
              </button>
            </div>
          </div>

          {/* Corpo do compose */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden rounded-xl border border-[#e7e5df] bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2 border-b border-[#f0efe9] pb-2">
              <span className="w-14 text-[13px] text-zinc-500">De</span>
              <span className="text-[13px] text-zinc-700">Pedro Montalvão &lt;pedro@advcuiaba.com&gt;</span>
            </div>

            <div className="flex items-start gap-2">
              <span className="w-14 pt-1.5 text-[13px] text-zinc-500">Para</span>
              <div className="flex-1">
                <RecipientChips value={compose.to} onChange={(v) => setCompose((c) => ({ ...c, to: v }))}
                  placeholder="destinatario@exemplo.com" autoFocus />
              </div>
              {!compose.showCc && (
                <button onClick={() => setCompose({ ...compose, showCc: true })}
                  className="pt-1.5 text-[12px] text-zinc-500 hover:text-amber-700">Cc/Cco</button>
              )}
            </div>

            {compose.showCc && (
              <>
                <div className="flex items-start gap-2">
                  <span className="w-14 pt-1.5 text-[13px] text-zinc-500">Cc</span>
                  <div className="flex-1">
                    <RecipientChips value={compose.cc} onChange={(v) => setCompose((c) => ({ ...c, cc: v }))}
                      placeholder="copia@exemplo.com" />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-14 pt-1.5 text-[13px] text-zinc-500">Cco</span>
                  <div className="flex-1">
                    <RecipientChips value={compose.bcc} onChange={(v) => setCompose((c) => ({ ...c, bcc: v }))}
                      placeholder="copia-oculta@exemplo.com" />
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <span className="w-14 text-[13px] text-zinc-500">Assunto</span>
              <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                placeholder="Assunto"
                className="flex-1 rounded-lg border border-[#e7e5df] px-3 py-1.5 text-[14px] outline-none focus:border-amber-400" />
            </div>

            <RichEditor
              key={compose.inReplyTo ?? 'new'}
              fill
              initialHtml={compose.bodyHtml}
              onChange={(html) => setCompose((c) => ({ ...c, bodyHtml: html }))}
              onAttach={addAttachments}
            />

            {compose.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {compose.attachments.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-zinc-50 px-2 py-1 text-[12px] text-zinc-600">
                    <Paperclip className="h-3.5 w-3.5 text-amber-600" />
                    <span className="max-w-[160px] truncate">{a.filename}</span>
                    <span className="text-zinc-400">{humanSize(a.size)}</span>
                    <button onClick={() => setCompose((c) => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
                      className="text-zinc-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}

            {sendError && <p className="text-[13px] text-red-600">{sendError}</p>}
          </div>
        </div>
      )}

      {settingsOpen && (
        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Configurações de Email" size="lg">
          <ModalBody>
            <div className="mb-4 inline-flex rounded-lg border border-[#e7e5df] p-0.5">
              <FormatBtn active={settingsTab === 'geral'} onClick={() => setSettingsTab('geral')} Icon={SlidersHorizontal}>Geral</FormatBtn>
              <FormatBtn active={settingsTab === 'assinatura'} onClick={() => setSettingsTab('assinatura')} Icon={PenLine}>Assinatura</FormatBtn>
              <FormatBtn active={settingsTab === 'antispam'} onClick={() => setSettingsTab('antispam')} Icon={ShieldCheck}>Antispam</FormatBtn>
            </div>

            {settingsTab === 'geral' && (
              <div className="space-y-4">
                <div>
                  <Label>Emails por página</Label>
                  <Input type="number" min={10} max={500} value={prefsDraft.perPage}
                    onChange={(e) => setPrefsDraft({ ...prefsDraft, perPage: Number(e.target.value) })} />
                  <p className="mt-1 text-[12px] text-zinc-400">Quantas mensagens carregar na lista (10–500).</p>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input type="checkbox" checked={prefsDraft.autoMarkRead}
                    onChange={(e) => setPrefsDraft({ ...prefsDraft, autoMarkRead: e.target.checked })} />
                  Marcar como lida automaticamente ao abrir a mensagem
                </label>

                <div className="border-t border-[#f0efe9] pt-4">
                  <Label>Limpar lixeira</Label>
                  <p className="mb-2 text-[12px] text-zinc-400">Exclui permanentemente itens da lixeira. Não pode ser desfeito.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={trashScope} onChange={(e) => setTrashScope(e.target.value as typeof trashScope)}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="all">Todo o período</option>
                      <option value="read">Apenas lidos</option>
                      <option value="unread">Apenas não lidos</option>
                    </select>
                    <button onClick={onEmptyTrash} disabled={emptyingTrash}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[13px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">
                      {emptyingTrash ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Esvaziar lixeira
                    </button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab === 'assinatura' && (
              <div className="space-y-3">
                <div>
                  <Label>Nome de exibição (opcional)</Label>
                  <Input value={sigDraft.name ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, name: e.target.value })} placeholder="Dr. Pedro Montalvão" />
                </div>
                <div>
                  <Label>Assinatura — texto simples</Label>
                  <textarea value={sigDraft.signature_text ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, signature_text: e.target.value })} rows={4}
                    className="w-full resize-y rounded-lg border border-[#e7e5df] px-3 py-2 text-[14px] outline-none focus:border-amber-400"
                    placeholder={'Dr. Pedro Montalvão\nOAB/MT 30.021'} />
                </div>
                <div>
                  <Label>Assinatura — HTML</Label>
                  <textarea value={sigDraft.signature_html ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, signature_html: e.target.value })} rows={5}
                    className="w-full resize-y rounded-lg border border-[#e7e5df] px-3 py-2 font-mono text-[13px] outline-none focus:border-amber-400"
                    placeholder='<div><strong>Dr. Pedro Montalvão</strong><br>OAB/MT 30.021</div>' />
                  {sigDraft.signature_html && (
                    <div className="mt-2 rounded-lg border border-[#f0efe9] p-2">
                      <p className="mb-1 text-[11px] text-zinc-400">Prévia</p>
                      <iframe title="sig-preview" sandbox="" srcDoc={sigDraft.signature_html} className="h-24 w-full" />
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input type="checkbox" checked={sigDraft.use_html} onChange={(e) => setSigDraft({ ...sigDraft, use_html: e.target.checked })} />
                  Usar HTML por padrão ao escrever
                </label>
              </div>
            )}

            {settingsTab === 'antispam' && (
              <div className="space-y-4">
                <p className="text-[12px] text-zinc-500">
                  A classificação combina autenticação do remetente (SPF/DKIM/DMARC), regras abaixo e heurísticas de conteúdo.
                  <b className="text-zinc-700"> Whitelist</b> nunca marca como spam; <b className="text-zinc-700">blocklist</b> vai direto pro spam.
                </p>

                {/* Formulário de nova regra */}
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[#e7e5df] p-2.5">
                  <div>
                    <Label>Tipo</Label>
                    <select value={ruleForm.kind} onChange={(e) => setRuleForm({ ...ruleForm, kind: e.target.value as SpamRuleKind })}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="whitelist">Whitelist (confiável)</option>
                      <option value="blocklist">Blocklist (bloquear)</option>
                    </select>
                  </div>
                  <div>
                    <Label>Critério</Label>
                    <select value={ruleForm.match_type} onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value as SpamRuleMatch })}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="address">Endereço</option>
                      <option value="domain">Domínio</option>
                      <option value="from_regex">Remetente (regex)</option>
                      <option value="subject_regex">Assunto (regex)</option>
                      <option value="body_regex">Corpo (regex)</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <Label>Valor</Label>
                    <Input value={ruleForm.value} onChange={(e) => setRuleForm({ ...ruleForm, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addRule(); }}
                      placeholder={ruleForm.match_type === 'domain' ? 'exemplo.com.br' : ruleForm.match_type === 'address' ? 'fulano@exemplo.com' : 'expressão'} />
                  </div>
                  <button onClick={addRule}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-amber-700">
                    <Plus className="h-4 w-4" /> Adicionar
                  </button>
                </div>

                {/* Lista de regras */}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[#e7e5df]">
                  {rulesLoading ? (
                    <div className="flex h-20 items-center justify-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : spamRules.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-zinc-400">Nenhuma regra cadastrada.</div>
                  ) : (
                    spamRules.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 border-b border-[#f0efe9] px-3 py-2 last:border-0">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.kind === 'whitelist' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {r.kind === 'whitelist' ? 'Permitir' : 'Bloquear'}
                        </span>
                        <span className="text-[11px] text-zinc-400">{MATCH_LABEL[r.match_type]}</span>
                        <span className={`flex-1 truncate text-[13px] ${r.enabled ? 'text-zinc-800' : 'text-zinc-400 line-through'}`}>{r.value}</span>
                        <button onClick={() => toggleRule(r)} className="text-[12px] text-zinc-500 hover:text-amber-700">
                          {r.enabled ? 'Desativar' : 'Ativar'}
                        </button>
                        <button onClick={() => removeRule(r.id)} title="Excluir" className="text-zinc-400 hover:text-red-600">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Button>
            <button onClick={saveSettings} disabled={savingSig}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
              {savingSig ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

// Anexos de uma mensagem (chips clicáveis → URL assinada do bucket privado).
function AttachmentChips({ m }: { m: EmailMessage }) {
  if (!m.attachments?.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {m.attachments.map((a, i) => (
        <button key={i} onClick={async () => { if (a.path) { const u = await emailService.attachmentUrl(a.path); if (u) window.open(u, '_blank'); } }}
          className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2 py-1 text-[12px] text-zinc-600 hover:bg-zinc-50">
          <Paperclip className="h-3.5 w-3.5 text-amber-600" />{a.filename || 'anexo'}
        </button>
      ))}
    </div>
  );
}

/**
 * Uma mensagem na leitura. Quando faz parte de uma conversa (single=false) vira
 * um card colapsável (cabeçalho clicável); a última fica aberta por padrão.
 */
function MessageView({ m, single, defaultOpen }: { m: EmailMessage; single: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(single || defaultOpen);
  const name = senderName(m);
  const time = formatTime(m.sent_at || m.created_at);
  const isOut = m.direction === 'outbound';
  const body = m.body_html
    ? <EmailHtmlFrame html={m.body_html} />
    : <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-200">{m.body_text || '(sem conteúdo)'}</pre>;

  if (single) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-2.5">
          <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-medium ${avatarColor(name)}`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px]">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">{name}</span>
              {m.from_address && <span className="text-zinc-500"> &lt;{m.from_address}&gt;</span>}
            </div>
            <div className="text-[12px] text-zinc-400">para {m.to_text || '—'} · {time}</div>
          </div>
        </div>
        <AttachmentChips m={m} />
        {body}
      </div>
    );
  }

  return (
    <div className={`mb-2 overflow-hidden rounded-lg border ${open ? 'border-[#e7e5df]' : 'border-[#f0efe9]'}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50">
        <div className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-medium ${avatarColor(name)}`}>
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
              {isOut ? `Você → ${m.to_text || '—'}` : name}
            </span>
            <span className="flex-none text-[11px] text-zinc-400">{time}</span>
          </div>
          {open
            ? <div className="truncate text-[12px] text-zinc-400">{isOut ? `de ${name}` : `para ${m.to_text || '—'}`}</div>
            : <div className="truncate text-[12px] text-zinc-400">{snippet(m, 90)}</div>}
        </div>
      </button>
      {open && (
        <div className="border-t border-[#f5f4f0] px-3 py-3">
          <AttachmentChips m={m} />
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza o HTML do email num iframe que cresce ate a altura total do
 * conteudo — sem barra de rolagem interna. O scroll fica na coluna de leitura
 * (na pagina), nunca dentro do preview.
 * `sandbox="allow-same-origin"` (sem allow-scripts) permite medir a altura do
 * documento sem deixar o email executar JS.
 */
function EmailHtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
    if (h > 0) setHeight(h + 8);
  }, []);

  const onLoad = useCallback(() => {
    measure();
    // Remede apos imagens carregarem (alteram a altura).
    const doc = ref.current?.contentDocument;
    doc?.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
    setTimeout(measure, 300);
  }, [measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  return (
    <iframe
      ref={ref}
      title="email"
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={onLoad}
      style={{ height }}
      scrolling="no"
      className="w-full overflow-hidden rounded-lg border border-[#f0efe9]"
    />
  );
}

/**
 * Editor rich-text leve (sem dependências) baseado em contentEditable +
 * execCommand. Gera HTML. Barra com negrito/itálico/sublinhado/listas/link
 * e botão de anexar — no estilo do compose do webmail.
 */
function RichEditor({ initialHtml, onChange, onAttach, fill }: {
  initialHtml: string;
  onChange: (html: string) => void;
  onAttach: (files: FileList | null) => void;
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
    }
    // só na montagem (key force remonta ao trocar de mensagem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda a seleção atual — controles nativos (select/color) tiram o foco do
  // editor e colapsam a seleção; salvamos e restauramos para aplicar no trecho certo.
  const savedRange = useRef<Range | null>(null);
  const saveSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) {
      savedRange.current = s.getRangeAt(0).cloneRange();
    }
  };
  const restoreSel = () => {
    const s = window.getSelection();
    if (savedRange.current && s) { s.removeAllRanges(); s.addRange(savedRange.current); }
  };

  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    document.execCommand(cmd, false, value);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  // exec a partir de controle que tirou o foco (select/color): restaura a seleção antes.
  const execFromControl = (cmd: string, value?: string) => {
    ref.current?.focus();
    restoreSel();
    exec(cmd, value);
  };

  const addLink = () => {
    const url = window.prompt('URL do link:', 'https://');
    if (url) exec('createLink', url);
  };

  const FONTS = [
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Calibri, Candara, Segoe, sans-serif', 'Calibri'],
    ['Georgia, "Times New Roman", serif', 'Georgia'],
    ['"Times New Roman", Times, serif', 'Times New Roman'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['"Courier New", Courier, monospace', 'Courier New'],
  ];
  const SIZES = [['2', 'Pequena'], ['3', 'Normal'], ['4', 'Média'], ['5', 'Grande'], ['6', 'Enorme']];

  const Btn = ({ onClick, Icon, title }: { onClick: () => void; Icon: typeof Bold; title: string }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100">
      <Icon className="h-4 w-4" />
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px flex-none bg-[#e7e5df]" />;
  const selCls = 'h-7 rounded-md border border-[#e7e5df] bg-white px-1.5 text-[12px] text-zinc-600 outline-none hover:bg-zinc-50 focus:border-amber-400';

  return (
    <div className={`flex flex-col rounded-lg border border-[#e7e5df] focus-within:border-amber-400 ${fill ? 'min-h-0 flex-1' : ''}`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#f0efe9] px-1.5 py-1.5">
        {/* Fonte e tamanho */}
        <select title="Fonte" className={`${selCls} w-[92px]`}
          onMouseDown={saveSel}
          onChange={(e) => { const v = e.target.value; e.currentTarget.selectedIndex = 0; if (v) execFromControl('fontName', v); }}>
          <option value="">Fonte</option>
          {FONTS.map(([v, label]) => <option key={v} value={v} style={{ fontFamily: v }}>{label}</option>)}
        </select>
        <select title="Tamanho" className={`${selCls} w-[78px]`}
          onMouseDown={saveSel}
          onChange={(e) => { const v = e.target.value; e.currentTarget.selectedIndex = 0; if (v) execFromControl('fontSize', v); }}>
          <option value="">Tam.</option>
          {SIZES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <Sep />

        {/* Estilo */}
        <Btn onClick={() => exec('bold')} Icon={Bold} title="Negrito (Ctrl+B)" />
        <Btn onClick={() => exec('italic')} Icon={Italic} title="Itálico (Ctrl+I)" />
        <Btn onClick={() => exec('underline')} Icon={Underline} title="Sublinhado (Ctrl+U)" />
        <Btn onClick={() => exec('strikeThrough')} Icon={Strikethrough} title="Tachado" />
        <button type="button" title="Cor do texto" onMouseDown={(e) => { e.preventDefault(); saveSel(); }}
          onClick={() => colorRef.current?.click()} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100">
          <Palette className="h-4 w-4" />
        </button>
        <input ref={colorRef} type="color" className="hidden"
          onChange={(e) => execFromControl('foreColor', e.target.value)} />
        <Sep />

        {/* Alinhamento */}
        <Btn onClick={() => exec('justifyLeft')} Icon={AlignLeft} title="Alinhar à esquerda" />
        <Btn onClick={() => exec('justifyCenter')} Icon={AlignCenter} title="Centralizar" />
        <Btn onClick={() => exec('justifyRight')} Icon={AlignRight} title="Alinhar à direita" />
        <Sep />

        {/* Listas, citação, link */}
        <Btn onClick={() => exec('insertUnorderedList')} Icon={List} title="Lista" />
        <Btn onClick={() => exec('insertOrderedList')} Icon={ListOrdered} title="Lista numerada" />
        <Btn onClick={() => exec('formatBlock', 'blockquote')} Icon={Quote} title="Citação" />
        <Btn onClick={addLink} Icon={Link2} title="Inserir link" />
        <Sep />

        {/* Limpar e anexar */}
        <Btn onClick={() => exec('removeFormat')} Icon={RemoveFormatting} title="Limpar formatação" />
        <Btn onClick={() => fileRef.current?.click()} Icon={Paperclip} title="Anexar arquivo" />
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={(e) => { onAttach(e.target.files); e.target.value = ''; }} />
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onKeyUp={saveSel} onMouseUp={saveSel} onBlur={saveSel}
        style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '14px', lineHeight: 1.6, color: '#1f2937' }}
        className={`overflow-y-auto px-4 py-3 outline-none [&_a]:text-amber-700 [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 ${fill ? 'min-h-[280px] flex-1' : 'min-h-[260px] max-h-[45vh]'}`} />
    </div>
  );
}

// Campo de destinatários estilo webmail: chips por endereço, parsing por
// vírgula/ponto-e-vírgula/Enter, validação visual (inválido fica vermelho),
// Backspace remove o último. O valor externo continua sendo a string separada por
// vírgulas (compatível com o DTO/ponte), então nada muda no envio.
function RecipientChips({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const emails = parseRecipients(value);
  const setEmails = (list: string[]) => onChange(list.join(', '));
  const commitDraft = () => {
    const parts = parseRecipients(draft);
    if (parts.length) setEmails([...emails, ...parts]);
    setDraft('');
  };
  const removeAt = (i: number) => setEmails(emails.filter((_, j) => j !== i));

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#e7e5df] px-2 py-1 focus-within:border-amber-400">
      {emails.map((e, i) => {
        const ok = isValidEmail(e);
        return (
          <span key={`${e}-${i}`} title={ok ? e : 'Endereço inválido'}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] ${ok ? 'bg-zinc-100 text-zinc-700' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
            {!ok && <AlertCircle className="h-3 w-3 flex-none" />}
            <span className="max-w-[220px] truncate">{e}</span>
            <button type="button" onClick={() => removeAt(i)} className="flex-none text-zinc-400 hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <input value={draft} autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && draft.includes('@'))) {
            e.preventDefault(); commitDraft();
          } else if (e.key === 'Backspace' && !draft && emails.length) {
            e.preventDefault(); removeAt(emails.length - 1);
          }
        }}
        onBlur={commitDraft}
        placeholder={emails.length ? '' : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-[14px] outline-none placeholder:text-zinc-400" />
    </div>
  );
}

// Esqueleto de carregamento da lista — substitui o spinner por linhas "fantasma"
// (sensação de webmail carregando, sem layout shift quando os dados chegam).
function EmailListSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 border-b border-[#f0efe9] px-3 py-2.5 dark:border-zinc-800">
          <div className="h-8 w-8 flex-none rounded-full bg-zinc-200/70 dark:bg-zinc-700" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-2.5 w-28 rounded bg-zinc-200/70 dark:bg-zinc-700" />
              <div className="h-2.5 w-8 rounded bg-zinc-200/50 dark:bg-zinc-700/60" />
            </div>
            <div className="h-2.5 w-3/4 rounded bg-zinc-200/70 dark:bg-zinc-700" />
            <div className="h-2.5 w-1/2 rounded bg-zinc-200/40 dark:bg-zinc-700/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolBtn({ onClick, Icon, children, danger }: { onClick: () => void; Icon: typeof Reply; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-zinc-100 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-zinc-600'}`}>
      <Icon className="h-3.5 w-3.5" />{children}
    </button>
  );
}

function FormatBtn({ active, onClick, Icon, children }: { active: boolean; onClick: () => void; Icon: typeof Type; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${active ? 'bg-amber-100 font-medium text-amber-800' : 'text-zinc-500 hover:text-zinc-700'}`}>
      <Icon className="h-3.5 w-3.5" />{children}
    </button>
  );
}
