// A barra flutuante de mensagens — a única peça do CRM que fica na tela em
// TODOS os módulos, sobre qualquer conteúdo.
//
// Está num arquivo próprio, e não dentro do widget, por dois motivos:
//
//   • ela é PURA. Recebe números e nomes, devolve pixels; não conhece Supabase,
//     rota nem permissão. Dá para abrir a bancada (`?chatlauncherpreview=1`) e
//     ver os estados todos lado a lado, inclusive os que quase nunca aparecem —
//     999 pendências, nome sem foto, editor com alteração não salva;
//   • o widget tem mais de três mil linhas, e a peça mais vista do sistema
//     estava perdida no fim dele.
//
// DESENHO. Uma superfície opaca, uma borda de um pixel, uma sombra curta. A
// versão anterior empilhava gradiente diagonal, `backdrop-filter`, um véu de
// brilho por cima, ícone laranja com sombra colorida, badge vermelho-degradê
// com halo e um anel que pulsava para sempre enquanto houvesse mensagem — seis
// efeitos numa peça de 44 pixels de altura, competindo com o conteúdo em vez de
// esperar por ele. Aqui o que muda de aparência é só o que muda de estado: o
// número, e o rosto de quem escreveu.
import React from 'react';
import { FileText, MessageCircle } from 'lucide-react';

/** Cor chapada; a borda vem de um `inset shadow` para não somar ao tamanho. */
const SURFACE: React.CSSProperties = {
  background: '#111a2e',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.09)',
};

/**
 * O contador. Laranja da marca, chapado, com o número em largura fixa
 * (`tabular-nums`) para a barra não dar um tranco quando o total vai de 9 para
 * 10. Era vermelho — a cor de erro do sistema para anunciar o trabalho normal
 * do escritório.
 */
const BADGE_CLASS =
  'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full '
  + 'bg-orange-500 text-white text-[11px] font-semibold leading-none tabular-nums';

/** Acima disso o número vira "99+": quatro dígitos deformariam a barra. */
const BADGE_MAX = 99;

export interface ChatLauncherBarProps {
  /** Total de pendências — equipe + WhatsApp somados. */
  badgeCount: number;
  /** Dica do mouse: é ela que abre a conta de onde vem o número. */
  title: string;
  /** Rosto de quem escreveu por último, quando há pendência. */
  peerName?: string | null;
  peerAvatarUrl?: string | null;
  /** O Editor de Petições está minimizado nesta aba? Então ele mora aqui. */
  editorMinimized?: boolean;
  editorHasUnsavedChanges?: boolean;
  onToggle: () => void;
  onOpenEditor: () => void;
}

const contador = (n: number) => (n > BADGE_MAX ? `${BADGE_MAX}+` : String(n));

const ChatLauncherBar: React.FC<ChatLauncherBarProps> = ({
  badgeCount,
  title,
  peerName,
  peerAvatarUrl,
  editorMinimized = false,
  editorHasUnsavedChanges = false,
  onToggle,
  onOpenEditor,
}) => {
  const temPendencia = badgeCount > 0;
  const mostraRosto = temPendencia && !!(peerName || peerAvatarUrl);

  return (
    <button
      data-chat-floating-widget-launcher="1"
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      className="group relative rounded-full overflow-hidden transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      style={{
        // Uma sombra só, curta. Uma peça permanente na tela tem de pousar sobre
        // a interface, não flutuar acima dela como um aviso de erro.
        boxShadow: '0 10px 30px -12px rgba(15,23,42,.55), 0 2px 8px -2px rgba(15,23,42,.35)',
      }}
    >
      {/* Celular — só o círculo; não há espaço para rótulo nem para o Editor. */}
      <div className="sm:hidden flex items-center justify-center h-12 w-12 text-white relative" style={SURFACE}>
        <div className="relative">
          <MessageCircle className="w-5 h-5" strokeWidth={2} />
          {temPendencia && (
            <span className={BADGE_CLASS} style={{ position: 'absolute', top: -8, right: -10 }}>
              {contador(badgeCount)}
            </span>
          )}
        </div>
      </div>

      {/* Computador — barra horizontal, até três blocos. */}
      <div className="hidden sm:flex items-stretch text-white relative" style={SURFACE}>
        <div className="flex items-center gap-2.5 pl-4 pr-3.5 h-11">
          <MessageCircle className="w-[17px] h-[17px] text-white/75" strokeWidth={1.9} />
          <span className="text-[13px] font-medium tracking-[-0.005em] text-white/95">Mensagens</span>
          {temPendencia && <span className={BADGE_CLASS}>{contador(badgeCount)}</span>}
        </div>

        {editorMinimized && (
          <>
            <div className="my-2.5 w-px bg-white/[0.12]" aria-hidden />
            {/* Não é <button>: já estamos dentro de um, e botão dentro de botão
                é HTML inválido — o navegador desmonta a árvore. */}
            <div
              role="button"
              tabIndex={0}
              className="flex items-center gap-2 px-3.5 h-11 text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
              title={editorHasUnsavedChanges ? 'Abrir Editor — há alterações não salvas' : 'Abrir Editor'}
              onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenEditor();
                }
              }}
            >
              <FileText className="w-[15px] h-[15px]" strokeWidth={1.9} />
              <span className="text-[13px] font-medium">Editor</span>
              {editorHasUnsavedChanges && (
                // Ponto sólido, sem pulsar: "não salvo" é um estado, não um
                // alarme. Quem passa o mouse lê a frase inteira.
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
              )}
            </div>
          </>
        )}

        {mostraRosto && (
          <div className="flex items-center pr-3 pl-0.5 h-11">
            {peerAvatarUrl ? (
              <img
                src={peerAvatarUrl}
                alt={peerName || ''}
                className="w-7 h-7 rounded-full object-cover ring-1 ring-white/25"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/[0.10] ring-1 ring-white/20 flex items-center justify-center text-[11px] font-semibold text-white/90">
                {(peerName || '?').substring(0, 1).toUpperCase()}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
};

export default ChatLauncherBar;
