// O rosto de um contato do WhatsApp: foto quando existe, iniciais quando não.
//
// Nasceu dentro do painel "Nova conversa" e saiu de lá quando o CARTÃO DE
// CONTATO recebido passou a mostrar rosto também. São a mesma pergunta feita
// duas vezes — "quem é este número, e ele tem WhatsApp?" —, então é a mesma
// resposta desenhada: manter duas cópias seria deixar o mesmo contato com duas
// caras diferentes em duas telas do mesmo módulo.
import React, { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { initials } from './format';

/**
 * Paleta das iniciais. O WhatsApp dá uma cor por contato em vez de pintar a
 * agenda inteira da mesma cor — com trinta linhas na tela, uma coluna toda
 * verde vira uma mancha e ninguém acha ninguém. A cor sai do nome, então é
 * sempre a mesma pessoa na mesma cor, hoje e amanhã.
 */
const CORES_AVATAR = [
  'from-[#00a884] to-[#017561]',
  'from-[#3b82f6] to-[#1d4ed8]',
  'from-[#f59e0b] to-[#b45309]',
  'from-[#8b5cf6] to-[#6d28d9]',
  'from-[#ec4899] to-[#be185d]',
  'from-[#0ea5e9] to-[#0369a1]',
  'from-[#14b8a6] to-[#0f766e]',
  'from-[#ef4444] to-[#b91c1c]',
];
export function corDoNome(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma = (soma * 31 + nome.charCodeAt(i)) >>> 0;
  return CORES_AVATAR[soma % CORES_AVATAR.length];
}

/**
 * Avatar do contato: foto do WhatsApp quando existe, iniciais quando não.
 *
 * Quando a Evolution já disse que aquele número NÃO tem WhatsApp, o avatar
 * ganha o alvo vermelho no canto — o mesmo lugar onde qualquer aplicativo de
 * mensagem põe o estado de quem está do outro lado. O selo escrito ao lado do
 * nome explica; o alvo é o que se enxerga varrendo a coluna com os olhos, sem
 * ler linha por linha.
 */
export const ContactAvatar: React.FC<{
  name: string;
  url: string | null;
  semWhats?: boolean;
  /** Lado do círculo em pixels. O padrão é o da agenda. */
  size?: number;
}> = ({ name, url, semWhats, size = 48 }) => {
  // A URL assinada pode ter expirado entre carregar a agenda e rolar até aqui.
  // Sem esta rede, a linha ficaria com o ícone de imagem quebrada — pior do que
  // as iniciais, que sempre funcionam.
  const [quebrou, setQuebrou] = useState(false);
  const [carregada, setCarregada] = useState(false);
  useEffect(() => { setQuebrou(false); setCarregada(false); }, [url]);
  const mostraFoto = !!url && !quebrou;
  // O alvo e a letra encolhem junto com o círculo: num avatar de 36px o selo de
  // 17px do tamanho cheio cobriria um quarto do rosto.
  const selo = Math.max(13, Math.round(size * 0.355));
  return (
    // O invólucro NÃO corta: é ele que deixa o alvo passar da borda do círculo.
    <span className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <span
        style={{ fontSize: Math.max(10, Math.round(size * 0.3)) }}
        className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br font-bold text-white shadow-sm ring-1 ring-black/5 transition-opacity duration-300 ${corDoNome(name)} ${semWhats ? 'opacity-40 saturate-50' : ''}`}>
        {/* As iniciais ficam por baixo enquanto a foto carrega: é sobre elas
            que a imagem atravessa, em vez de aparecer sobre um buraco. */}
        {mostraFoto && <span className="absolute">{initials(name, '')}</span>}
        {mostraFoto
          ? <img src={url!} alt="" data-carregada={carregada}
              onLoad={() => setCarregada(true)} onError={() => setQuebrou(true)}
              className="wa-avatar-img relative h-full w-full object-cover" loading="lazy" />
          : initials(name, '')}
      </span>
      {semWhats && (
        <span aria-hidden
          style={{ width: selo, height: selo }}
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-red-500 text-white ring-2 ring-white">
          <Ban size={Math.round(selo * 0.6)} strokeWidth={2.75} />
        </span>
      )}
    </span>
  );
};

export default ContactAvatar;
