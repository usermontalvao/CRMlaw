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
import { matchesNormalizedSearch } from '../utils/search';
// Os tipos e a lista de versões moram em `src/data/releases.ts` — ver o
// cabeçalho de lá para o porquê: são a fonte do aviso de versão, não só desta página.
import { releases } from '../data/releases';
import type { ChangeType } from '../data/releases';

/* ============================================================================
   CODINOMES DAS VERSÕES
   
   Inspirados em tipos de café brasileiro ☕
   Cada versão recebe um codinome divertido e memorável.
   ============================================================================ */

const VERSION_CODENAMES: Record<string, { name: string; emoji: string }> = {
  '1.10.327': { name: 'Cafe Ligacao Com Dono e Com Reforco', emoji: '[phone]' },
  '1.10.326': { name: 'Cafe Microfone Certo na Ligacao', emoji: '[phone]' },
  '1.10.325': { name: 'Cafe Chamada Perdida na Tela', emoji: '[phone]' },
  '1.10.324': { name: 'Cafe Etapa e Documento Lado a Lado', emoji: '[memo]' },
  '1.10.323': { name: 'Cafe Triagem Que Relê a Conversa', emoji: '[memo]' },
  '1.10.316': { name: 'Cafe Login Unico e Email Confirmado', emoji: '[shield]' },
  '1.10.315': { name: 'Cafe Orbita Estavel no Splash', emoji: '[art]' },
  '1.10.314': { name: 'Cafe Editor Blindado e Imagens Persistentes', emoji: '[memo]' },
  '1.10.313': { name: 'Cafe Editor Persistente na Retomada', emoji: '[memo]' },
  '1.10.312': { name: 'Cafe Agenda Coesa e Login Direto', emoji: '[palette]' },
  '1.10.309': { name: 'Cafe Trilha Cronologica Coesa', emoji: '[signature]' },
  '1.10.308': { name: 'Cafe Laudo Seco e Disparo Blindado', emoji: '[signature]' },
  '1.10.304': { name: 'Cafe QR Limpo e Acoes Compactas', emoji: '[signature]' },
  '1.10.303': { name: 'Cafe Envelope Blindado e Auditoria Coesa', emoji: '[signature]' },
  '1.10.302': { name: 'Cafe Protocolo Publico e Verificacao Afinada', emoji: '[signature]' },
  '1.10.301': { name: 'Cafe Relatorio Rico e Trilha Completa', emoji: '[art]' },
  '1.10.300': { name: 'Cafe Certificado Sem Badge Verde', emoji: '[art]' },
  '1.10.299': { name: 'Cafe Checkpoint de Assinatura e Kit em Caixa Alta', emoji: '[signature]' },
  '1.10.298': { name: 'Cafe Kit Assinado com Verificacao por Arquivo', emoji: '[signature]' },
  '1.10.297': { name: 'Cafe Tema Persistente e Templates Afinados', emoji: '[palette]' },
  '1.10.296': { name: 'Cafe Editor Resiliente e Atalhos Blindados', emoji: '[memo]' },
  '1.10.295': { name: 'Cafe Editor com Corretor Local', emoji: '[memo]' },
  '1.10.294': { name: 'Cafe Suspensao Progressiva com PIN Blindado', emoji: '[shield]' },
  '1.10.293': { name: 'Cafe Bloqueio Progressivo com Timer', emoji: '[lock]' },
  '1.10.292': { name: 'Cafe Card de Telefone Refinado', emoji: '[art]' },
  '1.10.291': { name: 'Cafe Blindado Anti-Forca-Bruta', emoji: '[shield]' },
  '1.10.290': { name: 'Cafe Peticao com Barra Profissional', emoji: '[memo]' },
  '1.10.289': { name: 'Cafe Peticao com Texto Integro', emoji: '[memo]' },
  '1.10.288': { name: 'Cafe Showcase com Troca Suave', emoji: '[art]' },
  '1.10.287': { name: 'Cafe Showcase Sem Distorcao', emoji: '[art]' },
  '1.10.286': { name: 'Cafe Rodape Sem Quebra', emoji: '[art]' },
  '1.10.285': { name: 'Cafe Login Sem Scroll', emoji: '[art]' },
  '1.10.284': { name: 'Cafe Login Editorial', emoji: '[art]' },
  '1.10.282': { name: 'Cafe Rascunho Persistente', emoji: '[mail]' },
  '1.10.281': { name: 'Cafe Revisao Contextual', emoji: '[memo]' },
  '1.10.280': { name: 'Cafe Editor Unificado', emoji: '[memo]' },
  '1.10.279': { name: 'Cafe Financeiro em Definicao', emoji: '[coffee]' },
  '1.10.278': { name: 'Cafe WhatsApp Operacional Afinado', emoji: '[green_heart]' },
  '1.10.277': { name: 'Cafe Kit Rastreador', emoji: '[eyes]' },
  '1.10.276': { name: 'Cafe Thread Visivel', emoji: '[speech_balloon]' },
  '1.10.275': { name: 'Cafe Link Publico Direto', emoji: '[link]' },
  '1.10.274': { name: 'Cafe WhatsApp Coeso', emoji: '[green_heart]' },
  '1.10.273': { name: 'Cafe Operacao Afinada', emoji: '[sparkles]' },
  '1.10.272': { name: 'Cafe Auditoria Continua', emoji: '[signature]' },
  '1.10.271': { name: 'Cafe Emails Alinhados', emoji: '[mail]' },
  '1.10.270': { name: 'Cafe Comunicacao Afinada', emoji: '[mail]' },
  '1.10.269': { name: 'Cafe Marca Viva', emoji: '[palette]' },
  '1.10.267': { name: 'Cafe Assinatura Token Scoped', emoji: '[lock]' },
  '1.10.266': { name: 'Cafe Templates Editaveis', emoji: '[edit]' },
  '1.10.265': { name: 'Cafe Assinatura Mobile Blindada', emoji: '[shield]' },
  '1.10.264': { name: 'Cafe Workspace Persistente', emoji: '[window]' },
  '1.10.263': { name: 'Cafe Janelas Orquestradas', emoji: '[window]' },
  '1.10.262': { name: 'Cafe Threads e Centro Operacional Polidos', emoji: '[sparkles]' },
  '1.10.261': { name: 'Cafe Inbox Estrela e Sino Integrados', emoji: '[star]' },
  '1.10.260': { name: 'Cafe Email Operacional Integrado', emoji: '[mail]' },
  '1.10.259': { name: 'Cafe Portal Blindado e DJEN Trancado', emoji: '[shield]' },
  '1.10.258': { name: 'Cafe Sessao Sob Controle do Supabase', emoji: '[lock]' },
  '1.10.257': { name: 'Cafe Assinatura Publica Fortificada', emoji: '[shield]' },
  '1.10.256': { name: 'Cafe Verificacao e Blindagem Final', emoji: '[shield]' },
  '1.10.255': { name: 'Cafe Arquivo Publico Blindado', emoji: '[lock]' },
  '1.10.254': { name: 'Cafe Assinatura e Ficha Alinhadas', emoji: '[sync]' },
  '1.10.253': { name: 'Cafe Fluxo de Assinatura Editorial', emoji: '[signature]' },
  '1.10.252': { name: 'Cafe Assinatura Publica Blindada', emoji: '[shield]' },
  '1.10.250': { name: 'Cafe Despedida Cinematica', emoji: '🎬' },
  '1.10.249': { name: 'Cafe Agenda DJEN Vivo', emoji: '📅' },
  '1.10.248': { name: 'Cafe Sessao e Timeline Coerentes', emoji: '🧭' },
  '1.10.247': { name: 'Cafe Portal Acesso Rapido', emoji: '🚪' },
  '1.10.245': { name: 'Cafe Advisor Orquestrado', emoji: '🧭' },
  '1.10.244': { name: 'Cafe Politica Blindada', emoji: '🔐' },
  '1.10.243': { name: 'Cafe Push Orquestrado', emoji: '📲' },
  '1.10.242': { name: 'Cafe Ausencia na Retomada', emoji: '🌙' },
  '1.10.241': { name: 'Cafe Reabertura Temporal', emoji: '⏱️' },
  '1.10.240': { name: 'Cafe SW Resiliente', emoji: '📡' },
  '1.10.239': { name: 'Cafe Chunk Seguro', emoji: '🛠️' },
  '1.10.238': { name: 'Cafe Chunk Cirurgico', emoji: '🪓' },
  '1.10.237': { name: 'Cafe Heap Forcado', emoji: '🚀' },
  '1.10.236': { name: 'Cafe Browsers Atualizados', emoji: '🌐' },
  '1.10.235': { name: 'Cafe Heap Estavel', emoji: '🧠' },
  '1.10.234': { name: 'Cafe Icone Tipado', emoji: '🧩' },
  '1.10.233': { name: 'Cafe Estado Blindado', emoji: '🛡️' },
  '1.10.232': { name: 'Cafe CRM Conversa Nativa', emoji: '☕' },
  '1.10.231': { name: 'Cafe Silencio Inteligente', emoji: '🔕' },
  '1.10.230': { name: 'Cafe Limpeza Assistida', emoji: 'clean' },
  '1.10.229': { name: 'Café Workflow Estruturado', emoji: '🧭' },
  '1.10.227': { name: 'Café WhatsApp Orquestrado', emoji: '🟢' },
  '1.10.226': { name: 'Café Assinatura Resiliente', emoji: '🛡️' },
  '1.10.225': { name: 'Café Assinatura Orquestrada', emoji: '✍️' },
  '1.10.224': { name: 'Café Configuração Blindada', emoji: '🔐' },
  '1.10.223': { name: 'Café Processo Lúcido', emoji: '🧠' },
  '1.10.217': { name: 'Café Recibo Limpo', emoji: '🧾' },
  '1.10.216': { name: 'Café Componentes Padrão', emoji: '🎨' },
  '1.10.215': { name: 'Café Modal Limpo', emoji: '🪟' },
  '1.10.212': { name: 'Cafe SemVer', emoji: '??' },
  '1.10.211': { name: 'Cafe Portal Vivo', emoji: '??' },
  '1.10.210': { name: 'Caf? Portal Alerta', emoji: '??' },
  '1.10.209': { name: 'Café Texto Limpo', emoji: '✍️' },
  '1.10.208': { name: 'Café Scanner Natural', emoji: '📸' },
  '1.10.192': { name: 'Café Portal Redesign', emoji: '🎨' },
  '1.10.191': { name: 'Café Intimação Viva', emoji: '⚖️' },
  '1.10.172': { name: 'Café Link Público', emoji: '🔗' },
  '1.10.171': { name: 'Café Rota Única', emoji: '🎯' },
  '1.10.170': { name: 'Café Sessão Viva', emoji: '🔐' },
  '1.10.169': { name: 'Café Edge Limpo', emoji: '⚡' },
  '1.10.168': { name: 'Café Rota Certa', emoji: '🛣️' },
  '1.10.167': { name: 'Café Doc Aberto', emoji: '📄' },
  '1.10.166': { name: 'Café Portal Novo', emoji: '🌐' },
  '1.10.163': { name: 'Café Upload Liberado', emoji: '📤' },
  '1.10.162': { name: 'Café Docs Notificados', emoji: '📬' },
  '1.10.161': { name: 'Café Build Limpo', emoji: '🔧' },
  '1.10.160': { name: 'Café Docs Inteligentes', emoji: '📄' },
  '1.10.159': { name: 'Café Portal Completo', emoji: '🚪' },
  '1.10.158': { name: 'Café Corretor Ligado', emoji: '✍️' },
  '1.10.157': { name: 'Café Compromisso Certo', emoji: '📌' },
  '1.10.156': { name: 'Café Blocos Limpos', emoji: '🧹' },
  '1.10.155': { name: 'Café Agenda Unificada', emoji: '📆' },
  '1.10.154': { name: 'Café Data Ajustada', emoji: '📅' },
  '1.10.153': { name: 'Café Prazo Certo', emoji: '⏱️' },
  '1.10.152': { name: 'Café Chamou Atenção', emoji: '⚡' },
  '1.10.151': { name: 'Café Ding Ding Ding', emoji: '🔔' },
  '1.10.150': { name: 'Café Chacoalha', emoji: '⚡' },
  '1.10.149': { name: 'Café Build Limpo', emoji: '🏗️' },
  '1.10.148': { name: 'Café Discreto', emoji: '🤫' },
  '1.10.147': { name: 'Café Canal Correto', emoji: '🔧' },
  '1.10.146': { name: 'Café Digitando na Lista', emoji: '📋' },
  '1.10.145': { name: 'Café Digitando Visível', emoji: '💬' },
  '1.10.144': { name: 'Café Scroll Garantido', emoji: '⬇️' },
  '1.10.143': { name: 'Café Andamento Persistido', emoji: '🏛️' },
  '1.10.142': { name: 'Café Estágio Vivo', emoji: '📊' },
  '1.10.141': { name: 'Café Baixa Avulsa', emoji: '💰' },
  '1.10.140': { name: 'Café Editar Baixa', emoji: '✏️' },
  '1.10.139': { name: 'Café Recibo Exato', emoji: '🧾' },
  '1.10.138': { name: 'Café Digest Pontual', emoji: '⏰' },
  '1.10.137': { name: 'Café Vara Real', emoji: '⚖️' },
  '1.10.136': { name: 'Café Digest Semanal', emoji: '📧' },
  '1.10.135': { name: 'Café Agenda Visual', emoji: '📅' },
  '1.10.134': { name: 'Café Chat Unificado', emoji: '💬' },
  '1.10.133': { name: 'Chat Premium', emoji: '🎙️' },
  '1.10.132': { name: 'Presença Real', emoji: '🟢' },
  '1.10.131': { name: 'Café DataJud Express', emoji: '⚖️' },
  '1.10.130': { name: 'Café Terminal Glass', emoji: '⌨️' },
  '1.10.129': { name: 'Café Vidro Aero', emoji: '🪟' },
  '1.10.128': { name: 'Café Vidro Aero Inicial', emoji: '🌈' },
  '1.10.125': { name: 'Café Barra Animada', emoji: '✨' },
  '1.10.124': { name: 'Café Busca Relâmpago', emoji: '⚡' },
  '1.10.123': { name: 'Café Busca Completa', emoji: '🗃️' },
  '1.10.122': { name: 'Café Prazo Certo', emoji: '⏰' },
  '1.10.121': { name: 'Café Busca Total', emoji: '🔭' },
  '1.10.120': { name: 'Café Partes Identificadas', emoji: '👥' },
  '1.10.119': { name: 'Café Busca Global', emoji: '🔍' },
  '1.10.118': { name: 'Café Cron Inteligente', emoji: '🤖' },
  '1.10.117': { name: 'Café Comarca Limpa', emoji: '📍' },
  '1.10.116': { name: 'Café Comarca Detectada', emoji: '🏛️' },
  '1.10.115': { name: 'Café Intimação Material', emoji: '⚖️' },
  '1.10.114': { name: 'Café Deploy Fresco', emoji: '🚀' },
  '1.10.113': { name: 'Café Balão Visível', emoji: '👁️' },
  '1.10.112': { name: 'Café Balão Resolvido', emoji: '💬' },
  '1.10.111': { name: 'Café Intimação Limpa', emoji: '🧹' },
  '1.10.110': { name: 'Café Intimação Enterprise', emoji: '🏛️' },
  '1.10.109': { name: 'Café Sem Ruído Visual', emoji: '🧘' },
  '1.10.108': { name: 'Café Intimação Pro', emoji: '⚖️' },
  '1.10.107': { name: 'Café Documento Legível', emoji: '📜' },
  '1.10.106': { name: 'Café Intimação Notifica', emoji: '⚖️' },
  '1.10.105': { name: 'Café Qoder Docs', emoji: '📖' },
  '1.10.104': { name: 'Café Hook Esperto', emoji: '🪝' },
  '1.10.103': { name: 'Café Hoje em Foco', emoji: '📅' },
  '1.10.102': { name: 'Café Tela Certa', emoji: '📱' },
  '1.10.101': { name: 'Café Notificação Certa', emoji: '🔔' },
  '1.10.095': { name: 'Café Áudio no Módulo', emoji: '🎧' },
  '1.10.094': { name: 'Café Widget Afiado', emoji: '🎯' },
  '1.10.093': { name: 'Café Chamou Atenção', emoji: '👋' },
  '1.10.092': { name: 'Café Som Top', emoji: '🎵' },
  '1.10.091': { name: 'Café Chat Polido', emoji: '✨' },
  '1.10.090': { name: 'Café Chat Interativo', emoji: '💞' },
  '1.10.089': { name: 'Café Chat Notifica', emoji: '🔔' },
  '1.10.088': { name: 'Café Alerta no Acordo', emoji: '🚨' },
  '1.10.087': { name: 'Café Atraso à Vista', emoji: '🗓️' },
  '1.10.086': { name: 'Café Sempre Carrega', emoji: '🔄' },
  '1.10.085': { name: 'Café Assunto Limpo', emoji: '📧' },
  '1.10.084': { name: 'Café Instantâneo', emoji: '⚡' },
  '1.10.083': { name: 'Café Conversa', emoji: '🧵' },
  '1.10.082': { name: 'Café Menção Certeira', emoji: '🎯' },
  '1.10.081': { name: 'Café Ordem Certa', emoji: '🩹' },
  '1.10.080': { name: 'Café Te Marquei', emoji: '💬' },
  '1.10.079': { name: 'Café Tudo Conectado', emoji: '🕸️' },
  '1.10.078': { name: 'Café Vínculo Rápido', emoji: '🔗' },
  '1.10.077': { name: 'Café Cargo Certo', emoji: '🎖️' },
  '1.10.076': { name: 'Café Hierarquia', emoji: '🪜' },
  '1.10.075': { name: 'Café Tela Cheia', emoji: '🖥️' },
  '1.10.074': { name: 'Café Advogado em Foco', emoji: '👨‍⚖️' },
  '1.10.073': { name: 'Café Formulário Premium', emoji: '📋' },
  '1.10.072': { name: 'Café Modal Refinado', emoji: '✨' },
  '1.10.071': { name: 'Café Barra Limpa', emoji: '🧹' },
  '1.10.070': { name: 'Café Histórico Vivo', emoji: '📜' },
  '1.10.069': { name: 'Café Prazos Pro', emoji: '⚡' },
  '1.10.068': { name: 'Café Galeria', emoji: '🖼️' },
  '1.10.067': { name: 'Café Enterprise', emoji: '🏛️' },
  '1.10.066': { name: 'Café Sem Overflow', emoji: '📐' },
  '1.10.065': { name: 'Café Header Compacto', emoji: '📱' },
  '1.10.064': { name: 'Café Chat no Lugar', emoji: '💬' },
  '1.10.063': { name: 'Café Rodapé ZapSign', emoji: '🧾' },
  '1.10.062': { name: 'Café Rodapé Transparente', emoji: '🪟' },
  '1.10.061': { name: 'Café Bloco Contínuo', emoji: '📜' },
  '1.10.060': { name: 'Café Clip Inteligente', emoji: '🎯' },
  '1.10.059': { name: 'Café Clip Cirúrgico', emoji: '✂️' },
  '1.10.058': { name: 'Café Sem Duplicata', emoji: '🚫' },
  '1.10.057': { name: 'Café Página Completa', emoji: '📄' },
  '1.10.051': { name: 'Café Corporativo', emoji: '🏢' },
  '1.10.048': { name: 'Café Boas-Vindas', emoji: '👋' },
  '1.10.047': { name: 'Café Relatório Premium', emoji: '📋' },
  '1.10.046': { name: 'Café Bucket Certeiro', emoji: '🪣' },
  '1.10.042': { name: 'Café Cor Persistente', emoji: '🎨' },
  '1.10.041': { name: 'Café Duplicata Inteligente', emoji: '🔍' },
  '1.10.040': { name: 'Café IA Sênior', emoji: '🧠' },
  '1.10.039': { name: 'Café Industrial', emoji: '⚙️' },
  '1.10.038': { name: 'Café IA Acionável', emoji: '🤖' },
  '1.10.037': { name: 'Café Intimações Premium', emoji: '🔔' },
  '1.10.036': { name: 'Café Cards Refinados', emoji: '🗂️' },
  '1.10.035': { name: 'Café Hub Premium', emoji: '📄' },
  '1.10.034': { name: 'Café Loading Profissional', emoji: '⏳' },
  '1.10.030': { name: 'Café Seleção Premium', emoji: '✨' },
  '1.10.029': { name: 'Café Menu Inteligente', emoji: '🎯' },
  '1.10.028': { name: 'Café Drive Nativo', emoji: '☁️' },
  '1.10.027': { name: 'Café Página Contínua', emoji: '📄' },
  '1.10.026': { name: 'Café Sem Fronteiras', emoji: '🌊' },
  '1.10.025': { name: 'Café Envelope Completo', emoji: '📎' },
  '1.10.024': { name: 'Café Imagem na Fila', emoji: '🖼️' },
  '1.10.023': { name: 'Café Seleção Completa', emoji: '✅' },
  '1.10.022': { name: 'Café Envelope Múltiplo', emoji: '📋' },
  '1.10.021': { name: 'Café Cloud na Fila', emoji: '☁️' },
  '1.10.020': { name: 'Café Assinatura no Lugar', emoji: '✍️' },
  '1.10.019': { name: 'Café Arquivos Visíveis', emoji: '📂' },
  '1.10.018': { name: 'Café Cliente na Agenda', emoji: '📅' },
  '1.10.017': { name: 'Café Ficha 360 Completa', emoji: '🔄' },
  '1.10.016': { name: 'Café Editor em Tela Cheia', emoji: '📝' },
  '1.10.015': { name: 'Café Preview Formatado', emoji: '📄' },
  '1.10.011': { name: 'Café Perfil no Bucket', emoji: '📸' },
  '1.10.010': { name: 'Café Tipagem Corrigida', emoji: '🧩' },
  '1.10.009': { name: 'Café Build Estável', emoji: '🛠️' },
  '1.10.008': { name: 'Café Link Corrigido', emoji: '🔗' },
  '1.10.007': { name: 'Café Regra Cumprida', emoji: '✅' },
  '1.10.006': { name: 'Café Lembrete Laranja', emoji: '🍊' },
  '1.9.915': { name: 'Café Área Ativa', emoji: '🪄' },
  '1.9.914': { name: 'Café Menu Completo', emoji: '📜' },
  '1.9.913': { name: 'Café Clique Liberado', emoji: '🧷' },
  '1.9.912': { name: 'Café Menu Destravado', emoji: '🖱️' },
  '1.9.911': { name: 'Café Clique Confirmado', emoji: '📌' },
  '1.9.910': { name: 'Café Status Claro', emoji: '🏷️' },
  '1.9.909': { name: 'Café Ordem Corrigida', emoji: '🧱' },
  '1.9.908': { name: 'Café Navegação Livre', emoji: '🧭' },
  '1.9.907': { name: 'Café Header Compacto', emoji: '🧩' },
  '1.9.906': { name: 'Café Ícone Restaurado', emoji: '🩹' },
  '1.9.905': { name: 'Café Telefone no Cloud', emoji: '📞' },
  '1.9.904': { name: 'Café Cloud Reaberto', emoji: '🛠️' },
  '1.9.903': { name: 'Café Whats do Cliente', emoji: '📱' },
  '1.9.902': { name: 'Café Pasta em Tela', emoji: '⏳' },
  '1.9.901': { name: 'Café Pasta em Montagem', emoji: '📦' },
  '1.9.900': { name: 'Café Sirene em Alerta', emoji: '🚨' },
  '1.9.899': { name: 'Café Motivo em Destaque', emoji: '🔴' },
  '1.9.898': { name: 'Café Motivo no Card', emoji: '🗒️' },
  '1.9.897': { name: 'Café Alerta Visível', emoji: '🏷️' },
  '1.9.896': { name: 'Café Motivo Obrigatório', emoji: '📝' },
  '1.9.895': { name: 'Café Menu Persistente', emoji: '📌' },
  '1.9.894': { name: 'Café Pasta em Alerta', emoji: '🚨' },
  '1.9.893': { name: 'Café Vídeo Sem Repetição', emoji: '🧽' },
  '1.9.892': { name: 'Café Vídeo Limpo', emoji: '🖥️' },
  '1.9.891': { name: 'Café Vídeo Jurius', emoji: '🎬' },
  '1.9.890': { name: 'Café PDF Estável', emoji: '📕' },
  '1.9.889': { name: 'Café Cola em Andamento', emoji: '📋' },
  '1.9.888': { name: 'Café Drop Único', emoji: '🫳' },
  '1.9.887': { name: 'Café Cópia Inteligente', emoji: '📄' },
  '1.9.886': { name: 'Café Extensão Travada', emoji: '🔒' },
  '1.9.885': { name: 'Café Modal Acima', emoji: '🪟' },
  '1.9.884': { name: 'Café Modal Fechado', emoji: '🧩' },
  '1.9.883': { name: 'Café Estado Restaurado', emoji: '🩹' },
  '1.9.882': { name: 'Café ZIP Direto', emoji: '🗂️' },
  '1.9.881': { name: 'Café Entrada Limpa', emoji: '🧹' },
  '1.9.880': { name: 'Café Página Solta', emoji: '📥' },
  '1.9.879': { name: 'Café Cards Soltos', emoji: '🃏' },
  '1.9.878': { name: 'Café Drop no Vazio', emoji: '🫳' },
  '1.9.877': { name: 'Café Drop Ampliado', emoji: '🪂' },
  '1.9.876': { name: 'Café Ação Silenciosa', emoji: '🫧' },
  '1.9.875': { name: 'Café Página Centralizada', emoji: '🧭' },
  '1.9.874': { name: 'Café PDF Refeito', emoji: '🧱' },
  '1.9.873': { name: 'Café Cloud Silencioso', emoji: '🤫' },
  '1.9.872': { name: 'Café Página Fiel', emoji: '📐' },
  '1.9.871': { name: 'Café PDF Visível', emoji: '📃' },
  '1.9.870': { name: 'Café Conversão Alternativa', emoji: '🔄' },
  '1.9.869': { name: 'Café Exportação Visível', emoji: '🧩' },
  '1.9.868': { name: 'Café Editor Único', emoji: '🆔' },
  '1.9.867': { name: 'Café Conversão Sinalizada', emoji: '📡' },
  '1.9.866': { name: 'Café Conversão Serena', emoji: '🛡️' },
  '1.9.865': { name: 'Café Conversão Limitada', emoji: '⏱️' },
  '1.9.864': { name: 'Café Conversão no Topo', emoji: '🚀' },
  '1.9.863': { name: 'Café Conversão Viva', emoji: '✨' },
  '1.9.862': { name: 'Café Word Fiel', emoji: '🧾' },
  '1.9.861': { name: 'Café Word em PDF', emoji: '📄' },
  '1.9.860': { name: 'Café PDF Estável', emoji: '📄' },
  '1.9.859': { name: 'Café Pasta Escalada', emoji: '📁' },
  '1.9.848': { name: 'Café Nuvem Limpa', emoji: '✨' },
  '1.9.847': { name: 'Café Cloud Vivo', emoji: '☁️' },
  '1.9.846': { name: 'Café Sidebar Ampla', emoji: '🧭' },
  '1.9.845': { name: 'Café PDF Vertical', emoji: '📏' },
  '1.9.844': { name: 'Café PDF Alto', emoji: '📐' },
  '1.9.843': { name: 'Café PDF Expandido', emoji: '📄' },
  '1.9.842': { name: 'Café Breadcrumb Leve', emoji: '🪶' },
  '1.9.840': { name: 'Café Grid Aberto', emoji: '🧱' },
  '1.9.839': { name: 'Café Tela Ampla', emoji: '🖥️' },
  '1.9.838': { name: 'Café Busca Contextual', emoji: '🔎' },
  '1.9.837': { name: 'Café Menu Único', emoji: '🧭' },
  '1.9.836': { name: 'Café Header Global', emoji: '🌐' },
  '1.9.831': { name: 'Café Cliente no Topo', emoji: '🏷️' },
  '1.9.830': { name: 'Café Desktop Cloud', emoji: '🖥️' },
  '1.9.829': { name: 'Café Scroll Único', emoji: '🧭' },
  '1.9.828': { name: 'Café Card Enxuto', emoji: '📚' },
  '1.9.827': { name: 'Café Quatro por Linha', emoji: '🧱' },
  '1.9.826': { name: 'Café PDF Fixo', emoji: '📄' },
  '1.9.825': { name: 'Café Ícone Compacto', emoji: '🗂️' },
  '1.9.824': { name: 'Café Modal Acima', emoji: '🪟' },
  '1.9.823': { name: 'Café Pasta no Vazio', emoji: '📁' },
  '1.9.822': { name: 'Café Galeria PDF', emoji: '🧾' },
  '1.9.821': { name: 'Café Ctrl Vivo', emoji: '⌨️' },
  '1.9.820': { name: 'Café Lateral Quieto', emoji: '🧱' },
  '1.9.819': { name: 'Café Miniatura Viva', emoji: '🖼️' },
  '1.9.818': { name: 'Café Ordem Certa', emoji: '🧩' },
  '1.9.817': { name: 'Café Cola Rápida', emoji: '📎' },
  '1.9.816': { name: 'Café Tecla Del', emoji: '⌫' },
  '1.9.815': { name: 'Café Pasta Raiz', emoji: '🗂️' },
  '1.9.814': { name: 'Café Área de Transferência', emoji: '📋' },
  '1.9.813': { name: 'Café Atalho de Pasta', emoji: '✂️' },
  '1.9.812': { name: 'Café Espaço Livre', emoji: '🗑️' },
  '1.9.811': { name: 'Café Lixeira Clara', emoji: '🧺' },
  '1.9.810': { name: 'Café Modal Claro', emoji: '🪟' },
  '1.9.809': { name: 'Café Preview Estável', emoji: '📄' },
  '1.9.808': { name: 'Café Linha Clara', emoji: '📍' },
  '1.9.807': { name: 'Café Ícone Direto', emoji: '✅' },
  '1.9.806': { name: 'Café Selo Claro', emoji: '🟢' },
  '1.9.805': { name: 'Café Clique Fino', emoji: '🖱️' },
  '1.9.804': { name: 'Café Fluxo Estável', emoji: '🧾' },
  '1.9.803': { name: 'Café Painel Livre', emoji: '🪟' },
  '1.9.802': { name: 'Café Coluna Clara', emoji: '📚' },
  '1.9.801': { name: 'Café Árvore Leve', emoji: '🌿' },
  '1.9.800': { name: 'Café Entrada Viva', emoji: '📬' },
  '1.9.799': { name: 'Café Drop Preciso', emoji: '🎯' },
  '1.9.798': { name: 'Café Atalho Vivo', emoji: '🧲' },
  '1.9.797': { name: 'Café Caixa Viva', emoji: '📥' },
  '1.9.796': { name: 'Café Lixeira Coerente', emoji: '🗃️' },
  '1.9.795': { name: 'Café Filtro Certo', emoji: '🔍' },
  '1.9.794': { name: 'Café Topo Limpo', emoji: '🧼' },
  '1.9.793': { name: 'Café Lixeira Visível', emoji: '🧺' },
  '1.9.792': { name: 'Café Claro Coerente', emoji: '☀️' },
  '1.9.791': { name: 'Café Movimento Vivo', emoji: '✨' },
  '1.9.790': { name: 'Café Contagem Real', emoji: '🔢' },
  '1.9.789': { name: 'Café Sidebar Direta', emoji: '🧭' },
  '1.9.788': { name: 'Café Lixeira Restaurada', emoji: '🗑️' },
  '1.9.787': { name: 'Café Hierarquia Clara', emoji: '🗂️' },
  '1.9.786': { name: 'Café Link Estável', emoji: '🛡️' },
  '1.9.785': { name: 'Café Link Aberto', emoji: '🔓' },
  '1.9.784': { name: 'Café Arquivo Manual', emoji: '📦' },
  '1.9.783': { name: 'Café Arquivo Polido', emoji: '✨' },
  '1.9.782': { name: 'Café Arquivo Vivo', emoji: '🗄️' },
  '1.9.781': { name: 'Café Pasta Compacta', emoji: '📁' },
  '1.9.780': { name: 'Café Lixeira Acessível', emoji: '🧺' },
  '1.9.779': { name: 'Café Pasta Lixeira', emoji: '🗂️' },
  '1.9.778': { name: 'Café Explorer Laranja', emoji: '🪟' },
  '1.9.777': { name: 'Café Lixeira Windows', emoji: '🗑️' },
  '1.9.776': { name: 'Café Galáxia Modal', emoji: '🌌' },
  '1.9.775': { name: 'Café Nuvem Fluida', emoji: '📱' },
  '1.9.774': { name: 'Café Lixeira Viva', emoji: '🗑️' },
  '1.9.773': { name: 'Café Busca Total', emoji: '🔎' },
  '1.9.772': { name: 'Café Fila na Nuvem', emoji: '☁️' },
  '1.9.771': { name: 'Café PDF Visível', emoji: '📕' },
  '1.9.770': { name: 'Café Raiz Preservada', emoji: '🌳' },
  '1.9.769': { name: 'Café Pasta Compatível', emoji: '🧩' },
  '1.9.768': { name: 'Café Pasta Arrastável', emoji: '🗂️' },
  '1.9.767': { name: 'Café Pasta Segura', emoji: '📁' },
  '1.9.766': { name: 'Café Cache Limpo', emoji: '🧹' },
  '1.9.765': { name: 'Café Assinatura em Nuvem', emoji: '✍️' },
  '1.9.764': { name: 'Café Cloud Estável', emoji: '☁️' },
  '1.9.763': { name: 'Café DOCX Turbo', emoji: '⚡' },
  '1.9.520': { name: 'Café Modal Laranja', emoji: '🟠' },
  '1.9.519': { name: 'Café Tempo Preservado', emoji: '⏰' },
  '1.9.518': { name: 'Café Badge MS', emoji: '🏷️' },
  '1.9.517': { name: 'Café MS Corrigido', emoji: '📄' },
  '1.9.516': { name: 'Café Data Corrigida', emoji: '📅' },
  '1.9.491': { name: 'Café Vinculação Automática', emoji: '🔗' },
  '1.9.490': { name: 'Café Chat Duplicado', emoji: '💬' },
  '1.9.489': { name: 'Café Intimações Restauradas', emoji: '📋' },
  '1.9.478': { name: 'Café DM Única', emoji: '👤' },
  '1.9.477': { name: 'Café Chat Usável', emoji: '✅' },
  '1.9.476': { name: 'Café Chat Móvel', emoji: '📱' },
  '1.9.475': { name: 'Café Facebook Sticky', emoji: '📌' },
  '1.9.425': { name: 'Café Intimações DJEN', emoji: '⚖️' },
  '1.9.424': { name: 'Café Feed UTF-8', emoji: '🔤' },
  '1.9.417': { name: 'Café Enquetes Visíveis', emoji: '📊' },
  '1.9.416': { name: 'Café Grid Perfeito', emoji: '📐' },
  '1.9.415': { name: 'Café Feed Turbinado', emoji: '🚀' },
  '1.9.414': { name: 'Café Feed Alinhado', emoji: '📐' },
  '1.9.413': { name: 'Café Feed Corporativo', emoji: '🏢' },
  '1.9.405': { name: 'Café Feed Sem Widgets', emoji: '📰' },
  '1.9.404': { name: 'Café Requerimentos Retrátil', emoji: '🧩' },
  '1.9.403': { name: 'Café Assinatura Mobile', emoji: '✍️' },
  '1.9.402': { name: 'Café Header Sem Barra', emoji: '🧼' },
  '1.9.401': { name: 'Café Responsivo Master', emoji: '📱' },
  '1.9.400': { name: 'Café Dashboard Mobile', emoji: '📱' },
  '1.9.349': { name: 'Café Intimação Expandida', emoji: '📱' },
  '1.9.136': { name: 'Café CPF do Login', emoji: '🧾' },
  '1.9.135': { name: 'Café CPF Persistente', emoji: '💾' },
  '1.9.134': { name: 'Café CPF Resiliente', emoji: '🧯' },
  '1.9.133': { name: 'Café CPF Mascarado', emoji: '🆔' },
  '1.9.132': { name: 'Café CPF no Perfil', emoji: '🪪' },
  '1.9.131': { name: 'Café Perfil Consistente', emoji: '🪪' },
  '1.9.130': { name: 'Café Permissões Corrigidas', emoji: '🔐' },
  '1.9.129': { name: 'Café Menu Inteligente', emoji: '🧭' },
  '1.9.128': { name: 'Café Editar Cargo', emoji: '✏️' },
  '1.9.127': { name: 'Café Cargos Unificados', emoji: '🎭' },
  '1.9.126': { name: 'Café Advogado Criador', emoji: '⚖️' },
  '1.9.125': { name: 'Café Gestão de Usuários', emoji: '👥' },
  '1.9.124': { name: 'Café Chat Realtime', emoji: '💬' },
  '1.9.123': { name: 'Café Intimação Desaparecida', emoji: '🔍' },
  '1.9.115': { name: 'Café Tipo Legível', emoji: '🏷️' },
  '1.9.114': { name: 'Café Data Sem Fuso', emoji: '📅' },
  '1.9.113': { name: 'Café Anexos Completos', emoji: '📎' },
  '1.9.112': { name: 'Café Rascunho Local', emoji: '💾' },
  '1.9.111': { name: 'Café CEP Confirmado', emoji: '📍' },
  '1.9.91': { name: 'Café Assinatura Controlada', emoji: '🔐' },
  '1.9.90': { name: 'Café Compilando', emoji: '🔧' },
  '1.9.87': { name: 'Café Carregando Laranja', emoji: '🟠' },
  '1.9.86': { name: 'Café Procurando', emoji: '🔎' },
  '1.9.85': { name: 'Café Laranja Total', emoji: '🟧' },
  '1.9.84': { name: 'Café Olhar Lateral', emoji: '👁️' },
  '1.9.83': { name: 'Café Editável', emoji: '✏️' },
  '1.9.82': { name: 'Café Mobile Bloqueado', emoji: '📵' },
  '1.9.81': { name: 'Café Compacto', emoji: '📎' },
  '1.9.80': { name: 'Café Identificado', emoji: '🏷️' },
  '1.9.79': { name: 'Café Glow Ajustado', emoji: '✨' },
  '1.9.78': { name: 'Café Ícone Puro', emoji: '🔘' },
  '1.9.77': { name: 'Café Widget Premium', emoji: '✨' },
  '1.9.76': { name: 'Café Inserção Direta', emoji: '✅' },
  '1.9.75': { name: 'Café Modal Persistente', emoji: '🧩' },
  '1.9.74': { name: 'Café Destaque', emoji: '🟠' },
  '1.9.73': { name: 'Café Ordem Fixa', emoji: '📌' },
  '1.9.72': { name: 'Café Contexto', emoji: '🟧' },
  '1.9.71': { name: 'Café Tipografado', emoji: '🔤' },
  '1.9.70': { name: 'Café Reciclado', emoji: '♻️' },
  '1.9.69': { name: 'Café Tag Express', emoji: '🏷️' },
  '1.9.68': { name: 'Café Fraseado', emoji: '✂️' },
  '1.9.67': { name: 'Café Fuzzy', emoji: '🔎' },
  '1.9.66': { name: 'Café Tolerante', emoji: '🧠' },
  '1.9.65': { name: 'Café Preview', emoji: '📝' },
  '1.9.64': { name: 'Café Amplo', emoji: '📏' },
  '1.9.63': { name: 'Café Tagueado', emoji: '🏷️' },
  '1.9.62': { name: 'Café Turbo', emoji: '⚡' },
  '1.9.61': { name: 'Café Mapa', emoji: '🗺️' },
  '1.9.60': { name: 'Café Timeline', emoji: '🕒' },
  '1.9.59': { name: 'Café Notificado', emoji: '🔔' },
  '1.9.58': { name: 'Café Jurídico', emoji: '⚖️' },
  '1.9.57': { name: 'Café Tema Laranja', emoji: '🟠' },
  '1.9.56': { name: 'Café Laranja', emoji: '🟧' },
  '1.9.55': { name: 'Café Status 200', emoji: '✅' },
  '1.9.54': { name: 'Café OTP', emoji: '🔐' },
  '1.9.53': { name: 'Café E-mail', emoji: '✉️' },
  '1.9.52': { name: 'Café Telefone', emoji: '📞' },
  '1.9.30': { name: 'Café Estável', emoji: '🧰' },
  '1.9.29': { name: 'Café Persistente', emoji: '💾' },
  '1.9.28': { name: 'Café Otimizado', emoji: '⚡' },
  '1.9.18': { name: 'Café Vinculado', emoji: '🔗' },
  '1.9.17': { name: 'Café Integração', emoji: '🔗' },
  '1.9.16': { name: 'Café Indicadores', emoji: '🏷️' },
  '1.9.15': { name: 'Café Link Estilo', emoji: '🔗' },
  '1.9.14': { name: 'Café Compacto', emoji: '📦' },
  '1.9.13': { name: 'Café Visual Leve', emoji: '🌟' },
  '1.9.09': { name: 'Café Dark Button', emoji: '🌚' },
  '1.9.08': { name: 'Café Design Fino', emoji: '✨' },
  '1.9.07': { name: 'Café Modal Compacto', emoji: '🪟' },
  '1.9.06': { name: 'Café Estável', emoji: '🛠️' },
  '1.9.05': { name: 'Café Criar Processo', emoji: '➕' },
  '1.9.04': { name: 'Café Confecção', emoji: '🧵' },
  '1.9.03': { name: 'Café Processo', emoji: '⚖️' },
  '1.9.02': { name: 'Café Atalhos', emoji: '🔗' },
  '1.9.01': { name: 'Café Selo', emoji: '🏷️' },
  '1.9.00': { name: 'Café Recomendado', emoji: '⭐' },
  '1.8.99': { name: 'Café Escala', emoji: '📏' },
  '1.8.98': { name: 'Café Documento', emoji: '📄' },
  '1.8.97': { name: 'Café Assinatura', emoji: '✍️' },
  '1.8.96': { name: 'Café Exclusão', emoji: '🗑️' },
  '1.8.95': { name: 'Café Memória', emoji: '🧠' },
  '1.8.94': { name: 'Café Padrão', emoji: '📌' },
  '1.8.93': { name: 'Café Vinculado', emoji: '🔗' },
  '1.8.92': { name: 'Café Template', emoji: '📎' },
  '1.8.91': { name: 'Café Nome', emoji: '📝' },
  '1.8.90': { name: 'Café Vínculo', emoji: '🔗' },
  '1.8.89': { name: 'Café Recente', emoji: '⏱️' },
  '1.8.88': { name: 'Café Atalhos', emoji: '🧷' },
  '1.8.87': { name: 'Café Saudação', emoji: '🪪' },
  '1.8.86': { name: 'Café Cliente', emoji: '👤' },
  '1.8.85': { name: 'Café Word', emoji: '🗂️' },
  '1.8.84': { name: 'Café Sem Cabeçalho', emoji: '📄' },
  '1.8.83': { name: 'Café Ordenado', emoji: '🧭' },
  '1.8.82': { name: 'Café Expresso', emoji: '🚀' },
  '1.8.81': { name: 'Café Simples', emoji: '☕' },
  '1.8.80': { name: 'Café Repaint', emoji: '🖋️' },
  '1.8.79': { name: 'Café Fluido', emoji: '⚡' },
  '1.8.78': { name: 'Café Numerado', emoji: '🔢' },
  '1.8.77': { name: 'Café Blocos', emoji: '🧩' },
  '1.8.76': { name: 'Café Petição', emoji: '📄' },
  '1.3.66': { name: 'Café Notificado', emoji: '🔔' },
  '1.3.38': { name: 'Café Filtro', emoji: '🔎' },
  '1.3.37': { name: 'Café Sincronizado', emoji: '🔄' },
  '1.3.35': { name: 'Café Padrão', emoji: '🎨' },
  '1.3.34': { name: 'Café Petições', emoji: '📄' },
  '1.3.33': { name: 'Café Overlay', emoji: '🧩' },
  '1.3.32': { name: 'Café Turbo', emoji: '⚡' },
  '1.3.31': { name: 'Café Premium', emoji: '☕' },
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
    color: { bg: 'bg-slate-600', text: 'text-slate-700', border: 'border-[#e7e5df]', light: 'bg-slate-50' },
  },
  {
    id: 'dev',
    name: 'Dev & Governança',
    description: 'Ferramentas de desenvolvimento, CI/CD e governança de código',
    icon: Code2,
    color: { bg: 'bg-emerald-600', text: 'text-emerald-700', border: 'border-emerald-200', light: 'bg-emerald-50' },
  },
  {
    id: 'peticoes',
    name: 'Petições',
    description: 'Editor de petições, blocos, templates e formatação inteligente',
    icon: FileText,
    color: { bg: 'bg-orange-600', text: 'text-orange-700', border: 'border-orange-200', light: 'bg-orange-50' },
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
    color: { bg: 'bg-gray-600', text: 'text-gray-700', border: 'border-[#e7e5df]', light: 'bg-gray-50' },
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

const CHANGE_TYPE_CONFIG: Record<ChangeType, { label: string; icon: React.ElementType; color: string }> = {
  feature: { label: 'Novo', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
  improvement: { label: 'Melhoria', icon: CheckCircle2, color: 'text-blue-600 bg-blue-50' },
  fix: { label: 'Correção', icon: Shield, color: 'text-amber-600 bg-amber-50' },
  security: { label: 'Segurança', icon: Shield, color: 'text-red-600 bg-red-50' },
  breaking: { label: 'Breaking', icon: GitBranch, color: 'text-purple-600 bg-purple-50' },
};


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
        matchesNormalizedSearch(searchQuery, [release.version, release.summary, getCodename(release.version).name]) ||
        release.modules.some((mod) =>
          mod.changes.some((change) =>
            matchesNormalizedSearch(searchQuery, [change.title, change.description])
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
      <header className="sticky top-0 z-20 bg-[#f8f7f5]/95 backdrop-blur-lg border-b border-[#e7e5df]/60">
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
      <div className="sticky top-16 z-10 bg-[#f8f7f5] border-b border-[#e7e5df]">
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
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[#e7e5df] bg-[#f8f7f5] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition"
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
                      <div className="absolute left-0 sm:left-2 top-1 w-8 h-8 rounded-full bg-[#f8f7f5] border-2 border-orange-400 flex items-center justify-center shadow-sm text-lg">
                        {codename.emoji}
                      </div>

                      <div className="bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-sm overflow-hidden">
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
            <div className="mt-12 pt-8 border-t border-[#e7e5df]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] p-4">
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

                <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] p-4">
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

                <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] p-4">
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
                    className="bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-sm overflow-hidden"
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
            <div className="mt-8 p-6 bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-[#e7e5df]">
                  <div className="text-3xl font-bold text-slate-900">{SYSTEM_MODULES.length}</div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Módulos</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-[#e7e5df]">
                  <div className="text-3xl font-bold text-slate-900">
                    {SYSTEM_MODULES.reduce((acc, m) => acc + m.features.length, 0)}
                  </div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Funcionalidades</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-[#e7e5df]">
                  <div className="text-3xl font-bold text-slate-900">{releases.length}</div>
                  <div className="text-sm text-slate-600 font-medium mt-1">Versões</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-[#e7e5df]">
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
