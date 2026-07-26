import React from 'react';
import EditingNowBadge from '../components/EditingNowBadge';
import EditorPresenceBar from '../components/EditorPresenceBar';
import type { EditingPeer } from '../hooks/useNextcloudPresence';

/**
 * DEV-ONLY (`?presencepreview=1`): harness visual dos avisos de "quem está
 * editando". Serve para conferir o texto e as cores sem precisar de duas contas
 * logadas ao mesmo tempo.
 */

const peer = (userName: string, typing = false): EditingPeer => ({
  userId: userName,
  userName,
  typing,
  since: Date.now() - 60_000,
});

const cases: Array<{ title: string; peers: EditingPeer[] }> = [
  { title: 'Uma pessoa com o documento aberto', peers: [peer('Lisliandra Cerqueira Inocêncio Montalvão')] },
  { title: 'Uma pessoa digitando agora', peers: [peer('Lisliandra Cerqueira Inocêncio Montalvão', true)] },
  { title: 'Duas pessoas, ninguém digitando', peers: [peer('Pedro Rodrigues Montalvão Neto'), peer('Ana Paula Souza')] },
  {
    title: 'Três pessoas, uma digitando',
    peers: [peer('Pedro Rodrigues Montalvão Neto'), peer('Ana Paula Souza', true), peer('Carlos Eduardo Lima')],
  },
  {
    title: 'Cinco pessoas (estouro do +N)',
    peers: [
      peer('Pedro Rodrigues Montalvão Neto'),
      peer('Ana Paula Souza'),
      peer('Carlos Eduardo Lima'),
      peer('Marina Alves'),
      peer('João Vitor Pereira', true),
    ],
  },
];

const EditingPresencePreview: React.FC = () => (
  <div className="min-h-screen bg-slate-100 p-8">
    <h1 className="text-lg font-bold text-slate-800">Avisos de edição — presença em tempo real</h1>
    <p className="mt-1 text-sm text-slate-500">
      Amarelo = com o documento aberto. Verde = digitando neste instante.
    </p>

    <div className="mt-6 space-y-6">
      {cases.map((item) => (
        <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.title}</p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-2 text-[11px] text-slate-400">Lista (Nextcloud)</p>
              <EditingNowBadge peers={item.peers} />
            </div>
            <div>
              <p className="mb-2 text-[11px] text-slate-400">Grade (Nextcloud)</p>
              <div className="w-32">
                <EditingNowBadge peers={item.peers} compact />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] text-slate-400">Dentro do editor</p>
              <EditorPresenceBar peers={item.peers} />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default EditingPresencePreview;
