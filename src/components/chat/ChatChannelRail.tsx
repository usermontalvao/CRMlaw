// O TRILHO DE CANAIS — a coluna estreita à esquerda do painel de mensagens.
//
// Antes, WhatsApp e Equipe eram duas abas espremidas no meio do cabeçalho,
// disputando 230px com o título à esquerda e três botões de janela à direita.
// Três coisas na mesma linha, e o topo não comportava uma quarta: o dia em que
// Ligações entrar no painel, não há onde pôr.
//
// Aqui o canal sai do topo e vira LUGAR. A coluna tem espaço vertical de sobra,
// cada canal carrega o próprio contador, e o cabeçalho fica com uma coisa só —
// o nome de onde você está. Acrescentar um canal é acrescentar um item na
// lista, não redesenhar o cabeçalho.
//
// O trilho não some quando você abre uma conversa: é dele que se lê, o tempo
// todo, em qual canal você está falando — e sair de um WhatsApp para o chat da
// equipe passa a ser um clique, não um voltar seguido de uma troca de aba.
//
// ── DESENHO ──────────────────────────────────────────────────────────────────
//
// A pastilha branca com sombra curta é a mesma do controle segmentado que ela
// substitui (SegmentedTabs), e a barra laranja de 3px encostada na borda é a
// mesma da barra lateral do CRM: quem já sabe ler "estou aqui" em um lugar lê
// no outro. O fundo é o creme #fbfaf9 com um fio #ecebe7 — a mesma dupla da
// pill da pesquisa global, e não mais um cinza-azulado sem origem.
//
// ARMADILHA (a mesma da ChatLauncherBar): nenhum botão daqui pode ter a classe
// `border`. `index.css` tem um bloco antigo de "correção global de modais" que
// pinta `button[class*="border"]` de #3a3a3c com `!important` quando há um
// ancestral `fixed z-50`. As bordas daqui vêm por `style`, de propósito.
import React from 'react';

/** Laranja da casa — o mesmo dos badges da barra lateral. */
const BRAND = '#f27a23';
/** Creme do trilho e fio da direita: o par da pill da pesquisa global. */
const CREME = '#fbfaf9';
const FIO = '#ecebe7';

/** Acima disso o número vira "99+": quatro dígitos deformariam a pastilha. */
const BADGE_MAX = 99;

export interface ChatChannelItem<T extends string> {
  key: T;
  /** Rótulo sob o ícone. Curto: cabe 56px. */
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Pendências do canal. `0` ou ausente não desenha nada. */
  count?: number;
  title?: string;
}

export interface ChatChannelRailProps<T extends string> {
  items: ReadonlyArray<ChatChannelItem<T>>;
  value: T;
  onChange: (key: T) => void;
  /** Ação do pé do trilho (nova conversa). Ausente não desenha o botão. */
  onNew?: () => void;
  newTitle?: string;
  /** O vão do meio é área de arrastar a janela, como o cabeçalho. */
  onDragHandlePointerDown?: (e: React.PointerEvent) => void;
}

export function ChatChannelRail<T extends string>({
  items, value, onChange, onNew, newTitle = 'Nova conversa', onDragHandlePointerDown,
}: ChatChannelRailProps<T>) {
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="Canais"
      className="w-14 shrink-0 flex flex-col items-center py-2.5 gap-1"
      style={{ background: CREME, borderRight: `1px solid ${FIO}` }}
    >
      {items.map((item) => {
        const ativo = value === item.key;
        const Icone = item.icon;
        const n = item.count ?? 0;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={ativo}
            title={item.title ?? item.label}
            onClick={() => onChange(item.key)}
            className={`relative w-11 h-12 rounded-xl flex flex-col items-center justify-center gap-[3px] transition-colors duration-150 ${
              ativo ? '' : 'hover:bg-slate-900/[0.035]'
            }`}
            style={ativo
              ? {
                  background: '#ffffff',
                  boxShadow: '0 1px 2px rgba(15,23,42,.10), 0 0 0 0.5px rgba(15,23,42,.05)',
                  color: '#c2410c',
                }
              : { color: '#8a8781' }}
          >
            {/* Encostada na borda do painel, como a da barra lateral do CRM. */}
            {ativo && (
              <span
                aria-hidden
                className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-r-full"
                style={{ background: BRAND }}
              />
            )}
            <Icone className="w-[18px] h-[18px]" strokeWidth={1.9} />
            <span className="text-[8.5px] font-semibold leading-none tracking-tight">{item.label}</span>
            {n > 0 && (
              <span
                /* Encostado no canto, não sobre o ícone: em "99+" o contador é
                   largo, e centímetro que ele avança para dentro é centímetro
                   que come o desenho que dá nome ao canal. */
                className="absolute top-0 right-0 min-w-[15px] h-[15px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-bold text-white tabular-nums"
                style={{ background: BRAND, boxShadow: `0 0 0 2px ${ativo ? '#ffffff' : CREME}` }}
                aria-label={`${n} ${n === 1 ? 'pendência' : 'pendências'}`}
              >
                {n > BADGE_MAX ? `${BADGE_MAX}+` : n}
              </span>
            )}
          </button>
        );
      })}

      {/* O vão continua sendo pega de arrastar: o trilho é parte da moldura. */}
      <div className="flex-1 w-full cursor-grab active:cursor-grabbing" onPointerDown={onDragHandlePointerDown} />

      {onNew && (
        /* O "+" desceu do canto da lista para cá. Flutuando sobre o vazio ele
           era um segundo círculo laranja na mesma diagonal da barra "Fechar";
           no pé do trilho ele é contorno, e o laranja fica com quem avisa. */
        <button
          type="button"
          onClick={onNew}
          title={newTitle}
          aria-label={newTitle}
          /* Superfície de verdade, não um contorno pontilhado: sobre o creme do
             trilho, o tracejado sumia — e um botão que não se vê não é botão. */
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-150 hover:text-[#c2410c]"
          style={{ background: '#ffffff', border: '1px solid #e7e5df', color: '#78716c', boxShadow: '0 1px 2px rgba(15,23,42,.06)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default ChatChannelRail;
