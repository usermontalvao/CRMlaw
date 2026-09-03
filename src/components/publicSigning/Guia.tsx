/**
 * O GUIA — quem aponta a próxima coisa a tocar.
 *
 * Noventa e nove por cento das assinaturas acontecem no celular, e quase sempre
 * com alguém que nunca assinou um contrato pelo telefone. O fluxo já era curto
 * e explicado; o que faltava era o GESTO — a mesma ideia que já existia num
 * lugar só, o dedo que atravessa o quadro da assinatura (ver `DemoDoDedo`).
 * Aqui ela vira a língua das seis etapas.
 *
 * ┌── AS REGRAS, e elas são o produto ──────────────────────────────────────┐
 * │ 1. Só aparece depois de HESITAÇÃO. Quem já sabe o caminho toca antes e  │
 * │    nunca vê professor nenhum.                                           │
 * │ 2. Some no primeiro toque, e volta depois de ~2 s de silêncio, se o     │
 * │    passo continuar pendente. Nunca some sozinho — a vigia de um segundo │
 * │    repõe o que qualquer remedição tenha engolido.                       │
 * │ 3. Nunca escurece a tela e nunca bloqueia: a camada inteira é           │
 * │    pointer-events:none. Ele é um conselho, não um pedágio.              │
 * │ 4. Aponta UMA coisa por vez, na ordem em que a pessoa precisa fazer.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A APARÊNCIA é a do produto, não a de um tour de onboarding: cartão branco
 * com borda de um fio, o mesmo raio e a mesma tipografia dos cartões da etapa
 * de identidade. O alvo não pisca — ganha FOCO, um fio laranja com brilho
 * largo e baixo, respirando em 3 s. É a diferença entre "olha aqui!" e "é
 * este". As classes moram em `ui.tsx`, junto das outras animações públicas.
 *
 * COMO LIGAR NUMA TELA: ponha `data-guia="alguma-coisa"` no controle e declare
 * o passo com `alvo: '[data-guia="alguma-coisa"]'`. `pronto` é o que tira o
 * passo da fila — é ele que faz o guia andar sozinho, campo a campo.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface PassoDoGuia {
  /** Seletor do alvo. Por convenção, `[data-guia="..."]`. */
  alvo: string;
  /** A frase, no imperativo e curta. É lida de relance, não estudada. */
  texto: string;
  /** Alvo com cantos redondos (o botão-pílula do leitor). */
  redondo?: boolean;
  /** Já cumprido: o guia pula para o próximo. */
  pronto?: boolean;
  /**
   * De que lado do alvo o cartão fica. Por padrão ele vai ACIMA quando cabe —
   * assim não tapa o que vem depois, que é para onde a pessoa está indo. Vale
   * forçar `abaixo` quando o que está acima do alvo é justamente a frase que
   * explica o alvo (foi o caso do rótulo "Recomendado", na identidade).
   */
  lado?: 'acima' | 'abaixo';
}

/** Quanto tempo parado antes de o guia aparecer. */
const ESPERA_ENTRADA = 1400; // ao chegar numa etapa
const ESPERA_PARADO = 2200;  // depois de mexer em alguma coisa

export const Guia: React.FC<{
  /** Os passos da tela atual, na ordem. */
  passos: PassoDoGuia[];
  /** Muda quando a tela muda — é o que reinicia a espera. */
  chave: string;
  /** Desligado enquanto há overlay por cima, envio em curso, etc. */
  ligado?: boolean;
}> = ({ passos, chave, ligado = true }) => {
  const camadaRef = useRef<HTMLDivElement>(null);
  const focoRef = useRef<HTMLDivElement>(null);
  const cartaoRef = useRef<HTMLDivElement>(null);
  const textoRef = useRef<HTMLSpanElement>(null);
  const contadorRef = useRef<HTMLSpanElement>(null);

  // Os passos vivem numa gaveta para os ouvintes não precisarem ser
  // reassinados a cada render do pai (que acontece a cada tecla digitada).
  const passosRef = useRef(passos);
  passosRef.current = passos;
  const ligadoRef = useRef(ligado);
  ligadoRef.current = ligado;

  const relogioRef = useRef<number | null>(null);
  const visivelRef = useRef<PassoDoGuia | null>(null);
  const quadroRef = useRef<number | null>(null);
  const ateRef = useRef(0);

  useEffect(() => {
    const camada = camadaRef.current;
    const foco = focoRef.current;
    const cartao = cartaoRef.current;
    const texto = textoRef.current;
    const contador = contadorRef.current;
    if (!camada || !foco || !cartao || !texto || !contador) return;

    /*
      O passo da vez: o primeiro ainda não cumprido QUE EXISTE NA TELA.

      A checagem do alvo não é preciosismo. Se um passo aponta para algo que
      não está montado — porque a tela mudou de cara, porque o botão só nasce
      depois de carregar, porque a marca `data-guia` saiu num refactor — o guia
      ficaria mudo para sempre naquela etapa, sem erro nenhum no console.
      Pulando para o próximo alvo presente, o pior caso vira "guiou o passo
      seguinte", e não "sumiu".
    */
    const daVez = () => {
      const fila = passosRef.current;
      for (let i = 0; i < fila.length; i++) {
        const passo = fila[i];
        if (passo.pronto) continue;
        if (!document.querySelector(passo.alvo)) continue;
        return { passo, indice: i + 1, total: fila.length };
      }
      return null;
    };

    const esconder = () => {
      visivelRef.current = null;
      camada.classList.remove('ap-guia-vendo');
    };

    const posicionar = (passo: PassoDoGuia, indice: number, total: number) => {
      const alvo = document.querySelector(passo.alvo);
      if (!alvo) { camada.classList.remove('ap-guia-vendo'); return; }

      const r = alvo.getBoundingClientRect();
      const alturaTela = window.innerHeight;
      const larguraTela = window.innerWidth;

      // fora da vista (rolagem, teclado): recolhe, mas continua sendo o passo
      if (r.width === 0 || r.bottom < 8 || r.top > alturaTela - 8) {
        camada.classList.remove('ap-guia-vendo');
        return;
      }
      camada.classList.add('ap-guia-vendo');

      foco.style.left = `${r.left - 4}px`;
      foco.style.top = `${r.top - 4}px`;
      foco.style.width = `${r.width + 8}px`;
      foco.style.height = `${r.height + 8}px`;
      foco.classList.toggle('ap-guia-redondo', !!passo.redondo);

      if (texto.textContent !== passo.texto) texto.textContent = passo.texto;
      const rotulo = total > 1 ? `Passo ${indice} de ${total}` : '';
      if (contador.textContent !== rotulo) contador.textContent = rotulo;
      contador.hidden = !rotulo;

      const c = cartao.getBoundingClientRect();
      const cabeAcima = r.top > c.height + 26;
      const cabeAbaixo = r.bottom + c.height + 26 < alturaTela;
      const acima = passo.lado === 'abaixo' ? !cabeAbaixo
        : passo.lado === 'acima' ? cabeAcima
        : cabeAcima;
      cartao.classList.toggle('ap-guia-acima', acima);
      cartao.classList.toggle('ap-guia-abaixo', !acima);
      cartao.style.top = `${acima ? r.top - c.height - 15 : r.bottom + 15}px`;

      const centro = r.left + r.width / 2;
      const margem = 12;
      const esq = Math.max(margem, Math.min(centro - c.width / 2, larguraTela - c.width - margem));
      cartao.style.left = `${esq}px`;
      cartao.style.setProperty('--ap-bico', `${centro - esq}px`);
    };

    /* Acompanha o alvo por meio segundo e PARA. Um requestAnimationFrame eterno
       manteria a página acordada à toa — no telefone isso é bateria. Meio
       segundo cobre o que se move sozinho (fonte que chega, teclado que entra);
       o resto vem por evento. */
    const acompanhar = () => {
      const atual = visivelRef.current;
      if (!atual) { quadroRef.current = null; return; }
      const vez = daVez();
      if (vez) posicionar(vez.passo, vez.indice, vez.total);
      quadroRef.current = performance.now() < ateRef.current
        ? requestAnimationFrame(acompanhar)
        : null;
    };

    const remedir = () => {
      if (!visivelRef.current) return;
      ateRef.current = performance.now() + 500;
      if (quadroRef.current == null) quadroRef.current = requestAnimationFrame(acompanhar);
    };

    const mostrar = () => {
      const vez = daVez();
      if (!vez || !ligadoRef.current) { esconder(); return; }
      visivelRef.current = vez.passo;
      posicionar(vez.passo, vez.indice, vez.total);
      remedir();
    };

    const agendar = (ms: number) => {
      if (relogioRef.current) window.clearTimeout(relogioRef.current);
      relogioRef.current = null;
      if (!ligadoRef.current) { esconder(); return; }
      relogioRef.current = window.setTimeout(() => {
        relogioRef.current = null;
        mostrar();
      }, ms);
    };

    const mexeu = () => {
      esconder();
      agendar(ESPERA_PARADO);
    };

    const eventos: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchmove'];
    eventos.forEach((ev) => window.addEventListener(ev, mexeu, { passive: true }));
    window.addEventListener('input', mexeu, { passive: true, capture: true });
    window.addEventListener('scroll', mexeu, { passive: true, capture: true });
    window.addEventListener('resize', remedir);
    window.visualViewport?.addEventListener('resize', remedir);
    window.visualViewport?.addEventListener('scroll', remedir);

    /* A VIGIA. O guia some por um motivo só — a pessoa mexeu. Se o passo segue
       pendente, o relógio não está correndo e a camada está apagada, alguma
       coisa o engoliu: uma remedição no meio de uma rolagem, o teclado
       entrando, uma troca de etapa. Esta batida repõe. */
    const vigia = window.setInterval(() => {
      if (!ligadoRef.current || relogioRef.current) return;
      const vez = daVez();
      if (!vez) { esconder(); return; }
      if (!camada.classList.contains('ap-guia-vendo') || texto.textContent !== vez.passo.texto) {
        mostrar();
      }
    }, 1000);

    agendar(ESPERA_ENTRADA);

    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, mexeu));
      window.removeEventListener('input', mexeu, true);
      window.removeEventListener('scroll', mexeu, true);
      window.removeEventListener('resize', remedir);
      window.visualViewport?.removeEventListener('resize', remedir);
      window.visualViewport?.removeEventListener('scroll', remedir);
      window.clearInterval(vigia);
      if (relogioRef.current) window.clearTimeout(relogioRef.current);
      if (quadroRef.current != null) cancelAnimationFrame(quadroRef.current);
      relogioRef.current = null;
      quadroRef.current = null;
      visivelRef.current = null;
    };
    // `chave` reinicia a espera a cada etapa; `ligado` liga e desliga a camada.
  }, [chave, ligado]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ap-guia" ref={camadaRef} aria-hidden="true">
      <div className="ap-guia-foco" ref={focoRef} />
      <div className="ap-guia-cartao ap-guia-acima" ref={cartaoRef}>
        <span className="ap-guia-seta">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v13" />
            <path d="m18 12-6 6-6-6" />
          </svg>
        </span>
        <span>
          <span className="ap-guia-contador" ref={contadorRef} hidden />
          <span className="ap-guia-texto" ref={textoRef} />
        </span>
        <span className="ap-guia-bico" />
      </div>
    </div>,
    document.body,
  );
};

export default Guia;
