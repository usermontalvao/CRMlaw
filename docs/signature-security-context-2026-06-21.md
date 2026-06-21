# Signature Security Context - 2026-06-21

Fonte original do contexto:
- `C:\Users\pedro\.codex\attachments\4ff291be-65d4-4277-ac57-2c6900fef5b3\pasted-text.txt`

## Resumo executivo

- O vazamento em massa via `anon` no banco foi tratado como fechado.
- O ponto residual mais importante ficou no storage de documentos da assinatura.
- A necessidade de acesso publico por token ao documento foi mantida como requisito de produto.
- A estrategia correta passou a ser: manter consulta publica por token, mas mover leitura de arquivos para validacao server-side token-scoped.

## Estado descrito no contexto

### Fechado / considerado seguro

- Tabela `clients` antes exposta por `anon`, agora fechada.
- Demais tabelas criticas do banco antes acessiveis por `anon`, agora fechadas.
- Login mantido via RPC segura.
- Buckets publicos sensiveis previamente identificados como fechados.

### Ainda exposto / pendente

1. Documentos do storage de assinatura ainda legiveis via chave publica se o acesso for amplo por path/bucket.
2. Protecao de senha vazada no Auth desligada no painel.
3. Usuarios autenticados internos ainda veem tudo; isso pode ser aceitavel ou nao, dependendo da regra de negocio.

## Distincao importante registrada

"Consultar meu documento por token" nao e o mesmo que "qualquer anon conseguir listar/baixar documentos de todos".

O requisito de produto valido e:
- o usuario com token deve conseguir consultar o documento dele.

O comportamento inadequado e:
- policy ampla no storage sem relacao real com o token;
- listagem ou leitura de arquivos de terceiros por quem tenha apenas a chave publica.

## Direcao tecnica acordada

### Modelo correto

- O frontend publico nao deve ler diretamente o storage com permissao ampla.
- Uma edge function deve:
  - receber `token` + `path`;
  - validar que o token pertence ao signatario/processo correto;
  - validar que o arquivo pertence a esse contexto;
  - devolver URL assinada curta so daquele arquivo.

### Sequencia segura de rollout

1. Criar a edge function token-scoped.
2. Repontar leituras do fluxo publico para essa edge.
3. Testar o fluxo real de assinatura em producao com token/OTP reais.
4. So depois remover policies `SELECT` anon amplas dos buckets envolvidos.

## Implementacao relatada no contexto

- Edge function `public-signing-file` foi criada e validada com:
  - token valido + arquivo do proprio processo -> `200`
  - token valido + arquivo de outro processo -> `403`
  - token invalido -> `403`
- O fluxo publico passou a usar essa edge nas leituras de documentos.
- Foi registrado um detalhe importante:
  - a chave de service role do projeto usa formato `sb_secret_...`
  - o `createClient(url, key)` padrao nao bastou
  - foi necessario forcar headers globais para o uso efetivo como service role

## Ponto em aberto registrado

- As policies anon de leitura no storage ainda nao deveriam ser removidas sem teste real de ponta a ponta no fluxo publico.
- `client-documents` foi citado como caso separado, fora do fluxo central de assinatura, exigindo tratamento proprio.

## Ultimo contexto operacional

Depois da parte de storage, a conversa mudou para UX do modal publico:
- separar o fluxo de e-mail OTP em duas etapas;
- primeira etapa: informar e-mail;
- segunda etapa isolada: informar codigo;
- "reenviar codigo" discreto, sem botao principal.

O trabalho foi interrompido por limitacao temporaria do ambiente:
- "O servidor esta limitando temporariamente as solicitacoes"

## Observacao

Este arquivo e apenas um registro de contexto operacional e tecnico para continuidade futura.
