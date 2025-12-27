# Changelog

## 1.3.31
- Documentação: redesign da superpágina para o padrão visual do sistema (layout limpo/profissional, sem gradientes chamativos e sem aparência de template), mantendo sidebar, busca e seções.

## 1.3.30
- Documentação: nova superpágina de documentação premium com design moderno, sidebar de navegação, seções organizadas (Início, Guia do Sistema, Changelog, FAQ), busca integrada e layout responsivo.

## 1.3.29
- Autenticidade/Verificação: exibição do contato do signatário agora prioriza o e-mail/telefone realmente usado na autenticação (Google/telefone), evitando mostrar e-mail interno `public+...@crm.local`.

## 1.3.28
- Assinatura (selfie): anti-falso-negativo — se a IA reclamar apenas de “clareza/borrão/iluminação” mas não indicar ausência de rosto/obstrução/borrão severo, a foto é aceita.

## 1.3.27
- Assinatura (selfie): critérios da IA ajustados para não reprovar por iluminação; reprova apenas por ausência de rosto, obstrução no rosto ou foto muito borrada.

## 1.3.26
- Assinatura Pública: validação de selfie com IA agora bloqueia envio quando a foto estiver sem rosto visível/nítido e exibe o motivo.
- Edge Function: `analyze-facial-photo` agora aceita validação via `token` público (sem login) com checagem no backend.

## 1.3.25
- Assinatura Eletrônica: validação de foto facial com IA (OpenAI Vision) - verifica nitidez, iluminação e visibilidade do rosto.
- Se a foto não passar na validação, exibe mensagem e pede para tirar nova foto.
- Opção "Usar mesmo assim" para casos excepcionais.

## 1.3.24
- Notificações: suporte a notificação do navegador ao receber notificações via Realtime (quando o usuário conceder permissão).
- Notificações: clique na notificação de assinatura abre diretamente o módulo Assinaturas no modal de detalhes.

## 1.3.23
- Notificações: popups na tela agora ficam fixos até o usuário fechar (sem expirar automaticamente).
- Notificações: redesign das notificações de assinatura (badge + progresso + cores) no popup e no dropdown.

## 1.3.22
- Notificações: `analyze-intimations` agora cria notificação para todas as novas intimações analisadas (não apenas urgentes).
- Notificações: título da intimação agora reflete a urgência (📄/📋/⚠️/🚨).
- Notificações: `NotificationBell` com Realtime mais robusto em ambiente dev (evita duplicidade no React StrictMode).

## 1.3.21
- Notificações: integração de Requerimentos (alertas de MS/tempo em análise) via `notification-scheduler`.
- Notificações: `user_notifications` agora suporta `requirement_id` e tipo `requirement_alert`.
- Notificações: clique no sino/popup abre diretamente Requerimentos quando o alerta for de requerimento.
- Notificações: scheduler agora respeita `notify_days_before` (prazos) e `notify_minutes_before` (agenda) e usa deduplicação por `dedupe_key`.
- Notificações: correção de seleção de usuários ativos via `profiles.is_active`/`profiles.user_id`.

## 1.3.20
- Notificações: popup na tela agora permanece por 60 minutos (com botão de fechar).
- Notificações: múltiplos popups empilhados (um em cima do outro) no canto da tela.

## 1.3.19
- Notificações: popup na tela estilo Facebook/Instagram quando chega notificação via Realtime.
- Notificações: intimações agora exibem partes (nomes/polo) e resumo/assunto para maior precisão.
- Notificações: assinaturas digitais disparam popup realtime quando alguém assina documento.
- Notificações: barra de progresso visual no popup (6 segundos para fechar automaticamente).

## 1.3.18
- Clientes: seção "Documentos/Contratos assinados" nos detalhes do cliente (lista documentos assinados via módulo de Assinatura Digital, com acesso ao PDF assinado).

## 1.3.17
- Notificações: geração quase realtime de notificações de intimações (run-djen-sync chama analyze-intimations ao salvar novas intimações).
- Notificações: dropdown do sino exibe apenas não lidas (ao marcar como lida, some da lista).

## 1.3.16
- Notificações: Edge Function `analyze-intimations` para análise automática de intimações via cron.
- Notificações: cron job executa a cada 30 minutos para analisar novas intimações.
- Notificações: intimações urgentes (alta/crítica) geram notificação automática.
- Notificações: usa Groq AI como provider principal, OpenAI como fallback.

## 1.3.15
- Notificações: ao marcar intimação como lida, notificação correspondente é marcada como lida automaticamente.
- Notificações: dropdown mostra apenas notificações não lidas (lidas somem da lista).

## 1.3.14
- Notificações: sistema de lembretes automáticos via Edge Function (cron).
- Notificações: lembrete de prazo 1-3 dias antes do vencimento.
- Notificações: lembrete de compromisso 1 dia antes.
- Notificações: alerta de intimação urgente (análise IA).
- Notificações: alerta de assinatura pendente há mais de 1 dia.
- Notificações: trigger automático quando cliente assina documento.
- Notificações: cron jobs executam a cada hora e às 8h da manhã.
- Notificações: deduplicação para evitar notificações repetidas em 24h.

## 1.3.13
- Notificações: integração completa em todo o sistema.
- Notificações: prazos criados geram notificação (urgente se ≤3 dias ou prioridade alta).
- Notificações: compromissos criados geram notificação com data/hora.
- Notificações: assinaturas digitais geram notificação quando cliente assina.
- Notificações: processos criados geram notificação com número e cliente.
- Notificações: ícone de caneta (PenTool) para assinaturas digitais.

## 1.3.12
- Notificações: cria notificação para TODAS as intimações (não apenas urgentes).
- Notificações: badges de tribunal e urgência (ALTA, CRÍTICA) nas notificações.
- Notificações: ícone diferenciado para intimações urgentes (triângulo vermelho).
- Notificações: cor de fundo do ícone baseada na urgência.
- Notificações: mensagem com resumo da análise de IA.

## 1.3.11
- Notificações: suporte a Realtime (notificações instantâneas via WebSocket).
- Notificações: som toca automaticamente ao receber nova notificação.
- Notificações: habilitado Realtime na tabela user_notifications.

## 1.3.10
- Notificações: corrigido RLS policy para permitir INSERT/UPDATE/DELETE na tabela user_notifications.

## 1.3.9
- Notificações: novo sistema estilo Facebook/Instagram com dropdown moderno.
- Notificações: som de alerta usando Web Audio API (pode ser ativado/desativado).
- Notificações: badge com contador animado (pulse) no ícone do sino.
- Notificações: tempo relativo (agora, 5m, 2h, 3d).
- Notificações: ações rápidas (marcar como lida, deletar) ao passar o mouse.
- Notificações: botão para marcar todas como lidas.
- Notificações: polling automático a cada 30 segundos.

## 1.3.8
- Notificações: corrigido erro 400 ao criar notificações de intimação urgente (mapeia `intimation_urgent` para `intimation_new` e registra `urgent: true` no metadata).

## 1.3.7
- Intimações DJEN: layout unificado em barra única (header + filtros + ações).
- Intimações DJEN: indicadores inline (total, não lidas, urgência).
- Intimações DJEN: botões de ação apenas com ícones (Filtros, Histórico, Exportar, Config).
- Intimações DJEN: exibição dos nomes das partes (destinatários ou extraídos do texto).
- Intimações DJEN: fallback de extração de partes do texto quando não há destinatários cadastrados.
- Intimações DJEN: vinculação automática quando nome da parte = nome do cliente cadastrado (match 100%).
- Intimações DJEN: prioridade de visualização para as intimações.

## 1.3.6
- Intimações DJEN: análise automática de IA agora é disparada quando novas intimações chegam via realtime.

## 1.3.5
- Intimações DJEN: toast de realtime agora mostra a quantidade de novas intimações recebidas (inserts agrupados em lote).

## 1.3.4
- Edge Function run-djen-sync: removido limite de 10 processos - agora busca TODOS os processos cadastrados.

## 1.3.3
- Database: habilitado Realtime (postgres_changes) para tabela `djen_comunicacoes` - agora a lista atualiza automaticamente ao chegar nova intimação.

## 1.3.2
- Intimações DJEN: busca agora considera também o número do processo cadastrado (process_code) e agrupamento prioriza process_code quando houver vínculo.

## 1.3.1
- Intimações DJEN: atualização automática da lista e notificação quando chegar nova intimação (realtime).

## 1.3.0
- Intimações DJEN: período de busca alterado para 7 dias (Edge Function + sync manual).
- Edge Function run-djen-sync: extrai número do processo do texto quando não vem da API.
- Edge Function run-djen-sync: vinculação automática com processos cadastrados melhorada.
- Deletadas intimações antigas do banco (desde 11/12).

## 1.2.9
- Database: coluna `numero_processo` em `djen_comunicacoes` agora é nullable (API do DJEN nem sempre retorna esse campo).

## 1.2.8
- Edge Function run-djen-sync: corrigido insert em `djen_comunicacoes` preenchendo campos obrigatórios (`djen_id` e `hash`) e melhorados logs de erro para diagnosticar falhas (evita "saved=0" silencioso).

## 1.2.7
- Intimações DJEN: corrigido "Última atualização" para exibir a sincronização mais recente (não a primeira).
- Edge Function run-djen-sync: corrigido nome da tabela `djen_comunicacoes_local` → `djen_comunicacoes`.
- Corrigido nome da tabela em `processTimeline.service.ts`.

## 1.2.6
- Intimações DJEN: melhorias visuais no header e ações (layout mais premium).
- Intimações DJEN: período de busca do DJEN ampliado para 15 dias (cron/Edge Function e sincronização manual).

## 1.2.5
- Intimações DJEN: "Última atualização" agora é baseada exclusivamente no histórico do cron (`djen_sync_history`).
- DJEN cron: Edge Function `run-djen-sync` registra execução bloqueada (token inválido) no `djen_sync_history`.

## 1.2.4
- Intimações DJEN: sincronização manual agora registra na tabela `djen_sync_history` do Supabase.
- Intimações DJEN: adicionados métodos `logSync` e `updateSync` no service de status.

## 1.2.3
- Intimações DJEN: criada migration para tabela `djen_sync_history` com políticas RLS corretas.
- Intimações DJEN: corrigido service para não lançar exceção quando tabela não existe.

## 1.2.2
- Modelos de Documentos: scroll automático ao selecionar categoria, modelo e cliente na aba Gerar.

## 1.2.1
- Modelos de Documentos: repaginação do layout geral do módulo mantendo abas (Gerar/Gerenciar), com header premium e contadores.
- Modelos de Documentos: aba Gerenciar com filtros e ação "Novo Modelo" em layout mais limpo.

## 1.2.0
- Petições Padrões: novo layout da aba "Gerar Documento" com fluxo em 3 passos (Categoria → Modelo → Cliente).
- Petições Padrões: seleção visual de categorias com contagem de modelos disponíveis.
- Petições Padrões: indicador de progresso (steps) no topo do formulário.
- Petições Padrões: animações suaves ao revelar cada etapa.
- Petições Padrões: header com gradiente e design mais moderno.
- Petições Padrões: campos personalizados agora aparecem em grid 2 colunas.

## 1.1.99
- Petições Padrões: normalização automática de pontuação para evitar vírgulas duplicadas quando campos opcionais (ex: complemento) estão vazios.

## 1.1.98
- Petições Padrões: cidade agora é formatada em Title Case (ex: "Várzea Grande") e UF em maiúsculo (ex: "MT") na geração de documentos.

## 1.1.97
- Petições Padrões: invertida ordem das abas - "Gerar Documento" agora é a primeira aba (padrão).

## 1.1.96
- Petições Padrões: adicionada função de substituir template DOCX no modal de edição.
- Petições Padrões: UI melhorada para mostrar arquivo atual e botão "Substituir" quando já existe um template.
- Petições Padrões: aviso visual quando o arquivo será substituído.

## 1.1.95
- Petições Padrões: corrigido conflito entre [[ESTADO]] (UF) e [[ESTADO CIVIL]] - agora cidade e UF mantêm capitalização original.
- Petições Padrões: adicionado placeholder [[UF]] como alternativa para estado.

## 1.1.94
- Petições Padrões: CPF agora é formatado com máscara (000.000.000-00).
- Petições Padrões: CEP agora é formatado com máscara (00000-000).
- Petições Padrões: nacionalidade, estado civil e profissão agora são exibidos em minúsculo.

## 1.1.93
- Petições Padrões: placeholders do cliente agora funcionam igual ao módulo Documentos (com variações: maiúsculo, minúsculo, com/sem acento, com espaço ou underscore).
- Petições Padrões: adicionado placeholder [[ENDERECO_COMPLETO]] com endereço formatado.
- Petições Padrões: corrigido problema de campos do cliente vindo "undefined".

## 1.1.92
- Petições Padrões: arquivos DOCX agora são processados automaticamente com substituição de placeholders (não pede mais para editar manualmente).
- Petições Padrões: usa docxtemplater para gerar documento DOCX com todos os campos preenchidos.

## 1.1.91
- Petições Padrões: campo tipo "date" agora abre calendário nativo do navegador.
- Petições Padrões: campos personalizados agora são renderizados conforme seu tipo (date, textarea, select, number, currency).
- Petições Padrões: geração de documento agora aplica corretamente os valores dos campos personalizados.
- Petições Padrões: datas são formatadas para DD/MM/YYYY e moedas para R$ X.XXX,XX no documento gerado.

## 1.1.90
- Petições Padrões: adicionada opção de editar campo personalizado no modal de campos.

## 1.1.89
- Petições Padrões: modais (Nova/Editar, Campos, Visualizar) agora respeitam o tema e não ficam pretos no modo claro.

## 1.1.88
- Documentos: templates marcados como petições/requerimentos não aparecem mais na aba "Gerenciar templates" (ficam apenas na aba "Petições Padrões").

## 1.1.87
- **Submódulo Petições Padrões**: Nova aba no módulo de Documentos para gerenciar petições e requerimentos padrões.
  - CRUD completo de petições com categorias (Requerimento Administrativo, Petição Inicial, Recurso, Contestação, Outros)
  - Upload de arquivos DOCX ou criação de templates em texto com placeholders
  - Campos personalizados por petição (texto, número, data, seleção, moeda, CPF, telefone, CEP)
  - Geração de documentos com substituição automática de dados do cliente
  - Histórico de documentos gerados
- Arquivos criados:
  - `src/components/StandardPetitionsModule.tsx` - Componente de UI completo
  - `src/services/standardPetition.service.ts` - Service com CRUD
  - `src/types/standardPetition.types.ts` - Tipos TypeScript
  - `supabase/migrations/20251227_standard_petitions.sql` - Migration do banco

## 1.1.86
- Processos: exibida a última atualização do cron DJEN no header (data/hora, status, encontrados/salvos).

## 1.1.85
- Módulo Intimações: banner "Atualizando dados em segundo plano..." agora só aparece após o primeiro carregamento completo (não aparece ao entrar no módulo).

## 1.1.84
- Módulo Intimações: não exibe mais o banner "Atualizando dados em segundo plano..." no carregamento inicial.

## 1.1.83
- **Módulo Intimações**: Removida análise automática de IA ao abrir o módulo (agora só via cron)
- **UI Melhorada**: Header redesenhado com card de "Última atualização" mostrando:
  - Data e hora da última execução do cron
  - Status (Sucesso/Erro/Executando) com badge colorido
  - Quantidade de intimações encontradas e salvas
- Removida mensagem "Atualizando em segundo plano" desnecessária

## 1.1.82
- **Cron 2x/dia**: Alterado de 1x para 2x por dia (7h e 19h)
- **Módulo Intimações**: Removida sincronização automática ao abrir o módulo (agora só via cron ou botão manual)
- **Edge Function**: Logs detalhados da execução do cron com ID único de execução, etapas numeradas e duração total
- Header atualizado: "Sincronização automática: 2x/dia (7h e 19h) via cron Supabase"

## 1.1.81
- **Cron DJEN Completo**: Edge Function `run-djen-sync` agora atualiza **status do processo automaticamente** quando salva nova intimação vinculada.
  - Detecta status baseado no texto: citação, conciliação, contestação, instrução, sentença, recurso, cumprimento, arquivado
  - Atualiza flags `djen_synced`, `djen_last_sync`, `djen_has_data` no processo
- **Linha do Tempo do Processo**: agora busca do **banco local** (`djen_comunicacoes_local`) com análise IA já pronta pelo cron.
  - Abre instantaneamente sem precisar chamar OpenAI/Groq novamente
  - Fallback para DJEN direto se não houver dados no banco
  - Novo método `fetchTimelineFromDatabase` no `processTimeline.service.ts`
- Fluxo completo: Cron diário → Sincroniza DJEN → Salva intimações → Analisa IA → Atualiza processo → Timeline pronta

## 1.1.80
- Edge Function `run-djen-sync`: agora executa **análise automática de IA** após sincronizar intimações do DJEN.
  - Busca até 50 intimações sem análise
  - Chama OpenAI (gpt-4o-mini) para extrair: resumo, urgência, prazo, pontos-chave
  - Salva análise no campo `ai_analysis` da tabela `djen_comunicacoes_local`
  - Delay de 1.5s entre análises para respeitar rate limit
  - Requer `OPENAI_API_KEY` configurada nos secrets do Supabase
- Cron diário unificado: sincronização DJEN + análise IA em uma única chamada

## 1.1.79
- Linha do Tempo (Processos): modal mais organizado e com visual mais premium:
  - Header com ação de atualizar e melhor alinhamento/spacing
  - Layout em 2 colunas com sidebar mais limpa e componentes com bordas arredondadas
  - Cards de eventos com hierarquia visual melhor e expansão mais legível
- Linha do Tempo (Processos): correção de segurança no filtro/busca quando `description` vem vazio.

## 1.1.78
- Linha do Tempo (Processos): redesign ultra-minimalista:
  - Sem cards, bordas ou sombras - apenas texto e espaço
  - Timeline dot mínimo (2px)
  - Data e tipo em linha única discreta
  - Título como elemento principal
  - Ações aparecem apenas quando expandido
  - Conteúdo expandido limpo e compacto

## 1.1.77
- Linha do Tempo (Processos): redesign completo dos cards com UI/UX mais limpo e humano:
  - Tipografia mais leve e hierarquia visual clara
  - Badges removidos, substituídos por texto sutil
  - Indicadores de urgência discretos (apenas quando necessário)
  - Botões de ação como links minimalistas
  - Cards com bordas arredondadas e sombras suaves
  - Espaçamento respirado e cores neutras

## 1.1.76
- Linha do Tempo (Processos): reduzida poluição visual nos cards (badges mais discretos/compactos e ações em botões outline menores).

## 1.1.75
- Processos: status do processo agora é persistido **obrigatoriamente** conforme o subestágio do mapa exibido na Linha do Tempo (ex.: Conciliação/Contestação/Recurso), garantindo consistência entre modal e lista.
- Build: correções de TypeScript para compatibilidade de tipos em Perfil/Requerimentos.

## 1.1.74
- Processos: ajustada ordem de prioridade na detecção automática de status. Agora "Conciliação" tem prioridade sobre "Contestação" e a detecção de Contestação exige termos mais específicos (evitando falsos positivos como "solicitou retificação").

## 1.1.73
- Processos: adicionados **sub-estágios** ao status do processo: Citação, Conciliação, Contestação, Instrução e Recurso.
- IA agora detecta e atualiza automaticamente para o sub-estágio correto baseado nos eventos da timeline.
- Novos badges coloridos para cada sub-estágio na lista de processos.
- Migration SQL incluída para atualizar constraint do banco de dados.

## 1.1.72
- Processos: melhorada detecção de status pela IA. Agora prioriza os **eventos mais recentes** (últimos 5) e exige termos mais específicos para "Arquivado" (ex.: "arquivamento definitivo", "autos arquivados"). Eventos como Decisão, Intimação e Citação agora corretamente detectam status "Em Andamento".

## 1.1.71
- Processos: corrigida lógica de atualização automática de status pela IA. Agora a análise pode **corrigir** status incorretos (ex.: "Arquivado" → "Em Andamento"), não apenas avançar na hierarquia.

## 1.1.70
- Processos: corrigido status exibido no front após análise/sincronização (DJEN/IA). Agora a atualização de status passa por `processService.updateStatus`, garantindo invalidação de cache e recarregamento correto.

## 1.1.69
- Financeiro: separadores brilhantes agora aparecem entre parcelas no modo escuro quando existe mais de uma parcela.
- Linha discreta `via-white/15` com fade nas extremidades adiciona leitura entre cards.

## 1.1.68
- Financeiro: cartão de parcelas em atraso no dark mode agora usa gradiente vinho (#3f0b1d → #09090b) alinhado ao tema.
- Badges/pílulas receberam `dark:bg-[#4c0e1f]` e texto claro para leitura segura.
- Indicador numérico usa `dark:bg-[#fb7185]` para manter o status visual.

## 1.1.67
- Financeiro: melhorado contraste do card vermelho (parcelas em atraso) no modo escuro.
- Fundo alterado de `dark:from-rose-500/15` para `dark:from-rose-500/30` com fundo zinc-800.
- Bordas e badges ajustados para melhor legibilidade em dark mode.

## 1.1.66
- Perfil: métricas da aba "Métricas" com contraste alto (cards brancos, texto escuro).
- Corrigidas cores dos ícones e labels para garantir visibilidade das estatísticas.
- Melhorias de acessibilidade e legibilidade no dashboard do perfil.

## 1.1.64
- Requerimentos/MS: textos oficiais atualizados para BPC LOAS.
- MS agora imprime:
  - "Benefício de Prestação Continuada (BPC/LOAS) à Pessoa com Deficiência"
  - "Benefício de Prestação Continuada (BPC/LOAS) – Idoso"
- Adequado para padrão do Ministério da Saúde.

## 1.1.63
- Requerimentos: ajustado label do tipo legado.
- 'bpc_loas' agora exibe "BPC LOAS - Deficiente".
- Nomenclatura mais clara para registros antigos.

## 1.1.62
- Requerimentos: corrigido erro de constraint do banco.
- Mantido tipo legado 'bpc_loas' para compatibilidade.
- Atualizada constraint do banco para incluir novos tipos.
- MS continua imprimindo textos oficiais corretos.

## 1.1.61
- Requerimentos/MS: saída do campo "Tipo/benefício" ajustada para exibir descrições oficiais do BPC LOAS.
- MS agora imprime:
  - "BENEFÍCIO ASSISTENCIAL AO PORTADOR DE DEFICIÊNCIA"
  - "Benefício de Prestação Continuada-BPC LOAS IDOSO"
- Corrigido erro de constraint do banco removendo tipo legado.

## 1.1.60
- Requerimentos: template MS atualizado para novos tipos BPC LOAS.
- Placeholder [[BENEFICIO]] agora exibe labels corretos:
  - "BPC LOAS - Deficiência"
  - "BPC LOAS - Idoso"
- Adequado para saída no Ministério da Saúde.

## 1.1.61
- Requerimentos/MS: saída do campo "Tipo/benefício" ajustada para exibir descrições oficiais do BPC LOAS.
- Compatibilidade com registros antigos: tipo legado "bpc_loas" agora sai como "BENEFÍCIO ASSISTENCIAL AO PORTADOR DE DEFICIÊNCIA".

## 1.1.59
- Requerimentos: adequação para BPC LOAS do MS.
- Separado BPC LOAS em duas categorias:
  - BPC LOAS - Deficiência
  - BPC LOAS - Idoso
- Atualizados tipos e labels para adequação legal.
- Benefícios agora classificados corretamente para MS.

## 1.1.58
- Requerimentos: animações premium nos ícones de status.
- Animações pulse e bounce com drop-shadow para destaque.
- Aplicado tanto nas abas superiores quanto na tabela.
- Corrigidos erros TypeScript em ícones Lucide.

## 1.1.57
- Requerimentos: removido loader fixo do status "Em Análise".
- Loader aparece apenas durante atualização de status.
- Status "Em Análise" agora exibe apenas ícone Activity estático.

## 1.1.56
- Requerimentos: animações adicionadas nos ícones de status.
- Em Exigência: animate-pulse (âmbar)
- Aguardando Perícia: animate-bounce (ciano)
- Aguardando Confecção: animate-pulse (índigo)
- Deferidos: animate-pulse (verde)
- Em Análise: sem animação (apenas loader)

## 1.1.55
- Requerimentos: ícones restaurados na tabela de status.
- Ícones temáticos agora visíveis ao lado do select.
- Mantida identificação visual clara dos status.

## 1.1.54
- Requerimentos: removido ícone duplicado na tabela de status.
- Mantido apenas ícone nas abas superiores para evitar poluição visual.
- Layout mais limpo e profissional.

## 1.1.53
- Requerimentos: ícones adicionados ao dropdown de status na tabela.
- Ícones temáticos agora visíveis ao lado de cada status.
- Melhor identificação visual dos requerimentos.

## 1.1.52
- Requerimentos: redesign profissional das animações de status.
- Removidas animações complexas e gradientes excessivos.
- Visual limpo com cores sólidas e ícones simples.
- Corrigidos bugs de renderização e TypeScript.
- Abas de status com hover suave e escala sutil.
- Dropdowns simplificados sem animações que causavam bugs.

## 1.1.51
- Requerimentos: novas animações e ícones temáticos para status.
- Em Análise: ícone Activity com animação pulse (1.6s).
- Aguardando Perícia: ícone Microscope com animação bounce (2.4s).
- Gradientes modernos em badges (amber→orange, cyan→blue, etc.).
- Animações mais suaves com shadow-lg e ring effects.
- Ícones médicos e gráficos para melhor identificação visual.

## 1.1.50
- Requerimentos: visão geral reorganizada com cartões e listas estruturadas.
- Layout limpo usando rounded-2xl, shadow-sm e divide-y para separar informações.
- Corrigido erro de sintaxe (className sem =) e import Search adicionado.
- Visual mais profissional e menos poluído na aba de visão geral.

## 1.1.49
- Requerimentos: removida linha vertical que dividia as colunas do modal.
- Layout agora sem separador visual entre colunas esquerda e direita.
- Visual mais limpo e unificado entre informações do cliente e do requerimento.
- Espaçamento natural do grid já separa o conteúdo adequadamente.

## 1.1.48
- Requerimentos: removidas informações duplicadas do header do modal.
- Header agora exibe apenas nome do beneficiário e protocolo.
- CPF e benefício removidos do topo para evitar duplicação.
- Informações completas ficam apenas na visão geral.

## 1.1.47
- Requerimentos: removidas listas da visão geral, agora usa apenas separadores.
- Layout limpo com linhas horizontais (h-px) entre informações.
- Separadores contextuais: âmbar para exigência, ciano para perícias.
- Visual mais limpo e organizado sem bordas em cada item.

## 1.1.46
- Requerimentos: colunas da visão geral invertidas.
- Coluna esquerda: informações do cliente e processos vinculados.
- Coluna direita: informações do requerimento (data, telefone, senha, protocolo, benefício).
- Layout mais intuitivo com informações do cliente em primeiro lugar.

## 1.1.45
- Requerimentos: adicionado separador visual entre colunas da visão geral.
- Linha vertical sutil (w-px) entre as duas colunas em desktop.
- Separador oculto em mobile (hidden lg:block) para manter layout responsivo.
- Melhora visual na distinção entre informações do requerimento e do cliente.

## 1.1.44
- Requerimentos: visão geral organizada em duas colunas lado a lado.
- Coluna esquerda: informações do requerimento (data, telefone, senha, protocolo, benefício).
- Coluna direita: informações do cliente (nome, CPF, telefone, benefício) e processos vinculados.
- Layout responsivo com grid-cols-1 lg:grid-cols-2 para melhor aproveitamento de espaço.

## 1.1.43
- Requerimentos: visão geral organizada em layout linear (sem blocos).
- Informações exibidas em formato de lista com bordas separadoras.
- Processos vinculados em cards simplificados e alinhados verticalmente.
- Layout mais limpo e fácil de escanear visualmente.

## 1.1.42
- Requerimentos: modal de detalhes padronizado para seguir layout do sistema.
- Header agora usa faixa laranja e estrutura consistente com outros modais.
- Botão fechar movido para direita com estilo padrão do sistema.
- Subtítulo "Detalhes do Requerimento" e informações reorganizadas.

## 1.1.41
- Requerimentos: layout da aba Notas invertido (conteúdo acima, input abaixo).
- Melhoria na UX para seguir padrão de apps de mensagens (conteúdo primeiro, campo de digitação embaixo).

## 1.1.40
- Requerimentos: notas agora exibidas em ordem inversa (mais recentes primeiro).
- Melhoria na experiência de leitura ao ver as notas mais recentes no topo.

## 1.1.39
- Requerimentos: Observações movidas para uma aba dedicada ao lado de Notas no modal.
- Nova aba destaca o texto interno com ícone NotebookPen e blocos organizados.
- Removido submenu anterior das observações na aba Visão Geral para reduzir ruído.
- Mostra também a última atualização do requerimento dentro da aba Observações.

## 1.1.38
- Requerimentos: visão geral do modal reorganizada com layout mais limpo.
- Informações divididas em seções: "Informações Principais" e "Processos Vinculados".
- Observações movidas para submenu com botão Exibir/Ocultar.
- Botão de observações com ícones Eye/EyeOff e estado showObservations.
- Layout mais espaçado com space-y-6 entre seções principais.
- Títulos de seção com text-sm font-semibold para melhor hierarquia.
- Observações em container destacado com background quando expandidas.
- Melhor organização visual e UX na aba "Visão Geral".

## 1.1.37
- Requerimentos: botões do header de documentos (Ver docs/Gerar MS) refinados para visual mais premium e consistente.

## 1.1.36
- Requerimentos: modal de detalhes otimizado para ficar menos carregado (Notas/Status/Documentos recolhíveis + composer de notas mais compacto).

## 1.1.35
- Requerimentos: Histórico de Notas agora permite registrar nova nota no estilo comentários (Instagram-like), com campo de texto e botão publicar.

## 1.1.34
- Requerimentos: melhorado destaque/visibilidade do botão "Gerar MS" na seção de documentos.

## 1.1.33
- Requerimentos: corrigido erro de interface que impedia abrir detalhes (ícone Eye ausente).
- Requerimentos: histórico de notas ajustado para comentários estilo Instagram com avatar/foto, usuário, data/hora e resposta.

## 1.1.32
- Requerimentos: histórico de notas reformulado para estilo de chat (Instagram-like) com foto, nome, data e respostas.
- Requerimentos: botões de ação do modal de detalhes reorganizados para melhor usabilidade e hierarquia visual.
- Requerimentos: botão "Gerar MS" agora possui fundo preto para destaque.

## 1.1.31
- Requerimentos: melhorado layout visual do modal de detalhes com seções agrupadas e ícones.
- Requerimentos: organizadas informações em cards com gradientes e cores distintas por categoria.
- Requerimentos: adicionados ícones contextuais para melhor identificação visual dos campos.
- Requerimentos: melhorada UX com layout responsivo e suporte a dark mode aprimorado.

## 1.1.30
- Requerimentos: histórico de status (auditoria) no modal de detalhes.
- Requerimentos: alertas de MS por nível (30/60/90+) e filtro "Somente risco MS (90+)".
- Requerimentos: ações rápidas no detalhe (voltar p/ Em análise, prazo de exigência, agendar perícia).

## 1.1.29
- Requerimentos: após passar a última perícia, o status retorna automaticamente para "Em análise".

## 1.1.28
- Requerimentos: modal "Registrar prazo para exigência" ajustado para fundo branco claro com faixa laranja.

## 1.1.27
- Requerimentos: tempo em análise (MS) agora considera a última entrada em "Em análise" (reinicia ao reentrar).
- Agenda: log de exclusões agrupado por dia (Hoje/Ontem/Data) para melhor leitura.

## 1.1.26
- Agenda: removida opção de limpar log; exibição limitada aos últimos 30 dias.
- Requerimentos: agendar perícia médica/social agora cria apenas compromisso na Agenda (sem prazo).

## 1.1.25
- Agenda: removida a opção de adicionar manualmente exclusões no log (mantido apenas registro automático).

## 1.1.24
- Agenda: log de exclusões agora permite adicionar manualmente exclusões feitas anteriormente (ex.: hoje antes do log existir).

## 1.1.23
- Agenda: log persistente de exclusões de compromissos com botão "Log" ao lado de "Filtros".

## 1.1.22
- Requerimentos: correção de layout para remover espaço vazio à direita após a coluna AÇÕES (tabela ocupa 100% do container).

## 1.0.97
- Exibição padrão do módulo de Assinaturas alterada para blocos (grid), mantendo a preferência do usuário no armazenamento local.

## 1.0.96
- Correção robusta na geração de URLs assinadas para imagens de selfie/assinatura no modal de detalhes, evitando erros 400 com tratamento específico por bucket e logs detalhados para diagnóstico.

## 1.0.95
- Correção na geração de URLs assinadas do modal de detalhes (normaliza caminhos vindos com prefixo do bucket, evitando erro 400 ao exibir selfie/assinatura no Supabase Storage).

## 1.0.94
- Ajuste no modal de detalhes do módulo de Assinaturas para organizar os botões de ação no desktop (Ver assinado / Baixar documento lado a lado e Excluir separado), evitando empilhamento.

## 1.0.93
- Ajuste no layout do modal de detalhes do módulo de Assinaturas no desktop, organizando os botões de ação em grid responsivo para evitar empilhamento e desconfiguração.

## 1.0.92
- Versão anterior.
