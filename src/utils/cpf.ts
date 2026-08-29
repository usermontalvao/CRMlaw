/**
 * Validação de CPF pelos dígitos verificadores.
 *
 * A tela pública de assinatura só conferia se havia 11 dígitos: "111.111.111-11"
 * e "123.456.789-00" passavam. Um CPF inválido no documento assinado é um
 * defeito no próprio instrumento — vale barrar na entrada.
 *
 * Sem imports de propósito, para os testes exercitarem isto sem arrastar o
 * componente inteiro.
 */

/** Só os algarismos, do jeito que o usuário digitou (com ou sem máscara). */
export const digitosCpf = (valor: string | null | undefined): string =>
  (valor ?? '').replace(/\D/g, '');

/**
 * Calcula um dígito verificador do CPF.
 *
 * A regra é a mesma para os dois: soma ponderada dos algarismos anteriores com
 * pesos decrescentes, resto da divisão por 11, e resto menor que 2 vira zero.
 */
const digitoVerificador = (base: string, pesoInicial: number): number => {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += Number(base[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  return resto >= 10 ? 0 : resto;
};

/**
 * Diz se um CPF é válido: 11 dígitos, não todos iguais e com os dois dígitos
 * verificadores corretos.
 *
 * A rejeição dos repetidos ("000.000.000-00", "111.111.111-11" …) é obrigatória:
 * todos eles fecham a conta dos dígitos verificadores e passariam.
 */
export const cpfValido = (valor: string | null | undefined): boolean => {
  const d = digitosCpf(valor);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const primeiro = digitoVerificador(d.slice(0, 9), 10);
  if (primeiro !== Number(d[9])) return false;

  const segundo = digitoVerificador(d.slice(0, 10), 11);
  return segundo === Number(d[10]);
};
