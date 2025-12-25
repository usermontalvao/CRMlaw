# Changelog

## 1.1.65
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
