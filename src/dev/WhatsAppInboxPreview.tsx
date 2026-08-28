// DEV-ONLY: bancada do PAINEL de conversas (?wainboxpreview=1).
//
// A lista tem bancada de sobra (`?walistperf=1`), mas ninguém via o que a
// pessoa vê de verdade: a coluna inteira, na largura do widget flutuante —
// abas, busca, filtros e linhas, uma coisa em cima da outra. É nessa soma que
// os defeitos aparecem: cinco laranjas diferentes na mesma altura, cada botão
// com um tamanho, e o nome do contato gritando em caixa alta.
//
// As abas (`InboxTabs`) e as linhas (`ConversationListItem`) são os componentes
// DE VERDADE — o que mudar neles muda aqui. A barra de busca e os botões do
// topo são RÉPLICA do markup que mora dentro de `WhatsAppModule` (3.850 linhas,
// e o cabeçalho não é componente próprio); se mexer lá, confira aqui.
import React, { useMemo, useState } from 'react';
import { Filter, Headphones, Bell, Plus, Search } from 'lucide-react';
import { ConversationListItem } from '../components/whatsapp/conversationListItem';
import { signatureListChip, type SignatureChipInput } from '../components/whatsapp/signatureChip';
import { InboxTabs, type InboxTab } from '../components/whatsapp/InboxTabs';
import { SegmentedTabs } from '../components/chat/SegmentedTabs';
import type { WhatsAppChannel, WhatsAppConversation } from '../types/whatsapp.types';

const CANAL: WhatsAppChannel = {
  id: 'canal', instance_name: 'atendimento', name: 'Atendimento', color: '#f27a23',
  phone_number: null, status: 'connected', profile_pic_url: null, is_active: true, connected_at: null, absence_message: null,
  absence_enabled: false, timezone: 'America/Cuiaba', visibility_mode: 'all',
  funnel_enabled: true, funnel_initial_stage: 'novo',
  auto_close_enabled: true, auto_close_minutes: 240, auto_close_message: null,
  auto_close_business_hours_only: true,
};

// Acompanhamento de assinatura por conversa: é o chip que avisa que o cliente
// assinou (ou saiu sem assinar) sem ninguém precisar abrir a conversa. Fica na
// bancada porque é justamente na SOMA com etapa, docs e relógio que a fileira
// quebra em duas linhas.
const ACOMPANHAMENTO: Record<string, SignatureChipInput> = {
  c2: { kind: 'signature_signed', label: 'Assinado' },
  c5: { kind: 'signature_viewed', label: 'Saiu sem assinar — visto por último hoje às 14:32' },
};

const FUNNEL = [
  { key: 'Novo', stageKey: 'novo', stageLabel: 'Novo', color: '#64748b', bg: '#64748b22' },
  { key: 'Aguardando docs', stageKey: 'aguardando_documentos', stageLabel: 'Aguardando documentos', color: '#f59e0b', bg: '#f59e0b22' },
];

// Nomes em CAIXA ALTA de propósito: é assim que metade do cadastro do
// escritório está guardada, e é o caso que o `nomeProprio` existe para resolver.
const PESSOAS: Array<[string, string, number, string[]]> = [
  ['LISLIANDRA CERQUEIRA INOCENCIO DA SILVA', 'Voce: Olá! Agradecemos o contato. Nosso atendimento responde ja, ja.', 0, ['Novo']],
  ['PAULO HENRIQUE GARCIA BARBOSA', 'Album com 5 fotos', 3, ['Aguardando docs']],
  ['Priscila Brandão', 'Ok', 0, ['Novo']],
  ['CARLOS DANIEL RODRIGUES DE OLIVEIRA', 'Ou da moto?', 1, ['Novo']],
  ['MARIA DE FATIMA DOS SANTOS', 'Bom dia, doutor. Consegui separar os documentos que o senhor pediu.', 12, ['Aguardando docs']],
  ['Jeanderson Santana', 'Obrigado! Vou aguardar o retorno entao.', 0, ['Novo']],
];

const conversas = (): WhatsAppConversation[] => PESSOAS.map(([nome, previa, naoLidas, labels], i) => ({
  id: `c${i}`, instance_id: 'canal', remote_jid: `${i}@s.whatsapp.net`,
  contact_phone: `55669${String(100000 + i)}`, contact_name: nome,
  contact_avatar_path: null, contact_avatar_url: null,
  client_id: null, client_name: null,
  assigned_user_id: null, department_id: null, status: 'open' as const,
  unread_count: naoLidas,
  last_message_at: new Date(Date.now() - (i * 47 + 3) * 60000).toISOString(),
  last_message_preview: previa,
  last_message_direction: (i === 0 ? 'out' : 'in') as 'in' | 'out',
  last_call_at: null, last_call_direction: null, last_call_outcome: null,
  last_call_duration_seconds: null, last_call_is_video: false,
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: null, last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null,
  labels, legal_hold: false, legal_hold_reason: null, absence_suppressed: false,
  auto_close_suppressed: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}));

/**
 * A CONVERSA DA EQUIPE, ao lado da lista.
 *
 * RÉPLICA das classes do balão que mora em `ChatFloatingWidget` — está aqui
 * porque o defeito só aparece com mensagens CURTAS ("Oi", "g", "re"), que é
 * justamente o que ninguém consegue produzir de propósito numa conta de teste.
 * Se mexer no balão lá, confira aqui.
 */
const FALAS: Array<[boolean, string, boolean]> = [
  // [minha?, texto, fecha bloco?]
  [false, 'Oi', false],
  [false, 'Oi', false],
  [false, 'g', false],
  [false, 'oi', false],
  [false, 're', true],
  [true, 'Oi', true],
  [false, 'Doutor, o cliente mandou os documentos da audiência de quinta. Deixei tudo na pasta do processo.', true],
  [true, 'Perfeito, obrigado! Vou conferir agora e já te falo.', true],
];

const Conversa: React.FC = () => (
  <div className="flex-1 flex flex-col bg-[#faf9f7] overflow-hidden">
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
      <div className="flex justify-center py-3">
        <span className="px-2.5 py-1 rounded-full bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,.05)] text-[10.5px] font-medium text-slate-500">
          terça-feira, 02 de jun.
        </span>
      </div>
      {FALAS.map(([minha, texto, fecha], i) => (
        <div key={i} className={`flex flex-col ${fecha ? 'mb-2.5' : 'mb-[3px]'} ${minha ? 'items-end' : 'items-start'}`}>
          {!minha && i === 0 && <div className="text-[11px] font-medium text-slate-500 mb-1 ml-2.5">Lisliandra Cerqueira</div>}
          <div
            className={`max-w-[80%] min-w-[42px] px-4 py-[7px] text-[13.5px] leading-[1.45] overflow-hidden ${
              minha
                ? `bg-[#f27a23] text-white rounded-[14px] shadow-[0_1px_2px_rgba(242,122,35,.35)] ${fecha ? 'rounded-br-[6px]' : ''}`
                : `bg-white text-slate-800 ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,.06)] rounded-[14px] ${fecha ? 'rounded-bl-[6px]' : ''}`
            }`}
          >
            {texto}
          </div>
          {fecha && (
            <div className={`text-[10.5px] text-slate-400 mt-1 flex items-center gap-1 tabular-nums ${minha ? 'mr-9' : 'ml-9'}`}>
              13:46{minha && <span className="ml-0.5 text-sky-500">✓✓</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

export default function WhatsAppInboxPreview() {
  const [aba, setAba] = useState<InboxTab>('all');
  const [selecionada, setSelecionada] = useState('c1');
  const [painel, setPainel] = useState<'whatsapp' | 'equipe'>('whatsapp');
  const lista = useMemo(conversas, []);

  return (
    <div className="min-h-screen bg-[#f8f7f5] p-8">
      <header className="max-w-[900px] mx-auto mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Painel de conversas</h1>
        <p className="text-sm text-slate-500 mt-1">
          A coluna inteira na largura do widget (384 px), com os componentes de verdade.
        </p>
      </header>

      <div className="max-w-[900px] mx-auto flex gap-8 items-start">
        <div
          className="w-[384px] rounded-[24px] bg-white overflow-hidden flex flex-col"
          style={{ height: 620, boxShadow: '0 24px 56px -20px rgba(15,23,42,.28), 0 0 0 1px rgba(15,23,42,.07)' }}
        >
          {/* Topo do widget — abas WhatsApp | Equipe (réplica) */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-[#f1f0ec]">
            <SegmentedTabs
              className="min-w-0 w-full max-w-[230px]"
              size="md"
              value={painel}
              onChange={setPainel}
              items={[
                { key: 'whatsapp' as const, label: 'WhatsApp', count: 3 },
                { key: 'equipe' as const, label: 'Equipe', count: 0 },
              ]}
            />
          </div>

          {/* Busca + acoes (réplica do cabeçalho embutido de WhatsAppModule) */}
          <div className="border-b border-[#e7e5df] bg-[#fdfcfb] px-3 pt-2.5 pb-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Buscar conversa…"
                  className="w-full pl-9 py-1.5 pr-3 text-[13px] text-slate-800 placeholder-slate-400 rounded-full bg-[#f4f3f0] border border-transparent outline-none transition focus:bg-white focus:border-[#e0ddd5] focus:shadow-[0_1px_3px_rgba(15,23,42,.07)]"
                />
              </div>
              <button className="flex-shrink-0 inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700 transition-colors">
                <Filter size={16} />
              </button>
              <span className="flex items-center" title="Conectado ao WhatsApp">
                <span className="inline-block w-2 h-2 rounded-full ring-2 ring-white" style={{ background: '#22a559' }} />
              </span>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700 transition-colors">
                <Bell size={16} />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-[#f1f0ec] hover:text-slate-700 transition-colors">
                <Headphones size={16} />
              </button>
              <button className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#f27a23] text-white shadow-[0_1px_2px_rgba(242,122,35,.4)] hover:bg-[#e06b1f] transition-colors active:scale-95">
                <Plus size={17} />
              </button>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <InboxTabs
                active={aba}
                onChange={setAba}
                counts={{ all: lista.length, unread: 3, mine: 5 }}
                className="min-w-0 flex-1"
              />
            </div>
          </div>

          {/* Lista — componente de verdade */}
          <div className="flex-1 overflow-y-auto">
            {lista.map(c => (
              <ConversationListItem
                key={c.id}
                c={c}
                active={selecionada === c.id}
                channel={CANAL}
                dept={null}
                privateMode={false}
                statusKey="open"
                statusLabel="Aberta"
                statusCls=""
                docStatus={c.labels.includes('Aguardando docs') ? 'awaiting' : null}
                muted={false}
                draftPreview=""
                funnelLabels={FUNNEL}
                showChannelName={false}
                signatureChip={signatureListChip(ACOMPANHAMENTO[c.id] ?? null)}
                onDismissTracking={ACOMPANHAMENTO[c.id] ? () => {} : undefined}
                onSelect={setSelecionada}
              />
            ))}
          </div>
        </div>

        <div
          className="w-[384px] rounded-[24px] bg-white overflow-hidden flex flex-col"
          style={{ height: 620, boxShadow: '0 24px 56px -20px rgba(15,23,42,.28), 0 0 0 1px rgba(15,23,42,.07)' }}
        >
          <div className="px-3 py-2.5 flex items-center gap-2.5 border-b border-[#f1f0ec]">
            <div className="h-9 w-9 rounded-full bg-[#f4f3f0] flex items-center justify-center text-[12px] font-semibold text-slate-500">LC</div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight text-slate-800 truncate">Lisliandra Cerqueira</div>
              <div className="text-[11px] text-slate-400">visto há 3h</div>
            </div>
          </div>
          <Conversa />
        </div>
      </div>
    </div>
  );
}
