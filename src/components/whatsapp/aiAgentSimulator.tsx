/**
 * Prévia do agente — conversar com ele antes de soltar no canal.
 *
 * É uma gaveta ao lado do formulário: você escreve como se fosse o cliente e o
 * agente responde de verdade, pelo mesmo motor do atendimento
 * (`whatsapp-ai-agent`, modo `simulate`). Mesmo prompt, mesmas ferramentas,
 * mesmo modelo.
 *
 * O QUE NÃO ACONTECE AQUI: nada é gravado, nenhuma das oito ações é executada e
 * nenhuma mensagem sai para ninguém. Toda ferramenta que o agente pedir aparece
 * como "simulada", com o destino que ele escolheu — é justamente isso que se
 * quer conferir.
 *
 * Como não existe sessão no banco, a memória volta do servidor a cada turno e é
 * reenviada no seguinte: é ela que dá continuidade à conversa.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BrainCircuit, Clock, Loader2, RotateCcw, Send, Sparkles, User, X, Zap,
} from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { WA_AI_ACTIONS } from '../../utils/waAiActionCatalog';
import { isWaAiResetCommand } from '../../utils/waAiResetCommand';
import type {
  WhatsAppAiAssistantInput, WhatsAppAiSimulatedAction, WhatsAppAiSimulationResult,
} from '../../types/whatsapp.types';

const SIMULATOR_CSS = `
  /* Painel flutuante ancorado no canto de baixo. Antes ia de topo a rodapé e
     tapava a tela inteira do CRM; agora tem altura própria e só cresce até o
     limite da janela em telas baixas. A conversa rola dentro do corpo. */
  .wa-sim {
    position: fixed; right: 14px; bottom: 14px; z-index: 60;
    width: min(410px, calc(100vw - 28px));
    height: min(560px, calc(100vh - 28px));
    display: flex; flex-direction: column; overflow: hidden;
    background: #fff; border: 1px solid #e7e5df; border-radius: 14px;
    box-shadow: 0 20px 50px rgba(15,23,42,.18);
  }
  .wa-sim-head {
    display: flex; align-items: center; gap: 9px; padding: 12px 14px;
    border-bottom: 1px solid #f0eee9; flex-shrink: 0;
  }
  .wa-sim-body {
    flex: 1; overflow-y: auto; padding: 14px; background: #f7f5f2;
    display: flex; flex-direction: column; gap: 10px;
  }
  .wa-sim-foot { border-top: 1px solid #f0eee9; padding: 10px 12px; flex-shrink: 0; background: #fff; }
  .wa-sim-icon {
    background: transparent; border: none; cursor: pointer; color: #6b7280;
    padding: 5px; border-radius: 7px; display: inline-flex;
  }
  .wa-sim-icon:hover { background: #f3f4f6; color: #111827; }
  .wa-sim-icon:focus-visible, .wa-sim-send:focus-visible, .wa-sim-input:focus-visible {
    outline: 2px solid #ea6c00; outline-offset: 1px;
  }
  .wa-sim-send {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border: none; border-radius: 9px;
    background: #ea6c00; color: #fff; cursor: pointer; flex-shrink: 0;
  }
  .wa-sim-send:disabled { opacity: .45; cursor: not-allowed; }
  .wa-sim-input {
    flex: 1; resize: none; font: inherit; font-size: 12.5px; line-height: 1.5;
    padding: 8px 10px; border-radius: 9px; border: 1px solid #d1d5db; color: #111827;
  }
  @media (max-width: 640px) {
    .wa-sim {
      inset: 0; width: 100vw; height: 100vh;
      border: none; border-radius: 0;
    }
  }
`;

type Turn =
  | { who: 'cliente'; text: string }
  | { who: 'agente'; text: string; actions: WhatsAppAiSimulatedAction[]; handedOff: boolean;
      followup: { attempt: number; scheduled_at: string } | null; ms?: number }
  | { who: 'erro'; text: string }
  | { who: 'aviso'; text: string };

const actionTitle = (name: string) => WA_AI_ACTIONS.find(a => a.name === name)?.title || name;

const formatWhen = (iso: string, timezone: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString('pt-BR');
  }
};

type RunTurn = (input: {
  assistant: WhatsAppAiAssistantInput;
  messages: { role: 'cliente' | 'agente'; text: string }[];
  memory?: WhatsAppAiSimulationResult['memory'] | null;
  contactName?: string;
  trigger?: 'mensagem' | 'followup';
  followupAttempt?: number;
}) => Promise<WhatsAppAiSimulationResult>;

interface Props {
  /** O rascunho do formulário, com as referências já podadas. */
  draft: WhatsAppAiAssistantInput;
  onClose: () => void;
  /** Só a bancada de dev troca isto — em produção é sempre o motor de verdade. */
  runTurn?: RunTurn;
}

export const AiAgentSimulator: React.FC<Props> = ({ draft, onClose, runTurn }) => {
  const executar: RunTurn = runTurn
    || (input => whatsappService.simulateAiAssistant(input));
  const [contato, setContato] = useState('Ana');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [memory, setMemory] = useState<WhatsAppAiSimulationResult['memory'] | null>(null);
  // O veredito do roteiro do último turno: etapa, o que falta e o corte. É o
  // que o administrador precisa ver para saber se o roteiro que ele escreveu
  // corta onde deveria — a conversa sozinha não mostra isso.
  const [triage, setTriage] = useState<WhatsAppAiSimulationResult['triage'] | null>(null);
  const [showMemory, setShowMemory] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** O histórico que vai ao servidor — só o que foi realmente dito. */
  const conversa = useMemo(() => turns
    .filter((t): t is Extract<Turn, { who: 'cliente' | 'agente' }> =>
      t.who === 'cliente' || t.who === 'agente')
    .map(t => ({ role: t.who as 'cliente' | 'agente', text: t.text })), [turns]);

  const tentativa = useMemo(
    () => turns.filter(t => t.who === 'agente' && t.followup).length + 1, [turns]);

  const rodar = async (
    proximas: { role: 'cliente' | 'agente'; text: string }[],
    trigger: 'mensagem' | 'followup',
  ) => {
    setBusy(true);
    try {
      const out = await executar({
        assistant: draft,
        messages: proximas,
        memory,
        contactName: contato,
        trigger,
        followupAttempt: tentativa,
      });

      if (out.ok === false) {
        setTurns(prev => [...prev, { who: 'erro', text: out.error || 'O modelo não respondeu.' }]);
        return;
      }
      setMemory(out.memory);
      setTriage(out.triage ?? null);
      if (out.degraded) {
        setTurns(prev => [...prev, {
          who: 'aviso' as const,
          text: `A resposta veio fora do formato combinado (${out.degraded}). No atendimento real este turno ficaria marcado como degradado.`,
        }]);
      }
      const texto = (out.reply || '').trim();
      // Uma bolha por mensagem que o cliente receberia — a divisão vem do
      // servidor, a mesma que o envio real usa. As anotações do turno (ações,
      // handoff, tempo) ficam na última, que é quando o turno termina.
      const partes = (out.reply_parts || []).map(p => p.trim()).filter(Boolean);
      const bolhas = partes.length > 0 ? partes : (texto ? [texto] : []);
      setTurns(prev => [...prev, ...(bolhas.length > 0
        ? bolhas.map((parte, i) => ({
            who: 'agente' as const, text: parte,
            actions: i === bolhas.length - 1 ? (out.executed || []) : [],
            handedOff: i === bolhas.length - 1 ? out.handed_off : false,
            followup: i === bolhas.length - 1 ? out.followup : null,
            ms: i === bolhas.length - 1 ? out.duration_ms : undefined,
          }))
        : [{
            who: 'aviso' as const,
            text: (out.executed || []).length > 0
              ? 'O agente só executou ações neste turno, sem escrever nada ao cliente.'
              : 'O agente não respondeu nada neste turno.',
          }])]);
    } catch (e) {
      setTurns(prev => [...prev, { who: 'erro', text: (e as Error).message }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const enviar = async () => {
    const texto = input.trim();
    if (!texto || busy) return;
    setInput('');
    if (isWaAiResetCommand(texto)) {
      setTurns([]);
      setMemory(null);
      setTriage(null);
      inputRef.current?.focus();
      return;
    }
    const proximas = [...conversa, { role: 'cliente' as const, text: texto }];
    setTurns(prev => [...prev, { who: 'cliente', text: texto }]);
    await rodar(proximas, 'mensagem');
  };

  const simularFollowup = async () => {
    if (busy) return;
    setTurns(prev => [...prev, { who: 'aviso', text: `O cliente não respondeu — acompanhamento ${tentativa}.` }]);
    await rodar(conversa, 'followup');
  };

  const reiniciar = () => {
    setTurns([]); setMemory(null); setTriage(null); setInput(''); inputRef.current?.focus();
  };

  const timezone = draft.timezone || 'America/Cuiaba';

  return (
    <aside className="wa-sim" role="dialog" aria-label="Prévia do agente">
      <style>{SIMULATOR_CSS}</style>

      <header className="wa-sim-head">
        <Sparkles size={15} style={{ color: '#ea6c00', flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#111827' }}>
            Testar {draft.name?.trim() || 'agente'}
          </p>
          <p style={{ fontSize: '11px', color: '#9ca3af' }}>
            {draft.model} · nada é gravado, executado ou enviado
          </p>
        </div>
        <button type="button" className="wa-sim-icon" onClick={() => setShowMemory(v => !v)}
          aria-pressed={showMemory} title="Memória da conversa">
          <BrainCircuit size={15} />
        </button>
        <button type="button" className="wa-sim-icon" onClick={reiniciar} title="Recomeçar a conversa">
          <RotateCcw size={15} />
        </button>
        <button type="button" className="wa-sim-icon" onClick={onClose} title="Fechar (Esc)">
          <X size={16} />
        </button>
      </header>

      {showMemory && (
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid #f0eee9', background: '#fbfaf8', flexShrink: 0,
        }}>
          <p style={{ fontSize: '10.5px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Memória desta conversa
          </p>
          {!memory && <p style={{ fontSize: '11.5px', color: '#9ca3af', marginTop: '4px' }}>Ainda vazia.</p>}
          {memory && (
            <div style={{ fontSize: '11.5px', color: '#374151', marginTop: '4px', display: 'grid', gap: '3px' }}>
              <span>{memory.summary || '— sem resumo —'}</span>
              {Object.entries(memory.knownFacts || {}).length > 0 && (
                <span style={{ color: '#6b7280' }}>
                  {Object.entries(memory.knownFacts).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </span>
              )}
              {(memory.pendingItems || []).length > 0 && (
                <span style={{ color: '#92400e' }}>Aguardando: {memory.pendingItems.join(', ')}</span>
              )}
              {triage?.cut && (
                <span style={{ color: '#991b1b', fontWeight: 600 }}>
                  Triagem encerrada pelo sistema: {triage.cut.reason}
                  {triage.cut.effect === 'handoff' ? ' — vai para uma pessoa.' : '.'}
                </span>
              )}
              {triage && !triage.cut && triage.stage_label && (
                <span style={{ color: '#6b7280' }}>Etapa: {triage.stage_label}</span>
              )}
              {triage?.next_action?.type === 'ask_field' && (
                <span style={{ color: '#1d4ed8' }}>
                  Próxima ação do sistema: perguntar <strong>{triage.next_action.field}</strong>
                </span>
              )}
              {triage?.complete && (
                <span style={{ color: '#166534' }}>Roteiro cumprido — nada mais a perguntar.</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="wa-sim-body" ref={bodyRef}>
        {turns.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: '280px' }}>
            <p style={{ fontSize: '12.5px', color: '#6b7280' }}>
              Escreva como se fosse o cliente. O agente responde com o prompt e as ações que estão no
              formulário agora — inclusive sem salvar.
            </p>
          </div>
        )}

        {turns.map((t, i) => {
          if (t.who === 'erro') {
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '6px', alignSelf: 'center',
                maxWidth: '95%', fontSize: '11.5px', color: '#b91c1c',
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '9px', padding: '8px 10px',
              }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '1px' }} /> {t.text}
              </div>
            );
          }
          if (t.who === 'aviso') {
            return (
              <p key={i} style={{
                alignSelf: 'center', fontSize: '11px', color: '#6b7280', background: '#fff',
                border: '1px solid #ece9e2', borderRadius: '999px', padding: '4px 11px',
              }}>{t.text}</p>
            );
          }
          const cliente = t.who === 'cliente';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: cliente ? 'flex-start' : 'flex-end', gap: '4px' }}>
              <div style={{
                maxWidth: '86%', fontSize: '12.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                padding: '8px 11px', borderRadius: cliente ? '2px 11px 11px 11px' : '11px 2px 11px 11px',
                background: cliente ? '#fff' : '#e8f6ec',
                border: `1px solid ${cliente ? '#ece9e2' : '#c9e9d4'}`,
                color: '#111827',
              }}>{t.text}</div>

              {!cliente && t.actions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                  {t.actions.map((a, j) => (
                    <span key={j} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 600,
                      padding: '3px 9px', borderRadius: '999px',
                      background: a.ok ? '#fff7ed' : '#fef2f2',
                      border: `1px solid ${a.ok ? '#fed7aa' : '#fecaca'}`,
                      color: a.ok ? '#b45309' : '#b91c1c',
                    }}>
                      <Zap size={9} aria-hidden="true" />
                      {actionTitle(a.action)}{a.target ? ` → ${a.target}` : ''}
                      {a.ok ? ' · simulada' : ` · recusada: ${a.error}`}
                    </span>
                  ))}
                </div>
              )}

              {!cliente && t.handedOff && (
                <span style={{ fontSize: '10.5px', color: '#1d4ed8' }}>
                  A partir daqui a IA para: a conversa foi entregue a um humano.
                </span>
              )}
              {!cliente && t.followup && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', color: '#9ca3af' }}>
                  <Clock size={9} aria-hidden="true" />
                  Sem resposta, retomaria em {formatWhen(t.followup.scheduled_at, timezone)}
                </span>
              )}
            </div>
          );
        })}

        {busy && (
          <span style={{ alignSelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#9ca3af' }}>
            <Loader2 size={12} className="animate-spin" /> pensando…
          </span>
        )}
      </div>

      <div className="wa-sim-foot">
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <User size={12} style={{ color: '#9ca3af', flexShrink: 0 }} aria-hidden="true" />
          <span style={{ fontSize: '11px', color: '#6b7280' }}>Cliente:</span>
          <input
            value={contato}
            onChange={e => setContato(e.target.value)}
            aria-label="Nome do cliente na prévia"
            style={{
              flex: 1, fontSize: '11.5px', padding: '3px 7px', borderRadius: '7px',
              border: '1px solid #e5e7eb', color: '#111827',
            }}
          />
          {draft.followup_enabled && (
            <button type="button" className="wa-sim-icon" onClick={simularFollowup} disabled={busy}
              title="Simular o cliente sumindo — o agente retoma"
              style={{ fontSize: '11px', color: '#b45309', padding: '3px 8px' }}>
              <Clock size={11} /> acompanhamento
            </button>
          )}
        </label>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            className="wa-sim-input"
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); }
            }}
            placeholder="Escreva como o cliente… (Enter envia)"
            aria-label="Mensagem do cliente"
          />
          <button type="button" className="wa-sim-send" onClick={() => void enviar()}
            disabled={busy || !input.trim()} aria-label="Enviar mensagem do cliente">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default AiAgentSimulator;
