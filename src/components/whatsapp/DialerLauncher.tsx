// O BOTÃO QUE ABRE O DISCADOR — dentro da pesquisa global, depois de um fio.
//
// A escolha do lugar diz uma coisa que é verdade: procurar e ligar são a mesma
// família. As duas atravessam o CRM inteiro, nenhuma pertence a módulo nenhum,
// e as duas começam pela mesma pergunta — "quem?". Por isso o botão não vira
// mais um ícone solto no grupo de ações (que já tem quatro): ele entra na pill
// da pesquisa, separado por um fio, como a segunda metade da mesma ferramenta.
//
// O PONTO VERDE É O ESTADO DA LINHA, e é a única coisa aqui que se move. Ele
// existe porque a resposta "dá para ligar agora?" custava, antes, um clique e
// um aviso de erro: serviço fora do ar e conta não pareada só apareciam DEPOIS
// da tentativa. Agora está escrito na barra o tempo todo.
//
// A ANIMAÇÃO TEM UMA FUNÇÃO SÓ: dizer que o estado MUDOU. Duas, e nada além:
//
//  · na primeira aparição, o ícone entra deslizando de dentro da pill — é de lá
//    que ele "vem", e o movimento curto explica que ele faz parte dela;
//  · quando a linha CONECTA, o ponto dá um pulso único.
//
// O que não existe aqui é laço: um ícone que pulsa o dia inteiro vira paisagem
// e deixa de avisar qualquer coisa — foi o defeito da primeira versão do
// distintivo da aba de ligações (ver `callHistory.ts`). E quem pediu "reduzir
// movimento" ao sistema não vê nem uma coisa nem outra: o estado continua
// escrito no `title` e no `aria-label`, que é onde ele nunca depende de pixel.
import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Phone } from 'lucide-react';
import { useWaCalls } from '../../hooks/useWaCalls';
import { useCanDial } from '../../hooks/useCanDial';
import { dialerStore } from '../../services/wacalls/dialerStore';
import { useDialer } from './DialerWindow';

export const DialerLauncher: React.FC<{
  /** Variante da barra estreita do celular, onde não há pill para morar dentro. */
  standalone?: boolean;
}> = ({ standalone = false }) => {
  const podeDiscar = useCanDial();
  const { canCall } = useWaCalls();
  const { open } = useDialer();
  const semMovimento = useReducedMotion();

  // Pulso do ponto: só na SUBIDA de "não dá" para "dá". A conexão que já estava
  // de pé quando a página abriu não é novidade para ninguém.
  const [pulsar, setPulsar] = useState(false);
  const linhaAntes = useRef<boolean | null>(null);
  useEffect(() => {
    const antes = linhaAntes.current;
    linhaAntes.current = canCall;
    if (antes === null || antes === canCall || !canCall) return;
    setPulsar(true);
    const id = window.setTimeout(() => setPulsar(false), 900);
    return () => window.clearTimeout(id);
  }, [canCall]);

  // Sem permissão, o telefone não existe na barra — nem apagado, nem com
  // cadeado. Um botão desabilitado anuncia uma porta e ao mesmo tempo diz que
  // ela não é para você; para quem nunca vai ligar pelo CRM, isso é só ruído
  // permanente no lugar mais visível da tela. A trava de verdade continua no
  // `placeCall` (ver `dialPermission.ts`) — este `return` é desenho.
  //
  // Depois de todos os hooks de propósito: a regra do React não admite hook
  // condicional, e a pergunta da permissão é assíncrona.
  if (!podeDiscar) return null;

  const titulo = canCall
    ? 'Discador — ligar para um número ou contato (⌘⇧L)'
    : 'Discador — linha indisponível no momento (⌘⇧L)';

  return (
    <motion.button
      type="button"
      onClick={() => dialerStore.toggle()}
      initial={semMovimento ? false : { opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30, delay: 0.15 }}
      title={titulo}
      aria-label={titulo}
      aria-pressed={open}
      className={`relative flex flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
        standalone ? 'h-9 w-9' : 'h-8 w-8'
      } ${
        open
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
          : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700'
      }`}
    >
      <Phone className="h-[17px] w-[17px]" />
      <span
        aria-hidden
        className={`absolute right-1 top-1 h-[7px] w-[7px] rounded-full ring-2 ring-[#f7f6f3] transition-colors ${
          canCall ? 'bg-emerald-500' : 'bg-amber-400'
        } ${pulsar && !semMovimento ? 'wa-dialer-dot-pulse' : ''}`}
      />
    </motion.button>
  );
};

export default DialerLauncher;
