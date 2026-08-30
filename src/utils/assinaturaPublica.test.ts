import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canalDoRegistro,
  classificarCodigo,
  normalizarCodigo,
  fatoresDeAutenticacao,
  hashDoPdfAssinadoConsultado,
  rotuloDoCodigo,
  descreverAparelho,
  documentoSemOSignatario,
  faseDaAbertura,
  faseDaConferencia,
  explicacaoDaEspera,
  formatarCoordenadas,
  mascararCpf,
  nomeDoCanal,
  primeiroNome,
  progresso,
  rotularCanal,
  saudacao,
} from './assinaturaPublica.ts';

const emHora = (h: number) => new Date(2026, 7, 29, h, 30, 0);

test('a saudação vira pelo relógio de quem lê', () => {
  assert.equal(saudacao(emHora(0)), 'Bom dia');
  assert.equal(saudacao(emHora(11)), 'Bom dia');
  assert.equal(saudacao(emHora(12)), 'Boa tarde');
  assert.equal(saudacao(emHora(17)), 'Boa tarde');
  assert.equal(saudacao(emHora(18)), 'Boa noite');
  assert.equal(saudacao(emHora(23)), 'Boa noite');
});

test('preposição não é primeiro nome', () => {
  assert.equal(primeiroNome('Maria Silva Ribeiro'), 'Maria');
  assert.equal(primeiroNome('  Ana   Paula  '), 'Ana');
  assert.equal(primeiroNome('Di Fiori Bianchi'), 'Di Fiori');
  assert.equal(primeiroNome('Jô'), 'Jô');
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(null), '');
});

test('o CPF sai mascarado — a tela pública é fotografada', () => {
  assert.equal(mascararCpf('123.456.789-09'), '•••.456.789-••');
  assert.equal(mascararCpf('12345678909'), '•••.456.789-••');
  // Sem 11 dígitos não há máscara possível: melhor não mostrar nada.
  assert.equal(mascararCpf('1234'), '');
  assert.equal(mascararCpf(null), '');
});

test('o aparelho é reconhecível pela própria pessoa', () => {
  assert.equal(
    descreverAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    'iPhone · Safari',
  );
  assert.equal(
    descreverAparelho('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'),
    'Android · Chrome',
  );
  assert.equal(
    descreverAparelho('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'),
    'Mac · Edge',
  );
  assert.equal(descreverAparelho(''), '');
});

test('no iPhone, o Chrome não pode ser lido como Safari', () => {
  // O UA do Chrome no iOS carrega CriOS E Safari; a ordem do teste é o conserto.
  assert.equal(
    descreverAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1'),
    'iPhone · Chrome',
  );
});

test('as coordenadas saem cruas — não existe consulta reversa neste fluxo', () => {
  assert.equal(formatarCoordenadas({ lat: -15.598912, lng: -56.094878 }), '−15.5989, −56.0949');
  assert.equal(formatarCoordenadas({ lat: 1.5, lng: 2 }), '1.5000, 2.0000');
  assert.equal(formatarCoordenadas(null), '');
  assert.equal(formatarCoordenadas({ lat: Number.NaN, lng: 0 }), '');
});

test('o canal da identidade vira rótulo', () => {
  assert.equal(rotularCanal('whatsapp'), 'Identidade · WhatsApp');
  assert.equal(rotularCanal('email'), 'Identidade · E-mail');
  assert.equal(rotularCanal('google'), 'Identidade · Google');
  assert.equal(rotularCanal(null), 'Identidade confirmada');
});

test('no comprovante a chave já diz "Identidade" — o valor é só o canal', () => {
  assert.equal(nomeDoCanal('whatsapp'), 'WhatsApp');
  assert.equal(nomeDoCanal('email'), 'E-mail');
  assert.equal(nomeDoCanal('google'), 'Google');
  assert.equal(nomeDoCanal(null), 'Confirmada');
});

test('SMS não é WhatsApp — nem no rótulo, nem na leitura do registro', () => {
  assert.equal(nomeDoCanal('sms'), 'SMS');
  assert.equal(rotularCanal('sms'), 'Identidade · SMS');
  assert.equal(canalDoRegistro({ auth_verified_channel: 'sms' }), 'sms');
});

test('quem volta ao link depois lê o canal do registro', () => {
  assert.equal(canalDoRegistro({ auth_verified_channel: 'whatsapp' }), 'whatsapp');
  assert.equal(canalDoRegistro({ auth_verified_channel: 'google' }), 'google');
  // Registro antigo, gravado antes de `auth_verified_channel` existir.
  assert.equal(canalDoRegistro({ auth_provider: 'email_link' }), 'email');
  assert.equal(canalDoRegistro({ auth_provider: 'google' }), 'google');
  // `phone` não diz se foi WhatsApp ou SMS: melhor "Confirmada" do que um chute.
  assert.equal(canalDoRegistro({ auth_provider: 'phone' }), null);
  assert.equal(canalDoRegistro(null), null);
});

test('o título do documento não repete o nome de quem assinou', () => {
  assert.equal(
    documentoSemOSignatario('KIT CONSUMIDOR - JENIFFER APARECIDA ALVES RODRIGUES', 'Jeniffer Aparecida Alves Rodrigues'),
    'KIT CONSUMIDOR',
  );
  // Acento e caixa não podem impedir o corte.
  assert.equal(
    documentoSemOSignatario('Procuração — José Antônio da Silva', 'JOSE ANTONIO DA SILVA'),
    'Procuração',
  );
});

test('o corte é conservador: na dúvida, o título passa inteiro', () => {
  // Nome no MEIO do título não é o padrão que estamos apagando.
  assert.equal(
    documentoSemOSignatario('Contrato de Maria Silva assinado', 'Maria Silva'),
    'Contrato de Maria Silva assinado',
  );
  // Sobraria pouco demais para ainda ser nome de documento.
  assert.equal(documentoSemOSignatario('De Maria Silva', 'Maria Silva'), 'De Maria Silva');
  // Título que É só o nome continua sendo o título.
  assert.equal(documentoSemOSignatario('Maria Silva', 'Maria Silva'), 'Maria Silva');
  // Nome curto demais para servir de sufixo confiável.
  assert.equal(documentoSemOSignatario('Recibo Ana', 'Ana'), 'Recibo Ana');
  assert.equal(documentoSemOSignatario('Procuração', ''), 'Procuração');
  assert.equal(documentoSemOSignatario(null, 'Maria Silva'), '');
});

test('a validação reconhece QUAL código foi consultado', () => {
  const refs = {
    envelope: ['5f2a1c3e-0000-4aaa-bbbb-cccccccccccc', 'CA6B14B457214F73'],
    documentos: ['a3f05e0698287546', '3afff1e8b617ef7a'],
    signatario: '74B4E5EA2DA6E247',
  };
  assert.equal(classificarCodigo('CA6B14B457214F73', refs), 'envelope');
  assert.equal(classificarCodigo('a3f05e0698287546', refs), 'documento');
  assert.equal(classificarCodigo('74B4E5EA2DA6E247', refs), 'signatario');
  assert.equal(classificarCodigo('ZZZZ0000', refs), 'desconhecido');
  assert.equal(classificarCodigo('', refs), 'desconhecido');
});

test('o código do rodapé vem com hífen e a URL não — os dois têm de casar', () => {
  const refs = { documentos: ['a3f05e0698287546'] };
  assert.equal(classificarCodigo('A3F0-5E06-9828-7546', refs), 'documento');
  assert.equal(normalizarCodigo('a3f0-5e06 9828.7546'), 'A3F05E0698287546');
});

test('o recibo usa os dois identificadores públicos canônicos', () => {
  assert.equal(rotuloDoCodigo('envelope'), 'Protocolo do envelope');
  assert.equal(rotuloDoCodigo('documento'), 'Código de verificação do documento');
  assert.equal(rotuloDoCodigo('signatario'), 'Código de verificação');
  assert.equal(rotuloDoCodigo('desconhecido'), 'Código de verificação');
});

test('a consulta pelo código do documento mostra o SHA-256 daquele PDF assinado', () => {
  const documentos = [
    { verification_code: 'A8162AF5EEAB20D8', signed_pdf_sha256: 'HASH-ASSINADO-PRINCIPAL' },
    { verification_code: '05FBDC3C94D10F99', signed_pdf_sha256: 'HASH-ASSINADO-ANEXO' },
  ];
  assert.equal(
    hashDoPdfAssinadoConsultado('a816-2af5-eeab-20d8', documentos, 'HASH-LEGADO'),
    'HASH-ASSINADO-PRINCIPAL',
  );
  assert.equal(
    hashDoPdfAssinadoConsultado('05fbdc3c94d10f99', documentos, 'HASH-LEGADO'),
    'HASH-ASSINADO-ANEXO',
  );
  assert.equal(hashDoPdfAssinadoConsultado('', documentos, 'HASH-LEGADO'), 'HASH-LEGADO');
});

test('a autenticação lista o que foi USADO, não o que estava configurado', () => {
  // Caso real do acervo: auth_method dizia "signature_only", mas houve selfie
  // e confirmação por e-mail. Mostrar só o método escondia duas provas.
  assert.equal(
    fatoresDeAutenticacao({ assinatura: true, selfie: true, canal: 'email' }),
    'Assinatura, selfie e código por E-mail',
  );
  assert.equal(fatoresDeAutenticacao({ assinatura: true }), 'Assinatura');
  assert.equal(
    fatoresDeAutenticacao({ assinatura: true, selfie: true, documento: true, canal: 'whatsapp' }),
    'Assinatura, selfie, documento de identidade e código por WhatsApp',
  );
  assert.equal(fatoresDeAutenticacao({ canal: 'google' }), 'Conta Google');
});

test('sem nada registrado, a linha da autenticação some', () => {
  assert.equal(fatoresDeAutenticacao({}), '');
  assert.equal(fatoresDeAutenticacao({ assinatura: false, selfie: false, canal: null }), '');
});

test('nenhuma das duas esperas promete conclusão', () => {
  // Quem decide que terminou é a resposta do servidor, não o relógio.
  for (const s of [0, 3, 6, 9, 13, 30, 120]) {
    assert.ok(!/pronto|conclu(í|i)d/i.test(faseDaConferencia(s)), `conferência aos ${s}s`);
    assert.ok(!/pronto|conclu(í|i)d/i.test(faseDaAbertura(s)), `abertura aos ${s}s`);
  }
});

test('a espera longa nunca diz que está TENTANDO de novo', () => {
  // "Continuamos tentando" sugere que algo falhou e está sendo repetido. Não
  // está: há uma única execução em curso. Assustar quem está no meio de um ato
  // que não pode ser interrompido é o pior momento possível para essa palavra.
  for (const s of [20, 35, 60, 120]) {
    assert.equal(/tentando|tentativa/i.test(faseDaConferencia(s)), false,
      `"${faseDaConferencia(s)}" sugere repetição`);
    assert.equal(/tentando|tentativa/i.test(faseDaAbertura(s)), false,
      `"${faseDaAbertura(s)}" sugere repetição`);
  }
});

test('a espera do ENVIO não culpa a conexão — o trabalho é no aparelho', () => {
  // O PDF assinado é montado no dispositivo de quem assina. Dizer "a conexão
  // está lenta" mandava a pessoa conferir o wi-fi atrás de um problema que não
  // existe. Já a ABERTURA baixa o documento: ali a rede é suspeita legítima.
  for (const s of [20, 40, 90]) {
    assert.equal(/conex[ãa]o/i.test(faseDaConferencia(s)), false,
      `"${faseDaConferencia(s)}" culpa a conexão por trabalho local`);
  }
  assert.match(explicacaoDaEspera(40), /aparelho|anexos/i);
});

test('a explicação da espera só entra quando a espera fica longa', () => {
  // Explicar já na largada sugere que algo vai dar errado.
  assert.equal(explicacaoDaEspera(3), '');
  assert.equal(explicacaoDaEspera(12), '');
  assert.ok(explicacaoDaEspera(25).length > 0);
  assert.ok(explicacaoDaEspera(90).length > 0);
});

test('o título da espera cabe na caixa estreita da tela', () => {
  // A caixa tem 240px em corpo 15.5 bold: acima de ~34 caracteres passa de
  // duas linhas e empurra o layout. O texto que tranquiliza mora na segunda
  // linha, não no título.
  for (const s of [0, 3, 8, 15, 25, 60, 200]) {
    assert.ok(faseDaConferencia(s).length <= 34,
      `"${faseDaConferencia(s)}" tem ${faseDaConferencia(s).length} caracteres`);
  }
});

test('nenhuma etapa da espera promete que terminou', () => {
  for (const s of [0, 3, 8, 15, 25, 40, 120]) {
    assert.equal(/pronto|conclu[ií]d|finalizado com|sucesso/i.test(faseDaConferencia(s)), false);
  }
});

test('o progresso sobe, desacelera e nunca fecha a conta', () => {
  assert.equal(progresso(0), 0);
  assert.equal(progresso(-1), 0);
  assert.ok(progresso(1) > 0 && progresso(1) < progresso(3));
  assert.ok(progresso(3) < progresso(8));
  assert.ok(progresso(600) <= 99, 'nunca chega a 100 — quem fecha é o servidor');
});
