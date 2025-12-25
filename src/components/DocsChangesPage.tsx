import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Coffee,
  FileText,
  Filter,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  Palette,
  PenTool,
  Scale,
  Search,
  Settings,
  Shield,
  Tag,
  Users,
  Zap,
  FileSignature,
  Briefcase,
  Clock,
  DollarSign,
  Bell,
  FolderOpen,
  CalendarDays,
  ListTodo,
  UserPlus,
  Receipt,
  Gavel,
  X,
  History,
  Info,
} from 'lucide-react';

/* ============================================================================
   CODINOMES DAS VERSÕES
   
   Inspirados em tipos de café brasileiro ☕
   Cada versão recebe um codinome divertido e memorável.
   ============================================================================ */

const VERSION_CODENAMES: Record<string, { name: string; emoji: string }> = {
  '1.1.37': { name: 'Café Botão', emoji: '🔘' },
  '1.1.36': { name: 'Café Leve', emoji: '🪶' },
  '1.1.35': { name: 'Café Comentário', emoji: '📝' },
  '1.1.34': { name: 'Café Destaque', emoji: '🖤' },
  '1.1.33': { name: 'Café Correção', emoji: '👁️' },
  '1.1.32': { name: 'Café Social', emoji: '💬' },
  '1.1.31': { name: 'Café Visual', emoji: '🎨' },
  '1.0.31': { name: 'Café Constraint', emoji: '☕' },
  '1.0.30': { name: 'Café Identidade', emoji: '☕' },
  '1.0.29': { name: 'Café Progresso', emoji: '☕' },
  '1.0.28': { name: 'Café Visível', emoji: '☕' },
  '1.0.27': { name: 'Café Prático', emoji: '☕' },
  '1.0.26': { name: 'Café Minimal', emoji: '☕' },
  '1.0.25': { name: 'Café Clean', emoji: '☕' },
  '1.0.24': { name: 'Café Suave', emoji: '☕' },
  '1.0.23': { name: 'Café Intenso', emoji: '☕' },
  '1.0.22': { name: 'Café Aromático', emoji: '☕' },
  '1.0.21': { name: 'Café Aveludado', emoji: '☕' },
  '1.0.20': { name: 'Café Cremoso', emoji: '☕' },
  '1.0.19': { name: 'Café Forte', emoji: '☕' },
  '1.0.18': { name: 'Café Duplo', emoji: '☕' },
  '1.0.17': { name: 'Café Especial', emoji: '☕' },
  '1.0.16': { name: 'Cold Brew', emoji: '🧋' },
  '1.0.15': { name: 'Café Gelado', emoji: '🧊' },
  '1.0.14': { name: 'Café com Leite', emoji: '🥛' },
  '1.0.13': { name: 'Café Preto', emoji: '☕' },
  '1.0.12': { name: 'Carioca', emoji: '☕' },
  '1.0.11': { name: 'Affogato', emoji: '🍨' },
  '1.0.10': { name: 'Cortado', emoji: '☕' },
  '1.0.9': { name: 'Coado', emoji: '☕' },
  '1.0.8': { name: 'Pingado', emoji: '☕' },
  '1.0.7': { name: 'Macchiato', emoji: '🥛' },
  '1.0.6': { name: 'Mocha', emoji: '🍫' },
  '1.0.5': { name: 'Cappuccino', emoji: '☕' },
  '1.0.4': { name: 'Latte', emoji: '🥛' },
  '1.0.3': { name: 'Americano', emoji: '🇺🇸' },
  '1.0.2': { name: 'Ristretto', emoji: '💧' },
  '1.0.1': { name: 'Lungo', emoji: '📏' },
  '1.0.0': { name: 'Espresso', emoji: '⚡' },
};

const getCodename = (version: string) => VERSION_CODENAMES[version] || { name: 'Café', emoji: '☕' };

/* ============================================================================
   CONFIGURAÇÃO DOS MÓDULOS DO SISTEMA (CHANGELOG)
   ============================================================================ */

type ModuleConfig = {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: {
    bg: string;
    text: string;
    border: string;
    light: string;
  };
};

const CHANGELOG_MODULES: ModuleConfig[] = [
  {
    id: 'assinatura-publica',
    name: 'Assinatura Pública',
    description: 'Fluxo de assinatura digital para usuários externos',
    icon: PenTool,
    color: { bg: 'bg-violet-600', text: 'text-violet-700', border: 'border-violet-200', light: 'bg-violet-50' },
  },
  {
    id: 'relatorio-assinatura',
    name: 'Relatório de Assinatura',
    description: 'Geração e visualização de relatórios de assinaturas',
    icon: FileText,
    color: { bg: 'bg-blue-600', text: 'text-blue-700', border: 'border-blue-200', light: 'bg-blue-50' },
  },
  {
    id: 'branding',
    name: 'Branding & Identidade',
    description: 'Identidade visual, logos, metadados e SEO',
    icon: Palette,
    color: { bg: 'bg-pink-600', text: 'text-pink-700', border: 'border-pink-200', light: 'bg-pink-50' },
  },
  {
    id: 'sistema',
    name: 'Sistema',
    description: 'Funcionalidades gerais e infraestrutura do sistema',
    icon: Settings,
    color: { bg: 'bg-slate-600', text: 'text-slate-700', border: 'border-slate-200', light: 'bg-slate-50' },
  },
  {
    id: 'dev',
    name: 'Dev & Governança',
    description: 'Ferramentas de desenvolvimento, CI/CD e governança de código',
    icon: Code2,
    color: { bg: 'bg-emerald-600', text: 'text-emerald-700', border: 'border-emerald-200', light: 'bg-emerald-50' },
  },
  {
    id: 'docs',
    name: 'Documentação',
    description: 'Changelog, documentação e guias do sistema',
    icon: BookOpen,
    color: { bg: 'bg-amber-600', text: 'text-amber-700', border: 'border-amber-200', light: 'bg-amber-50' },
  },
];

const getModuleConfig = (moduleId: string): ModuleConfig => {
  return CHANGELOG_MODULES.find((m) => m.id === moduleId) || {
    id: moduleId,
    name: moduleId,
    description: '',
    icon: Zap,
    color: { bg: 'bg-gray-600', text: 'text-gray-700', border: 'border-gray-200', light: 'bg-gray-50' },
  };
};

/* ============================================================================
   DOCUMENTAÇÃO DO SISTEMA - MÓDULOS FUNCIONAIS
   
   Documentação completa de cada módulo do Jurius com:
   - Descrição detalhada
   - Funcionalidades principais
   - Dicas de uso
   ============================================================================ */

type SystemModule = {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  features: string[];
  tips?: string[];
};

const SYSTEM_MODULES: SystemModule[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Visão geral do escritório com métricas, gráficos e indicadores de performance. Acompanhe processos, prazos, financeiro e produtividade em tempo real.',
    icon: LayoutDashboard,
    color: 'bg-orange-600',
    features: [
      'Resumo de processos ativos e arquivados',
      'Gráficos de evolução mensal',
      'Indicadores de prazos próximos',
      'Métricas financeiras (receitas/despesas)',
      'Atalhos rápidos para ações frequentes',
    ],
    tips: [
      'Use os filtros de período para análises específicas',
      'Clique nos cards para acessar detalhes',
    ],
  },
  {
    id: 'processos',
    name: 'Processos',
    description: 'Gestão completa de processos judiciais e administrativos. Cadastre, acompanhe movimentações, vincule documentos e gerencie todas as informações processuais.',
    icon: Briefcase,
    color: 'bg-blue-600',
    features: [
      'Cadastro completo de processos',
      'Vinculação de clientes e partes',
      'Histórico de movimentações',
      'Upload de documentos do processo',
      'Anotações e observações internas',
      'Status e fases processuais',
      'Busca avançada por número, cliente ou assunto',
    ],
    tips: [
      'Mantenha o status sempre atualizado',
      'Use tags para categorizar processos similares',
    ],
  },
  {
    id: 'clientes',
    name: 'Clientes',
    description: 'Cadastro e gestão de clientes pessoa física e jurídica. Mantenha dados atualizados, histórico de atendimentos e vinculação com processos.',
    icon: Users,
    color: 'bg-emerald-600',
    features: [
      'Cadastro PF e PJ completo',
      'Dados de contato e endereço',
      'Documentos do cliente',
      'Histórico de processos vinculados',
      'Anotações e observações',
      'Busca por nome, CPF/CNPJ ou telefone',
    ],
    tips: [
      'Sempre valide CPF/CNPJ antes de salvar',
      'Mantenha telefones e e-mails atualizados',
    ],
  },
  {
    id: 'prazos',
    name: 'Prazos',
    description: 'Controle de prazos processuais e administrativos. Receba alertas, visualize calendário e nunca perca um prazo importante.',
    icon: Clock,
    color: 'bg-red-600',
    features: [
      'Cadastro de prazos com data e hora',
      'Alertas automáticos configuráveis',
      'Visualização em lista ou calendário',
      'Filtros por processo, cliente ou status',
      'Prazos fatais destacados',
      'Histórico de prazos cumpridos',
    ],
    tips: [
      'Configure alertas com antecedência adequada',
      'Marque prazos como cumpridos assim que concluir',
    ],
  },
  {
    id: 'financeiro',
    name: 'Financeiro',
    description: 'Gestão financeira completa do escritório. Controle honorários, despesas, contas a pagar/receber e fluxo de caixa.',
    icon: DollarSign,
    color: 'bg-green-600',
    features: [
      'Lançamento de receitas e despesas',
      'Controle de honorários por processo',
      'Contas a pagar e receber',
      'Relatórios financeiros',
      'Fluxo de caixa',
      'Categorização de lançamentos',
    ],
    tips: [
      'Categorize todos os lançamentos para relatórios precisos',
      'Vincule honorários aos processos correspondentes',
    ],
  },
  {
    id: 'documentos',
    name: 'Documentos',
    description: 'Repositório central de documentos. Upload, organização, busca e geração de documentos a partir de modelos.',
    icon: FolderOpen,
    color: 'bg-amber-600',
    features: [
      'Upload de múltiplos arquivos',
      'Organização por pastas e tags',
      'Busca por nome ou conteúdo',
      'Vinculação com processos e clientes',
      'Modelos de documentos',
      'Geração automática com variáveis',
      'Visualização inline de PDFs',
    ],
    tips: [
      'Use nomes descritivos nos arquivos',
      'Crie modelos para documentos frequentes',
    ],
  },
  {
    id: 'assinaturas',
    name: 'Assinaturas',
    description: 'Assinatura digital de documentos com validade jurídica. Envie para assinatura, acompanhe status e armazene documentos assinados.',
    icon: FileSignature,
    color: 'bg-violet-600',
    features: [
      'Envio de documentos para assinatura',
      'Múltiplos signatários',
      'Verificação facial opcional',
      'Assinatura com certificado digital',
      'Relatório de assinatura com QR Code',
      'Histórico completo de assinaturas',
      'Link público para assinatura externa',
    ],
    tips: [
      'Ative verificação facial para maior segurança',
      'Acompanhe o status de pendentes regularmente',
    ],
  },
  {
    id: 'agenda',
    name: 'Agenda',
    description: 'Calendário integrado para compromissos, audiências e reuniões. Sincronize com Google Calendar e receba lembretes.',
    icon: CalendarDays,
    color: 'bg-indigo-600',
    features: [
      'Visualização diária, semanal e mensal',
      'Cadastro de compromissos',
      'Vinculação com processos',
      'Lembretes por e-mail',
      'Cores por tipo de evento',
      'Arrastar e soltar para reagendar',
    ],
    tips: [
      'Vincule audiências aos processos',
      'Use cores diferentes para cada tipo de compromisso',
    ],
  },
  {
    id: 'tarefas',
    name: 'Tarefas',
    description: 'Gestão de tarefas e atividades do escritório. Atribua responsáveis, defina prioridades e acompanhe o progresso.',
    icon: ListTodo,
    color: 'bg-cyan-600',
    features: [
      'Criação de tarefas com descrição',
      'Atribuição de responsável',
      'Prioridade e prazo',
      'Status (pendente, em andamento, concluída)',
      'Vinculação com processos',
      'Filtros e ordenação',
    ],
    tips: [
      'Defina prazos realistas',
      'Atualize o status conforme progresso',
    ],
  },
  {
    id: 'intimacoes',
    name: 'Intimações',
    description: 'Recebimento e gestão de intimações eletrônicas. Integração com tribunais para captura automática.',
    icon: Bell,
    color: 'bg-rose-600',
    features: [
      'Captura automática de intimações',
      'Leitura e marcação de status',
      'Vinculação com processos',
      'Alertas de novas intimações',
      'Histórico completo',
      'Análise de conteúdo com IA',
    ],
    tips: [
      'Configure a integração com os tribunais',
      'Processe intimações diariamente',
    ],
  },
  {
    id: 'leads',
    name: 'Leads',
    description: 'Gestão de potenciais clientes. Capture leads, acompanhe o funil de vendas e converta em clientes.',
    icon: UserPlus,
    color: 'bg-pink-600',
    features: [
      'Cadastro de leads',
      'Funil de conversão',
      'Histórico de contatos',
      'Conversão para cliente',
      'Origem do lead',
      'Anotações e follow-ups',
    ],
    tips: [
      'Registre a origem de cada lead',
      'Faça follow-up regular',
    ],
  },
  {
    id: 'configuracoes',
    name: 'Configurações',
    description: 'Personalize o sistema conforme as necessidades do escritório. Usuários, permissões, integrações e preferências.',
    icon: Settings,
    color: 'bg-slate-600',
    features: [
      'Gestão de usuários',
      'Perfis e permissões',
      'Dados do escritório',
      'Integrações externas',
      'Modelos de e-mail',
      'Configurações de notificação',
    ],
    tips: [
      'Revise permissões periodicamente',
      'Mantenha integrações atualizadas',
    ],
  },
];

/* ============================================================================
   TIPOS DE ALTERAÇÃO (CHANGELOG)
   ============================================================================ */

type ChangeType = 'feature' | 'improvement' | 'fix' | 'security' | 'breaking';

type ChangeItem = {
  type: ChangeType;
  title: string;
  description?: string;
};

type ModuleChanges = {
  moduleId: string;
  changes: ChangeItem[];
};

type ReleaseNote = {
  version: string;
  date: string;
  summary?: string;
  modules: ModuleChanges[];
};

const CHANGE_TYPE_CONFIG: Record<ChangeType, { label: string; icon: React.ElementType; color: string }> = {
  feature: { label: 'Novo', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
  improvement: { label: 'Melhoria', icon: CheckCircle2, color: 'text-blue-600 bg-blue-50' },
  fix: { label: 'Correção', icon: Shield, color: 'text-amber-600 bg-amber-50' },
  security: { label: 'Segurança', icon: Shield, color: 'text-red-600 bg-red-50' },
  breaking: { label: 'Breaking', icon: GitBranch, color: 'text-purple-600 bg-purple-50' },
};

/* ============================================================================
   HISTÓRICO DE VERSÕES (CHANGELOG)
   ============================================================================ */

const releases: ReleaseNote[] = [
  {
    version: '1.1.65',
    date: '2025-12-25',
    summary: 'Perfil: melhorias de acessibilidade e legibilidade',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'improvement',
            title: 'Métricas com contraste alto',
            description:
              'Aba "Métricas" agora utiliza cards brancos com texto escuro para garantir alta legibilidade e contraste.',
          },
          {
            type: 'fix',
            title: 'Cores de ícones e labels corrigidas',
            description:
              'Corrigidas as cores dos ícones e labels para garantir visibilidade adequada das estatísticas no perfil.',
          },
          {
            type: 'improvement',
            title: 'Melhorias de acessibilidade',
            description:
              'Aprimorada a acessibilidade geral do dashboard do perfil com melhor contraste e legibilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.64',
    date: '2025-12-24',
    summary: 'Requerimentos: textos oficiais e labels do BPC LOAS',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Textos oficiais do MS atualizados para BPC/LOAS',
            description:
              'O Mandado de Segurança agora imprime os textos “Benefício de Prestação Continuada (BPC/LOAS) à Pessoa com Deficiência” e “Benefício de Prestação Continuada (BPC/LOAS) – Idoso”, seguindo o padrão exigido pelo Ministério da Saúde.',
          },
          {
            type: 'improvement',
            title: 'Label claro para registros legados de BPC LOAS',
            description:
              'O tipo legado “bpc_loas” passou a ser exibido como “BPC LOAS - Deficiente”, mantendo compatibilidade com dados antigos sem confundir os operadores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.37',
    date: '2025-12-23',
    summary: 'Requerimentos: botões de documentos refinados',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Botões do header de documentos mais premium',
            description:
              'Botões “Ver docs” e “Gerar MS” ajustados para mesmo tamanho, rounded-full, sombras mais suaves e disabled mais elegante.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.36',
    date: '2025-12-23',
    summary: 'Requerimentos: modal de detalhes mais leve',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Seções recolhíveis no modal de detalhes',
            description:
              'Histórico de Notas, Histórico de Status e Documentos agora podem ser recolhidos/expandidos, reduzindo poluição visual no modal.',
          },
          {
            type: 'improvement',
            title: 'Composer de notas mais compacto',
            description:
              'Área de registrar nota foi compactada para ficar mais parecida com comentários e ocupar menos espaço.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.35',
    date: '2025-12-23',
    summary: 'Requerimentos: registrar notas no estilo comentários',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Campo para registrar nota no Histórico de Notas',
            description:
              'Seção “Histórico de Notas” agora possui composer (avatar + campo de texto + botão Publicar) semelhante a comentários de redes sociais.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.34',
    date: '2025-12-23',
    summary: 'Requerimentos: botão Gerar MS mais visível',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Destaque no botão Gerar MS',
            description:
              'Botão “Gerar MS (Word/DOCX)” agora possui maior contraste, tamanho e sombra para ficar fácil de localizar na seção de documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.33',
    date: '2025-12-23',
    summary: 'Requerimentos: correções e ajustes no histórico de notas',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Correção ao abrir detalhes (Eye)',
            description:
              'Corrigido erro que impedia abrir detalhes de requerimentos por falta de import do ícone Eye.',
          },
          {
            type: 'improvement',
            title: 'Histórico de notas mais parecido com comentários',
            description:
              'Notas agora exibem avatar/foto do autor quando disponível, nome do usuário e data/hora de forma mais clara, com fluxo de resposta mais simples.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.32',
    date: '2025-12-23',
    summary: 'Requerimentos: melhorias na interação social e layout',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Histórico de notas estilo chat',
            description:
              'Visualização de notas redesenhada para parecer comentários de redes sociais, com foto do autor, nome, data/hora e agrupamento de respostas.',
          },
          {
            type: 'improvement',
            title: 'Organização dos botões de ação',
            description:
              'Botões do rodapé do modal reorganizados para melhor hierarquia visual, separando ações principais de ações destrutivas.',
          },
          {
            type: 'improvement',
            title: 'Destaque para Gerar MS',
            description:
              'Botão "Gerar MS" agora possui destaque visual com fundo preto para facilitar a localização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.31',
    date: '2025-12-22',
    summary: 'Requerimentos: layout visual aprimorado do modal de detalhes',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Layout visual do modal de detalhes redesenhado',
            description:
              'Modal de detalhes agora exibe informações organizadas em seções com gradientes, ícones contextuais e cores distintas por categoria.',
          },
          {
            type: 'feature',
            title: 'Seções agrupadas por categoria',
            description:
              'Informações divididas em: Informações Principais (azul), Informações Adicionais (âmbar), Observações (roxo), Histórico de Notas (verde), Histórico de Status (índigo), Processos Vinculados (ciano) e Documentos (rosa).',
          },
          {
            type: 'feature',
            title: 'Ícones contextuais em todos os campos',
            description:
              'Cada campo e seção agora possui ícones relevantes para melhor identificação visual: FileText para protocolo, User para beneficiário, Phone para telefone, etc.',
          },
          {
            type: 'improvement',
            title: 'UX responsiva e dark mode aprimorado',
            description:
              'Layout totalmente responsivo com suporte aprimorado ao dark mode, cards com gradientes sutis e melhor legibilidade em todas as telas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.30',
    date: '2025-12-22',
    summary: 'Requerimentos: histórico de status, alertas MS e ações rápidas',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Histórico de status (auditoria)',
            description:
              'O modal de detalhes agora exibe o histórico de mudanças de status do requerimento (de → para, data/hora e autor/sistema).',
          },
          {
            type: 'improvement',
            title: 'Alertas de MS por nível + filtro',
            description:
              'Em análise agora mostra alertas por nível (30/60/90+ dias) e foi adicionado filtro “Somente risco MS (90+)”.',
          },
          {
            type: 'improvement',
            title: 'Ações rápidas no detalhe',
            description:
              'Adicionados botões rápidos no detalhe para voltar para Em análise, registrar prazo de exigência e agendar perícia.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.29',
    date: '2025-12-22',
    summary: 'Requerimentos: status após perícia automático',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Retorno automático para Em análise após última perícia',
            description:
              'Quando a última perícia agendada já passou, o requerimento volta automaticamente para Em análise (checagem periódica e ao retornar foco na janela).',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.28',
    date: '2025-12-22',
    summary: 'Requerimentos: modal de exigência com visual claro',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de prazo de exigência mais claro',
            description:
              'Modal "Registrar prazo para exigência" agora usa fundo branco claro e faixa laranja no topo para melhor legibilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.27',
    date: '2025-12-22',
    summary: 'Requerimentos: contagem MS e Agenda: log em linha do tempo',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Tempo em análise reinicia ao voltar para Em análise',
            description:
              'A contagem de dias para MS passa a considerar a última entrada no status Em análise (ex.: após perícia/exigência, reinicia ao retornar para Em análise).',
          },
        ],
      },
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'improvement',
            title: 'Log de exclusões agrupado por dia',
            description:
              'Log de exclusões agora exibe separadores por data (Hoje/Ontem/Data) para leitura mais rápida, mantendo filtro de 30 dias.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.26',
    date: '2025-12-22',
    summary: 'Agenda e Requerimentos: ajustes no log e perícias',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'improvement',
            title: 'Log de exclusões simplificado',
            description:
              'Removida opção de limpar log; exibição limitada aos últimos 30 dias.',
          },
        ],
      },
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Perícia não cria mais prazo',
            description:
              'Ao agendar perícia médica ou social, agora é criado apenas o compromisso na Agenda, sem gerar prazo duplicado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.25',
    date: '2025-12-22',
    summary: 'Agenda: simplificação do log de exclusões',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'improvement',
            title: 'Log de exclusões apenas automático',
            description:
              'Removida a opção de adicionar manualmente exclusões no log, mantendo apenas o registro automático ao excluir compromissos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.24',
    date: '2025-12-22',
    summary: 'Agenda: registrar exclusões antigas no log',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'improvement',
            title: 'Inserção manual no log de exclusões',
            description:
              'Modal de Log agora permite adicionar manualmente exclusões realizadas anteriormente (ex.: exclusões de hoje antes do log existir) e pré-preenche data/hora ao abrir.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.23',
    date: '2025-12-22',
    summary: 'Agenda: log de exclusões de compromissos',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'feature',
            title: 'Log de exclusões na Agenda',
            description:
              'Adicionado log persistente (localStorage) para exclusões de compromissos, com botão “Log” ao lado de “Filtros” e modal para visualizar e limpar histórico.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.22',
    date: '2025-12-22',
    summary: 'Requerimentos: correção de espaço vazio à direita na tabela',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Tabela ocupa toda a largura disponível',
            description:
              'A tabela desktop passou a usar w-full, evitando que o container reserve uma área vazia à direita após a coluna Ações (efeito de “coluna fantasma”).',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.21',
    date: '2025-12-22',
    summary: 'Requerimentos: melhoria visual do banner e badges de mandado de segurança',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Design aprimorado para alertas',
            description:
              'Banner com gradiente red-to-orange, borda esquerda destacada, ícone em círculo e número de dias em negrito. Badges na tabela com fundo vermelho claro e ícone de relógio para análise normal.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.20',
    date: '2025-12-22',
    summary: 'Requerimentos: correção definitiva de overflow no texto "Possível mandado de segurança"',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Layout responsivo sem scroll horizontal',
            description:
              'Aplicadas correções abrangentes: tabela com min-w-[800px], colunas com max-width e truncate, texto com break-words e flex items-start para garantir que o banner longo caiba 100% em todos os breakpoints sem scroll.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.19',
    date: '2025-12-22',
    summary: 'Requerimentos: correção de layout para evitar scroll no banner de mandado de segurança',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Banner "Possível mandado de segurança" sem overflow',
            description:
              'Ajustado layout do banner e da lista para que o texto "Possível mandado de segurança — Em análise há X dias" caiba 100% na tela sem causar scroll horizontal.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.18',
    date: '2025-12-22',
    summary: 'Requerimentos: correção de visibilidade do botão Salvar no modal Template MS',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão Salvar agora visível',
            description:
              'Adicionado !important nas classes de fundo do botão Salvar para garantir que o fundo preto seja aplicado mesmo com conflitos de CSS.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.17',
    date: '2025-12-22',
    summary: 'Requerimentos: botão Salvar com fundo preto no modal Template MS',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Salvar com fundo preto',
            description:
              'Ajuste visual no modal de Template MS: botão Salvar agora utiliza fundo preto para maior contraste e destaque.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.16',
    date: '2025-12-22',
    summary: 'Requerimentos: modal Template MS com altura maior e rodapé fixo',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão Salvar visível em telas menores',
            description:
              'Modal do Template MS agora usa layout em coluna (flex) com corpo rolável e rodapé fixo, além de altura máxima maior (max-h-[90vh]) para garantir que o botão Salvar fique acessível.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.15',
    date: '2025-12-22',
    summary: 'Requerimentos: ajuste visual no modal do Template MS',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Linha laranja no topo do modal',
            description:
              'Adicionada linha laranja (gradiente) no topo do modal de Template MS para destacar visualmente.',
          },
          {
            type: 'fix',
            title: 'Botão Salvar sempre visível',
            description:
              'Área de conteúdo do modal agora é rolável (max-h-[35vh] overflow-y-auto) para garantir que o botão Salvar nunca fique escondido.',
          },
          {
            type: 'improvement',
            title: 'Lista de placeholders disponíveis',
            description:
              'Adicionada seção com todos os placeholders configurados no módulo (dados do cliente e do requerimento) para facilitar a criação de templates.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.14',
    date: '2025-12-22',
    summary: 'Requerimentos: correção de cidade em maiúsculo no cabeçalho do MS',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Placeholder [[Cidade]] (cabeçalho) agora é preenchido',
            description:
              'O preenchimento de placeholders do MS passou a cobrir também a variação com primeira letra maiúscula (ex.: [[Cidade]]), garantindo que a cidade saia em maiúsculo no cabeçalho do DOCX.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.13',
    date: '2025-12-22',
    summary: 'Documentos: ocultar Modelo MS (Requerimentos) em Novo documento',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Modelo MS (Requerimentos) apenas em Gerenciar templates',
            description:
              'O template de MS usado pelo módulo de Requerimentos não aparece mais na seleção de “Novo documento”, ficando disponível somente em “Gerenciar templates”.',
          },
        ],
      },
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Marcação do template MS para filtro no módulo Documentos',
            description:
              'O template MS criado pelo Requerimentos agora recebe a tag [REQUERIMENTOS_MS] na descrição para facilitar organização e filtros.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.12',
    date: '2025-12-22',
    summary: 'Requerimentos: ajustes finos no MS (Word/DOCX)',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Cidade em maiúsculo e data por extenso',
            description:
              'No MS gerado em Word (DOCX), o placeholder [[cidade]] passa a sair em maiúsculo e o [[DATA_REQUERIMENTO]] passa a sair por extenso.',
          },
          {
            type: 'fix',
            title: 'Remoção de vírgula dupla no endereço',
            description:
              'Correção automática no DOCX gerado para evitar trechos como ", , Bairro" quando o complemento estiver vazio.',
          },
          {
            type: 'improvement',
            title: 'Modal do Template MS mais claro',
            description:
              'Ajustado o visual do modal de Template MS para ficar claramente em fundo branco e com textos coerentes com geração em Word (DOCX).',
          },
          {
            type: 'improvement',
            title: 'Remoção do botão Gerar MS do header da listagem',
            description:
              'O botão de gerar MS foi removido do header da tela inicial de Requerimentos, mantendo a geração dentro dos detalhes do requerimento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.11',
    date: '2025-12-22',
    summary: 'Requerimentos: fluxo de template MS igual ao módulo Documentos',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Seleção de template ao gerar MS',
            description:
              'Ao clicar em "Gerar MS (Word/DOCX)" sem template selecionado, o modal de seleção/upload de template abre automaticamente (mesmo comportamento do módulo Documentos).',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.10',
    date: '2025-12-22',
    summary: 'Requerimentos: MS gerado em Word (DOCX) mantendo layout',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Geração do MS em DOCX (sem conversão PDF)',
            description:
              'O Mandado de Segurança agora é gerado e anexado como Word (DOCX) já preenchido a partir do template, preservando o layout original do modelo (sem conversão para PDF).',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.9',
    date: '2025-12-22',
    summary: 'Requerimentos/Documentos: correção de upload no bucket generated-documents',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Upload do MS (PDF) não bloqueado por RLS',
            description:
              'Adicionadas policies de Storage (SELECT/INSERT/DELETE) para usuários autenticados no bucket generated-documents, corrigindo erro “new row violates row-level security policy” ao gerar e anexar PDFs.',
          },
        ],
      },
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Upload de documentos gerados no bucket generated-documents',
            description:
              'Políticas de acesso ao bucket generated-documents ajustadas para permitir upload/download de documentos gerados por usuários autenticados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.8',
    date: '2025-12-22',
    summary: 'Requerimentos: correção template MS (configuração)',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Configuração requirements_ms_template_id sem NULL',
            description:
              'Corrigido erro de NOT NULL na tabela system_settings: a configuração do template MS agora inicializa com string vazia (JSON) e o salvamento do template não envia null.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.7',
    date: '2025-12-22',
    summary: 'Requerimentos: template MS em Word (DOCX)',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Template MS (DOCX) no Requerimentos',
            description:
              'Adicionado gerenciamento de template Word do Mandado de Segurança (DOCX) no módulo de Requerimentos, com seleção/envio do arquivo e preenchimento automático dos placeholders na geração do PDF.',
          },
          {
            type: 'improvement',
            title: 'Template padrão persistido',
            description:
              'O template selecionado para o MS agora é salvo nas configurações do sistema e aplicado automaticamente nas próximas gerações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.6',
    date: '2025-12-22',
    summary: 'Requerimentos: botão MS ao lado do Exportar Excel',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Gerar MS (PDF) no header',
            description:
              'Adicionado botão “Gerar MS (PDF)” ao lado de “Exportar Excel” no topo do módulo. Ele gera o MS do requerimento que estiver aberto em “Detalhes”.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.5',
    date: '2025-12-22',
    summary: 'Requerimentos: anexos mais visíveis nos detalhes',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'CTA de anexos no estado vazio',
            description:
              'Na seção “Documentos do requerimento”, quando não houver anexos, o painel agora mostra um botão grande “Gerar MS (PDF)” dentro do card para facilitar encontrar e usar a funcionalidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.4',
    date: '2025-12-22',
    summary: 'Requerimentos: gerar MS em PDF e anexar no próprio requerimento',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Gerar Mandado de Segurança (PDF) no Requerimento',
            description:
              'Adicionado botão “Gerar MS (PDF)” nos detalhes do requerimento, gerando a petição com placeholders preenchidos automaticamente (incluindo BENEFICIO pelo tipo cadastrado) e salvando como documento anexado ao requerimento.',
          },
          {
            type: 'feature',
            title: 'Documentos do requerimento (listar/baixar/excluir)',
            description:
              'Criada infraestrutura de anexos do requerimento para armazenar PDFs no bucket de documentos gerados e gerenciar download/exclusão diretamente no módulo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.3',
    date: '2025-12-22',
    summary: 'Documentos: modelo de MS + campos dinâmicos do template',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'feature',
            title: 'Modelo - Mandado de Segurança (INSS)',
            description:
              'Adicionado template de Mandado de Segurança (demora na análise do requerimento), com placeholders e campos para protocolo, benefício, APS/cidade de referência e tempo em análise. Valor da causa padronizado em 1 salário mínimo e assinatura configurada para Cuiabá-MT (data atual).',
          },
          {
            type: 'improvement',
            title: 'Campos do Modelo (dinâmicos) ao gerar documento',
            description:
              'Para templates em texto, o gerador agora exibe automaticamente os campos extras detectados (placeholders [[...]]), permitindo preencher tudo sem editar o template.',
          },
          {
            type: 'improvement',
            title: 'Placeholders do cliente: RG, data de nascimento e endereço completo',
            description:
              'Adicionados placeholders para RG, data de nascimento e endereço completo no mapeamento automático do cliente ao gerar documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.2',
    date: '2025-12-22',
    summary: 'Requerimentos: conversão em processos (principal e MS)',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Converter requerimento em processo principal e/ou MS',
            description:
              'Nos detalhes do requerimento, agora é possível criar/abrir um processo principal e também um processo de Mandado de Segurança (MS) separado, ambos vinculados ao mesmo requerimento.',
          },
        ],
      },
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Vínculo com requerimento via requirement_id/requirement_role',
            description:
              'Processos agora suportam vínculo opcional com requerimentos e um papel (principal/ms) para permitir coexistência de processo administrativo e MS.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.1',
    date: '2025-12-22',
    summary: 'Requerimentos: aviso de MS com contagem de dias',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Alerta de mandado de segurança mostra quantos dias em análise',
            description:
              'No aviso “Possível mandado de segurança”, a interface agora exibe explicitamente a contagem de dias em análise (lista e detalhes).',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2025-12-22',
    summary: 'Requerimentos: acompanhamento premium (agenda + alertas)',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Perícias também viram compromissos na Agenda',
            description:
              'Ao agendar perícia médica/social, o sistema cria eventos no calendário (event_type=pericia) além dos prazos vinculados.',
          },
          {
            type: 'improvement',
            title: 'Hierarquia de acompanhamento: “Em exigência” no topo',
            description:
              'Reordenamos abas, dropdowns e ordenação interna para priorizar o que exige ação imediata (Exigência → Perícia → Análise).',
          },
          {
            type: 'feature',
            title: 'Aviso de mandado de segurança após 90 dias em análise',
            description:
              'Requerimentos em análise há 90+ dias exibem alerta destacado na lista e nos detalhes para apoiar decisões rápidas do time.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.99',
    date: '2025-12-22',
    summary: 'Requerimentos: agendamento de perícias e automação de status',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de agendamento de perícia (claro) e exceção ao dark mode',
            description:
              'O modal de agendamento de perícia agora força visual claro e legível mesmo com overrides globais de modais no modo escuro.',
          },
        ],
      },
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Agendamento de perícia médica e/ou social',
            description:
              'Novo fluxo para registrar perícia médica e/ou social no requerimento, salvando as datas/horas e criando prazos vinculados automaticamente.',
          },
          {
            type: 'improvement',
            title: 'Status muda automaticamente para “Em análise” após as perícias',
            description:
              'Quando passa a data da última perícia registrada (médica/social), o status do requerimento é atualizado automaticamente para “Em análise”.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.98',
    date: '2025-12-22',
    summary: 'Atualização de versão e changelog',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Versão atualizada para 1.0.98',
            description: 'Incremento de versão do sistema conforme processo de commit.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.92',
    date: '2025-12-20',
    summary: 'Documentos: geração mais direta no mobile',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Template selecionado no topo do formulário (mobile)',
            description:
              'No celular, a lista lateral de templates foi ocultada e a seleção do template foi movida para dentro do formulário de geração, reduzindo rolagem e deixando o fluxo mais rápido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.91',
    date: '2025-12-20',
    summary: 'Documentos: UX mobile melhorada',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'CTA de geração sempre visível no celular',
            description:
              'O botão “Gerar documento” agora fica em um footer sticky no mobile e a lista de templates não usa mais scroll interno no celular, reduzindo esforço e melhorando a navegação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.90',
    date: '2025-12-20',
    summary: 'Modal financeiro mais compacto',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Parcelas e pagamentos com menos altura',
            description:
              'Reduzimos espaçamentos, paddings e ajustamos o grid do card de parcelas no modal de detalhes para evitar excesso de altura e deixar a leitura mais fluida.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.89',
    date: '2025-01-19',
    summary: 'Cartões de parcelas redesenhados',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Visual premium para “Parcelas e Pagamentos”',
            description:
              'Cartões com gradiente, badges de status e botão “Dar baixa” destacando atraso/pendência tornam a experiência mais clara e bonita no modal de detalhes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.88',
    date: '2025-01-19',
    summary: 'Rolagem do modal de detalhes no mobile',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'fix',
            title: 'Parcelas acessíveis no modal de detalhes (mobile)',
            description:
              'Eliminamos o scroll aninhado e reforçamos o touch scrolling (iOS/Android), permitindo rolar até “Parcelas e Pagamentos” e registrar baixa normalmente no celular.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.87',
    date: '2025-01-19',
    summary: 'Correções de modal financeiro e estabilidade',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'fix',
            title: 'Erro 500 por hooks duplicados resolvido',
            description:
              'Restauramos o filtro memoizado principal e removemos o useMemo duplicado dentro da área de cancelados, eliminando o ReferenceError/Hook Order que derrubava o módulo financeiro.',
          },
          {
            type: 'improvement',
            title: 'Modal de detalhes rolável no mobile',
            description:
              'O modal de detalhes agora usa layout scrollável no viewport inteiro, permitindo acessar a seção de parcelas e registrar pagamentos em telas menores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.86',
    date: '2025-01-18',
    summary: 'Formulário financeiro preparado para lançamentos gerais',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Terminologia genérica no cadastro',
            description:
              'Renomeamos botão, título do modal e campos “Título/Data do Acordo” para “Novo Lançamento / Título do lançamento / Data do lançamento”, permitindo usar o módulo também para lançamentos que não sejam acordos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.85',
    date: '2025-01-18',
    summary: 'Logo oficial “J” aplicada aos ícones do app',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'fix',
            title: 'Logo Jurius aplicada na inicialização',
            description:
              'Atualizamos os ícones maskable (192px e 512px) usados no PWA e no app desktop/mobile para exibir a marca oficial com o “J” sobre fundo laranja, substituindo o ícone antigo com letras WA.',
          },
          {
            type: 'improvement',
            title: 'Script de geração de ícones padronizado',
            description:
              'Adicionamos um script convert-logo.ps1 que desenha programaticamente o gradiente laranja e a letra “J”, garantindo consistência sempre que os ícones precisarem ser regenerados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.84',
    date: '2025-01-18',
    summary: 'Detalhes de assinatura otimizados para dispositivos móveis',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de detalhes adaptado para telas pequenas',
            description: 'O modal de detalhes da assinatura foi ajustado com espaçamento reduzido, botões em grid e layout empilhado para melhor visualização em dispositivos móveis.',
          },
          {
            type: 'fix',
            title: 'Cards de signatários responsivos',
            description: 'Os cards de signatários agora usam layout flex adaptativo, com imagens menores em mobile e informações de autenticação reorganizadas para evitar quebras de layout.',
          },
          {
            type: 'improvement',
            title: 'Botões de ação em grid responsivo',
            description: 'Os botões de ação (Ver assinado, Baixar, Excluir) agora usam grid responsivo que se adapta ao tamanho da tela, com texto reduzido em dispositivos móveis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.83',
    date: '2025-01-18',
    summary: 'Modais de assinatura totalmente responsivos em dispositivos móveis',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'fix',
            title: 'Modal de assinatura adaptado para mobile',
            description: 'O modal de assinatura agora tem layout fluido, com cabeçalho empilhado em telas pequenas e canvas de assinatura responsivo que se adapta ao tamanho da tela.',
          },
          {
            type: 'improvement',
            title: 'Canvas de assinatura com toque otimizado',
            description: 'O componente de assinatura agora usa largura responsiva para melhor experiência em dispositivos touch, mantendo a proporção adequada.',
          },
          {
            type: 'fix',
            title: 'Modal de zoom de imagens responsivo',
            description: 'O modal para visualizar imagens ampliadas (assinaturas/fotos) foi ajustado com padding e margens adaptativas para melhor visualização em telas pequenas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.82',
    date: '2025-01-18',
    summary: 'Assinaturas responsivas no painel e em dispositivos móveis',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'fix',
            title: 'Layout da lista adaptado ao mobile',
            description: 'As linhas da listagem de solicitações de assinatura agora empilham informações e mantêm os badges acessíveis em telas pequenas, evitando overflow lateral.',
          },
          {
            type: 'improvement',
            title: 'Modal de detalhes responsivo',
            description: 'O modal de detalhes das solicitações ganhou padding fluido, título compactado e altura máxima de 90vh para não estourar em celulares.',
          },
          {
            type: 'improvement',
            title: 'Canvas de assinatura com largura fluida',
            description: 'O componente SignatureCanvas passa a ajustar automaticamente a largura/altura conforme o container, facilitando a assinatura com o dedo no celular.',
          },
          {
            type: 'fix',
            title: 'Toolbar do posicionador sempre visível',
            description: 'Botões de zoom/paginação do posicionador ficaram centralizados e com estados claros independente da largura da viewport.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.81',
    date: '2025-01-18',
    summary: 'Assinatura: documento responsivo no celular',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'fix',
            title: 'Visualização DOCX responsiva',
            description: 'Na página pública de assinatura, documentos DOCX agora são escalados automaticamente para caber na tela do celular.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.80',
    date: '2025-01-18',
    summary: 'Link de preenchimento: botão Copiar mais visível',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Contraste do botão Copiar',
            description: 'Ajustado o estilo do botão Copiar no modal do Link de Preenchimento para não ficar branco/invisível.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.79',
    date: '2025-01-18',
    summary: 'Link de preenchimento: botão Copiar ao lado do campo',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Copiar ao lado do link (mais visível)',
            description: 'No modal do Link de Preenchimento, o botão Copiar fica ao lado do campo do link para facilitar o uso.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.78',
    date: '2025-01-18',
    summary: 'Relatório de assinatura: ocultar e-mail interno',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Suprimir e-mail placeholder no histórico',
            description: 'No PDF/relatório de assinatura, e-mails do tipo public+...@crm.local não são exibidos para evitar confusão.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.77',
    date: '2025-01-18',
    summary: 'Link de preenchimento: copiar ao lado do link',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Botão de copiar ao lado do link',
            description: 'No modal do Link de Preenchimento, o botão de copiar fica ao lado do campo do link para facilitar o envio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.76',
    date: '2025-01-18',
    summary: 'Clientes: seleção em massa mais discreta',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Selecionar ao lado de Mostrar filtros',
            description: 'A barra de ações (Selecionar todos/Limpar/Desativar selecionados) agora aparece apenas após ativar o modo Selecionar, com layout mais discreto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.75',
    date: '2025-01-18',
    summary: 'CEP: corrigido retorno para trocar CEP',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão "Não" volta para editar o CEP',
            description: 'Ao confirmar endereço pelo CEP e marcar "Não", o sistema limpa o CEP/endereço e retorna para permitir digitar um novo CEP.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.74',
    date: '2025-01-18',
    summary: 'Templates públicos: cria cliente ao encaminhar para assinatura',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Criar/associar cliente automaticamente no fluxo público',
            description: 'Ao enviar um template pelo link público, o sistema cria/atualiza o cliente (status ativo) e salva o client_id na solicitação de assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.73',
    date: '2025-01-18',
    summary: 'Clientes: seleção em massa e ordenação',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'feature',
            title: 'Selecionar e desativar em massa',
            description: 'Adicionado modo Selecionar com checkboxes, ações Selecionar todos/Limpar e botão para desativar clientes selecionados.',
          },
          {
            type: 'improvement',
            title: 'Ordenação Mais novos / Mais antigos',
            description: 'Adicionado filtro simples de ordenação na listagem de clientes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.72',
    date: '2025-01-18',
    summary: 'Clientes: CPF/CNPJ com máscara na listagem',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'fix',
            title: 'CPF e CNPJ exibidos com máscara',
            description: 'A listagem de clientes agora aplica máscara automaticamente ao CPF/CNPJ (ex.: 292.779.731-53).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.71',
    date: '2025-01-18',
    summary: 'Clientes: filtro por data de criação',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'feature',
            title: 'Filtro "Criado de" e "Criado até"',
            description: 'Adicionado filtro por período de criação (de/até) na listagem de clientes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.70',
    date: '2025-01-18',
    summary: 'Documentos: ações de copiar no link de preenchimento',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Segundo botão de copiar (sem WhatsApp)',
            description: 'No modal do Link de Preenchimento, removido botão de WhatsApp e adicionado um segundo botão (ícone) ao lado de Copiar para facilitar a ação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.69',
    date: '2025-01-18',
    summary: 'Documentos: compartilhar link por WhatsApp',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Botão WhatsApp ao lado de Copiar',
            description: 'No modal do Link de Preenchimento, adicionado botão para abrir o WhatsApp com mensagem pronta e o link.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.68',
    date: '2025-01-18',
    summary: 'Assinatura: modo selecionar na lista',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Botão "Selecionar" ao lado de Filtros',
            description: 'Adicionado botão Selecionar na toolbar para ativar/desativar o modo de seleção (checkboxes aparecem somente após clicar). Ao desativar, a seleção é limpa.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.67',
    date: '2025-01-18',
    summary: 'Assinatura: seleção múltipla na lista',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'feature',
            title: 'Selecionar vários documentos e excluir em lote',
            description: 'Adicionado checkbox nos cards/linhas (pendentes/concluídos) com ações de Selecionar todos, Limpar e Excluir selecionados (remove do painel/arquiva).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.66',
    date: '2025-01-18',
    summary: 'Git: correção do hook de versionamento',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Pre-commit não falha mais ao ler package.json staged',
            description: 'Corrigido script scripts/verify-version-changelog.cjs para usar `git show :<arquivo>` ao ler arquivos no stage (evita erro "ambiguous argument ::package.json").',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.65',
    date: '2025-01-18',
    summary: 'Documentos: botão de geração melhorado',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Gerar documentos (novo botão)',
            description: 'Renomeado de "Gerar documento Word" para "Gerar documentos" e aplicado visual com gradiente/sombra e estados de loading/disabled mais claros.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.64',
    date: '2025-01-18',
    summary: 'Templates: botão Editar restaurado',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Ação de editar voltou para o card',
            description: 'Na tela de gerenciamento de templates, o botão Editar foi adicionado novamente nos cards para acesso rápido ao modal de edição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.63',
    date: '2025-01-18',
    summary: 'Templates: opção para habilitar parte contrária',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'feature',
            title: 'Habilitar/ocultar campo de parte contrária por template',
            description: 'Na configuração do template, adicionado toggle para habilitar a Parte contrária (Réu). Quando desativado, o campo não aparece na geração e o placeholder [[réu]] fica vazio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.62',
    date: '2025-01-18',
    summary: 'Nova tela de geração de documentos',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Tela "Novo documento" redesenhada',
            description: 'Layout em duas colunas com seleção visual de templates em cards, formulário mais intuitivo e feedback visual aprimorado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.61',
    date: '2025-01-18',
    summary: 'Reorganização visual da tela de templates',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Nova interface de gerenciamento de templates',
            description: 'Templates agora são exibidos em cards organizados em grid, com ações agrupadas por categoria (principais e secundárias) para melhor experiência.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.60',
    date: '2025-01-18',
    summary: 'Correção definitiva do botão Salvar no modal de configuração',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão "Salvar configuração" agora sempre visível',
            description: 'Aplicado estilo inline para garantir que o botão apareça corretamente independente do tema (dark mode estava sobrescrevendo as classes Tailwind).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.59',
    date: '2025-01-18',
    summary: 'Assinatura: seleção múltipla de arquivos no upload',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'feature',
            title: 'Selecionar todos e excluir selecionados',
            description: 'Na etapa de upload do módulo de assinatura, agora é possível selecionar arquivos (checkbox), selecionar todos, limpar seleção e excluir os selecionados de uma vez.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.58',
    date: '2025-01-18',
    summary: 'Configuração do link público: botão salvar visível',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão “Salvar configuração” com melhor contraste',
            description: 'No modal de configuração do link público, o botão de salvar agora permanece visível e legível mesmo quando está desabilitado (carregando).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.57',
    date: '2025-01-18',
    summary: 'Tema: modal de documentos ajustado para o modo claro',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Modal de gerenciar documentos não fica mais preto',
            description: 'O modal de gerenciamento de documentos do template agora força fundo branco e cores do tema claro, evitando contraste ruim no painel.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.56',
    date: '2025-01-18',
    summary: 'Painel de Documentos: melhor visibilidade e gestão de anexos',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Resumo de principal + anexos nos templates',
            description: 'A listagem de templates agora mostra um resumo “principal + X anexo(s)” para facilitar a conferência rápida.',
          },
          {
            type: 'improvement',
            title: 'Gerenciador de arquivos com destaque e download',
            description: 'No gerenciador de documentos do template, o arquivo principal agora é destacado e cada item possui ação de download.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.55',
    date: '2025-01-18',
    summary: 'Melhoria no painel: loading do link de preenchimento por template',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Spinner não aparece em todos os templates',
            description: 'Ao gerar o link público de preenchimento, o estado de carregamento agora fica apenas no template selecionado, evitando confusão visual no painel.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.54',
    date: '2025-01-18',
    summary: 'Template-fill agora inclui anexos do template',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Anexos incluídos na solicitação de assinatura',
            description: 'Ao gerar documentos via link público (template-fill), os arquivos anexos do template agora também são renderizados e incluídos em attachment_paths, aparecendo na assinatura pública.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.53',
    date: '2025-01-18',
    summary: 'Link fixo reutilizável para WhatsApp (permalinks)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'feature',
            title: 'Permalinks: links fixos que nunca expiram',
            description: 'Novo sistema de permalinks permite criar um link fixo (ex: /p/procuracao-inss) que pode ser compartilhado no WhatsApp. Cada acesso gera um token único internamente, então o link nunca "morre" após uso.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.52',
    date: '2025-01-18',
    summary: 'Correção na geração de documento (arquivo principal vs anexos)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Geração agora usa o documento principal',
            description: 'Corrigido bug onde a geração de documento via link público usava o primeiro anexo em vez do arquivo principal do template. Agora prioriza corretamente template.file_path.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.51',
    date: '2025-01-18',
    summary: 'Validação mais rígida para CPF e Telefone no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Não avança com CPF/Telefone incompletos',
            description: 'No preenchimento público, CPF e Telefone agora são validados por quantidade de dígitos (máscara não conta como preenchimento). Assim o usuário não consegue avançar/submeter com valores incompletos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.50',
    date: '2025-01-18',
    summary: 'Formulário público com cores do tema do CRM',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Captura de informações com identidade visual do CRM',
            description: 'O preenchimento público (nome/CPF/telefone/endereço) foi padronizado para usar a paleta laranja do CRM nos botões, foco de inputs, progresso e estados selecionados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.49',
    date: '2025-01-18',
    summary: 'Preview de PDF com múltiplas páginas na assinatura pública',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'PDF preview agora mostra todas as folhas',
            description: 'Na página pública de assinatura, o preview em PDF não limita mais a visualização à primeira folha. O viewer voltou a permitir rolagem entre múltiplas páginas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.48',
    date: '2025-01-18',
    summary: 'Correções na geração de documento (nome e páginas)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'PDF agora gera todas as páginas do DOCX',
            description: 'Corrigido um retorno prematuro na conversão DOCX→PDF que fazia o compilado parar na primeira página. Agora o processo percorre todas as páginas/seções do documento.',
          },
          {
            type: 'fix',
            title: 'Nome do signatário não pode virar CEP/NCEP',
            description: 'Blindagem na detecção do campo de nome no formulário público para impedir que placeholders de endereço/CEP (ex.: NCEP/CEP) sejam utilizados como nome na geração do documento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.47',
    date: '2025-01-18',
    summary: 'Rodapé do PDF com link de verificação',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Link para verificar autenticidade no rodapé',
            description: 'No PDF assinado (rodapé com Hash e Código), foi incluído também o link “Verificar” para conferência da autenticidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.46',
    date: '2025-01-18',
    summary: 'Endereço guiado: confirmação do ViaCEP e quadra opcional',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Fluxo de CEP com confirmação',
            description: 'No preenchimento público, após informar o CEP o sistema exibe o endereço encontrado e pergunta se está correto (Sim/Não). Se confirmado, prossegue para Número.',
          },
          {
            type: 'improvement',
            title: 'Quadra opcional',
            description: 'Após informar o número, o formulário pergunta “Tem quadra?”. Se sim, exibe o campo Quadra (Complemento). Se não, pula essa etapa e não exige o complemento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.45',
    date: '2025-01-18',
    summary: 'Ordem do formulário corrigida (CEP só na etapa de endereço)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Fluxo normal antes do CEP',
            description: 'O preenchimento público voltou a seguir a ordem normal (nome, CPF, etc.) e só exibe a etapa de CEP/endereço quando chega na parte de endereço do template, em vez de iniciar o formulário pelo CEP.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.44',
    date: '2025-01-18',
    summary: 'Endereço com CEP primeiro e detalhes mínimos',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'CEP primeiro + pedir só o que faltar',
            description: 'No preenchimento público, o endereço agora começa pedindo apenas o CEP. Após a busca no ViaCEP, o formulário solicita somente os campos que não forem preenchidos automaticamente (ex.: Número e Complemento — exibido como “Quadra”; Rua/Bairro só aparecem se não vierem do ViaCEP).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.43',
    date: '2025-01-18',
    summary: 'Etapa de endereço mais compacta no mobile',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Endereço com menos campos visíveis',
            description: 'Na etapa Endereço do preenchimento público, os campos foram reduzidos para CEP, Endereço (rua), Número, Complemento e Bairro. Cidade/Estado continuam sendo preenchidos automaticamente via CEP quando existirem no template, mas não são exibidos nem bloqueiam o envio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.42',
    date: '2025-01-18',
    summary: 'Endereço em uma etapa e envio automático no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Endereço em uma única tela',
            description: 'No preenchimento público, os campos de endereço (CEP, rua, número, complemento, bairro, cidade, estado) agora aparecem juntos na mesma etapa, com busca automática via CEP (ViaCEP).',
          },
          {
            type: 'improvement',
            title: 'Envio automático ao finalizar',
            description: 'A etapa final deixou de exigir clique em “Gerar documento”. Ao chegar no final do preenchimento, o sistema envia automaticamente e redireciona para a assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.41',
    date: '2025-01-18',
    summary: 'Etapa de dados mantida no fluxo normal de assinatura',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Só pula Nome/CPF/Telefone quando vier do template-fill',
            description: 'O PublicSigningPage volta a solicitar nome/CPF/telefone no fluxo normal. A etapa de dados só é pulada quando o signatário foi criado via template-fill (prefill) e já está com os dados mínimos completos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.40',
    date: '2025-01-18',
    summary: 'Redirecionamento automático para assinatura',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Após finalizar, vai direto para a página de assinatura',
            description: 'Ao concluir o preenchimento público, o sistema agora redireciona automaticamente para /#/assinar/{token}, eliminando a etapa intermediária de copiar o link de assinatura (mantém link de fallback caso o redirecionamento falhe).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.39',
    date: '2025-01-18',
    summary: 'Mensagens de erro claras no template-fill',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Erros do template-fill agora aparecem com mensagem real',
            description: 'A Edge Function template-fill foi ajustada para retornar {success:false,error} em HTTP 200 e logar detalhes no console, evitando o “400 Bad Request” genérico no frontend e facilitando o diagnóstico.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.38',
    date: '2025-01-18',
    summary: 'DATA não é solicitada no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Campo [[DATA]] não aparece no formulário mesmo configurado',
            description: 'O placeholder DATA agora é sempre removido da lista de etapas do preenchimento público (inclusive quando estiver configurado como obrigatório no template). A data continua sendo preenchida automaticamente com a data do sistema no momento do envio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.37',
    date: '2025-01-18',
    summary: 'Correção no select em lista (auto-avançar)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Selecionar opção não exibe erro indevido',
            description: 'Corrigida condição de corrida no select em lista: ao tocar em uma opção, o valor é aplicado e a etapa avança sem disparar a validação com estado antigo, evitando a mensagem “Preencha este campo para continuar.”',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.36',
    date: '2025-01-18',
    summary: 'Seleção com opções visíveis no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Campos de seleção sem dropdown',
            description: 'No preenchimento público, campos do tipo "select" agora exibem as opções diretamente na tela (lista de botões), evitando abrir dropdown/modal e permitindo escolher com 1 toque, com avanço automático.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.35',
    date: '2025-01-18',
    summary: 'Auto-avançar em campos de seleção no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Seleção avança automaticamente',
            description: 'No preenchimento público (Typeform), campos do tipo "select" avançam automaticamente para a próxima etapa assim que uma opção é selecionada, sem precisar clicar em "Próximo".',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.34',
    date: '2025-01-18',
    summary: 'Nome em maiúsculas no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Nome completo agora força MAIÚSCULAS',
            description: 'No preenchimento público, o campo de identificação (signer_name) e campos configurados com tipo "name" passam a forçar o texto em maiúsculas durante a digitação, padronizando o nome no documento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.33',
    date: '2025-01-18',
    summary: 'Correção de design: removido visual IA, design 100% mobile-first compatível com tema CRM.',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Redesenho completo da página pública de preenchimento',
            description: 'Correção drástica no design da página pública de preenchimento: removido completamente visual artificial de IA, gradientes, headers, logos, ícones, sombras e excessos. Design 100% mobile-first, compatível com tema CRM: fundo slate-50 simples, bordas padrão, tipografia menor (base text-sm), botões simples, inputs compactos, padding reduzido. Foco total em responsividade e usabilidade mobile, sem elementos que destoem do restante do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.32',
    date: '2025-01-18',
    summary: 'Redesenho profissional da página pública de preenchimento',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Redesenho completo da página pública de preenchimento',
            description: 'Redesenho completo da página pública de preenchimento (PublicTemplateFillPage) com visual profissional de plataforma de assinatura: header com logo Jurius, fundo gradiente sutil, tipografia refinada, ícones contextuais, botões com hover/active states, micro-interações, sombras e layout totalmente responsivo. Melhorias de UX: loading centralizado com ícone animado, erros com ícones visuais, progresso com gradiente animado e campos com focus ring emerald. Removido rodapé redundante e centralizado versão no header. Reforço de identidade visual similar a plataformas de e-signature estabelecidas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.31',
    date: '18/12/2025',
    summary: 'Correções de constraint e DATA no formulário público',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Banco agora aceita tipos name/cpf/phone/cep no template_custom_fields',
            description: 'Adicionada migration para atualizar o CHECK constraint de field_type em template_custom_fields, evitando erro ao salvar configuração do link público.',
          },
          {
            type: 'fix',
            title: 'Placeholder DATA aparece no modal e é inferido como Data',
            description: 'A configuração do link público não filtra mais [[DATA]] e também detecta DATA/DATA_*/DATA * como tipo Data automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.30',
    date: '18/12/2025',
    summary: 'Tipos de CPF/Telefone/Nome/CEP no link público',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Configuração do link público com tipos de identificação e CEP',
            description: 'Adicionadas opções de tipo CPF, Telefone, Nome e CEP na configuração do link público do template. Isso permite mapear placeholders mesmo com nomes diferentes e melhorar o preenchimento/integrações.',
          },
        ],
      },
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Máscaras e ViaCEP por tipo configurado',
            description: 'O formulário público aplica máscara/teclado adequado para CPF, telefone e CEP, e o ViaCEP passa a ser acionado pelo campo configurado como CEP (não depende do placeholder se chamar exatamente CEP).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.29',
    date: '18/12/2025',
    summary: 'Progresso mais simples no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Removido “0/14 obrigatórios” e substituído por percentual',
            description: 'O formulário público agora exibe um progresso percentual (suavizado) para uma experiência mais leve; as validações de campos obrigatórios continuam funcionando normalmente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.28',
    date: '18/12/2025',
    summary: 'Botão Salvar sempre visível no modal',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Salvar não fica “invisível” quando bloqueado',
            description: 'O botão de salvar na configuração do link público deixou de usar o atributo disabled (que deixava o botão apagado demais) e passou a usar bloqueio por clique + opacidade, mantendo a visibilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.27',
    date: '18/12/2025',
    summary: 'Salvar sempre visível na configuração do link público',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão Salvar disponível no topo do modal',
            description: 'Adicionado botão de salvar no cabeçalho do modal de configuração do link público para garantir acesso mesmo quando o rodapé não estiver visível por scroll/tela menor.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.26',
    date: '18/12/2025',
    summary: 'Cabeçalho do preenchimento público mais limpo',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Removido indicador "Etapa" (1/N) no cabeçalho',
            description: 'O cabeçalho do preenchimento público ficou mais clean removendo o bloco de etapa; o progresso permanece na barra.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.25',
    date: '18/12/2025',
    summary: 'Interface mais limpa no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Removido indicador de placeholder na tela do cliente',
            description: 'A linha "Obrigatório/Opcional · [[PLACEHOLDER]]" foi removida do formulário público para deixar a experiência mais limpa e profissional.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.24',
    date: '18/12/2025',
    summary: 'UI do preenchimento público mais leve e elegante',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Layout do formulário público mais “magro”',
            description: 'Ajustados tamanhos de fonte, espaçamentos, altura de inputs/botões, sombras e larguras para deixar o preenchimento público mais leve visualmente, sem perder legibilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.23',
    date: '18/12/2025',
    summary: 'Formulário público pergunta apenas o que existe no documento',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Removido campo “fantasma” (ex: email) quando não existe no template',
            description: 'O link público agora considera a interseção entre os campos configurados e os placeholders extraídos do DOCX, impedindo que campos antigos salvos na configuração apareçam no formulário quando não existem no documento.',
          },
          {
            type: 'improvement',
            title: 'Ordem do formulário segue o order configurado',
            description: 'A sequência das perguntas segue a ordem configurada no template (order), sem reagrupamentos que alterem a experiência.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.22',
    date: '18/12/2025',
    summary: 'Ordenação por arrastar e opções pré-definidas no formulário público',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Configuração do formulário do template com ordenação por arrastar',
            description: 'Na configuração do link público do template, agora é possível reordenar os campos arrastando (drag-and-drop), persistindo a ordem no formulário público.',
          },
          {
            type: 'feature',
            title: 'Campos do tipo seleção com opções pré-definidas (presets)',
            description: 'Você pode configurar campos como "Seleção" e definir opções (1 por linha). Para placeholders como "estado civil" e "nacionalidade", há presets prontos (editáveis).',
          },
        ],
      },
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Formulário público usa opções e tipo definidos no template',
            description: 'O preenchimento público agora prioriza as configurações do template (tipo e opções) ao renderizar campos, permitindo selects customizados por template.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.21',
    date: '18/12/2025',
    summary: 'Campos dinâmicos no preenchimento público e assinatura mais direta',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Preenchimento público pede apenas campos habilitados do template',
            description: 'O formulário público passa a respeitar o flag "enabled" dos campos do template e não força etapas fixas (email/CPF/telefone) quando não existirem no documento.',
          },
          {
            type: 'improvement',
            title: 'Assinatura pública reaproveita dados do signatário e pode pular a etapa de dados',
            description: 'Quando nome/CPF/telefone já estiverem disponíveis no bundle público, o modal segue direto para a etapa de assinatura após autenticação.',
          },
          {
            type: 'fix',
            title: 'Email do signatário opcional no submit de template-fill',
            description: 'O backend aceita email opcional no fluxo público, gerando um email interno somente para satisfazer a restrição do banco, sem persistir no cadastro do cliente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.20',
    date: '18/12/2025',
    summary: 'UI Typeform no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Formulário público com visual leve e alinhado ao CRM',
            description: 'A tela de preenchimento público foi redesenhada para experiência Typeform (1 pergunta por vez), com layout mais leve, card central e estilo consistente com o tema do CRM.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.19',
    date: '18/12/2025',
    summary: 'Correção na identificação de placeholders em DOCX',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Detecção completa de [[...]] em templates DOCX',
            description: 'A extração de placeholders agora varre document.xml + header/footer do DOCX para garantir que todos os [[...]] sejam identificados (ex: [[reu]] em cabeçalho/rodapé).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.18',
    date: '18/12/2025',
    summary: 'Data automática e detecção de telefone no preenchimento público',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Placeholder DATA preenchido automaticamente',
            description: 'O campo [[data]] agora é definido automaticamente com a data atual no momento do envio para assinatura (não é mais solicitado ao cliente no formulário público).',
          },
          {
            type: 'improvement',
            title: 'Telefone detectado automaticamente para autenticação',
            description: 'O telefone do signatário é inferido automaticamente (signer.phone, ou fallback para [[telefone]]/[[celular]]) para suportar autenticação por telefone quando necessário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.17',
    date: '18/12/2025',
    summary: 'Configuração do formulário público por template',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'feature',
            title: 'Editor de campos do link público (por template)',
            description: 'Adicionada opção de configurar o formulário público por template, permitindo editar título (label), descrição/ajuda e marcar se o campo é obrigatório. As configurações ficam salvas em template_custom_fields e são respeitadas no preenchimento público (Typeform).',
          },
          {
            type: 'fix',
            title: 'Suporte a description em template_custom_fields',
            description: 'Criada migration para adicionar a coluna description em template_custom_fields, habilitando ajuda/descrição por campo no formulário público.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.16',
    date: '18/12/2025',
    summary: 'Preenchimento estilo Typeform (1 pergunta por etapa)',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Experiência Typeform no preenchimento público',
            description: 'A página pública de preenchimento agora é um fluxo multi-etapas (1 campo por vez), com navegação Voltar/Próximo, Enter para avançar, validação por etapa e indicador de progresso.',
          },
          {
            type: 'improvement',
            title: 'ViaCEP integrado ao passo de CEP',
            description: 'O autopreenchimento ViaCEP foi mantido e funciona no passo do CEP, preenchendo endereço/bairro/cidade/UF automaticamente quando aplicável.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.15',
    date: '18/12/2025',
    summary: 'Página pública de preenchimento responsiva + ViaCEP',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Formulário público mais responsivo e interativo',
            description: 'A página de preenchimento foi reorganizada em seções (Identificação/Endereço/Dados do documento), com layout mobile-first, barra de progresso e card lateral com orientações.',
          },
          {
            type: 'feature',
            title: 'Autopreenchimento de endereço por CEP (ViaCEP)',
            description: 'Ao informar um CEP válido (8 dígitos), o sistema consulta a API ViaCEP e preenche automaticamente logradouro, bairro, cidade e UF (sem sobrescrever valores já digitados).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.14',
    date: '18/12/2025',
    summary: 'Link público de preenchimento (estilo ZapSign) e assinatura automática',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'feature',
            title: 'Link público para preenchimento e envio para assinatura',
            description: 'Criada rota pública de preenchimento (/#/preencher/:token), Edge Function para gerar DOCX preenchido e iniciar a solicitação de assinatura automaticamente, retornando o link de assinatura.',
          },
          {
            type: 'improvement',
            title: 'Campos de assinatura gerados automaticamente',
            description: 'A Edge Function cria registros em signature_fields a partir do signature_field_config do template, garantindo posicionamento consistente para a assinatura pública.',
          },
        ],
      },
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Suporte a document_id em signature_fields',
            description: 'Adicionada migration para incluir signature_fields.document_id (default main), alinhando banco com serviços de assinatura/PDF e suporte a múltiplos documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.13',
    date: '17/12/2025',
    summary: 'Introdução com fundo mais escuro',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'improvement',
            title: 'Fundo do overlay mais escuro',
            description: 'Ajustado o overlay de login/logout para um fundo mais escuro com camada de escurecimento sobre os brilhos, melhorando contraste e mantendo o visual premium.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.12',
    date: '17/12/2025',
    summary: 'Refino final da introdução',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'improvement',
            title: 'Refinamentos visuais na introdução',
            description: 'Ajustes sutis na introdução: micro-animação de flutuação no logo, divisor elegante abaixo da marca e barra de carregamento com melhor presença/contraste, mantendo o visual leve e profissional.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.11',
    date: '17/12/2025',
    summary: 'Introdução premium com animação mais fluida',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'improvement',
            title: 'Introdução mais profissional (login/logout)',
            description: 'Overlay de login/logout com card glass refinado, hierarquia visual aprimorada e partículas estáveis (sem variação aleatória a cada render), trazendo sensação premium e consistência na animação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.10',
    date: '17/12/2025',
    summary: 'Versão atual baseada no Changelog',
    modules: [
      {
        moduleId: 'docs',
        changes: [
          {
            type: 'fix',
            title: 'Versão Atual sincronizada com a última release',
            description: 'A página de documentação agora considera a última versão do changelog como referência para exibir "Versão Atual" e codinome, evitando divergência visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.9',
    date: '17/12/2025',
    summary: 'Versão automática em rodapés e PDFs',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Rodapé do sistema sempre atualizado automaticamente',
            description: 'Padronizado o uso de v{__APP_VERSION__} para evitar versão manual/hardcoded em telas e rodapés.',
          },
        ],
      },
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Versão no rodapé do PDF assinado',
            description: 'O carimbo/rodapé do PDF agora inclui a versão do sistema (Jurius v{__APP_VERSION__}) para rastreabilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.8',
    date: '17/12/2025',
    summary: 'Documentação completa do sistema e melhorias na navegação',
    modules: [
      {
        moduleId: 'docs',
        changes: [
          {
            type: 'feature',
            title: 'Documentação completa do sistema',
            description: 'Nova aba "Guia do Sistema" com documentação detalhada de todos os módulos: Dashboard, Processos, Clientes, Prazos, Financeiro, Documentos, Assinaturas, Agenda, Tarefas, Intimações, Leads e Configurações.',
          },
          {
            type: 'feature',
            title: 'Codinomes de versão',
            description: 'Cada versão agora tem um codinome inspirado em tipos de café brasileiro (Espresso, Lungo, Cappuccino, etc.).',
          },
          {
            type: 'improvement',
            title: 'Busca e filtros no changelog',
            description: 'Campo de busca para encontrar alterações específicas e filtro por módulo para navegação rápida.',
          },
          {
            type: 'improvement',
            title: 'Navegação por abas',
            description: 'Interface reorganizada com abas: Changelog e Guia do Sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.7',
    date: '17/12/2025',
    summary: 'Documentação profissional com changelog organizado por módulos',
    modules: [
      {
        moduleId: 'docs',
        changes: [
          {
            type: 'improvement',
            title: 'Changelog profissional e bem documentado',
            description: 'Página de alterações completamente redesenhada com separação por módulos, ícones específicos, tipos de alteração (feature/fix/improvement) e documentação inline para desenvolvedores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.6',
    date: '17/12/2025',
    summary: 'Organização inicial do changelog por módulos',
    modules: [
      {
        moduleId: 'docs',
        changes: [
          {
            type: 'improvement',
            title: 'Changelog agrupado por módulo',
            description: 'Primeira versão do changelog organizado, separando alterações por área do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.5',
    date: '17/12/2025',
    summary: 'Governança de código com enforcement de changelog',
    modules: [
      {
        moduleId: 'dev',
        changes: [
          {
            type: 'feature',
            title: 'Hook de pre-commit obrigatório',
            description: 'Implementado git hook que bloqueia commits se package.json (versão) e DocsChangesPage.tsx (changelog) não forem atualizados juntos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.4',
    date: '17/12/2025',
    summary: 'Melhorias no preview de compartilhamento',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'fix',
            title: 'Cache-bust em og:image',
            description: 'Adicionado parâmetro de versão nas meta tags og:image e twitter:image para forçar atualização do cache em mensageiros.',
          },
          {
            type: 'improvement',
            title: 'Apple Touch Icon atualizado',
            description: 'Ícone para dispositivos Apple agora usa o favicon SVG do Jurius.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.3',
    date: '17/12/2025',
    summary: 'Identidade visual Jurius nos metadados',
    modules: [
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'improvement',
            title: 'Metadados OG/Twitter atualizados',
            description: 'Título, descrição e imagem de preview agora usam a identidade Jurius em vez do nome antigo.',
          },
          {
            type: 'feature',
            title: 'Novos arquivos de ícone',
            description: 'Criados favicon.svg e og-image.svg com a marca Jurius (letra J em fundo laranja).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.2',
    date: '17/12/2025',
    summary: 'Compartilhamento de PDF como arquivo',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Compartilhar documento como arquivo PDF',
            description: 'Ao compartilhar documento assinado, o sistema agora tenta enviar o arquivo PDF diretamente via Web Share API (com fallback para link).',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.1',
    date: '17/12/2025',
    summary: 'Responsividade e versionamento',
    modules: [
      {
        moduleId: 'relatorio-assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Layout responsivo para mobile',
            description: 'Relatório de assinatura agora se adapta corretamente a telas pequenas: paddings ajustados, botões full-width, textos com quebra automática.',
          },
        ],
      },
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Versão exibida no rodapé',
            description: 'Versão do sistema (vinda do package.json) agora aparece no rodapé do layout principal.',
          },
          {
            type: 'feature',
            title: 'Página de Alterações (#/docs)',
            description: 'Nova rota pública para visualizar o histórico de versões e alterações do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '17/12/2025',
    summary: 'Release inicial com melhorias na assinatura pública',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Telas de erro e sucesso no tema do sistema',
            description: 'Telas de link inválido/expirado e confirmação de assinatura redesenhadas com a paleta laranja do Jurius.',
          },
          {
            type: 'feature',
            title: 'Pré-autorização de câmera',
            description: 'Antes de ativar a câmera para verificação facial, o sistema agora exibe uma tela explicativa pedindo permissão explícita do usuário.',
          },
        ],
      },
      {
        moduleId: 'branding',
        changes: [
          {
            type: 'fix',
            title: 'Correção de branding (Jurius)',
            description: 'Substituídas todas as ocorrências de "Juris" por "Jurius" nos componentes públicos e relatórios.',
          },
          {
            type: 'improvement',
            title: 'Tema laranja nos modais e relatórios',
            description: 'Ajustes visuais para garantir consistência da paleta de cores em todo o sistema.',
          },
        ],
      },
    ],
  },
];

/* ============================================================================
   COMPONENTE PRINCIPAL
   ============================================================================ */

type TabType = 'changelog' | 'guide';

const DocsChangesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('changelog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const latestRelease = releases[0];
  const latestVersion = latestRelease?.version ?? __APP_VERSION__;
  const latestCodename = getCodename(latestVersion);

  // Filtrar releases baseado na busca e módulo selecionado
  const filteredReleases = useMemo(() => {
    return releases.filter((release) => {
      const matchesSearch = searchQuery === '' || 
        release.version.toLowerCase().includes(searchQuery.toLowerCase()) ||
        release.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        getCodename(release.version).name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        release.modules.some((mod) =>
          mod.changes.some((change) =>
            change.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            change.description?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        );

      const matchesModule = selectedModule === null ||
        release.modules.some((mod) => mod.moduleId === selectedModule);

      return matchesSearch && matchesModule;
    });
  }, [searchQuery, selectedModule]);

  const toggleModuleExpand = (moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-white to-orange-50/30">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-slate-200/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a
              href="#/"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar ao sistema</span>
              <span className="sm:hidden">Voltar</span>
            </a>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
                <Scale className="w-4 h-4 text-white" />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-semibold text-slate-900">Jurius</div>
                <div className="text-[10px] text-slate-500 -mt-0.5">Documentação</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="sticky top-16 z-10 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 py-2">
            <button
              onClick={() => setActiveTab('changelog')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'changelog'
                  ? 'bg-orange-100 text-orange-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <History className="w-4 h-4" />
              Changelog
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'guide'
                  ? 'bg-orange-100 text-orange-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Guia do Sistema
            </button>
          </nav>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'changelog' ? (
          <>
            {/* Hero Section - Changelog */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold mb-4">
                <Coffee className="w-3.5 h-3.5" />
                v{latestVersion} "{latestCodename.name}" {latestCodename.emoji}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
                Histórico de Alterações
              </h1>
              <p className="mt-3 text-slate-600 max-w-2xl mx-auto text-sm">
                Cada versão tem um codinome inspirado em tipos de café ☕
              </p>
            </div>

            {/* Search and Filters */}
            <div className="mb-8 space-y-4">
              {/* Search Bar */}
              <div className="relative max-w-md mx-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar alterações..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Module Filters */}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setSelectedModule(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    selectedModule === null
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Todos
                </button>
                {CHANGELOG_MODULES.map((mod) => {
                  const Icon = mod.icon;
                  return (
                    <button
                      key={mod.id}
                      onClick={() => setSelectedModule(selectedModule === mod.id ? null : mod.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        selectedModule === mod.id
                          ? `${mod.color.bg} text-white`
                          : `${mod.color.light} ${mod.color.text} hover:opacity-80`
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {mod.name}
                    </button>
                  );
                })}
              </div>

              {/* Results count */}
              {(searchQuery || selectedModule) && (
                <p className="text-center text-xs text-slate-500">
                  {filteredReleases.length} {filteredReleases.length === 1 ? 'versão encontrada' : 'versões encontradas'}
                </p>
              )}
            </div>

            {/* Timeline de Releases */}
            <div className="relative">
              <div className="absolute left-4 sm:left-6 top-0 bottom-0 w-px bg-gradient-to-b from-orange-300 via-slate-200 to-transparent" />

              <div className="space-y-6">
                {filteredReleases.map((release, idx) => {
                  const codename = getCodename(release.version);
                  return (
                    <article key={release.version} className="relative pl-12 sm:pl-16">
                      <div className="absolute left-0 sm:left-2 top-1 w-8 h-8 rounded-full bg-white border-2 border-orange-400 flex items-center justify-center shadow-sm text-lg">
                        {codename.emoji}
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-lg font-bold text-slate-900">v{release.version}</span>
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                                  {codename.name}
                                </span>
                                {idx === 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold uppercase">
                                    Atual
                                  </span>
                                )}
                              </div>
                              {release.summary && (
                                <p className="text-sm text-slate-600 mt-1">{release.summary}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Calendar className="w-3.5 h-3.5" />
                              {release.date}
                            </div>
                          </div>
                        </div>

                        <div className="p-5 space-y-4">
                          {release.modules.map((mod) => {
                            const config = getModuleConfig(mod.moduleId);
                            const ModIcon = config.icon;

                            return (
                              <div key={mod.moduleId} className={`rounded-xl border ${config.color.border} overflow-hidden`}>
                                <div className={`px-4 py-2.5 ${config.color.light} border-b ${config.color.border}`}>
                                  <div className="flex items-center gap-2">
                                    <div className={`w-6 h-6 rounded-md ${config.color.bg} flex items-center justify-center`}>
                                      <ModIcon className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <div className={`text-sm font-semibold ${config.color.text}`}>{config.name}</div>
                                  </div>
                                </div>

                                <div className="divide-y divide-slate-100">
                                  {mod.changes.map((change, changeIdx) => {
                                    const typeConfig = CHANGE_TYPE_CONFIG[change.type];
                                    const TypeIcon = typeConfig.icon;

                                    return (
                                      <div key={changeIdx} className="px-4 py-3 hover:bg-slate-50/50 transition">
                                        <div className="flex items-start gap-3">
                                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${typeConfig.color} flex-shrink-0 mt-0.5`}>
                                            <TypeIcon className="w-3 h-3" />
                                            {typeConfig.label}
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-slate-800">{change.title}</div>
                                            {change.description && (
                                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                                {change.description}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {filteredReleases.length === 0 && (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Nenhuma alteração encontrada</p>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedModule(null); }}
                    className="mt-2 text-sm text-orange-600 hover:text-orange-700 font-medium"
                  >
                    Limpar filtros
                  </button>
                </div>
              )}
            </div>

            {/* Footer Info */}
            <div className="mt-12 pt-8 border-t border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <Coffee className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Versão Atual</div>
                      <div className="text-sm font-bold text-slate-900">v{latestVersion} "{latestCodename.name}"</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Versionamento</div>
                      <div className="text-sm font-semibold text-slate-900">Semantic Versioning</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Governança</div>
                      <div className="text-sm font-semibold text-slate-900">Pre-commit Hook</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Hero Section - Guide */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold mb-4">
                <BookOpen className="w-3.5 h-3.5" />
                Documentação
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
                Guia do Sistema
              </h1>
              <p className="mt-3 text-slate-600 max-w-2xl mx-auto text-sm">
                Conheça todos os módulos do Jurius e suas funcionalidades
              </p>
            </div>

            {/* System Modules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SYSTEM_MODULES.map((mod) => {
                const Icon = mod.icon;
                const isExpanded = expandedModules.has(mod.id);

                return (
                  <div
                    key={mod.id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    <button
                      onClick={() => toggleModuleExpand(mod.id)}
                      className="w-full px-5 py-4 flex items-start gap-4 text-left hover:bg-slate-50/50 transition"
                    >
                      <div className={`w-12 h-12 rounded-xl ${mod.color} flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-semibold text-slate-900">{mod.name}</h3>
                          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                        <p className="text-sm text-slate-600 mt-1 line-clamp-2">{mod.description}</p>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-slate-100">
                        <div className="pt-4">
                          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            Funcionalidades
                          </h4>
                          <ul className="space-y-2">
                            {mod.features.map((feature, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                {feature}
                              </li>
                            ))}
                          </ul>

                          {mod.tips && mod.tips.length > 0 && (
                            <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-100">
                              <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <HelpCircle className="w-3 h-3" />
                                Dicas
                              </h4>
                              <ul className="space-y-1">
                                {mod.tips.map((tip, idx) => (
                                  <li key={idx} className="text-xs text-amber-700">• {tip}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Quick Stats */}
            <div className="mt-8 p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-3xl font-bold text-slate-900">{SYSTEM_MODULES.length}</div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Módulos</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-3xl font-bold text-slate-900">
                    {SYSTEM_MODULES.reduce((acc, m) => acc + m.features.length, 0)}
                  </div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Funcionalidades</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-3xl font-bold text-slate-900">{releases.length}</div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Versões</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-3xl font-bold text-slate-900">
                    {releases.reduce((acc, r) => acc + r.modules.reduce((a, m) => a + m.changes.length, 0), 0)}
                  </div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Alterações</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <footer className="mt-12 text-center">
          <p className="text-xs text-slate-400">
            Jurius · Sistema de Gestão Jurídica · v{latestVersion}
          </p>
        </footer>
      </main>
    </div>
  );
};

export default DocsChangesPage;
