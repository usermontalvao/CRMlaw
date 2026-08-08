/**
 * Faixa do atendente dentro da conversa: o que ele faria agora.
 *
 * Em modo sombra é leitura pura — a resposta aparece marcada como não enviada,
 * e os gatilhos como "teria feito". A ideia é que quem atende veja o raciocínio
 * do agente na própria conversa, sem sair para outra tela, e possa discordar
 * antes de qualquer coisa ser ligada.
 *
 * Some sozinha quando o agente nunca passou pela conversa: quem não usa IA não
 * ganha ruído na tela.
 */
import React, { useEffect, useState } from 'react';
import { Bot, ChevronDown, EyeOff } from 'lucide-react';
import { agentsApi, type WaAgentRun, type WaRunVerdict } from '../../../services/whatsapp/agents';

const CHIP: Record<WaRunVerdict, string> = {
  simulado: 'background:#f1f5f9;color:#475569',
  executado: 'background:#ecfdf5;color:#047857',
  barrado: 'background:#fef2f2;color:#b91c1c',
  aprovacao: 'background:#fffbeb;color:#b45309',
};

const ROTULO: Record<WaRunVerdict, string> = {
  simulado: 'teria feito',
  executado: 'executado',
  barrado: 'barrado',
  aprovacao: 'aguarda ok',
};

const estilo = (css: string): React.CSSProperties =>
  Object.fromEntries(css.split(';').filter(Boolean).map(p => {
    const [k, v] = p.split(':');
    return [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v];
  })) as React.CSSProperties;

interface Dados {
  run: WaAgentRun | null;
  agentName: string | null;
  collected: Record<string, string>;
  qualification: string | null;
  status: string | null;
}

export const AgentConversationBanner: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const [dados, setDados] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setAberto(false);
    agentsApi.latestForConversation(conversationId)
      .then(d => { if (vivo) setDados(d); })
      .catch(() => { /* sem agente nesta conversa: a faixa simplesmente não aparece */ });
    return () => { vivo = false; };
  }, [conversationId]);

  if (!dados?.run) return null;

  const { run } = dados;
  const emSombra = run.mode === 'sombra';
  const campos = Object.entries(dados.collected);

  return (
    <div style={{ borderBottom: '1px solid #e7e5df', background: '#fbfaf8' }}>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Bot size={13} style={{ color: '#b45309', flexShrink: 0 }} />
        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#92400e' }}>
          {dados.agentName || 'Atendente de IA'}
        </span>
        {emSombra && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10.5px',
            color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '5px',
          }}>
            <EyeOff size={10} /> modo sombra
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ChevronDown
          size={14}
          style={{ color: '#94a3b8', transition: 'transform .15s', transform: aberto ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {aberto && (
        <div style={{ padding: '0 16px 11px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {run.reply_text && (
            <div>
              <span style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8', marginBottom: '3px' }}>
                {emSombra ? 'Responderia' : 'Respondeu'}
              </span>
              <div style={{
                fontSize: '12.5px', color: '#334155', lineHeight: 1.5, background: '#fff',
                border: emSombra ? '1px dashed #e2e8f0' : '1px solid #e2e8f0',
                borderRadius: '9px', padding: '8px 10px', whiteSpace: 'pre-wrap',
              }}>
                {run.reply_text}
              </div>
            </div>
          )}

          {run.tool_calls.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {run.tool_calls.map((t, i) => (
                <span
                  key={i}
                  title={t.detail || ''}
                  style={{
                    ...estilo(CHIP[t.verdict] ?? CHIP.simulado),
                    fontSize: '10.5px', fontFamily: 'ui-monospace, Menlo, monospace',
                    padding: '2px 7px', borderRadius: '6px', whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ opacity: 0.6 }}>{ROTULO[t.verdict] ?? ''} </span>{t.name}
                </span>
              ))}
            </div>
          )}

          {campos.length > 0 && (
            <div>
              <span style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8', marginBottom: '3px' }}>
                Já coletado
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {campos.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11.5px' }}>
                    <span style={{ color: '#94a3b8' }}>{k}</span>
                    <span style={{ color: '#334155', fontWeight: 500, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dados.qualification && (
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
              Qualificação: <strong style={{ color: '#334155' }}>{dados.qualification}</strong>
            </div>
          )}

          {emSombra && (
            <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0 }}>
              Nada disto foi executado nem enviado ao cliente.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentConversationBanner;
