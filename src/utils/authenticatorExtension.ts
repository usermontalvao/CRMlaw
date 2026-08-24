/** ID fixo definido pela chave pública do `extension/manifest.json`. */
export const AUTHENTICATOR_EXTENSION_ID = 'ipapgfacphjdohnonhjkgbcdmojelbjb';

/**
 * Único recurso que o manifest deixa o CRM enxergar. O ícone não contém dado
 * nem abre canal de comunicação: carregar significa "a extensão existe neste
 * navegador"; falhar significa "ofereça o download".
 */
export const AUTHENTICATOR_EXTENSION_MARKER =
  `chrome-extension://${AUTHENTICATOR_EXTENSION_ID}/icons/icon-16.png`;

type ImagemDeSonda = Pick<HTMLImageElement, 'onload' | 'onerror' | 'src'>;

/** Detecta a instalação neste navegador, e não uma sessão da conta em outro. */
export function detectarExtensaoAuthenticator(
  criarImagem: () => ImagemDeSonda = () => new Image(),
  limiteMs = 800,
): Promise<boolean> {
  return new Promise((resolver) => {
    const imagem = criarImagem();
    let terminou = false;

    const concluir = (instalada: boolean) => {
      if (terminou) return;
      terminou = true;
      globalThis.clearTimeout(limite);
      imagem.onload = null;
      imagem.onerror = null;
      resolver(instalada);
    };

    // Em navegadores que não entendem `chrome-extension://`, o evento de erro
    // costuma ser imediato. O limite cobre os que simplesmente ignoram a URL.
    const limite = globalThis.setTimeout(() => concluir(false), limiteMs);
    imagem.onload = () => concluir(true);
    imagem.onerror = () => concluir(false);
    imagem.src = AUTHENTICATOR_EXTENSION_MARKER;
  });
}
