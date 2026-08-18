// O ESTADO DO AVISO DE CHAMADA PERDIDA — fora do React, como o das chamadas.
//
// Mesmo padrão do `callStore`: singleton com `subscribe`/`getSnapshot` para o
// `useSyncExternalStore`. Aqui o motivo é ainda mais direto — o aviso precisa
// sobreviver à troca de módulo, ao fechamento do painel e ao F5. Um estado de
// componente morreria em todas essas três coisas, e o cartão existe justamente
// para NÃO morrer antes de alguém vê-lo.
//
// Duas fontes alimentam a lista, e as duas são necessárias:
//
//  · O EVENTO local (`waCallsStore.onMissedCall`), no instante em que o
//    telefone para de tocar. É o caminho rápido, e o único que funciona com o
//    CRM aberto em qualquer tela.
//  · A RELEITURA do registro (`callLogService.listRecentMissed`), para o que
//    tocou na mesa do colega, no celular do escritório, ou enquanto esta aba
//    estava fechada. Sem ela, o aviso seria pessoal em vez de ser do
//    escritório — e chamada perdida é do escritório.
//
// O que a lista mostra é decidido pelas regras puras de `missedCalls.ts`; aqui
// só moram a persistência, as fontes e o relógio.
import { callLogService, type CallLogRow } from '../callLog.service';
import { waCallsStore } from './callStore';
import { markCallsSeen, readCallsSeenUntilMs, subscribeCallsSeen } from './callsSeen';
import {
  MISSED_CALL_WINDOW_MS,
  mergeMissedCalls,
  parseStoredDismissed,
  parseStoredMissedCalls,
  pruneDismissed,
  type DismissedMissedCall,
  type MissedCall,
} from './missedCalls';
import type { WaCall } from './types';

/** O aviso guardado, para atravessar o F5. */
const LIST_KEY = 'wa:missedCalls';
/** O que esta mesa já dispensou. */
const DISMISSED_KEY = 'wa:missedCallsDismissed';

/**
 * De quanto em quanto tempo o registro é relido.
 *
 * O mesmo intervalo do distintivo da aba de Ligações, e pelo mesmo motivo:
 * cinco minutos é o tempo em que uma perdida ainda é notícia e a consulta não
 * pesa. Só corre com a aba à vista — releitura de aba escondida é conta paga
 * para ninguém ver.
 */
const REFRESH_MS = 5 * 60_000;

export interface MissedCallsSnapshot {
  /** As perdidas que ainda merecem tela, da mais recente para a mais antiga. */
  calls: MissedCall[];
}

const listeners = new Set<() => void>();
let entries: MissedCall[] = [];
let dismissed: DismissedMissedCall[] = [];
let snapshot: MissedCallsSnapshot = { calls: [] };
let started = false;
let refreshing: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** Tudo o que `init` ligou, para `shutdown` desligar de verdade. */
let cleanups: Array<() => void> = [];

const ler = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const gravar = (key: string, valor: string): void => {
  try { localStorage.setItem(key, valor); } catch { /* aba privada: o aviso vale só nesta sessão */ }
};

/**
 * Refaz a lista visível e avisa a tela — mas só quando ela mudou de verdade.
 *
 * A comparação por conteúdo não é economia de renderização: o
 * `useSyncExternalStore` exige que o retrato só troque de identidade quando o
 * estado troca. Devolvendo um array novo a cada leitura, o React entraria em
 * laço de atualização.
 */
function recompute(persist = true): void {
  const now = Date.now();
  dismissed = pruneDismissed(dismissed, now);
  const visiveis = mergeMissedCalls(entries, [], {
    now,
    dismissed: dismissed.map(d => d.callId),
    seenUntil: readCallsSeenUntilMs(),
  });
  // A lista guardada é a VISÍVEL: o que saiu por tempo, por marca de visto ou
  // por dispensa não precisa voltar do armazenamento no próximo F5.
  entries = visiveis;
  if (persist) {
    gravar(LIST_KEY, JSON.stringify(visiveis));
    gravar(DISMISSED_KEY, JSON.stringify(dismissed));
  }
  const igual = snapshot.calls.length === visiveis.length
    && snapshot.calls.every((c, i) => c.callId === visiveis[i].callId && c.name === visiveis[i].name
      && c.avatarUrl === visiveis[i].avatarUrl && c.avatarPath === visiveis[i].avatarPath
      && c.phone === visiveis[i].phone && c.conversationId === visiveis[i].conversationId);
  if (igual) return;
  snapshot = { calls: visiveis };
  listeners.forEach(fn => fn());
}

/** Entram chamadas novas (do evento ou da releitura) e a tela se refaz. */
function add(novas: readonly MissedCall[]): void {
  if (novas.length === 0) return;
  entries = mergeMissedCalls(entries, novas, {
    now: Date.now(),
    dismissed: dismissed.map(d => d.callId),
    seenUntil: readCallsSeenUntilMs(),
  });
  recompute();
}

/** A chamada que acabou de tocar aqui, do jeito que o aviso precisa dela. */
function fromWaCall(call: WaCall): MissedCall {
  return {
    callId: call.callId,
    phone: call.phone || '',
    lid: call.lid ?? null,
    name: call.contact?.name ?? null,
    avatarUrl: call.contact?.avatarUrl ?? null,
    avatarPath: null,
    conversationId: call.contact?.conversationId ?? null,
    clientId: call.contact?.clientId ?? null,
    startedAt: call.startedAt || Date.now(),
  };
}

/** A linha do registro, idem. O rosto vem como CAMINHO e é assinado na tela. */
function fromLogRow(row: CallLogRow): MissedCall {
  return {
    callId: row.callId,
    phone: row.phone || '',
    lid: row.peerLid ?? null,
    name: row.contactName ?? null,
    avatarUrl: null,
    avatarPath: row.contactAvatarPath ?? null,
    conversationId: row.conversationId,
    clientId: row.clientId,
    startedAt: Date.parse(row.startedAt),
  };
}

/** Lê o que ficou guardado do outro carregamento (ou da outra aba). */
function loadFromStorage(): void {
  entries = parseStoredMissedCalls(ler(LIST_KEY));
  dismissed = parseStoredDismissed(ler(DISMISSED_KEY));
}

export const missedCallsStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getSnapshot(): MissedCallsSnapshot {
    return snapshot;
  },

  /** Liga as fontes. Idempotente: várias telas podem chamar. */
  init(): void {
    if (started || typeof window === 'undefined') return;
    started = true;

    loadFromStorage();
    recompute(false);

    // 1. O telefone parou de tocar aqui.
    cleanups.push(waCallsStore.onMissedCall(call => add([fromWaCall(call)])));

    // 2. Alguém deu as ligações por vistas (aqui, no cartão, ou na aba).
    cleanups.push(subscribeCallsSeen(() => recompute()));

    // 3. A outra aba mexeu na lista: as duas mostram a mesma coisa.
    const daOutraAba = (event: StorageEvent) => {
      if (event.key !== LIST_KEY && event.key !== DISMISSED_KEY) return;
      loadFromStorage();
      recompute(false);
    };
    window.addEventListener('storage', daOutraAba);
    cleanups.push(() => window.removeEventListener('storage', daOutraAba));

    // 4. O registro do escritório, de tempos em tempos e ao voltar para a aba.
    timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, REFRESH_MS);
    const aoVoltar = () => { if (!document.hidden) void this.refresh(); };
    document.addEventListener('visibilitychange', aoVoltar);
    cleanups.push(() => document.removeEventListener('visibilitychange', aoVoltar));
    void this.refresh();
  },

  /**
   * Relê as perdidas recentes do escritório.
   *
   * Uma consulta por vez: a volta à aba e o relógio de cinco minutos podem
   * cair juntos, e duas consultas iguais no mesmo instante não trazem nada de
   * novo. Falha de rede não vira erro na tela — o aviso é um extra sobre o que
   * já está guardado, e um toast vermelho por causa dele atrapalharia mais do
   * que a ligação que ele deixou de mostrar.
   */
  refresh(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const desde = Date.now() - MISSED_CALL_WINDOW_MS;
        const rows = await callLogService.listRecentMissed(desde);
        add(rows.map(fromLogRow));
      } catch {
        // Sem rede, fica o que já está na tela.
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },

  /** "Já vi esta." Some da tela e não volta na próxima releitura. */
  dismiss(callIds: readonly string[]): void {
    if (callIds.length === 0) return;
    const now = Date.now();
    dismissed = [...dismissed, ...callIds.map(callId => ({ callId, at: now }))];
    recompute();
  },

  /**
   * "Já vi todas."
   *
   * Além de limpar o cartão, AVANÇA a marca compartilhada: quem dispensou o
   * aviso viu as ligações, e o distintivo da aba de Ligações não pode continuar
   * aceso apontando para as mesmas chamadas.
   */
  dismissAll(): void {
    const atuais = snapshot.calls;
    if (atuais.length === 0) return;
    const maisRecente = atuais.reduce((a, c) => (c.startedAt > a ? c.startedAt : a), 0);
    this.dismiss(atuais.map(c => c.callId));
    if (maisRecente > 0) markCallsSeen(new Date(maisRecente).toISOString());
  },

  /** Solta tudo o que `init` ligou. Só para testes e para o fim da aba. */
  shutdown(): void {
    if (timer) clearInterval(timer);
    timer = null;
    cleanups.forEach(fn => { try { fn(); } catch { /* já solto */ } });
    cleanups = [];
    started = false;
  },
};
