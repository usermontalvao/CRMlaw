// DEV-ONLY: bancada do HISTÓRICO DE LIGAÇÕES e das abas da inbox
// (`?wacallhistorypreview=1`).
//
// Duas coisas que só se conferem olhando, e que não dá para alcançar rodando o
// CRM (a inbox exige login, canal conectado e ligações de verdade no banco):
//
//  · AS ABAS CABEM? Cinco filtros na largura da coluna da lista foi o problema
//    que motivou trocá-los por ícones. A bancada mostra a barra nas larguras
//    reais (a do módulo cheio e a do widget embutido) e com o vermelho de
//    pendência ligado e desligado.
//  · AS LIGAÇÕES SE DISTINGUEM? Perdida, sem resposta, atendida, gravada e a
//    que chegou por LID — as cinco lado a lado, que é como o defeito de "tudo
//    igual" aparece.
import React, { useMemo, useState } from 'react';
import { CallHistoryList } from '../components/whatsapp/CallHistoryList';
import { InboxTabs, type InboxTab } from '../components/whatsapp/InboxTabs';
import { unreturnedMissedIds } from '../components/whatsapp/callHistory';
import type { CallLogRow } from '../services/callLog.service';

const HOJE = new Date();
const hora = (h: number, m: number) => {
  const d = new Date(HOJE);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ontem = (h: number, m: number) => {
  const d = new Date(HOJE);
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const linha = (patch: Partial<CallLogRow> & { id: string }): CallLogRow => ({
  callId: `wa-${patch.id}`,
  direction: 'inbound',
  phone: '556596128787',
  peerLid: null,
  clientId: null,
  conversationId: 'conv-1',
  userId: null,
  userName: null,
  startedAt: hora(9, 0),
  answeredAt: null,
  endedAt: hora(9, 0),
  durationSeconds: 0,
  endReason: 'user_ended',
  outcome: 'missed',
  recordingPath: null,
  recordingMime: null,
  recordingBytes: null,
  transcript: null,
  transcriptStatus: null,
  transcriptAt: null,
  contactName: 'Lisliandra Inocêncio',
  contactAvatarPath: null,
  ...patch,
});

const CHAMADAS: CallLogRow[] = [
  // A perdida que ninguém retornou: a pendência que o distintivo conta.
  linha({ id: 'p1', startedAt: hora(14, 12), contactName: 'Marcos Ferreira', phone: '5565999884411' }),
  // Chegou só com o apelido interno: aparece, mas não se inventa número nenhum.
  linha({
    id: 'p2', startedAt: hora(13, 40), phone: '', peerLid: '16758979195047',
    conversationId: null, contactName: null,
  }),
  // Atendida e GRAVADA — a ênfase própria.
  linha({
    id: 'p3', direction: 'outbound', outcome: 'answered', startedAt: hora(11, 5),
    answeredAt: hora(11, 5), durationSeconds: 372, userName: 'Dr. Pedro',
    recordingPath: 'call-recordings/demo.webm',
  }),
  // A nossa tentativa sem resposta — verde, não vermelha.
  linha({ id: 'p4', direction: 'outbound', startedAt: hora(10, 58), contactName: 'Ana Paula Souza', phone: '5565988112233' }),
  // Perdida ontem que JÁ foi retornada (a saída abaixo): sai da pendência.
  linha({ id: 'p5', startedAt: ontem(16, 20), contactName: 'Josué Andrade', phone: '5565991110000' }),
  linha({
    id: 'p6', direction: 'outbound', outcome: 'answered', startedAt: ontem(16, 45),
    answeredAt: ontem(16, 45), durationSeconds: 95, userName: 'Ana (recepção)',
    contactName: 'Josué Andrade', phone: '5565991110000',
  }),
];

const Coluna: React.FC<{ titulo: string; nota: string; width: number; children: React.ReactNode }> = ({
  titulo, nota, width, children,
}) => (
  <div>
    <p className="mb-0.5 text-[13px] font-bold text-slate-700">{titulo}</p>
    <p className="mb-2 text-[11.5px] text-slate-500">{nota}</p>
    <div className="overflow-hidden rounded-xl border border-[#e7e5df] bg-white" style={{ width }}>
      {children}
    </div>
  </div>
);

export const WaCallHistoryPreview: React.FC = () => {
  const [aba, setAba] = useState<InboxTab>('calls');
  const [privateMode, setPrivateMode] = useState(false);
  const abertas = useMemo(() => unreturnedMissedIds(CHAMADAS), []);

  return (
    <div className="min-h-screen bg-[#f3f2ef] p-6">
      <h1 className="text-[17px] font-bold text-slate-800">Histórico de ligações + abas da inbox</h1>
      <p className="mt-0.5 max-w-3xl text-[12.5px] text-slate-500">
        As abas viraram ícones porque cinco rótulos escritos não cabiam na coluna da lista. O nome só
        aparece na aba ativa; o contador fica em todas. Vermelho é pendência: agendada que falhou, ou
        chamada perdida sem retorno.
      </p>

      <label className="mt-3 inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-600">
        <input type="checkbox" checked={privateMode} onChange={e => setPrivateMode(e.target.checked)} />
        Modo privado (sem nome, número nem rosto)
      </label>

      <div className="mt-5 flex flex-wrap items-start gap-8">
        <Coluna titulo="Abas — módulo cheio (360 px)" nota="Sem pendência nenhuma: tudo âmbar." width={360}>
          <div className="p-3">
            <InboxTabs active={aba} onChange={setAba} counts={{ all: 128, unread: 7, mine: 12 }}
              scheduledPending={3} scheduledFailed={0} callsUnreturned={0} />
          </div>
        </Coluna>

        <Coluna titulo="Abas — com pendência" nota="Agendada não entregue e perdida sem retorno gritam em vermelho." width={360}>
          <div className="p-3">
            <InboxTabs active={aba} onChange={setAba} counts={{ all: 128, unread: 7, mine: 12 }}
              scheduledPending={3} scheduledFailed={2} callsUnreturned={abertas.size} />
          </div>
        </Coluna>

        <Coluna titulo="Abas — widget embutido (300 px)" nota="A largura mais apertada do CRM." width={300}>
          <div className="p-3">
            <InboxTabs active={aba} onChange={setAba} counts={{ all: 1284, unread: 132, mine: 12 }}
              scheduledPending={3} scheduledFailed={1} callsUnreturned={abertas.size} />
          </div>
        </Coluna>
      </div>

      <div className="mt-8 flex flex-wrap items-start gap-8">
        <Coluna titulo="Histórico de ligações" nota="Perdida sem retorno, chamada por LID, gravada, sem resposta e retornada." width={380}>
          <CallHistoryList
            calls={CHAMADAS}
            loading={false}
            error={null}
            onReload={() => window.alert('recarregaria')}
            unreturned={abertas}
            privateMode={privateMode}
            onOpenConversation={(id) => window.alert(`abriria a conversa ${id}`)}
            onCall={(phone, nome) => window.alert(`ligaria para ${nome || phone} (${phone})`)}
          />
        </Coluna>

        <Coluna titulo="Sem nenhuma ligação" nota="O estado do primeiro dia." width={380}>
          <CallHistoryList calls={[]} loading={false} error={null} onReload={() => {}} unreturned={new Set()} />
        </Coluna>

        <Coluna titulo="A consulta falhou" nota="Erro não pode virar tela em branco." width={380}>
          <CallHistoryList calls={[]} loading={false} error="Falha ao consultar o servidor."
            onReload={() => window.alert('tentaria de novo')} unreturned={new Set()} />
        </Coluna>
      </div>
    </div>
  );
};

export default WaCallHistoryPreview;
