// DEV-ONLY: bancada da barra de mensagens (?chatlauncherpreview=1).
//
// A barra é a peça mais vista do CRM e a mais difícil de ver em todos os seus
// estados: para conferir "999 pendências" ou "Editor com alteração não salva"
// na vida real seria preciso produzir a situação. Aqui os estados ficam lado a
// lado, e o painel de baixo deixa mexer em cada chave separadamente.
//
// O fundo imita a tela do CRM (creme #f8f7f5) de propósito: o defeito da versão
// azul-marinho só aparecia sobre o fundo real.
import React, { useState } from 'react';
import ChatLauncherBar from '../components/chat/ChatLauncherBar';

const AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/>
       </linearGradient></defs>
       <rect width="64" height="64" fill="url(#g)"/>
       <circle cx="32" cy="25" r="11" fill="rgba(255,255,255,.9)"/>
       <ellipse cx="32" cy="56" rx="19" ry="14" fill="rgba(255,255,255,.9)"/>
     </svg>`,
  );

type Estado = {
  titulo: string;
  nota: string;
  props: React.ComponentProps<typeof ChatLauncherBar>;
};

const nada = () => {};

const ESTADOS: Estado[] = [
  {
    titulo: 'Repouso',
    nota: 'Nenhuma pendência. É o estado de 90% do dia — tem de saber desaparecer.',
    props: { badgeCount: 0, title: 'Mensagens', onToggle: nada, onOpenEditor: nada },
  },
  {
    titulo: 'Uma pendência',
    nota: 'O branco esquenta, o ícone vira laranja e o rosto de quem escreveu entra.',
    props: {
      badgeCount: 1, title: '1 conversa da equipe', peerName: 'Michele da Cunha Leite',
      peerAvatarUrl: AVATAR, onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Sem foto',
    nota: 'A inicial no lugar do rosto — o caso do contato novo do WhatsApp.',
    props: {
      badgeCount: 7, title: '3 conversas da equipe · 4 contatos no WhatsApp',
      peerName: 'Jeanderson Santana da Silva', onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Muita pendência',
    nota: 'Acima de 99 o número vira "99+": quatro dígitos deformariam a barra.',
    props: {
      badgeCount: 214, title: '198 conversas da equipe · 16 contatos no WhatsApp',
      peerName: 'Pedro Rodrigues Montalvão Neto', peerAvatarUrl: AVATAR,
      onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Editor minimizado',
    nota: 'O Editor de Petições mora na barra enquanto estiver minimizado nesta aba.',
    props: {
      badgeCount: 0, title: 'Mensagens', editorMinimized: true,
      onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Editor não salvo',
    nota: 'Ponto âmbar, sólido: "não salvo" é um estado, não um alarme.',
    props: {
      badgeCount: 3, title: '3 conversas da equipe', editorMinimized: true,
      editorHasUnsavedChanges: true, peerName: 'Michele', peerAvatarUrl: AVATAR,
      onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Painel aberto',
    nota: 'A barra vira o botão de fechar: seta para baixo, rótulo "Fechar", tom quente.',
    props: {
      badgeCount: 0, title: 'Mensagens', open: true, onToggle: nada, onOpenEditor: nada,
    },
  },
  {
    titulo: 'Aberto, com o Editor',
    nota: 'Com o painel aberto o rosto sai (o nome já está na lista); o Editor fica.',
    props: {
      badgeCount: 2, title: '2 conversas da equipe', open: true, editorMinimized: true,
      peerName: 'Michele', peerAvatarUrl: AVATAR, onToggle: nada, onOpenEditor: nada,
    },
  },
];

const Chave: React.FC<{ ligada: boolean; onClick: () => void; children: React.ReactNode }> = ({
  ligada, onClick, children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 h-9 rounded-full text-[13px] font-medium border transition-colors ${
      ligada
        ? 'bg-[#f27a23] text-white border-[#f27a23]'
        : 'bg-white text-slate-600 border-[#e7e5df] hover:border-amber-300'
    }`}
  >
    {children}
  </button>
);

export default function ChatLauncherPreview() {
  const [pendencias, setPendencias] = useState(3);
  const [aberto, setAberto] = useState(false);
  const [editor, setEditor] = useState(false);
  const [naoSalvo, setNaoSalvo] = useState(false);
  const [comFoto, setComFoto] = useState(true);

  return (
    <div className="min-h-screen bg-[#f8f7f5] text-slate-800 p-8 pb-40">
      <header className="max-w-5xl mx-auto mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Barra de mensagens</h1>
        <p className="text-sm text-slate-500 mt-1">
          Todos os estados sobre o fundo real do CRM. O canto inferior direito é a peça de
          verdade, viva — mexa nas chaves e veja a largura, o número e o ícone se moverem.
        </p>
      </header>

      <div className="max-w-5xl mx-auto grid gap-4 sm:grid-cols-2">
        {ESTADOS.map((estado) => (
          <div
            key={estado.titulo}
            className="rounded-[20px] border border-[#e7e5df] bg-white/70 p-5 flex flex-col gap-4"
          >
            <div>
              <div className="text-[13px] font-semibold text-slate-700">{estado.titulo}</div>
              <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{estado.nota}</p>
            </div>
            <div className="flex justify-end items-center min-h-[64px] rounded-[14px] bg-[#f8f7f5] px-4 py-3">
              <ChatLauncherBar {...estado.props} />
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 inset-x-0 border-t border-[#e7e5df] bg-white/95 backdrop-blur px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-slate-500 mr-2">Peça viva:</span>
          <Chave ligada={pendencias > 0} onClick={() => setPendencias((n) => (n > 0 ? 0 : 3))}>
            pendências: {pendencias}
          </Chave>
          <button
            type="button"
            onClick={() => setPendencias((n) => n + 1)}
            className="h-9 w-9 rounded-full bg-white border border-[#e7e5df] text-slate-600 hover:border-amber-300"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setPendencias((n) => Math.max(0, n - 1))}
            className="h-9 w-9 rounded-full bg-white border border-[#e7e5df] text-slate-600 hover:border-amber-300"
          >
            −
          </button>
          <Chave ligada={aberto} onClick={() => setAberto((v) => !v)}>painel aberto</Chave>
          <Chave ligada={editor} onClick={() => setEditor((v) => !v)}>editor minimizado</Chave>
          <Chave ligada={naoSalvo} onClick={() => setNaoSalvo((v) => !v)}>não salvo</Chave>
          <Chave ligada={comFoto} onClick={() => setComFoto((v) => !v)}>com foto</Chave>
        </div>
      </div>

      <div className="fixed bottom-24 right-5 flex flex-col items-end z-[60]">
        <ChatLauncherBar
          badgeCount={pendencias}
          title={pendencias ? `${pendencias} conversas da equipe` : 'Mensagens'}
          open={aberto}
          editorMinimized={editor}
          editorHasUnsavedChanges={naoSalvo}
          peerName="Michele da Cunha Leite"
          peerAvatarUrl={comFoto ? AVATAR : null}
          onToggle={() => setAberto((v) => !v)}
          onOpenEditor={() => setEditor(false)}
        />
      </div>
    </div>
  );
}
