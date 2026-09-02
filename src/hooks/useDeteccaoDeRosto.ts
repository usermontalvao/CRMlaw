import { useEffect, useRef, useState } from 'react';

/**
 * Detecção de rosto ao vivo no visor da selfie (etapa 5 da assinatura pública).
 *
 * POR QUE EXISTE
 * A validação por IA (`analyze-facial-photo`) já reprovava foto sem rosto, mas
 * só DEPOIS do clique: a pessoa gastava a foto, esperava a análise e só então
 * descobria o problema — e cada tentativa ruim virava uma chamada de visão paga.
 * Aqui o portão vai para antes do clique.
 *
 * A TRAVA NUNCA PRENDE
 * A conta é assimétrica: deixar passar foto ruim custa pouco (a IA atrás
 * reprova e a pessoa repete), mas impedir alguém de assinar custa um contrato
 * com prazo. Somado a isso, detector de rosto erra mais com pele escura e luz
 * fraca — limitação conhecida da tecnologia. Por isso há três escapes:
 *   1. passados ESCAPE_MS sem nenhuma detecção, libera sozinho;
 *   2. uma vez liberado assim, continua liberado (não volta a travar);
 *   3. se o modelo não carregar, a etapa se comporta como antes do detector.
 *
 * O QUE ESTE DETECTOR NÃO FAZ
 * Não prova identidade nem vivacidade: uma foto impressa ou a tela de outro
 * celular passam por ele — e também passam pela IA. Ele resolve enquadramento,
 * não fraude.
 */

import {
  ESTABILIDADE_INICIAL,
  type EstadoDeteccao,
  avaliarQuadro,
  avancarEstabilidade,
  deveDispararSozinho,
} from './deteccaoDeRosto.logica';

export type { EstadoDeteccao };

/** Quadros por segundo da detecção. Mais que isso só esquenta o aparelho. */
const FPS = 6;
/** Sem nenhuma detecção neste tempo, o botão destrava sozinho. */
const ESCAPE_MS = 12_000;
/** Onde os pesos do modelo estão hospedados (no nosso domínio, não em CDN). */
const MODELO_URL = '/modelos/blazeface/model.json';

export interface DeteccaoDeRosto {
  estado: EstadoDeteccao;
  /** Se o botão de tirar foto pode ser acionado. */
  liberado: boolean;
  /**
   * Se a contagem regressiva do disparo automático pode correr.
   *
   * NÃO é só "o rosto está parado": os escapes do portão também abrem esta
   * porta. Ver `deveDispararSozinho` — o botão já era liberado por eles, e
   * deixar o automático de fora fazia a tela prometer uma contagem que nunca
   * vinha.
   */
  estavel: boolean;
  /** Frase curta para mostrar sob o visor. */
  dica: string;
}

const DICAS: Record<EstadoDeteccao, string> = {
  carregando: 'Preparando a câmera…',
  procurando: 'Centralize seu rosto no oval',
  longe: 'Aproxime um pouco o rosto',
  fora: 'Traga o rosto para o centro',
  pronto: 'Pronto — pode tirar a foto',
  indisponivel: 'Centralize e mantenha parado',
};

/**
 * @param videoRef  o <video> do visor
 * @param ativo     só roda quando a etapa da foto está em cena com a câmera ligada
 */
export function useDeteccaoDeRosto(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  ativo: boolean,
): DeteccaoDeRosto {
  const [estado, setEstado] = useState<EstadoDeteccao>('carregando');
  const [estavel, setEstavel] = useState(false);
  const [escapou, setEscapou] = useState(false);

  // O escape é definitivo dentro da sessão: quem já esperou uma vez não pode
  // voltar a ficar preso ao trocar de etapa e voltar.
  const escapouRef = useRef(false);
  escapouRef.current = escapou;

  useEffect(() => {
    if (!ativo) return;

    let vivo = true;
    let timer: number | undefined;
    let escapeTimer: number | undefined;
    let modelo: { estimateFaces: (input: HTMLVideoElement, retornarTensores?: boolean) => Promise<any[]> } | null = null;
    let estabilidade = ESTABILIDADE_INICIAL;

    const marcarEscape = () => {
      if (!vivo || escapouRef.current) return;
      setEscapou(true);
    };

    const detectar = async () => {
      const video = videoRef.current;
      if (!vivo || !modelo || !video) return;
      if (!video.videoWidth || video.readyState < 2) return;

      let rostos: any[] = [];
      try {
        rostos = await modelo.estimateFaces(video, false);
      } catch {
        // Um quadro que falha não é motivo para desistir do detector.
        return;
      }
      if (!vivo) return;

      const melhor = avaliarQuadro(rostos, video.videoWidth, video.videoHeight);
      setEstado(melhor);

      // Estabilidade com histerese: ganha rápido, perde devagar. Ver
      // avancarEstabilidade em deteccaoDeRosto.logica.ts.
      estabilidade = avancarEstabilidade(estabilidade, melhor);
      setEstavel(estabilidade.estavel);

      // O escape só é dispensado quando a detecção PROVA que funciona — isto
      // é, quando a estabilidade se forma. Antes bastava UM quadro em
      // 'pronto' para cancelá-lo, e aí um rosto que oscila (luz fraca, pele
      // escura, pessoa se ajeitando) ficava no pior dos mundos: nunca somava
      // os quadros seguidos para virar estável, e tinha perdido a rede de
      // segurança que existia justamente para esse caso. A contagem
      // regressiva não vinha nunca, e só a foto manual funcionava.
      if (estabilidade.estavel && escapeTimer !== undefined) {
        window.clearTimeout(escapeTimer);
        escapeTimer = undefined;
      }
    };

    (async () => {
      try {
        // Importação sob demanda: quem assina sem etapa de foto não baixa nada
        // disto, e o pacote da página pública continua pequeno.
        const [tf, blazeface] = await Promise.all([
          import('@tensorflow/tfjs-core'),
          import('@tensorflow-models/blazeface'),
        ]);
        await import('@tensorflow/tfjs-backend-webgl');
        if (!vivo) return;

        await tf.setBackend('webgl');
        await tf.ready();
        if (!vivo) return;

        modelo = await blazeface.load({ modelUrl: MODELO_URL });
        if (!vivo) return;

        setEstado('procurando');
        escapeTimer = window.setTimeout(marcarEscape, ESCAPE_MS);
        timer = window.setInterval(detectar, Math.round(1000 / FPS));
      } catch (err) {
        console.warn('[useDeteccaoDeRosto] modelo indisponível, seguindo sem o portão:', err);
        if (!vivo) return;
        setEstado('indisponivel');
        setEscapou(true);
      }
    })();

    return () => {
      vivo = false;
      estabilidade = ESTABILIDADE_INICIAL;
      setEstavel(false);
      if (timer !== undefined) window.clearInterval(timer);
      if (escapeTimer !== undefined) window.clearTimeout(escapeTimer);
    };
  }, [ativo, videoRef]);

  return {
    estado,
    liberado: estado === 'pronto' || escapou,
    estavel: deveDispararSozinho({ estavel, escapou }),
    dica: DICAS[estado],
  };
}
