/**
 * Termos de Uso / aceite LGPD exibidos no envio da assinatura pública.
 *
 * Versionado: ao publicar um novo texto, incremente SIGNATURE_TERMS_VERSION
 * (ex.: 'v2'). A versão aceita fica registrada por signatário em
 * signature_signers.terms_version e aparece no relatório/certificado.
 */
export const SIGNATURE_TERMS_VERSION = 'v1';

export const SIGNATURE_TERMS_TITLE = 'Termos de Uso da Assinatura Eletrônica';

/** Texto definitivo dos termos (v1). Renderizado com whitespace-pre-wrap. */
export const SIGNATURE_TERMS_TEXT = `Termos de Uso da Assinatura Eletrônica

1. Apresentação
Este sistema de assinatura eletrônica destina-se à formalização digital de documentos, declarações, autorizações, procurações, contratos, requerimentos e demais instrumentos disponibilizados por meio desta plataforma.
Ao prosseguir com o fluxo de assinatura, o usuário declara, para todos os fins, que leu, compreendeu e concorda integralmente com os presentes Termos de Uso, bem como com as informações aplicáveis ao tratamento dos dados necessários à execução do procedimento de assinatura.

2. Finalidade
A assinatura eletrônica tem por finalidade viabilizar a manifestação de vontade do signatário em ambiente digital, bem como registrar evidências técnicas aptas a demonstrar a autenticidade, integridade, rastreabilidade e regularidade do procedimento realizado.
A utilização deste sistema é restrita à assinatura do documento especificamente apresentado no fluxo correspondente, sendo vedado qualquer uso indevido, fraudulento, simulado, enganoso ou incompatível com a finalidade legítima do procedimento.

3. Aceite Eletrônico
O aceite destes Termos ocorre de forma eletrônica, mediante ação expressa do usuário no ambiente de assinatura, antes da conclusão do procedimento.
A ausência de aceite impede a finalização da assinatura.

4. Declarações do Usuário
Ao utilizar este sistema, o usuário declara e garante que:
- possui capacidade, legitimidade e poderes suficientes para assinar o documento apresentado;
- fornecerá informações verdadeiras, corretas, completas e atualizadas;
- não utilizará dados, documentos, imagens, contatos ou identificações de terceiros sem autorização legítima;
- não praticará qualquer ato de fraude, falsidade, simulação de identidade, adulteração de conteúdo, manipulação de imagem ou tentativa de contornar os mecanismos de autenticação e segurança do fluxo;
- reconhece que a assinatura eletrônica realizada neste ambiente representa manifestação válida de vontade, dentro dos limites e finalidades do documento apresentado.

5. Procedimento de Assinatura e Mecanismos de Validação
Para assegurar maior confiabilidade, segurança e robustez probatória, o procedimento de assinatura poderá envolver um ou mais mecanismos de autenticação, confirmação e evidência técnica, conforme a configuração aplicável ao documento, incluindo, entre outros:
- preenchimento ou confirmação de dados de identificação;
- validação por e-mail;
- validação por telefone;
- autenticação por provedor externo;
- captura da assinatura manuscrita em ambiente digital;
- captura de imagem facial;
- coleta de dados técnicos da sessão, do navegador e do dispositivo;
- registro cronológico dos eventos praticados no fluxo.
A combinação dos mecanismos poderá variar conforme a natureza do documento, o nível de segurança exigido e os critérios definidos pelo emissor.

6. Dados e Evidências Técnicas Tratados no Fluxo
Para execução do procedimento de assinatura, poderão ser tratados os dados estritamente necessários à operacionalização, segurança, autenticação, auditoria e validação do ato, tais como:
- nome, e-mail, telefone, CPF e demais dados de identificação informados ou confirmados no fluxo;
- informações relacionadas ao documento, ao atendimento, ao cliente, ao processo, ao requerimento ou à operação vinculada;
- assinatura manuscrita capturada em meio digital;
- imagem facial capturada durante o procedimento;
- data e horário das interações realizadas;
- endereço IP;
- dados do navegador, dispositivo e sessão;
- registros de abertura, visualização, autenticação, recusa, confirmação e assinatura;
- geolocalização, quando habilitada no fluxo e autorizada no dispositivo do usuário;
- identificadores técnicos, códigos de verificação, hashes e demais elementos necessários à preservação da integridade e autenticidade do procedimento.
Tais registros integram a trilha técnica da assinatura e poderão ser utilizados para comprovação do ato praticado, prevenção a fraudes, auditoria interna, segurança da informação e validação posterior do documento.

7. Análise Automatizada da Imagem Facial
Quando o fluxo exigir captura de imagem facial, o usuário fica expressamente ciente de que a selfie poderá ser submetida a análise automatizada por tecnologia de inteligência artificial, com a finalidade exclusiva de reforço técnico do procedimento de assinatura, incluindo verificações relacionadas à presença de rosto, enquadramento, nitidez, consistência visual e adequação mínima da imagem capturada.
Tal análise automatizada compõe a camada de segurança do fluxo de assinatura e não se confunde com eventual autorização opcional para uso da imagem em finalidade cadastral.
Na hipótese de a captura facial constituir requisito obrigatório para determinado documento, a recusa em realizar a captura e a respectiva análise técnica poderá impedir a conclusão da assinatura.

8. Uso Opcional da Foto como Foto Cadastral
A imagem capturada no procedimento de assinatura somente poderá ser utilizada também como foto cadastral do usuário caso haja autorização específica, destacada, livre e opcional, prestada em campo próprio e apartado do aceite destes Termos.
Essa autorização:
- não é obrigatória para a conclusão da assinatura;
- não interfere na validade do documento assinado;
- constitui manifestação autônoma e separada;
- poderá ser revogada posteriormente pelos meios disponibilizados pelo responsável pela plataforma, quando aplicável.
Na ausência dessa autorização específica, a imagem capturada permanecerá restrita às finalidades de autenticação, segurança, auditoria e evidência técnica da assinatura, não devendo ser reutilizada automaticamente como foto de perfil, foto cadastral ou imagem de ficha.

9. Geolocalização
Quando a geolocalização estiver habilitada no fluxo, sua coleta terá finalidade de reforço técnico e probatório do procedimento de assinatura.
A disponibilização dessa informação dependerá das permissões concedidas pelo próprio usuário em seu dispositivo. Em determinados cenários, sua ausência poderá limitar a formação de evidência complementar, sem necessariamente impedir a assinatura, salvo quando houver exigência expressa do fluxo configurado para o documento.

10. Responsabilidade pelas Informações Prestadas
O usuário é integralmente responsável pela veracidade, exatidão e legitimidade das informações fornecidas, bem como pela regularidade da assinatura realizada.
É expressamente vedado:
- utilizar identidade de terceiros;
- prestar informações falsas, incompletas ou enganosas;
- manipular imagens, dispositivos, sessão ou mecanismos de autenticação;
- compartilhar indevidamente links, códigos, tokens ou meios de confirmação de uso pessoal;
- praticar qualquer ato voltado à simulação, fraude ou invalidação do procedimento.
A constatação de uso indevido poderá ensejar bloqueio do fluxo, recusa operacional da assinatura, registro interno de incidente e adoção das medidas administrativas, contratuais e legais cabíveis.

11. Documento Assinado e Relatório Técnico
Concluído o procedimento, o sistema poderá gerar o documento assinado e, quando aplicável, relatório técnico ou trilha de auditoria contendo os elementos necessários à rastreabilidade do ato praticado.
Esse relatório poderá reunir, conforme o caso:
- identificação do signatário;
- registros de data e hora;
- forma de autenticação utilizada;
- eventos relevantes do fluxo;
- dados técnicos da sessão;
- evidências associadas à assinatura;
- identificadores de integridade, verificação e autenticidade.
Tais elementos compõem a base técnica de comprovação do procedimento de assinatura.

12. Verificação de Autenticidade
Os documentos assinados por meio deste sistema poderão contar com mecanismos de validação posterior, incluindo códigos, links, hashes, identificadores de conferência ou meios equivalentes.
Esses recursos têm por finalidade permitir a confirmação da autenticidade, integridade e vinculação do documento ao respectivo procedimento de assinatura.
O usuário compromete-se a não utilizar os mecanismos de verificação para finalidades abusivas, exploratórias, automatizadas ou incompatíveis com sua função legítima.

13. Segurança e Prevenção a Fraudes
A plataforma adota medidas técnicas e organizacionais voltadas à proteção do fluxo de assinatura, preservação das evidências, controle de acesso, monitoramento operacional e prevenção a fraudes.
Sem prejuízo dessas medidas, o usuário reconhece que nenhum ambiente tecnológico é absolutamente invulnerável, comprometendo-se igualmente a agir com diligência e boa-fé, inclusive para:
- proteger seus dispositivos e meios de autenticação;
- não compartilhar acesso com terceiros;
- revisar atentamente o conteúdo do documento antes da assinatura;
- comunicar, com a maior brevidade possível, qualquer suspeita de uso indevido, irregularidade ou comprometimento do fluxo.

14. Compartilhamento Operacional com Terceiros
Para viabilizar a execução do procedimento, determinadas operações poderão envolver fornecedores, prestadores de serviço e parceiros tecnológicos responsáveis por infraestrutura, autenticação, armazenamento, comunicações, processamento técnico, segurança, análise automatizada e suporte operacional.
Sempre que houver esse compartilhamento, ele ocorrerá dentro dos limites necessários à execução, manutenção, segurança, validação e melhoria operacional do serviço.

15. Retenção e Guarda de Registros
As informações, evidências técnicas e registros relacionados ao procedimento de assinatura poderão ser mantidos pelo período necessário à:
- execução e comprovação do ato praticado;
- preservação da integridade e autenticidade do documento;
- prevenção a fraudes e incidentes;
- atendimento de obrigações contratuais, operacionais ou regulatórias;
- exercício regular de direitos em processos administrativos, arbitrais ou judiciais.
Quando aplicável, e observadas as limitações técnicas, operacionais e probatórias do procedimento, os dados poderão ser eliminados, anonimizados ou ter seu tratamento restringido após o encerramento da finalidade pertinente e do período de retenção cabível.

16. Direitos Relacionados aos Dados Pessoais
O usuário poderá exercer os direitos aplicáveis em relação aos seus dados pessoais pelos canais disponibilizados pelo responsável pelo tratamento, observadas as restrições e limitações inerentes à necessidade de preservação de evidências, segurança do fluxo, auditoria, integridade documental e defesa de direitos.
A revogação de autorização específica para uso da imagem como foto cadastral não afeta a validade da assinatura já realizada, nem implica eliminação automática das evidências necessárias à comprovação do procedimento.

17. Indisponibilidade e Limitações Técnicas
A plataforma poderá estar sujeita a indisponibilidades temporárias, interrupções, falhas de comunicação, oscilações, manutenção programada, incompatibilidades técnicas ou eventos alheios ao controle do responsável pelo serviço.
Embora sejam adotados esforços razoáveis para assegurar continuidade e restabelecimento do funcionamento, não se garante operação ininterrupta, contínua ou absolutamente livre de falhas.

18. Condutas Vedadas
É vedado ao usuário:
- utilizar este sistema para fins ilícitos, fraudulentos ou abusivos;
- interferir, tentar interferir ou comprometer o funcionamento da plataforma;
- contornar controles de segurança ou autenticação;
- explorar vulnerabilidades;
- automatizar acessos de modo indevido;
- reproduzir, divulgar, redistribuir ou expor indevidamente documentos, imagens, relatórios, links, códigos ou evidências geradas no fluxo sem autorização legítima.

19. Suspensão, Restrição e Bloqueio
O procedimento de assinatura poderá ser suspenso, restringido, recusado ou bloqueado, a qualquer tempo, sempre que houver:
- indícios de fraude ou inconsistência relevante;
- suspeita de uso indevido;
- descumprimento destes Termos;
- necessidade técnica, operacional, jurídica ou de segurança;
- risco à integridade do procedimento ou à confiabilidade das evidências.
Nessas hipóteses, poderão ser preservados os registros necessários à auditoria, apuração dos fatos, segurança operacional e defesa de direitos.

20. Validade da Assinatura
A assinatura eletrônica realizada neste ambiente representa manifestação eletrônica de vontade do signatário no contexto do documento apresentado, observadas as evidências produzidas no fluxo e os requisitos operacionais adotados para o procedimento.
A validade, eficácia e alcance do documento assinado também dependem de seu conteúdo, da legitimidade das partes envolvidas, da regularidade do ato praticado e do contexto jurídico e fático de sua utilização.

21. Atualizações destes Termos
Estes Termos poderão ser alterados, atualizados ou substituídos a qualquer tempo, a critério do responsável pela plataforma, com ou sem aviso prévio, para refletir evoluções tecnológicas, aprimoramentos de segurança, mudanças operacionais, exigências regulatórias ou aperfeiçoamentos do fluxo de assinatura.
A versão aplicável ao procedimento será aquela apresentada, disponibilizada ou vinculada no momento do aceite e da assinatura.

22. Canais de Contato
Dúvidas, solicitações, comunicações ou requerimentos relacionados ao fluxo de assinatura, ao documento apresentado ou ao tratamento de dados poderão ser encaminhados pelos canais oficiais disponibilizados pelo emissor do documento.

23. Declaração Final de Concordância
Ao selecionar a opção de aceite e prosseguir com o procedimento, o usuário declara, de forma expressa, que:
- leu integralmente estes Termos;
- compreendeu o funcionamento da assinatura eletrônica;
- está ciente da coleta de evidências técnicas necessárias à execução e segurança do procedimento;
- está ciente de que a imagem facial poderá ser analisada automaticamente para validação técnica da assinatura, quando aplicável;
- concorda com a utilização deste sistema para assinatura do documento apresentado;
- compreende que eventual autorização para uso da foto como foto cadastral constitui opção autônoma, facultativa, separada e não condiciona a conclusão da assinatura.`;

/**
 * Consentimento SEPARADO e OPCIONAL para reutilizar a selfie capturada na
 * assinatura também como foto cadastral do cliente. Não é necessário para
 * concluir a assinatura. Versionado para registrar a prova do aceite.
 */
export const SELFIE_PROFILE_CONSENT_VERSION = 'v1';

export const SELFIE_PROFILE_CONSENT_LABEL =
  'Autorizo que a foto capturada neste processo de assinatura também seja utilizada como foto cadastral.';

export const SELFIE_PROFILE_CONSENT_HELP =
  'Opcional. Esta autorização não é necessária para concluir a assinatura.';

/**
 * Transparência (LGPD): a selfie poderá ser analisada automaticamente por
 * modelo de IA apenas para validação técnica do ato de assinar.
 */
export const FACIAL_AI_NOTICE =
  'A selfie poderá ser analisada automaticamente por um modelo de inteligência artificial apenas para validar tecnicamente a assinatura. Isso é independente da autorização opcional de uso como foto cadastral.';

/**
 * Registro versionado dos Termos de Uso da Assinatura.
 *
 * Cada assinatura grava em signature_signers.terms_version a versão aceita no
 * momento, então o relatório/certificado consegue apontar exatamente o texto
 * que a pessoa concordou — mesmo que versões posteriores existam.
 *
 * Para publicar uma nova versão: adicione uma entrada aqui (ex.: 'v2' com o
 * texto e a data) e atualize SIGNATURE_TERMS_VERSION para a nova versão. As
 * versões anteriores permanecem acessíveis na página pública /termos-assinatura.
 */
export interface SignatureTermsVersion {
  version: string;
  title: string;
  /** Data de publicação (ISO, YYYY-MM-DD). */
  publishedAt: string;
  text: string;
}

export const SIGNATURE_TERMS_VERSIONS: Record<string, SignatureTermsVersion> = {
  v1: {
    version: 'v1',
    title: SIGNATURE_TERMS_TITLE,
    publishedAt: '2026-06-20',
    text: SIGNATURE_TERMS_TEXT,
  },
};

/** Versões da mais recente para a mais antiga. */
export const SIGNATURE_TERMS_ALL_VERSIONS: SignatureTermsVersion[] =
  Object.values(SIGNATURE_TERMS_VERSIONS).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

/** Retorna a versão pedida; se inexistente/omitida, cai na versão atual. */
export function getSignatureTerms(version?: string | null): SignatureTermsVersion {
  if (version && SIGNATURE_TERMS_VERSIONS[version]) return SIGNATURE_TERMS_VERSIONS[version];
  return SIGNATURE_TERMS_VERSIONS[SIGNATURE_TERMS_VERSION];
}

export type SignatureTermsBlock = { type: 'h2' | 'p' | 'li'; text: string };

/**
 * Quebra o texto plano dos termos em blocos (título / parágrafo / item) para
 * renderização tipográfica. Usado tanto na página pública versionada quanto no
 * modal de aceite, para que ambos exibam o texto formatado de forma idêntica.
 */
export function parseSignatureTermsText(text: string, title: string): SignatureTermsBlock[] {
  const out: SignatureTermsBlock[] = [];
  let skippedTitle = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // O texto começa repetindo o título — não duplicar no corpo.
    if (!skippedTitle && line === title.trim()) { skippedTitle = true; continue; }
    if (/^\d+\.\s+/.test(line)) { out.push({ type: 'h2', text: line }); continue; }
    if (/^[-•]\s+/.test(line)) { out.push({ type: 'li', text: line.replace(/^[-•]\s+/, '') }); continue; }
    out.push({ type: 'p', text: line });
  }
  return out;
}
