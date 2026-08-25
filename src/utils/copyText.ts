/**
 * Copiar texto para a área de transferência, com plano B.
 *
 * `navigator.clipboard` não está sempre lá: some fora de HTTPS, some em
 * `iframe` sem permissão e some quando o navegador não considera a chamada
 * "gesto do usuário". O plano B é o velho `<textarea>` + `execCommand('copy')`,
 * que ainda funciona em todos os navegadores que o escritório usa.
 *
 * Devolve `true` só quando a cópia de fato aconteceu — quem chama precisa disso
 * para não anunciar sucesso sobre nada.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Permissão negada ou contexto inseguro: cai no plano B.
    }
  }

  if (typeof document === 'undefined') return false;
  const campo = document.createElement('textarea');
  campo.value = texto;
  // Fora da vista e sem rolar a página: `position: fixed` com opacidade zero é
  // o único jeito de o campo receber seleção sem piscar na tela.
  campo.setAttribute('readonly', '');
  campo.style.position = 'fixed';
  campo.style.top = '0';
  campo.style.left = '0';
  campo.style.opacity = '0';
  campo.style.pointerEvents = 'none';
  document.body.appendChild(campo);
  try {
    campo.select();
    campo.setSelectionRange(0, campo.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    campo.remove();
  }
}
