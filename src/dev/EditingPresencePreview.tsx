import React from 'react';
import EditingNowBadge from '../components/EditingNowBadge';
import EditorPresenceBar from '../components/EditorPresenceBar';
import type { EditingPeer } from '../hooks/useNextcloudPresence';
import { useUserAvatars } from '../hooks/useUserAvatars';
import { primeAvatar } from '../services/userAvatars';

/**
 * DEV-ONLY (`?presencepreview=1`): harness visual dos avisos de "quem está
 * editando". Serve para conferir texto, foto e cores sem precisar de duas contas
 * logadas ao mesmo tempo.
 *
 * As fotos aqui são quadrados coloridos gerados na hora e colocados no MESMO
 * cache que a tela real usa (`primeAvatar`), para o caminho exercitado ser o de
 * produção: a presença carrega só o id, e a foto é resolvida por ele.
 */

/** Quadrado colorido em SVG — foto de mentira, do tamanho de uma foto de verdade. */
const fakePhoto = (color: string, letter: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
      `<rect width="96" height="96" fill="${color}"/>` +
      `<text x="48" y="62" font-family="sans-serif" font-size="44" font-weight="bold" ` +
      `fill="white" text-anchor="middle">${letter}</text></svg>`,
  )}`;

const PEOPLE = [
  { id: 'u-lis', name: 'Lisliandra Cerqueira Inocêncio Montalvão', photo: fakePhoto('#0ea5e9', 'L') },
  { id: 'u-pedro', name: 'Pedro Rodrigues Montalvão Neto', photo: fakePhoto('#10b981', 'P') },
  { id: 'u-ana', name: 'Ana Paula Souza', photo: fakePhoto('#8b5cf6', 'A') },
  { id: 'u-carlos', name: 'Carlos Eduardo Lima', photo: fakePhoto('#f59e0b', 'C') },
  // Sem foto de propósito: tem de cair nas iniciais.
  { id: 'u-marina', name: 'Marina Alves', photo: null },
  { id: 'u-joao', name: 'João Vitor Pereira', photo: fakePhoto('#f43f5e', 'J') },
];

for (const person of PEOPLE) primeAvatar(person.id, person.photo);

const peer = (id: string, typing = false): EditingPeer => ({
  userId: id,
  userName: PEOPLE.find((person) => person.id === id)?.name || id,
  typing,
  since: Date.now() - 60_000,
});

const cases: Array<{ title: string; peers: EditingPeer[] }> = [
  { title: 'Uma pessoa com o documento aberto', peers: [peer('u-lis')] },
  { title: 'Uma pessoa digitando agora', peers: [peer('u-lis', true)] },
  { title: 'Duas pessoas, ninguém digitando', peers: [peer('u-pedro'), peer('u-ana')] },
  {
    title: 'Três pessoas, uma digitando',
    peers: [peer('u-pedro'), peer('u-ana', true), peer('u-carlos')],
  },
  {
    title: 'Cinco pessoas (uma sem foto, cai nas iniciais; estouro do +N)',
    peers: [peer('u-pedro'), peer('u-ana'), peer('u-carlos'), peer('u-marina'), peer('u-joao', true)],
  },
];

/** A barra do editor fala em "conexão"; a presença do Nextcloud fala em usuário. */
const BarFromPeers: React.FC<{
  peers: EditingPeer[];
  collabStatus?: 'connected' | 'reconnecting' | 'disconnected';
}> = ({ peers, collabStatus = 'connected' }) => {
  const avatarOf = useUserAvatars(peers.map((item) => item.userId));
  return (
    <EditorPresenceBar
      collabStatus={collabStatus}
      peers={peers.map((item) => ({
        id: item.userId,
        userName: item.userName,
        avatarUrl: avatarOf(item.userId),
        typing: item.typing,
      }))}
    />
  );
};

const EditingPresencePreview: React.FC = () => (
  <div className="min-h-screen bg-slate-100 p-8">
    <h1 className="text-lg font-bold text-slate-800">Avisos de edição — presença em tempo real</h1>
    <p className="mt-1 text-sm text-slate-500">
      A pessoa aparece pela FOTO; o nome vai no texto. Ponto verde = digitando neste instante.
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
              <div className="w-40">
                <EditingNowBadge peers={item.peers} compact />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] text-slate-400">Dentro do editor</p>
              <BarFromPeers peers={item.peers} />
            </div>
          </div>
        </div>
      ))}

      {/* Os dois estados que NÃO podem parecer "tudo certo". */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Coedição com problema (a barra troca de assunto em vez de mostrar as pessoas)
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <BarFromPeers peers={[peer('u-ana', true)]} collabStatus="reconnecting" />
          <BarFromPeers peers={[peer('u-ana', true)]} collabStatus="disconnected" />
        </div>
      </div>
    </div>
  </div>
);

export default EditingPresencePreview;
