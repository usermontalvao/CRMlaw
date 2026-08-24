// Preenchimento do código na página aberta.
//
// ── o que esta função PODE tocar ────────────────────────────────────────────
//
// Ela é injetada com `chrome.scripting.executeScript` na aba ativa, e só
// depois de um clique explícito no botão "Preencher". A permissão usada é
// `activeTab`, que o Chrome concede para UMA aba, naquele momento, por causa
// daquele clique — e revoga quando a aba navega. Não existe `host_permissions`
// de site nenhum, não existe content script rodando sozinho, e a extensão não
// enxerga página alguma enquanto ninguém pede.
//
// ── o que ela NUNCA faz ─────────────────────────────────────────────────────
//
// Não lê o conteúdo da página, não envia nada de volta além de "deu certo" ou
// "não achei campo", e não submete formulário: quem confirma é a pessoa. O
// código entra no campo e para por aí.

/**
 * Roda DENTRO da página. Não pode fechar sobre nada do escopo da extensão —
 * o que ela precisa chega por argumento.
 */
export function preencherNaPagina(codigo) {
  const visivel = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    const caixa = el.getBoundingClientRect();
    if (caixa.width < 8 || caixa.height < 8) return false;
    const estilo = getComputedStyle(el);
    return estilo.visibility !== 'hidden' && estilo.display !== 'none' && Number(estilo.opacity) > 0.05;
  };

  const digitar = (campo, valor) => {
    // Setter nativo + evento: React e Vue ignoram uma atribuição direta em
    // `.value`, porque escutam o evento e mantêm o próprio estado. Sem isto o
    // código aparece na tela e o site continua achando que o campo está vazio.
    const proto = campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    campo.focus();
    if (setter) setter.call(campo, valor); else campo.value = valor;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const candidatos = [...document.querySelectorAll('input, textarea')].filter(visivel);
  if (candidatos.length === 0) return { ok: false, motivo: 'sem-campo' };

  // Muitos sites de 2FA usam SEIS caixinhas de um dígito. Se for esse o caso,
  // cada dígito vai para a sua — preencher só a primeira não adianta nada.
  const caixinhas = candidatos.filter((el) => {
    const max = Number(el.getAttribute('maxlength'));
    return max === 1 && /text|tel|number|password/.test(el.type || 'text');
  });
  if (caixinhas.length >= codigo.length) {
    const alvo = caixinhas.slice(0, codigo.length);
    alvo.forEach((campo, i) => digitar(campo, codigo[i]));
    alvo[alvo.length - 1].focus();
    return { ok: true, modo: 'caixinhas' };
  }

  // Caso comum: um campo só. A ordem de preferência vai do sinal mais forte
  // (o site DIZ que é um código de uso único) para o mais fraco (é o campo em
  // que a pessoa já estava).
  const pontuar = (el) => {
    const pistas = `${el.name} ${el.id} ${el.getAttribute('autocomplete') ?? ''} ${el.placeholder ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
    if ((el.getAttribute('autocomplete') ?? '').includes('one-time-code')) return 100;
    if (/\b(otp|totp|2fa|mfa)\b/.test(pistas)) return 90;
    if (/(one.?time|verification|verificacao|verificação)/.test(pistas)) return 80;
    if (/(c[oó]digo|code|token|pin)/.test(pistas)) return 70;
    if (Number(el.getAttribute('maxlength')) === codigo.length) return 60;
    if (el === document.activeElement) return 50;
    return 0;
  };

  const melhor = candidatos
    .map((el) => ({ el, nota: pontuar(el) }))
    .sort((a, b) => b.nota - a.nota)[0];

  // Nota zero é chute. Preencher a esmo poderia jogar o código dentro de um
  // campo de busca, de comentário, ou de qualquer coisa que a página envie
  // para outro lugar — melhor dizer que não achou.
  if (!melhor || melhor.nota === 0) return { ok: false, motivo: 'sem-campo' };

  digitar(melhor.el, codigo);
  return { ok: true, modo: 'campo' };
}
