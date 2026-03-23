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

/* ============================================================================
   CODINOMES DAS VERSÕES
   
   Inspirados em tipos de café brasileiro ☕
   Cada versão recebe um codinome divertido e memorável.
   ============================================================================ */

const VERSION_CODENAMES: Record<string, { name: string; emoji: string }> = {
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

const releases: ReleaseNote[] = [
  {
    version: '1.9.993',
    date: '23/03/2026',
    summary: 'Correspondentes/Processos: o vínculo passou a reconhecer audiências futuras do processo mesmo antes de existirem como evento da agenda.',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'fix',
            title: 'Audiências do processo disponíveis no seletor de vínculo',
            description: 'O painel de Correspondentes passou a considerar audiências futuras registradas em `hearing_date` e `hearing_time`, ainda que não exista evento persistido em `calendar_events`.',
          },
          {
            type: 'fix',
            title: 'Criação automática do compromisso da agenda ao vincular',
            description: 'Ao selecionar uma audiência vinda diretamente do processo, o sistema cria o evento correspondente na agenda antes de concluir o vínculo do correspondente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.992',
    date: '23/03/2026',
    summary: 'Correspondentes/Processos: audiências cadastradas no processo passaram a aparecer no seletor de compromissos para vínculo.',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'fix',
            title: 'Seletor de compromissos agora inclui audiências do módulo de Processos',
            description: 'O painel de Correspondentes passou a exibir também audiências vindas de `hearing_date` e `hearing_time`, mesmo antes de existir um evento persistido na agenda.',
          },
          {
            type: 'fix',
            title: 'Vínculo cria automaticamente o evento da agenda quando necessário',
            description: 'Ao escolher uma audiência originada do processo, o sistema cria o evento correspondente em `calendar_events` antes de salvar o vínculo do correspondente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.991',
    date: '23/03/2026',
    summary: 'Correspondentes: o modal de novo cadastro passou a rolar corretamente, mantendo o botão de ação visível em telas menores.',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'fix',
            title: 'Modal de Novo Correspondente com scroll funcional',
            description: 'O formulário de cadastro agora permite rolagem vertical completa e mantém o rodapé de ação acessível, evitando que o botão final fique escondido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.990',
    date: '20/03/2026',
    summary: 'Cloud: o arraste deixou de conflitar com o drag nativo do preview, evitando arquivos indevidos como download.png e preservando a movimentação múltipla.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drag interno padronizado nos cards do Cloud',
            description: 'Os cards passaram a iniciar o arraste usando um handler interno único, com preenchimento explícito do dataTransfer para manter o drop consistente.',
          },
          {
            type: 'fix',
            title: 'Preview deixou de disparar drag nativo do navegador',
            description: 'As imagens de preview de arquivos e PDFs passaram a bloquear o arraste nativo do browser, evitando a geração indevida de arquivos como download.png durante a movimentação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.989',
    date: '20/03/2026',
    summary: 'Cloud: o arraste passou a respeitar a seleção múltipla, permitindo mover vários itens juntos em uma única operação.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drag-and-drop agora leva toda a seleção atual',
            description: 'Quando o arraste começa em um item já selecionado, o Cloud agora inclui todos os documentos e pastas da seleção na mesma operação de mover.',
          },
          {
            type: 'fix',
            title: 'Drop em pasta, lixeira e arquivados deixou de processar apenas um item',
            description: 'Os destinos de drag-and-drop passaram a iterar sobre toda a seleção ativa, corrigindo o problema em que somente o item de origem era movimentado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.988',
    date: '20/03/2026',
    summary: 'App/Auth: contadores inválidos e falhas transitórias de sessão/rede passaram a ser tratados com mais robustez para evitar ruído visual e no console.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Badge de tarefas deixou de aceitar valores inválidos no render',
            description: 'Os contadores exibidos no header e em layouts compartilhados agora sanitizam valores não numéricos antes de renderizar, evitando avisos como `Received NaN for the children attribute`.',
          },
          {
            type: 'fix',
            title: 'Carregamentos dependentes da sessão ficaram mais tolerantes a oscilações do Supabase',
            description: 'As leituras de perfil e tarefas passaram a tratar como transitórias as falhas de autenticação/rede durante troca ou renovação de sessão, reduzindo erros ruidosos no console sem quebrar a interface.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.987',
    date: '20/03/2026',
    summary: 'Cloud: o carregamento inicial do módulo passou a abrir com um skeleton completo e animado, substituindo a área branca temporária.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Abertura do Cloud ganhou skeleton completo no carregamento lazy',
            description: 'Enquanto o bundle do módulo ainda está sendo carregado pelo React, o app agora mostra uma estrutura visual do Cloud com navegação, painel e cards animados, evitando a sensação de tela vazia.',
          },
          {
            type: 'improvement',
            title: 'Entrada visual do módulo ficou mais fluida desde o primeiro frame',
            description: 'O fallback do `Suspense` foi personalizado para o Cloud, mantendo continuidade visual entre o shell do app e o conteúdo do explorador antes da montagem final do componente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.986',
    date: '19/03/2026',
    summary: 'Cloud: corrigido o badge inferior dos cards de pasta para não manter o texto de alerta após a resolução.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Rodapé do card não mostra mais alerta em pasta resolvida',
            description: 'O selo vermelho inferior deixou de ser exibido quando a pasta já está resolvida e sem pendência ativa, eliminando a inconsistência visual do card.',
          },
          {
            type: 'fix',
            title: 'Texto do badge inferior passou a respeitar o tipo real da ocorrência',
            description: 'Quando ainda existe ocorrência ativa, o rodapé do card passa a mostrar corretamente `Alerta` ou `Pendência`, em vez de manter `Alerta` como texto fixo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.985',
    date: '19/03/2026',
    summary: 'Cloud: corrigida a hierarquia visual do status resolvido e removido o bloqueio indevido de acesso para auxiliares no módulo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Pasta resolvida não permanece mais com aparência de alerta',
            description: 'O badge visual do Cloud passou a priorizar o estado `Resolvido` quando a pasta já não possui pendência ativa, evitando que o visual de alerta continue aparecendo após a resolução.',
          },
          {
            type: 'fix',
            title: 'Auxiliar deixou de sofrer bloqueio indevido no acesso ao Cloud',
            description: 'A checagem de acesso ao módulo Cloud passou a aceitar também a permissão específica `cloud`, em vez de depender apenas da permissão de `documentos`, removendo a limitação reportada para usuários auxiliares.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.984',
    date: '19/03/2026',
    summary: 'Cloud PDF: corrigida a condição do card que impedia a miniatura do PDF de aparecer mesmo após a geração segura da primeira página.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Cards de PDF passaram a ler o estado correto da miniatura',
            description: 'A renderização do card deixou de depender do `previewUrl` das imagens e passou a considerar diretamente o estado `cardPdfThumbnailUrls` dos PDFs.',
          },
          {
            type: 'fix',
            title: 'Ícone vermelho deixou de bloquear a exibição da capa do PDF',
            description: 'Foi corrigida a condição lógica que mantinha o card preso no visual de fallback mesmo quando a miniatura da primeira página já estava sendo gerada pelo fluxo seguro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.983',
    date: '19/03/2026',
    summary: 'Cloud PDF: corrigido o fluxo final de geração das miniaturas dos cards para que a primeira página volte a aparecer corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Thumbnail dos PDFs voltou a renderizar nos cards',
            description: 'A geração da miniatura da primeira página foi ajustada para carregar o arquivo por bytes antes da renderização, restaurando a visualização real nos cards do Cloud.',
          },
          {
            type: 'fix',
            title: 'Fallback do ícone deixou de ser o estado permanente dos PDFs',
            description: 'Os cards deixaram de ficar presos no visual simplificado do ícone vermelho quando o thumbnail podia ser gerado normalmente, mantendo a abordagem segura sem montar `Page` direto na grid.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.982',
    date: '19/03/2026',
    summary: 'Cloud PDF: os cards voltaram a mostrar a primeira página do PDF com thumbnail segura e sem reintroduzir o crash do preview.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview visual dos PDFs restaurado nos cards',
            description: 'Os cards do Cloud voltaram a exibir uma miniatura real da primeira página do PDF, preservando a leitura visual da listagem.',
          },
          {
            type: 'fix',
            title: 'Thumbnail segura gerada fora do componente `Page`',
            description: 'A miniatura agora é renderizada com `pdfjs` em `canvas` e convertida para imagem, evitando a montagem direta de `Page` na grid e mantendo a proteção contra o erro `sendWithPromise`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.981',
    date: '19/03/2026',
    summary: 'Cloud PDF: removido o preview resumido instável com react-pdf nos cards para eliminar um crash recorrente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Thumbnail de PDF dos cards trocado por preview estável',
            description: 'Os cards de arquivos PDF deixaram de montar o componente `Page` do `react-pdf` para a miniatura rápida, passando a usar um bloco visual leve e previsível.',
          },
          {
            type: 'fix',
            title: 'Crash no preview resumido do Cloud eliminado',
            description: 'A região do card apontada pelo stack trace deixou de depender do worker do PDF.js, evitando o erro `Cannot read properties of null (reading sendWithPromise)` durante a montagem do preview.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.980',
    date: '19/03/2026',
    summary: 'Cloud PDF Hub: corrigido o erro intermitente do react-pdf ao alternar entre visualizações e modos de edição.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Estados de carregamento do PDF separados por contexto',
            description: 'O Hub PDF deixou de compartilhar o mesmo estado de documento pronto entre as miniaturas e a grade de edição, evitando que páginas fossem renderizadas antes do `Document` correto terminar de carregar.',
          },
          {
            type: 'fix',
            title: 'Crash do `Page` reduzido ao trocar de modo',
            description: 'A troca entre os modos do Hub PDF agora reinicia corretamente os estados de readiness do preview, reduzindo falhas como `Cannot read properties of null (reading sendWithPromise)` no `react-pdf`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.979',
    date: '19/03/2026',
    summary: 'Cloud Mobile: topo do preview compactado para deixar o PDF e os documentos como protagonistas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Header do preview reduzido para linha única',
            description: 'O topo do preview mobile passou a usar apenas uma linha com o nome do arquivo truncado, reduzindo a altura ocupada antes do conteúdo.',
          },
          {
            type: 'improvement',
            title: 'Ações convertidas em ícones e exclusão movida para menu secundário',
            description: 'As ações principais foram condensadas em ícones discretos e a ação de excluir deixou de competir visualmente com o conteúdo, passando a viver em um menu secundário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.978',
    date: '19/03/2026',
    summary: 'Cloud Mobile: preview de documentos e PDFs reorganizado para um layout mais limpo no celular.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cabeçalho do preview mobile reorganizado',
            description: 'O topo do modal de preview passou a ter título com melhor quebra de linha, botão de fechar isolado e ações com hierarquia mais clara no mobile.',
          },
          {
            type: 'improvement',
            title: 'Ações do preview distribuídas em layout mais limpo',
            description: 'Botões como `Renomear`, `Baixar`, `Hub PDF`, `Excluir` e `Girar 90°` foram redistribuídos para evitar empilhamento feio e poluição visual em telas pequenas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.977',
    date: '19/03/2026',
    summary: 'Cloud Mobile: itens voltaram a abrir com um toque, incluindo documentos e PDFs.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Abertura mobile com um toque restaurada para arquivos',
            description: 'Arquivos, documentos Word e PDFs do Cloud passaram a abrir com um toque no mobile, alinhando o comportamento com as pastas e com a expectativa de uso em telas touch.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.976',
    date: '19/03/2026',
    summary: 'Chat Mobile: botão flutuante reposicionado para ficar acima da barra inferior.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Launcher do chat elevado no mobile',
            description: 'O botão flutuante do chat foi reposicionado para cima no mobile, evitando aparência baixa demais e melhorando a convivência com barras inferiores fixas como a do Cloud.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.975',
    date: '19/03/2026',
    summary: 'Cloud Mobile: botão sanduíche do header voltou a abrir o menu principal do sistema.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Sanduíche do topo reconfigurado para o menu do sistema',
            description: 'O botão de menu do header mobile do Cloud voltou a abrir a navegação principal do sistema, enquanto o menu interno do módulo permanece disponível pela barra inferior.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.974',
    date: '19/03/2026',
    summary: 'Cloud Mobile: organização final dos botões de ação para evitar conflito com o chat.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'FAB redundante removido do mobile',
            description: 'O botão flutuante adicional com ícone `+` foi removido para evitar duplicidade de ação e poluição visual no canto inferior.',
          },
          {
            type: 'improvement',
            title: 'Upload centralizado na barra inferior',
            description: 'A ação de envio foi mantida apenas na navegação fixa do rodapé, deixando o fluxo mais previsível e organizado no mobile.',
          },
          {
            type: 'improvement',
            title: 'Espaço reservado para o chat flutuante',
            description: 'A barra inferior do Cloud foi ajustada para reservar área visual ao chat flutuante, reduzindo sobreposição e conflito entre controles.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.973',
    date: '19/03/2026',
    summary: 'Cloud Mobile: navegação fixa no rodapé com voltar, início, menu, filtro e envio.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Barra de navegação fixa no rodapé mobile',
            description: 'O Cloud no celular passou a ter uma barra fixa inferior com ações rápidas para `Voltar`, `Início`, `Menu`, `Filtrar` e `Enviar`, reduzindo esforço de navegação.',
          },
          {
            type: 'improvement',
            title: 'Ação de voltar entre pastas no mobile',
            description: 'Foi adicionada uma ação dedicada para retornar à pasta anterior e também sair rapidamente das views de Arquivado e Lixeira.',
          },
          {
            type: 'improvement',
            title: 'Botão de envio reposicionado acima do rodapé',
            description: 'O botão flutuante de envio foi movido para evitar conflito visual e sobreposição com o chat flutuante no canto inferior direito.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.972',
    date: '19/03/2026',
    summary: 'Cloud Mobile: correção da interação do header compacto e abertura de pastas no mobile.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Busca do header voltou a aceitar digitação',
            description: 'O campo `Buscar no Cloud` no header mobile foi reconectado ao estado interno do Cloud, permitindo digitar e filtrar os arquivos normalmente.',
          },
          {
            type: 'fix',
            title: 'Menu do topo voltou a abrir a navegação lateral',
            description: 'O botão de menu do header compacto agora controla corretamente a sidebar interna do Cloud no mobile.',
          },
          {
            type: 'fix',
            title: 'Pastas abrem com um toque no mobile',
            description: 'A interação dos cards/lista foi ajustada para que as pastas sejam abertas com um toque em telas pequenas, sem depender de duplo clique.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.971',
    date: '19/03/2026',
    summary: 'Cloud Mobile: redesenho radical para eliminar poluição visual e priorizar conteúdo imediato.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Header ultra-compacto em linha única',
            description: 'O header foi simplificado para apenas menu + busca + avatar em uma única linha, eliminando elementos redundantes e reduzindo drasticamente o espaço acima da dobra.',
          },
          {
            type: 'improvement',
            title: 'Seção "Navegação" removida',
            description: 'A seção destacada de navegação foi removida e integrada ao menu lateral, acessível via botão de menu no header.',
          },
          {
            type: 'improvement',
            title: 'Busca duplicada eliminada',
            description: 'Removida a segunda barra de busca dentro do Cloud, mantendo apenas o acesso centralizado no header pill-shaped.',
          },
          {
            type: 'improvement',
            title: 'Filtros colapsáveis em botão "Filtrar"',
            description: 'Tabs e filtros horizontais foram convertidos em um único botão "Filtrar" discreto, liberando espaço para o conteúdo principal.',
          },
          {
            type: 'improvement',
            title: 'Conteúdo aparece imediatamente após header',
            description: 'Com a remoção dos elementos visuais intermediários, os arquivos agora são exibidos logo após o header compacto, sem scroll visual desnecessário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.970',
    date: '19/03/2026',
    summary: 'Cloud Mobile: recriação fiel da UI com header pill-shaped, título Arquivos, chips horizontais e FAB para upload rápido.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Header mobile pill-shaped com menu, busca e avatar',
            description: 'O header do Cloud mobile foi recriado como uma barra arredondada única (pill-shaped) contendo menu à esquerda, texto de busca centralizado e avatar do usuário à direita, inspirado em apps de arquivos modernos como Google Drive.',
          },
          {
            type: 'improvement',
            title: 'Título "Arquivos" e chips horizontais scrolláveis',
            description: 'A área principal agora exibe um título grande "Arquivos" seguido por chips horizontais para Filtros ativos, Pastas, Documentos e contador de itens, proporcionando navegação rápida e contextual.',
          },
          {
            type: 'improvement',
            title: 'FAB (Floating Action Button) para upload rápido',
            description: 'Adicionado botão de ação flutuante fixo no canto inferior direito, com gradiente laranja/âmbar e ícone de +, permitindo upload de arquivos com um toque, otimizado para dispositivos móveis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.969',
    date: '19/03/2026',
    summary: 'Cloud: mobile refinado com shell inspirada em apps de arquivos, header arredondado e cards mais limpos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cloud mobile com shell visual inspirada em Google Drive',
            description: 'O topo do Cloud no celular passou a usar uma composição mais leve e separada, com header arredondado, chips de contexto, barra secundária mais organizada e melhor hierarquia visual entre navegação e ações.',
          },
          {
            type: 'improvement',
            title: 'Cards e área de exploração refinados no mobile',
            description: 'A área principal do Cloud recebeu breadcrumb arredondado, busca mais suave e cards com espaçamento e acabamento visual mais próximos de um gerenciador de arquivos mobile moderno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.968',
    date: '19/03/2026',
    summary: 'Cloud: topo mobile reorganizado para uma experiência mais limpa e menos poluída.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Header mobile do Cloud compactado',
            description: 'As ações do topo do Cloud no celular foram reagrupadas para evitar excesso de blocos visuais, escondendo controles secundários em telas pequenas e mantendo foco nas ações principais.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.967',
    date: '19/03/2026',
    summary: 'Cloud: correção do erro de DOM no menu lateral e melhoria da experiência mobile com navegação em drawer.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Estrutura inválida de botão corrigida no menu lateral',
            description: 'A seção Caixa de entrada do sidebar interno do Cloud deixou de renderizar um botão dentro de outro, eliminando o aviso de DOM nesting e o risco de hydration error.',
          },
          {
            type: 'improvement',
            title: 'Cloud mobile com navegação mais próxima de app de arquivos',
            description: 'No celular, o módulo passou a usar drawer lateral com overlay, header compacto, melhor hierarquia visual e leitura mais confortável para navegação parecida com apps como o Google Drive.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.966',
    date: '18/03/2026',
    summary: 'Cloud: o indicador de vínculo das pastas foi movido para o rodapé do card, ao lado da data/hora.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Indicador de vínculo reposicionado no card',
            description: 'Os cards de pasta do Cloud agora exibem o indicador visual de vínculo/correção no rodapé, ao lado da data e hora, liberando o topo para uma leitura mais limpa do status principal.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.965',
    date: '18/03/2026',
    summary: 'Cloud: a seta para expandir ou recolher a lista de clientes foi movida para a linha da Caixa de entrada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Expansão de clientes integrada à Caixa de entrada',
            description: 'A navegação interna do Cloud passou a concentrar o controle de expansão da seção Clientes na própria linha da Caixa de entrada, mantendo a lista recolhida por padrão e deixando o menu mais direto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.964',
    date: '18/03/2026',
    summary: 'Cloud: refatoração visual completa do menu lateral interno com blocos mais modernos e melhor hierarquia.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Menu lateral interno do Cloud redesenhado',
            description: 'O sidebar interno do módulo Cloud recebeu header refinado, blocos visuais para Caixa de entrada, Arquivado, Lixeira, Acesso Rápido, Favoritos e Recentes, além de gradientes, badges estilizados, divisores elegantes e melhor espaçamento geral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.958',
    date: '18/03/2026',
    summary: 'Agenda/Processos: o modal de audiência passou a usar fallback do processo carregado para exibir a tramitação.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Fallback da tramitação no modal de audiência',
            description: 'Quando o dado embutido no evento não trouxer a vara/órgão, o modal agora consulta o processo já carregado no calendário para exibir corretamente a tramitação abaixo do número do processo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.957',
    date: '18/03/2026',
    summary: 'Agenda/Processos: o modal do compromisso passou a mostrar a tramitação logo abaixo do número do processo.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Tramitação abaixo do número do processo',
            description: 'No bloco de detalhes do compromisso vinculado a processo, o número do processo agora exibe em seguida a vara/órgão de tramitação, sem duplicar a informação em uma linha separada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.956',
    date: '18/03/2026',
    summary: 'Agenda: modal de compromisso voltou a usar aparência clara e legível.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Correção do fundo escuro no modal',
            description: 'O modal de detalhes do compromisso deixou de herdar o visual escuro e passou a manter fundo branco, textos escuros e cartões claros para leitura consistente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.955',
    date: '18/03/2026',
    summary: 'Agenda: modal de compromisso refeito com design clean e moderno.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de detalhes refeito',
            description: 'O modal de detalhes do compromisso ganhou um design completamente novo: header compacto com título e badges, corpo com ícones coloridos para cada informação, card do correspondente simplificado, e footer com botões menores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.954',
    date: '18/03/2026',
    summary: 'Agenda: modal de compromisso passou a usar ainda mais altura útil da tela.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Mais área visível no modal de compromisso',
            description: 'O modal de detalhes do compromisso teve o limite vertical ampliado novamente e ganhou menos margem externa para exibir mais conteúdo antes da rolagem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.953',
    date: '18/03/2026',
    summary: 'Agenda: modal de compromisso ficou ligeiramente mais alto, sem alterar a estrutura do layout.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Ajuste fino na altura do modal',
            description: 'O modal de detalhes do compromisso ganhou um pouco mais de altura útil, mantendo scroll interno e o restante da organização visual já refinada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.952',
    date: '18/03/2026',
    summary: 'Agenda: modal de compromisso ficou mais clean, com menos altura visual e card de correspondente simplificado.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de compromisso mais clean',
            description: 'O modal de detalhes do compromisso foi reorganizado para ter menos altura visual e um card de correspondente mais simples.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.951',
    date: '18/03/2026',
    summary: 'Agenda: layout do card de apoio externo foi corrigido para funcionar melhor em espaços estreitos.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Card de apoio externo sem compressão visual',
            description: 'O card do correspondente vinculado no modal do compromisso foi reorganizado para evitar textos esmagados, CTA espremido e blocos informativos ilegíveis em telas menores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.950',
    date: '18/03/2026',
    summary: 'Correspondentes: alteração de status da diligência ficou direta no card de vínculos.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Troca rápida de status da diligência',
            description: 'Os vínculos agora permitem alterar o status da diligência diretamente no card, com seletor visível e sem exigir abertura do modal de edição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.949',
    date: '18/03/2026',
    summary: 'Correspondentes/Agenda: CTA de WhatsApp refinado e local da diligência adicionado ao vínculo com compromisso.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'CTA de WhatsApp com mais clareza visual',
            description: 'O botão para contato no WhatsApp do correspondente vinculado passou a ter destaque maior, melhor hierarquia visual e fallback informativo quando não houver número válido.',
          },
          {
            type: 'feature',
            title: 'Local da diligência no vínculo do correspondente',
            description: 'O vínculo com compromisso agora permite cadastrar e visualizar o local da diligência no painel de Correspondentes e no modal de detalhes do evento na agenda.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.948',
    date: '18/03/2026',
    summary: 'Agenda: card de correspondente vinculado ao compromisso recebeu refinamento visual no modal do evento.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Card de correspondente com visual mais premium',
            description: 'O bloco de correspondente vinculado ao compromisso ganhou cabeçalho mais elegante, avatar com inicial, selo de vínculo, blocos informativos e botão de WhatsApp com mais destaque visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.947',
    date: '18/03/2026',
    summary: 'Agenda: calendário passou a recarregar automaticamente após mudanças em vínculos de correspondentes no painel integrado.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Refresh automático após alterar vínculos de correspondentes',
            description: 'Ao criar, editar, remover, arquivar, reativar ou registrar pagamento em diligências pelo painel de Correspondentes aberto dentro da agenda, o CalendarModule agora recarrega seus dados automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.946',
    date: '18/03/2026',
    summary: 'Correspondentes: arquivamento foi separado do status cancelado e o submódulo ganhou hierarquia visual mais clara.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Arquivado separado de cancelado',
            description: 'As diligências passaram a usar um flag próprio de arquivamento, evitando que o status operacional do serviço seja alterado para Cancelado ao arquivar.',
          },
          {
            type: 'improvement',
            title: 'Hierarquia visual do submódulo refinada',
            description: 'O painel ganhou bloco de contexto por aba e cards com hierarquia visual mais clara para vínculos ativos e histórico arquivado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.945',
    date: '18/03/2026',
    summary: 'Correspondentes: diligências arquivadas saíram da lista principal e a aba Arquivados passou a usar a ação Reativar diligência.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Lista principal limpa e reativação explícita',
            description: 'Diligências canceladas, realizadas ou não comparecidas deixaram de aparecer na lista principal de vínculos. Na aba Arquivados, a ação foi renomeada para Reativar diligência para refletir melhor o fluxo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.944',
    date: '18/03/2026',
    summary: 'Correspondentes: arquivamento foi corrigido para agir sobre diligências/vínculos, não sobre o cadastro do correspondente.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'fix',
            title: 'Arquivamento movido para os vínculos',
            description: 'O botão Arquivar saiu do cadastro do correspondente e passou a atuar diretamente nas diligências da aba de vínculos. A aba Arquivados também passou a permitir restaurar a diligência encerrada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.943',
    date: '18/03/2026',
    summary: 'Correspondentes: painel reorganizado para priorizar vínculos, diligências ativas e histórico de compromissos arquivados.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Painel de correspondentes reorganizado',
            description: 'A aba de vínculos com compromissos passou a ser a principal, o histórico de arquivados agora mostra diligências encerradas e os cards de resumo foram reorganizados para destacar diligências ativas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.942',
    date: '18/03/2026',
    summary: 'Correspondentes: nomenclatura visível foi atualizada no painel e no calendário.',
    modules: [
      {
        moduleId: 'calendar',
        changes: [
          {
            type: 'improvement',
            title: 'Rótulos de correspondente padronizados',
            description: 'Os textos visíveis ao usuário foram ajustados para usar Correspondente/Correspondentes no lugar de Preposto/Prepostos no calendário e no painel relacionado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.941',
    date: '18/03/2026',
    summary: 'Assinaturas: arraste e movimentação no explorador foram liberados para itens de qualquer criador.',
    modules: [
      {
        moduleId: 'signature',
        changes: [
          {
            type: 'fix',
            title: 'Arraste liberado no explorador de assinaturas',
            description: 'A trava que impedia mover solicitações e documentos criados por outros usuários foi removida. Ao mover entre pastas, o registro continua preservando o created_by original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.940',
    date: '17/03/2026',
    summary: 'Editor de petições: removido o mini servidor local do Syncfusion e restaurado o uso direto do link público.',
    modules: [
      {
        moduleId: 'petitions',
        changes: [
          {
            type: 'fix',
            title: 'Link público do Syncfusion restaurado',
            description: 'Removido o mini servidor local e scripts auxiliares. O editor agora usa diretamente https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/ como fallback padrão, mantendo suporte a VITE_SYNC_FUSION.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.915',
    date: '13/03/2026',
    summary: 'Cloud: menu de contexto da área em branco voltou a executar as ações corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Ações da área em branco restauradas',
            description: 'O menu de contexto aberto fora de arquivos e pastas passou a usar a mesma referência de proteção contra fechamento global, liberando os cliques em Nova pasta, Enviar arquivos, Colar imagem e Atualizar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.914',
    date: '13/03/2026',
    summary: 'Cloud: menu de contexto de arquivos passou a ter scroll para exibir todas as ações.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Scroll no menu de arquivo',
            description: 'O menu de contexto de arquivos agora limita a altura na viewport e permite rolagem, garantindo acesso a todas as opções mesmo em telas menores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.913',
    date: '13/03/2026',
    summary: 'Cloud: menu de contexto de arquivos voltou a aceitar clique após ajuste no fechamento global por mousedown.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Clique dos itens do menu restaurado',
            description: 'O menu de contexto de arquivos recebeu a referência usada pela rotina global de fechamento, evitando que o menu fosse encerrado antes da execução dos handlers ao clicar em Abrir, Baixar, Mover, Renomear e demais ações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.912',
    date: '13/03/2026',
    summary: 'Cloud: menu de contexto de arquivos corrigido após conflito entre blocos duplicados.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Menu de arquivo voltou a responder',
            description: 'O bloco duplicado do menu de contexto de arquivos foi removido, restabelecendo o funcionamento dos itens como abrir, baixar, mover, renomear, copiar e excluir.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.911',
    date: '13/03/2026',
    summary: 'Cloud: ação de fixar arquivos e pastas passou a exibir confirmação visual imediata.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Feedback ao fixar/desafixar',
            description: 'Os botões de pin no Cloud agora mostram confirmação ao fixar ou remover arquivos e pastas dos favoritos, evitando a impressão de que o clique não funcionou.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.910',
    date: '13/03/2026',
    summary: 'Cloud: badges de status das pastas simplificados para evitar conflito visual.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Status da pasta sem contradição',
            description: 'Os cards do Cloud deixaram de exibir simultaneamente etiquetas padrão que conflitam com o status real da pasta, como Pendente junto de Resolvido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.909',
    date: '13/03/2026',
    summary: 'Assinatura: corrigido o erro de build por ordem de declaração do estado do cliente.',
    modules: [
      {
        moduleId: 'signature',
        changes: [
          {
            type: 'fix',
            title: 'selectedClientId usado na ordem correta',
            description: 'O carregamento do telefone do cliente no módulo Assinatura foi reposicionado para depois da declaração do estado, eliminando o erro de build do TypeScript.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.908',
    date: '13/03/2026',
    summary: 'Cloud: breadcrumb do topo ajustado para usar melhor o espaço disponível.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Mais espaço para a navegação',
            description: 'A barra superior do Cloud foi redistribuída para dar prioridade ao breadcrumb da pasta e reduzir o truncamento desnecessário mesmo quando ainda há espaço livre.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.907',
    date: '13/03/2026',
    summary: 'Cloud: layout do topo ajustado para acomodar telefone do cliente sem quebrar a barra.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Header com telefone compactado',
            description: 'O cabeçalho do Cloud foi reorganizado para manter busca, nome do cliente, telefone e WA.me alinhados sem deformar a barra superior.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.906',
    date: '13/03/2026',
    summary: 'Cloud: corrigido o crash do cabeçalho após a inclusão do telefone do cliente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Import do ícone Phone ajustado',
            description: 'O Cloud voltou a renderizar normalmente após a correção da importação do ícone Phone usado no cabeçalho com telefone e atalho WA.me.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.905',
    date: '13/03/2026',
    summary: 'Cloud: o topo da pasta agora mostra telefone do cliente com atalho para WhatsApp.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Telefone do cliente no cabeçalho',
            description: 'O chip do cliente no topo do Cloud agora exibe também o telefone principal com um atalho WA.me para abrir o WhatsApp diretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.904',
    date: '13/03/2026',
    summary: 'Cloud: corrigida a falha de build causada pela ação Nova pasta.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Ação Nova pasta restaurada',
            description: 'A referência ausente de handleOpenCreateFolder foi corrigida no Cloud, restaurando a abertura do modal de criação de pasta e evitando falha de build no deploy.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.903',
    date: '13/03/2026',
    summary: 'Assinatura: o cliente selecionado agora mostra telefone e atalho para WhatsApp.',
    modules: [
      {
        moduleId: 'signature',
        changes: [
          {
            type: 'improvement',
            title: 'Telefone do cliente com WA.me',
            description: 'No fluxo de assinatura, o cliente vinculado ao documento agora exibe o telefone principal com um atalho direto para abrir conversa no WhatsApp via wa.me.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.902',
    date: '13/03/2026',
    summary: 'Cloud: baixar pasta agora mostra uma tela de carregamento visível durante a montagem do ZIP.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Tela de espera no download da pasta',
            description: 'Ao baixar uma pasta no Cloud, o sistema agora abre uma camada visual central com a mensagem Aguarde... estamos montando a pasta..., tornando o processamento perceptível até o início do download.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.901',
    date: '13/03/2026',
    summary: 'Cloud: o download de pasta agora mostra a mensagem Aguarde... montando pasta... durante a preparação do ZIP.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Feedback visual ao baixar pasta',
            description: 'Enquanto o Cloud monta o arquivo ZIP para baixar uma pasta, o botão e o menu contextual passam a exibir a mensagem Aguarde... montando pasta..., deixando o processo mais claro para o usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.900',
    date: '13/03/2026',
    summary: 'Cloud: badges de alerta das pastas agora exibem uma sirene animada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Sirene animada no alerta',
            description: 'Quando uma pasta estiver marcada como alerta no Cloud, o badge agora mostra uma sirene animada para reforçar a urgência visualmente na listagem e nos detalhes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.899',
    date: '13/03/2026',
    summary: 'Cloud: o motivo de alerta ou pendência nos cards de pasta ganhou destaque em vermelho.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Motivo com destaque visual maior',
            description: 'O texto do motivo exibido nos cards de pasta do Cloud agora aparece em vermelho, deixando alertas e pendências mais perceptíveis na listagem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.898',
    date: '13/03/2026',
    summary: 'Cloud: o card da pasta agora mostra o motivo registrado no alerta ou na pendência.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Motivo visível no card da pasta',
            description: 'Além do badge de alerta ou pendência, os cards de pasta do Cloud agora exibem o motivo registrado, facilitando a leitura rápida sem precisar abrir os detalhes da pasta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.897',
    date: '13/03/2026',
    summary: 'Cloud: menu de pasta com rolagem, modal rápido claro e badge visível de alerta/pendência nos cards.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Ações rápidas de pasta mais visíveis',
            description: 'O menu contextual das pastas agora pode ser rolado para mostrar todas as opções, o modal rápido de pendência/alerta foi alinhado ao tema claro do Cloud e os cards de pasta passaram a exibir o badge de alerta ou pendência após o salvamento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.896',
    date: '13/03/2026',
    summary: 'Cloud: ações rápidas de alerta e pendência agora exigem motivo no modal, com fechamento do menu apenas por clique fora.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Motivo obrigatório nas ações rápidas de pasta',
            description: 'Ao marcar alerta ou pendência pelo menu contextual do Cloud, o sistema abre um modal para registrar o motivo antes de salvar. O menu também passou a usar fechamento por clique fora, evitando sumiços indevidos durante a navegação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.895',
    date: '13/03/2026',
    summary: 'Cloud: o menu contextual das pastas ficou persistente no scroll e ganhou ações rápidas de pendência, alerta e resolução.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Menu contextual de pasta mais útil',
            description: 'O menu contextual do Cloud agora permanece aberto durante o scroll e passou a oferecer ações rápidas para marcar pastas como pendência, alerta ou resolvido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.894',
    date: '13/03/2026',
    summary: 'Cloud: pastas agora podem ser marcadas com pendência ou alerta, com motivo e resolução.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Pendência e alerta nas pastas',
            description: 'O Cloud passou a permitir marcar pastas com status de pendência ou alerta, registrar o motivo e marcar a situação como resolvida diretamente pelo painel lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.893',
    date: '13/03/2026',
    summary: 'Cloud: o player de vídeo deixou de repetir o nome do arquivo em dois cabeçalhos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Título duplicado removido do player',
            description: 'O preview de vídeo do Cloud agora exibe o nome do arquivo apenas no cabeçalho principal do modal, eliminando a repetição visual dentro do player.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.892',
    date: '13/03/2026',
    summary: 'Cloud: o player de vídeo foi redesenhado para um visual mais limpo, focado no conteúdo e com branding Jurius discreto.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Player de vídeo mais limpo',
            description: 'O preview de vídeo do Cloud agora usa uma composição mais sóbria e coerente com o restante da interface, reduzindo elementos decorativos e destacando o vídeo em primeiro plano.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.891',
    date: '13/03/2026',
    summary: 'Cloud: vídeos agora abrem em um player próprio com identidade visual Jurius.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Player de vídeo Jurius no Cloud',
            description: 'O preview do Cloud agora reconhece vídeos e abre um reprodutor próprio com visual premium da marca Jurius, controles nativos e experiência mais adequada para arquivos de mídia.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.890',
    date: '13/03/2026',
    summary: 'Cloud: o preview de PDF das ferramentas ficou estável ao montar páginas apenas depois que o documento termina de carregar.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview PDF sem crash nas ferramentas',
            description: 'As ferramentas de PDF do Cloud agora esperam o `Document` do `react-pdf` ficar pronto antes de renderizar as páginas e resetam esse estado ao trocar ou fechar o arquivo, evitando o erro `sendWithPromise` em `null`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.889',
    date: '12/03/2026',
    summary: 'Cloud: o colar agora exibe aviso de progresso enquanto a operação está em andamento.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Aviso durante a colagem',
            description: 'Ao colar arquivos ou pastas no Cloud, o sistema agora mostra um aviso persistente de processamento e impede uma segunda tentativa até a conclusão da colagem atual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.888',
    date: '12/03/2026',
    summary: 'Cloud: o arraste de arquivos externos passou a processar o drop apenas uma vez, evitando uploads duplicados.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drop externo sem duplicação',
            description: 'O Cloud agora bloqueia o segundo processamento do mesmo evento de drop quando arquivos são arrastados de fora para dentro da área central, impedindo que o mesmo arquivo seja enviado duas vezes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.887',
    date: '12/03/2026',
    summary: 'Cloud: ao colar itens em outra pasta, o sistema agora preserva o nome original e usa o marcador de cópia apenas quando o destino é o mesmo da origem.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Sufixo de cópia só no mesmo destino',
            description: 'Arquivos e pastas copiados entre pastas diferentes no Cloud deixam de receber automaticamente o sufixo `(cópia)`. Esse marcador permanece apenas quando a duplicação acontece no mesmo local de origem, evitando nomes desnecessariamente alterados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.886',
    date: '12/03/2026',
    summary: 'Cloud: a renomeação de arquivos passou a preservar automaticamente a extensão no modal e no modo inline.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Extensão protegida ao renomear',
            description: 'O Cloud agora separa nome base e extensão em todos os fluxos principais de renomear arquivo, mantendo o sufixo visível e bloqueado para evitar alterações acidentais como .docx, .pdf, .jpg e similares.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.885',
    date: '12/03/2026',
    summary: 'Cloud: o modal de converter imagens em PDF passou a abrir acima do preview, sem ficar escondido atrás da visualização atual.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Conversão PDF acima do preview',
            description: 'Ao converter uma imagem em PDF a partir do preview, o Cloud agora fecha a visualização atual e abre o modal de conversão em uma camada superior, evitando que ele fique atrás do modal já aberto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.884',
    date: '12/03/2026',
    summary: 'Cloud: corrigido o erro de build no hub de PDF com a restauração da função de fechamento do modal.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Fechamento do hub PDF restaurado',
            description: 'O Cloud voltou a declarar a função `closePdfToolsModal`, eliminando o erro de build e restabelecendo o fechamento correto do modal de ferramentas PDF.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.883',
    date: '12/03/2026',
    summary: 'Cloud: corrigido o erro de runtime que impedia a renderização correta do botão de download de pasta após a melhoria do fluxo de ZIP.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'State de download de pasta restaurada',
            description: 'O Cloud voltou a declarar corretamente a state usada pelo botão de baixar pasta, eliminando o ReferenceError e permitindo o carregamento normal da tela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.882',
    date: '12/03/2026',
    summary: 'Cloud: o download de pasta passou a responder melhor no primeiro clique e exibe estado de preparação enquanto o arquivo ZIP é montado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Download de pasta mais confiável',
            description: 'O Cloud agora bloqueia cliques repetidos durante a preparação do ZIP, mostra um estado visual de carregamento e usa um disparo de download mais robusto para reduzir falhas no primeiro clique.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.881',
    date: '12/03/2026',
    summary: 'Cloud: a árvore da Caixa de entrada passou a esconder pastas arquivadas e itens da lixeira da navegação padrão.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Arquivados fora da Caixa de entrada',
            description: 'A árvore lateral e a navegação padrão da Caixa de entrada agora usam apenas pastas ativas, evitando que itens arquivados ou da lixeira apareçam misturados na entrada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.880',
    date: '12/03/2026',
    summary: 'Cloud: a área central do módulo passou a funcionar como dropzone ampla, com overlay visual de upload durante o arraste.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Dropzone ampla na área central do Cloud',
            description: 'O Cloud agora detecta arraste de arquivos em toda a área central útil do módulo, exibe um overlay grande com mensagem contextual e aceita o drop sem depender apenas do box interno da listagem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.879',
    date: '12/03/2026',
    summary: 'Cloud: o modo em cards passou a aceitar drag and drop também na área vazia abaixo da grade.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Dropzone estendida no modo cards',
            description: 'A grade de cards agora mantém um preenchimento de largura total dentro do próprio grid, permitindo soltar arquivos também no espaço vazio abaixo dos cards visíveis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.878',
    date: '12/03/2026',
    summary: 'Cloud: o espaço vazio abaixo da listagem/cards passou a aceitar arrastar arquivos como parte da dropzone do explorador.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drop permitido também no espaço vazio do painel',
            description: 'A visualização do explorador agora preenche a altura restante do painel e mantém uma área flexível no fim da lista, fazendo com que o drop funcione também abaixo dos itens visíveis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.877',
    date: '12/03/2026',
    summary: 'Cloud: a área de arrastar arquivos no explorador foi ampliada para aceitar drops em toda a região útil da tela.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Dropzone ocupando toda a área do explorador',
            description: 'O contêiner principal do explorador e o viewport interno passaram a preencher toda a altura disponível, permitindo arrastar e soltar arquivos em qualquer espaço livre do Cloud.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.876',
    date: '12/03/2026',
    summary: 'Cloud: ações rápidas como girar imagem/PDF deixaram de disparar o carregamento global e o módulo ficou mais estável contra recarregamentos visuais desnecessários.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Rotação rápida sem recarregar o Cloud inteiro',
            description: 'A rotação rápida de imagens e PDFs deixou de acionar o estado global de operação do Cloud e passou a atualizar a listagem de forma silenciosa.',
          },
          {
            type: 'fix',
            title: 'Menos recarregamentos visuais após ações rápidas',
            description: 'O efeito de carregamento inicial foi ajustado para responder apenas à troca real de pasta ou modo, evitando reexecuções desnecessárias quando apenas callbacks internos mudam.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.875',
    date: '12/03/2026',
    summary: 'Cloud: o preview principal de PDF foi reajustado para exibir a página centralizada e sem corte lateral dentro do viewer.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview de PDF centralizado no viewer',
            description: 'O modal principal de preview do Cloud deixou de esticar o visualizador em tela cheia e passou a usar uma área centralizada com padding e largura controlada, reduzindo cortes na margem esquerda e deslocamentos da página.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.874',
    date: '12/03/2026',
    summary: 'Cloud: o Hub PDF voltou a abrir previews com estabilidade e o módulo deixou de quebrar o recarregamento do Vite após as últimas alterações.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview de PDF com remontagem segura',
            description: 'O Hub PDF passou a remontar `Document` e `Page` do react-pdf sempre que o arquivo/URL muda, reduzindo crashes ligados ao worker ao fechar ou trocar rapidamente o preview.',
          },
          {
            type: 'fix',
            title: 'CloudModule recompilando corretamente',
            description: 'Foram removidas duplicações acidentais de bloco e exportação no CloudModule que estavam causando erro de compilação e falha 500 no hot reload do Vite.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.873',
    date: '12/03/2026',
    summary: 'Cloud: ações como copiar, colar e mover itens deixaram de provocar sensação de recarregamento desnecessário da tela.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Refresh silencioso após ações',
            description: 'Após operações como copiar, colar, mover e duplicar itens, o Cloud passou a atualizar os dados sem reativar o loading geral da tela, reduzindo a sensação de recarregamento inteiro do módulo.',
          },
          {
            type: 'improvement',
            title: 'Dependências de carga estabilizadas',
            description: 'O carregamento principal do Cloud deixou de depender de mudanças transitórias na referência da pasta atual, evitando execuções extras de reload sem mudança real de contexto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.872',
    date: '12/03/2026',
    summary: 'Cloud: a conversão Word para PDF no navegador passou a preservar melhor a paginação e o layout do documento.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Captura por página com layout A4 forçado',
            description: 'O Cloud agora renderiza o DOCX com quebra de páginas, cabeçalho e rodapé, forçando largura A4 e capturando cada página separadamente para reduzir quebras e deformações de formatação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.871',
    date: '12/03/2026',
    summary: 'Cloud: corrigida a conversão de Word para PDF que estava gerando páginas em branco.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'PDF não sai mais em branco',
            description: 'O Cloud passou a usar o mesmo padrão de container offscreen estável do módulo de documentos para renderizar o DOCX antes da captura, evitando PDFs brancos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.870',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF foi substituída por uma solução baseada em docx-preview + html2canvas + jsPDF, removendo a dependência do Syncfusion.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Conversão Word para PDF sem Syncfusion',
            description: 'A conversão de arquivos .docx para PDF no Cloud passou a usar docx-preview para renderizar o documento e html2canvas + jsPDF para gerar o PDF, eliminando timeouts e dependência do editor Syncfusion.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.869',
    date: '12/03/2026',
    summary: 'Cloud: a exportação Word para PDF foi reforçada com ajuste de layout antes do PDF e com o editor oculto renderizando invisível dentro da viewport.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Exportação Syncfusion reforçada',
            description: 'Antes de gerar o PDF, o Cloud reaplica o serviceUrl do Syncfusion e força atualização de layout no editor, reduzindo casos em que o saveAsBlob ficava preso em timeout.',
          },
          {
            type: 'improvement',
            title: 'Editor oculto renderizando dentro da viewport',
            description: 'A instância invisível usada para converter Word em PDF deixou de ficar muito distante da viewport e passou a renderizar de forma invisível no próprio plano da página, diminuindo travas offscreen.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.868',
    date: '12/03/2026',
    summary: 'Cloud: o editor oculto da conversão Word para PDF passou a usar identificador exclusivo, reduzindo conflitos internos entre instâncias do editor.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Editor oculto com id exclusivo',
            description: 'A instância oculta do Syncfusion usada para converter Word em PDF no Cloud agora possui id próprio, evitando colisões com o editor visível e reduzindo falhas por timeout.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.867',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF agora sinaliza melhor o carregamento do documento e responde visualmente ao clique de forma imediata.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Conversão aguardando sinal real do editor',
            description: 'O Cloud passou a esperar o evento de documento carregado do editor oculto antes de exportar o PDF, reduzindo casos em que a conversão parecia não iniciar e terminava em timeout.',
          },
          {
            type: 'improvement',
            title: 'Feedback imediato no botão',
            description: 'Ao clicar em converter, o botão muda instantaneamente para “Convertendo...”, deixando claro que a ação foi disparada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.866',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF foi suavizada para evitar refresh visual durante o processo e reduzir falhas por espera excessiva de renderização.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Conversão sem refresh visual do preview',
            description: 'Enquanto o Word é convertido em PDF no Cloud, o preview atual não é mais atualizado incidentalmente, evitando sensação de página recarregando durante o processamento.',
          },
          {
            type: 'improvement',
            title: 'Espera de conversão menos frágil',
            description: 'A geração de PDF deixou de depender da detecção visual completa das páginas renderizadas antes da exportação, reduzindo o erro de demora excessiva para renderizar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.865',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF passou a validar a renderização antes da exportação e não fica mais presa indefinidamente sem resposta.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Conversão com timeout controlado',
            description: 'O Cloud agora aguarda a renderização real das páginas no editor oculto antes de exportar o PDF e encerra com erro controlado quando a conversão ultrapassa o tempo limite.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.864',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF ficou mais estável e o aviso de processamento foi movido para o topo da interface.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Conversão com carregamento validado',
            description: 'O Cloud agora espera o Word realmente carregar no editor oculto antes de exportar para PDF, reduzindo casos em que a conversão demorava e não concluía.',
          },
          {
            type: 'improvement',
            title: 'Aviso de conversão reposicionado',
            description: 'A mensagem “Estamos convertendo...” foi movida para o topo central da tela para não competir visualmente com o botão de mensagens.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.863',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF agora mostra feedback animado enquanto o arquivo está sendo processado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Animação de conversão em andamento',
            description: 'A interface do Cloud passou a exibir a mensagem animada “Estamos convertendo...” durante a conversão de Word para PDF, deixando o processamento mais claro para o usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.862',
    date: '12/03/2026',
    summary: 'Cloud: a conversão de Word para PDF foi ajustada para preservar melhor o layout original do documento.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Conversão Word->PDF mais fiel',
            description: 'A geração de PDF de arquivos .docx no Cloud passou a usar exportação via Syncfusion, reduzindo bugs visuais de paginação, fontes e quebra de layout.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.861',
    date: '12/03/2026',
    summary: 'Cloud: agora é possível converter arquivos Word .docx em PDF diretamente pela interface.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Conversão de Word para PDF no Cloud',
            description: 'Arquivos .docx agora podem ser convertidos em PDF direto no Cloud, com upload automático do PDF gerado para a mesma pasta do documento original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.860',
    date: '12/03/2026',
    summary: 'Cloud: o modal de preview PDF deixou de recarregar automaticamente por mudanças incidentais de navegação.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview PDF sem recarga incidental',
            description: 'O efeito de carregamento do preview foi estabilizado para não recarregar o PDF apenas por mudança de pasta atual enquanto o mesmo arquivo continua aberto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.859',
    date: '12/03/2026',
    summary: 'Cloud: os controles P/M/G agora também ajustam visualmente os cards de pasta no modo cards.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Escala de pastas integrada ao P/M/G',
            description: 'Os cards de pasta agora acompanham o tamanho pequeno, médio e grande com ajuste de altura, padding, espaçamento e ícone, mantendo consistência visual com os arquivos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.848',
    date: '11/03/2026',
    summary: 'Cloud: loading com visual mais limpo, sem bordas aparentes na animação.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Animação sem contorno visível',
            description: 'Foram removidas as bordas mais marcadas do card e do núcleo visual do loading, mantendo apenas o brilho e a sensação de profundidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.847',
    date: '11/03/2026',
    summary: 'Cloud: animação de carregamento refinada com mais fluidez e sensação visual premium.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Loading mais fluido e sofisticado',
            description: 'A tela de carregamento do Cloud ganhou movimentos mais suaves no ícone, brilho sutil e composição visual mais elegante durante a espera.',
          },
          {
            type: 'improvement',
            title: 'Progresso e status mais vivos',
            description: 'A barra animada e os indicadores de sincronização foram refinados para transmitir atividade contínua com melhor acabamento visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.846',
    date: '11/03/2026',
    summary: 'Cloud: sidebar mais larga para leitura de nomes, com ellipsis em itens extensos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebar mais larga e legível',
            description: 'A coluna lateral do Cloud foi ampliada para reduzir quebras de nomes em clientes e pastas, deixando a navegação mais limpa e rápida.',
          },
          {
            type: 'improvement',
            title: 'Ellipsis em nomes longos',
            description: 'Itens extensos agora usam truncamento com reticências na sidebar, evitando múltiplas linhas e preservando o alinhamento visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.845',
    date: '11/03/2026',
    summary: 'Cloud: preview de PDF com altura total real da página e largura preservada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'PDF em altura total real',
            description: 'O preview de PDF agora encosta no topo e no rodapé da página, removendo margens verticais do modal sem expandir a largura lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.844',
    date: '11/03/2026',
    summary: 'Cloud: preview de PDF mais alto, mantendo a largura tradicional do modal.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Altura ampliada sem mexer na largura',
            description: 'O modal de preview de PDF manteve a largura anterior e recebeu apenas aumento de altura para melhorar a leitura sem alterar o enquadramento lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.843',
    date: '11/03/2026',
    summary: 'Cloud: preview de PDF expandido para usar a altura total da página.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Modal PDF em altura total',
            description: 'O modal de visualização de PDF do Cloud agora ocupa toda a altura da página, oferecendo mais espaço útil para leitura do documento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.842',
    date: '11/03/2026',
    summary: 'Cloud: breadcrumb mais limpo, header mais compacto, sidebar mais densa e cards maiores.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Breadcrumb sem o título redundante',
            description: 'O texto "Cloud" foi removido do topo contextual, mantendo apenas o ícone inicial e a navegação da pasta atual.',
          },
          {
            type: 'improvement',
            title: 'Barra de busca mais compacta',
            description: 'A altura vertical do bloco de busca foi reduzida mais uma vez, deixando mais área livre para o conteúdo principal.',
          },
          {
            type: 'improvement',
            title: 'Status e busca mais próximos',
            description: 'O badge de cliente foi mantido junto ao campo de busca para melhorar leitura, contexto e equilíbrio visual.',
          },
          {
            type: 'improvement',
            title: 'Cards e sidebar refinados',
            description: 'Os cards ganharam largura mínima maior e a sidebar ficou mais compacta para mostrar mais itens sem desperdiçar espaço.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.840',
    date: '11/03/2026',
    summary: 'Cloud: menos padding externo, grid mais aberto e divisória visual mais suave.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Padding externo reduzido',
            description: 'O módulo Cloud ficou mais próximo do navbar e das laterais para aumentar a área útil de trabalho e reduzir a sensação de conteúdo encaixotado.',
          },
          {
            type: 'improvement',
            title: 'Grid de cards expandido',
            description: 'A largura mínima dos cards foi ampliada para melhorar o aproveitamento horizontal e permitir uma distribuição visual mais profissional no explorador.',
          },
          {
            type: 'improvement',
            title: 'Divisória mais leve entre sidebar e conteúdo',
            description: 'O cabeçalho do explorador e a linha divisória lateral foram suavizados para alinhar melhor a transição entre a navegação e a área de cards.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.839',
    date: '11/03/2026',
    summary: 'Cloud: navbar limpa e área de trabalho mais ampla com menos espaço desperdiçado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Título removido do navbar superior',
            description: 'A escrita "Cloud" foi removida do topo para evitar redundância, já que o módulo já está identificado na navegação lateral e pelos controles do header.',
          },
          {
            type: 'improvement',
            title: 'Área útil ampliada',
            description: 'O container principal do Cloud teve paddings e espaçamentos externos reduzidos para deixar a sidebar e a grade de arquivos ocuparem melhor a tela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.838',
    date: '11/03/2026',
    summary: 'Cloud: busca contextual reposicionada entre breadcrumb e status para um cabeçalho mais equilibrado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Busca integrada ao cabeçalho contextual',
            description: 'O campo "Pesquisar nesta pasta" saiu do canto direito isolado e passou a ocupar a barra contextual entre o breadcrumb do Cloud e o status do cliente.',
          },
          {
            type: 'improvement',
            title: 'Hierarquia visual mais equilibrada',
            description: 'Título, busca e status agora formam um único bloco de contexto, reduzindo espaço vazio e deixando a interface mais organizada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.837',
    date: '11/03/2026',
    summary: 'Cloud: removido menu duplicado na área de conteúdo, mantendo apenas a navbar superior.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Menu duplicado removido',
            description: 'Removido o segundo bloco com Enviar, Nova pasta, Filtros, Lista/Cards e P/M/G dentro da área de conteúdo do Cloud.',
          },
          {
            type: 'improvement',
            title: 'Hierarquia visual corrigida',
            description: 'A interface agora mantém apenas o menu da navbar superior, melhorando organização, leitura e consistência do layout.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.836',
    date: '11/03/2026',
    summary: 'Cloud: botões de ação movidos para o header principal do sistema.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Botões movidos para header global',
            description: 'Botões "Enviar", "Nova pasta", "Filtros", "Lista/Cards" e "P/M/G" movidos do CloudModule para o header principal do sistema.',
          },
          {
            type: 'improvement',
            title: 'Exibição condicional no header',
            description: 'Botões do Cloud aparecem no header global apenas quando o módulo Cloud está ativo, mantendo o layout limpo em outros módulos.',
          },
          {
            type: 'improvement',
            title: 'Design consistente',
            description: 'Botões no header seguem o design padrão do sistema com shadow, border e hover effects consistentes.',
          },
          {
            type: 'improvement',
            title: 'Header do Cloud simplificado',
            description: 'Header do CloudModule agora contém apenas busca e navegação mobile, reduzindo poluição visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.834',
    date: '11/03/2026',
    summary: 'Cloud: seleção múltipla corrigida e preview de imagens com navegação e conversão para PDF.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Seleção múltipla mantida no menu contextual',
            description: 'Ao abrir menu contextual com botão direito, a seleção múltipla agora é preservada em vez de resetar para apenas o item clicado.',
          },
          {
            type: 'improvement',
            title: 'Navegação entre imagens no preview',
            description: 'Preview de imagens agora possui setas (← →) para navegar entre todas as imagens da pasta, similar aos PDFs.',
          },
          {
            type: 'improvement',
            title: 'Converter imagem para PDF direto do preview',
            description: 'Botão "Converter para PDF" adicionado diretamente no preview de imagens, abrindo o modal de conversão com a imagem pré-selecionada.',
          },
          {
            type: 'improvement',
            title: 'Contador de imagens no header do preview',
            description: 'Header do preview agora mostra "Imagem X de Y" para facilitar a navegação e saber quantas imagens existem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.830',
    date: '11/03/2026',
    summary: 'Cloud: produtividade ampliada com renomear inline, seleção por caixa, favoritos de arquivos, recentes e zoom dos cards.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Renomear inline estilo desktop',
            description: 'Arquivos e pastas passaram a permitir renomeação inline no modo lista e cards com suporte a F2, Enter e Escape.',
          },
          {
            type: 'improvement',
            title: 'Seleção por caixa e zoom dos cards',
            description: 'O explorador agora aceita seleção por arraste no espaço vazio e oferece controle de densidade visual dos cards em três tamanhos.',
          },
          {
            type: 'improvement',
            title: 'Favoritos de arquivos e recentes',
            description: 'Arquivos podem ser fixados em favoritos e o módulo mantém uma lista de recentes a partir de abertura e download.',
          },
          {
            type: 'improvement',
            title: 'Drag and drop mais claro',
            description: 'O feedback visual de arrastar e soltar passou a indicar melhor a pasta alvo e o estado da operação entre mover, copiar e recortar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.829',
    date: '11/03/2026',
    summary: 'Cloud: a interface passou a usar rolagem única da página com sidebar sticky.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Scroll único na página',
            description: 'Os containers internos do Cloud deixaram de rolar separadamente, permitindo que a rolagem aconteça de forma natural na página inteira.',
          },
          {
            type: 'improvement',
            title: 'Sidebar sticky sem scroll próprio',
            description: 'A navegação lateral passou a acompanhar a página com comportamento sticky no desktop, mantendo-se visível sem criar uma segunda barra de rolagem interna.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.828',
    date: '11/03/2026',
    summary: 'Cloud: os cards de pasta deixaram de ficar esticados com áreas vazias grandes.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Pastas sem espaço vazio excessivo no cards',
            description: 'O grid do modo cards passou a alinhar os itens pelo topo e os cards de pasta agora respeitam a altura do próprio conteúdo, evitando blocos vazios grandes ao lado de arquivos com preview.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.827',
    date: '11/03/2026',
    summary: 'Cloud: o modo cards aproveita melhor a largura e acomoda 4 itens por linha com mais facilidade.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Quatro cards por linha com mais frequência',
            description: 'A largura mínima dos cards foi reduzida no explorador para permitir 4 itens por linha em resoluções mais largas, sem apertar desnecessariamente a interface.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.826',
    date: '11/03/2026',
    summary: 'Cloud: o modal de renomear agora protege a extensão .pdf contra mudanças acidentais.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Extensão .pdf bloqueada no renomear',
            description: 'Arquivos PDF passaram a exibir a extensão fixa no modal de renomeação, permitindo editar apenas o nome base e evitando alteração acidental da extensão.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.825',
    date: '11/03/2026',
    summary: 'Cloud: os cards de pasta ficaram mais compactos e sem metadados abaixo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cards de pasta mais compactos',
            description: 'O modo cards das pastas foi ajustado para um visual mais enxuto, com ícone menor e proporções mais próximas do estilo de ícones do Windows.',
          },
          {
            type: 'improvement',
            title: 'Sem cliente e modificado abaixo da pasta',
            description: 'As linhas informativas abaixo dos cards de pasta foram removidas para deixar a grade mais limpa e focada no nome da pasta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.824',
    date: '11/03/2026',
    summary: 'Cloud: o modal de renomear agora aparece acima do modal de preview.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Renomear acima do preview',
            description: 'O empilhamento dos modais foi ajustado para que as janelas de renomeação simples e em lote abram acima do modal de visualização de arquivos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.823',
    date: '11/03/2026',
    summary: 'Cloud: criar nova pasta ficou acessível no vazio e mais visível na tela inicial.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Menu contextual no espaço vazio funcionando',
            description: 'O botão direito no espaço vazio do explorador agora abre corretamente o menu com a opção de criar nova pasta.',
          },
          {
            type: 'improvement',
            title: 'Ação Nova pasta mais clara no estado vazio',
            description: 'O botão do estado vazio/inicial foi padronizado para `Nova pasta`, deixando a criação de pastas mais evidente para o usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.822',
    date: '11/03/2026',
    summary: 'Cloud: o modal de preview de PDF virou uma galeria com ações rápidas do arquivo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Navegação entre PDFs no modal de preview',
            description: 'O preview de PDF agora permite avançar e voltar entre os PDFs filtrados da tela, além de listar miniaturas/nomes em uma faixa inferior tipo galeria.',
          },
          {
            type: 'feature',
            title: 'Ações rápidas no modal de preview',
            description: 'Foram adicionadas ações de renomear, baixar, excluir e abrir o Hub PDF diretamente no cabeçalho do modal de visualização do PDF.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.821',
    date: '11/03/2026',
    summary: 'Cloud: a árvore lateral agora respeita Ctrl/Cmd e Shift para seleção de pastas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Ctrl/Cmd e Shift funcionando na árvore lateral',
            description: 'Os cliques nas pastas da barra lateral passaram a reutilizar a lógica central de seleção do Cloud, permitindo seleção aditiva e por intervalo sem perder a seleção atual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.820',
    date: '11/03/2026',
    summary: 'Cloud: o painel lateral de detalhes não abre mais sozinho durante a seleção.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Painel de detalhes apenas sob comando do usuário',
            description: 'A abertura automática do painel lateral foi removida, evitando interferência quando o usuário seleciona vários itens no explorador do Cloud.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.819',
    date: '11/03/2026',
    summary: 'Cloud: o Hub PDF agora mostra miniaturas reais das páginas na área de seleção.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Miniaturas reais em Páginas do PDF',
            description: 'A grade de seleção do Hub PDF passou a renderizar o preview visual de cada página, facilitando a escolha correta sem depender apenas do número da página.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.818',
    date: '11/03/2026',
    summary: 'Cloud: corrigido o crash causado pela ordem de inicialização do atalho de colar.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Ctrl+V sem ReferenceError no Cloud',
            description: 'O efeito global de atalhos foi reposicionado para executar apenas após a criação do handler de colagem, impedindo a quebra do módulo ao renderizar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.817',
    date: '11/03/2026',
    summary: 'Cloud: subpastas agora exibem a ação Colar e o teclado aceita copiar, recortar e colar diretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Colar visível na pasta atual e em subpastas',
            description: 'A barra superior do Cloud agora mostra a ação Colar sempre que existir conteúdo no clipboard interno e houver uma pasta atual válida.',
          },
          {
            type: 'feature',
            title: 'Atalhos Ctrl+C, Ctrl+X e Ctrl+V no Cloud',
            description: 'O explorador passou a aceitar copiar, recortar e colar itens usando atalhos do teclado, sem depender apenas do menu contextual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.816',
    date: '11/03/2026',
    summary: 'Cloud: a tecla Delete/Del voltou a remover corretamente os itens selecionados.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Atalho Delete sincronizado com a seleção atual',
            description: 'O listener global do Cloud passou a usar o handler de exclusão memoizado e a aceitar tanto Delete quanto Del para enviar a seleção para a lixeira.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.815',
    date: '11/03/2026',
    summary: 'Cloud: ao jogar ou enviar uma pasta, a estrutura agora preserva corretamente a pasta raiz.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Importação de pasta mantém a pasta principal',
            description: 'O Cloud passou a respeitar o caminho relativo completo fornecido pelo navegador, impedindo que apenas os arquivos internos sejam recriados sem a pasta raiz.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.814',
    date: '11/03/2026',
    summary: 'Cloud: agora há ações explícitas de copiar, colar e criar cópia para itens e seleções.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Copiar, recortar e colar no próprio Cloud',
            description: 'Arquivos, pastas e seleções agora podem ser copiados ou recortados e colados em outra pasta pelo menu contextual e pelo menu da área em branco.',
          },
          {
            type: 'improvement',
            title: 'Criar cópia para arquivo e pasta',
            description: 'Itens individuais agora possuem a ação Criar cópia, incluindo duplicação recursiva do conteúdo das pastas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.813',
    date: '11/03/2026',
    summary: 'Cloud: seleção agora pode ser recortada ou copiada diretamente para uma pasta-alvo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Recortar e copiar seleção para uma pasta pelo menu contextual',
            description: 'O menu das pastas agora oferece atalhos para mover a seleção para a pasta escolhida ou duplicar arquivos e subpastas diretamente nela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.812',
    date: '11/03/2026',
    summary: 'Cloud: esvaziar a lixeira agora garante remoção definitiva inclusive em itens aninhados.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Lixeira libera espaço de forma consistente',
            description: 'A exclusão permanente de pastas agora percorre também subpastas e arquivos já marcados na lixeira, removendo registros e blobs físicos do storage para liberar espaço corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.811',
    date: '11/03/2026',
    summary: 'Cloud: o modal de esvaziamento da lixeira também voltou a ficar claro e legível.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Modal de lixeira esvaziada sem fundo preto',
            description: 'O estado de sucesso do esvaziamento da lixeira agora usa uma base branca explícita e uma camada interna clara para impedir vazamento visual do tema escuro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.810',
    date: '11/03/2026',
    summary: 'Cloud: modais de transferência e exclusão voltaram a aparecer claros e legíveis.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Modal preto de progresso do Cloud corrigido',
            description: 'Os modais de upload e exclusão agora forçam superfícies claras e contraste consistente para evitar fundo escuro/preto e texto ilegível em temas escuros.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.809',
    date: '11/03/2026',
    summary: 'Cloud: preview de PDF ficou estável após uploads em lote e renomeações.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview PDF não quebra mais após atualizar arquivos',
            description: 'O Cloud agora limpa estados de preview inválidos e força a remontagem do `react-pdf` quando o arquivo ou a URL muda após uploads ou renomeações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.808',
    date: '11/03/2026',
    summary: 'Cloud: o ícone de vínculo da árvore lateral agora fica ao lado do nome da pasta.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Ícone de vínculo lateral fica ao lado do nome da pasta',
            description: 'Agora o ícone de vínculo fica ao lado do nome da pasta na árvore lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.807',
    date: '11/03/2026',
    summary: 'Cloud: o indicador de vínculo na árvore lateral ficou mais limpo, só com ícone.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Indicador de vínculo ficou somente visual',
            description: 'Na árvore lateral do Cloud, o status de vínculo das pastas agora usa apenas ícone colorido, sem texto, deixando a interface mais limpa e objetiva.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.806',
    date: '11/03/2026',
    summary: 'Cloud: badges da árvore lateral ficaram mais diretos, com leitura visual verde/vermelha.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Selo lateral de pasta ficou mais claro visualmente',
            description: 'Na árvore lateral do Cloud, o antigo texto de vínculo foi substituído por um selo mais direto: `Corrigido` em verde quando a pasta está vinculada e `X` em vermelho quando não está.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.805',
    date: '10/03/2026',
    summary: 'Cloud: navegação por clique ficou mais fluida sem o drawer atrapalhar o duplo clique.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Drawer de detalhes respeita melhor a intenção de navegação',
            description: 'A abertura automática do painel de detalhes ganhou um pequeno atraso cancelável, reduzindo a sensação de que a lateral abre cedo demais quando você quer apenas dar duplo clique e entrar na pasta.',
          },
          {
            type: 'improvement',
            title: 'Duplo clique de pastas e arquivos ficou mais previsível',
            description: 'Ao navegar no Cloud, o duplo clique agora cancela a abertura automática do drawer antes de entrar na pasta ou abrir o arquivo, deixando a experiência mais próxima de um explorador tradicional.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.804',
    date: '10/03/2026',
    summary: 'Cloud: abertura de DOCX no editor de petições ficou mais estável e sem carga duplicada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Cloud evita reimportação duplicada no editor de petições',
            description: 'O fluxo de abertura de arquivos Word vindos do Cloud agora respeita o identificador da requisição inicial para não baixar/importar o mesmo documento mais de uma vez.',
          },
        ],
      },
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget do editor reduz carga pesada ao abrir DOCX inicial',
            description: 'Quando o editor é aberto apenas para importar um documento inicial, a listagem de petições salvas deixa de ser carregada nesse momento, reduzindo risco de timeout no banco.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.803',
    date: '10/03/2026',
    summary: 'Cloud: painel de detalhes virou drawer overlay e os cards ganharam grid responsivo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Painel de detalhes em drawer overlay',
            description: 'Ao selecionar uma pasta ou arquivo, os detalhes agora deslizam pela direita sem comprimir a área principal do explorador.',
          },
          {
            type: 'improvement',
            title: 'Cards com distribuição responsiva mais estável',
            description: 'A grade de cards passou a usar colunas automáticas com largura mínima, preservando melhor o layout quando o espaço disponível muda.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.802',
    date: '10/03/2026',
    summary: 'Cloud: informações auxiliares da árvore lateral agora aparecem abaixo do nome da pasta.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Árvore lateral com leitura mais vertical',
            description: 'O layout dos itens da árvore agora prioriza nome no topo e informações auxiliares logo abaixo, com espaçamento mais claro entre seta, ícone e conteúdo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.801',
    date: '10/03/2026',
    summary: 'Cloud: árvore lateral mais legível para nomes longos de pastas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebar evita esmagamento de nomes longos',
            description: 'Os itens da árvore lateral agora usam até duas linhas para o nome da pasta e deixam o selo de vínculo abaixo, preservando leitura e hierarquia visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.800',
    date: '10/03/2026',
    summary: 'Cloud: correção do drop na Caixa de entrada para restaurar e desarquivar itens corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Caixa de entrada resolve corretamente o item arrastado',
            description: 'O drop na Caixa de entrada agora localiza o arquivo ou pasta em todas as coleções relevantes antes de restaurar, desarquivar ou mover para a raiz.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.799',
    date: '10/03/2026',
    summary: 'Cloud: correção do drop de pastas e arquivos na sidebar de Arquivado e Lixeira.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drop lateral resolve corretamente o item arrastado',
            description: 'A sidebar agora localiza a pasta ou arquivo arrastado em todas as coleções relevantes antes de executar arquivamento ou envio para lixeira.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.798',
    date: '10/03/2026',
    summary: 'Cloud: atalhos de Arquivado e Lixeira agora funcionam como destinos reais de arrastar e soltar.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Arquivado e Lixeira aceitam drop na sidebar',
            description: 'Os atalhos laterais agora recebem arquivos e pastas por drag and drop, com highlight visual e execução automática da ação correspondente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.797',
    date: '10/03/2026',
    summary: 'Cloud: arrastar para a Caixa de entrada agora restaura e desarquiva itens automaticamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Caixa de entrada aceita drop de Arquivado e Lixeira',
            description: 'Ao arrastar itens especiais para a Caixa de entrada, o Cloud restaura ou desarquiva automaticamente e move o item para a raiz quando aplicável.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.796',
    date: '10/03/2026',
    summary: 'Cloud: correção final da Lixeira vazia com contador preenchido.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Lixeira não cai mais em estado vazio incorreto',
            description: 'A filtragem da view da Lixeira passou a considerar `delete_scheduled_for`, fazendo a grade renderizar os itens corretamente quando o contador indica conteúdo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.795',
    date: '10/03/2026',
    summary: 'Cloud: correção de filtro da Lixeira para exibir itens corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Lixeira exibe itens corretamente',
            description: 'Corrigida a lógica de filtro que causava a Lixeira aparecer vazia mesmo com itens presentes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.794',
    date: '10/03/2026',
    summary: 'Cloud: Arquivado e Lixeira agora contam e exibem apenas itens de topo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Arquivado sem duplicar filhos internos',
            description: 'A contagem e a listagem do Arquivado passaram a ignorar arquivos que já estão dentro de pastas arquivadas de topo.',
          },
          {
            type: 'fix',
            title: 'Lixeira mostra apenas itens de topo',
            description: 'A Lixeira deixou de exibir e somar arquivos internos de pastas já deletadas, mostrando apenas os itens principais da view.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.793',
    date: '10/03/2026',
    summary: 'Cloud: correção da Lixeira para pastas e limpeza final do modal de upload no tema claro.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Pastas voltam a ir para a Lixeira',
            description: 'A exclusão de pastas voltou a usar o fluxo real da Lixeira, evitando que itens sumissem da visualização esperada.',
          },
          {
            type: 'fix',
            title: 'Modal de upload sem fundo escuro residual',
            description: 'O modal animado de upload foi ajustado para ficar totalmente coerente com o tema claro da interface.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.792',
    date: '10/03/2026',
    summary: 'Cloud: modais animados ajustados para tema claro.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Modais animados coerentes no tema claro',
            description: 'Os modais de carregamento e exclusão do Cloud deixaram de usar visual escuro indevido quando a interface está em tema claro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.791',
    date: '10/03/2026',
    summary: 'Cloud: animações de carregamento e exclusão mais visíveis e refinadas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Loading mais premium no Cloud',
            description: 'A tela de carregamento ganhou card animado, barra dinâmica e microanimações para transmitir progresso com mais clareza.',
          },
          {
            type: 'improvement',
            title: 'Exclusão com feedback visual reforçado',
            description: 'O modal de exclusão/processamento agora tem animação mais evidente durante processamento e estados mais claros para sucesso e erro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.790',
    date: '10/03/2026',
    summary: 'Cloud: contadores reais de objetos em Arquivado e Lixeira na sidebar.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Contagem real em Arquivado e Lixeira',
            description: 'Os badges da sidebar agora exibem a quantidade total real de objetos arquivados e na lixeira, sem depender da pasta aberta no momento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.789',
    date: '10/03/2026',
    summary: 'Cloud: limpeza da sidebar com remoção de Recentes e reposicionamento de Arquivado/Lixeira abaixo das pastas ativas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebar mais direta',
            description: 'O bloco Recentes foi removido da lateral do Cloud para reduzir ruído visual e simplificar a navegação.',
          },
          {
            type: 'improvement',
            title: 'Arquivado e Lixeira abaixo das pastas ativas',
            description: 'A navegação foi reorganizada para posicionar Arquivado e Lixeira abaixo da árvore principal de pastas ativas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.788',
    date: '10/03/2026',
    summary: 'Cloud: restauração da separação entre Lixeira e Arquivado, sem exclusão automática no arquivamento.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Lixeira dedicada restaurada',
            description: 'Excluir arquivos e pastas voltou a enviar itens para a Lixeira do Cloud, em vez de misturá-los com o Arquivado.',
          },
          {
            type: 'fix',
            title: 'Arquivado separado da Lixeira',
            description: 'O Arquivado voltou a exibir apenas itens arquivados manualmente, mantendo o comportamento sem exclusão automática.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.787',
    date: '10/03/2026',
    summary: 'Cloud: correção da hierarquia do Arquivado para manter subpastas e arquivos dentro da pasta pai arquivada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Hierarquia correta no Arquivado',
            description: 'Subpastas e arquivos de uma pasta pai arquivada deixaram de aparecer soltos na raiz do Arquivado, respeitando a estrutura original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.786',
    date: '10/03/2026',
    summary: 'Cloud: correção mais profunda do link público para evitar timeout/500 ao resolver a pasta compartilhada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Link público sem consulta pesada da pasta raiz',
            description: 'O Cloud deixou de depender da leitura direta da pasta raiz compartilhada no acesso público, reduzindo o risco de timeout e erro 500.',
          },
          {
            type: 'improvement',
            title: 'Fluxo público mais estável para links sem senha',
            description: 'O acesso automático de links públicos sem senha foi mantido com comportamento mais estável e mensagens mais claras para o usuário final.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.785',
    date: '10/03/2026',
    summary: 'Cloud: correção do compartilhamento público para links sem senha e redução de consultas desnecessárias no carregamento público.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Link público sem senha não pede senha',
            description: 'A página pública do Cloud agora detecta corretamente quando o link não possui senha e entra automaticamente sem exibir campo de senha desnecessário.',
          },
          {
            type: 'improvement',
            title: 'Carregamento público mais leve',
            description: 'A lógica da página pública foi simplificada para evitar consultas extras de pastas, reduzindo risco de timeout e erro 500 no acesso compartilhado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.784',
    date: '10/03/2026',
    summary: 'Cloud: arquivamento sem exclusão automática, com comportamento totalmente manual no Arquivado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Arquivado sem exclusão automática',
            description: 'Itens arquivados deixaram de ter prazo automático de exclusão, permanecendo arquivados até ação manual do usuário.',
          },
          {
            type: 'improvement',
            title: 'Interface do Arquivado mais clara',
            description: 'Mensagens e indicadores relacionados a exclusão automática/agendada foram removidos do Cloud para refletir o novo comportamento manual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.783',
    date: '09/03/2026',
    summary: 'Cloud: correção do card de pasta e refinamento da área Arquivado com arquivos arquivados e ações mais consistentes.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Correção do layout dos cards de pasta',
            description: 'Foi corrigido o empilhamento incorreto dos botões de ação no cabeçalho dos cards de pasta, estabilizando o layout visual.',
          },
          {
            type: 'improvement',
            title: 'Arquivado agora mostra arquivos e pastas',
            description: 'A área `Arquivado` foi ampliada para listar também arquivos arquivados, deixando a visão mais completa.',
          },
          {
            type: 'improvement',
            title: 'Ações melhores para arquivos arquivados',
            description: 'Arquivos arquivados agora podem ser desarquivados com mais facilidade pela interface lateral e pelo menu de contexto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.782',
    date: '09/03/2026',
    summary: 'Cloud: nova área Arquivado na navegação com visualização dedicada para pastas arquivadas e ação de arquivar mais acessível.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Área Arquivado na navegação do Cloud',
            description: 'Foi adicionada uma área `Arquivado` ao lado de `Este Computador` e `Lixeira`, permitindo navegar rapidamente pelas pastas arquivadas.',
          },
          {
            type: 'improvement',
            title: 'Ação de arquivar mais acessível',
            description: 'O Cloud passou a exibir a ação de arquivar pasta de forma mais visível, facilitando o fluxo de organização sem depender apenas de menus de contexto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.781',
    date: '09/03/2026',
    summary: 'Cloud: pastas mais compactas e com visual mais próximo do Explorer do Windows.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Pastas menores e mais compactas',
            description: 'Os cards de pastas no Cloud foram reduzidos para ocupar menos espaço visual e deixar a navegação mais limpa.',
          },
          {
            type: 'improvement',
            title: 'Visual de pasta inspirado no Explorer',
            description: 'O desenho visual da pasta foi refinado para se aproximar mais do estilo do Windows Explorer apresentado como referência.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.780',
    date: '09/03/2026',
    summary: 'Cloud: ação de esvaziar lixeira agora fica visível no topo da própria pasta Lixeira.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Botão de esvaziar lixeira visível no topo',
            description: 'A visualização da pasta Lixeira agora exibe o botão `Esvaziar lixeira` no topo da interface, deixando a ação mais fácil de encontrar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.779',
    date: '09/03/2026',
    summary: 'Cloud: lixeira transformada em pasta/área real, com pastas excluídas indo para a lixeira e lateral mais limpa sem histórico recente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Lixeira como pasta real do Cloud',
            description: 'A lixeira deixou de ser apenas um bloco lateral e passou a funcionar como uma área/pasta navegável do Cloud, exibindo itens arquivados no painel principal.',
          },
          {
            type: 'improvement',
            title: 'Pastas excluídas agora vão para a lixeira',
            description: 'Ao excluir uma pasta, o sistema arquiva a árvore inteira de pastas e arquivos para a lixeira antes de qualquer remoção permanente.',
          },
          {
            type: 'improvement',
            title: 'Sidebar mais simples e sem histórico recente',
            description: 'O bloco de histórico recente foi removido da lateral para evitar confusão e concentrar a navegação em acesso rápido, recentes e lixeira.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.778',
    date: '09/03/2026',
    summary: 'Cloud: refinamento visual para ficar mais próximo do Explorer do Windows, com toolbar mais limpa e navegação mais familiar.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Toolbar mais limpa e sem botão de colar print',
            description: 'O botão visual de colar print foi removido da barra superior para reduzir poluição visual, mantendo o recurso disponível via `Ctrl+V`.',
          },
          {
            type: 'improvement',
            title: 'Cloud mais parecido com o Explorer do Windows',
            description: 'A barra superior, o breadcrumb e a navegação lateral receberam refinamentos visuais para aproximar o módulo da sensação de uso do Windows Explorer.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.777',
    date: '09/03/2026',
    summary: 'Cloud: lixeira dedicada na lateral com ação de esvaziar lixeira e melhor separação visual entre histórico, arquivados e itens excluídos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Lixeira dedicada com ação de esvaziar',
            description: 'Os arquivos excluídos passaram a ficar em uma lixeira própria na lateral, com visual destacado e botão para esvaziar lixeira de forma rápida, no estilo Windows.',
          },
          {
            type: 'improvement',
            title: 'Sidebar do Cloud mais organizada',
            description: 'A navegação lateral foi reorganizada para separar melhor favoritos, recentes, pastas arquivadas, lixeira e histórico recente, reduzindo a sensação de mistura entre blocos de informação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.776',
    date: '09/03/2026',
    summary: 'Cloud: feedback visual premium para uploads e exclusões, com modal de progresso e animação de remoção de documentos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Upload com modal premium de progresso',
            description: 'Os uploads do Cloud agora aparecem em um modal central com progresso do lote, status por arquivo, visual mais amigável e fechamento automático após conclusão total bem-sucedida.',
          },
          {
            type: 'improvement',
            title: 'Exclusão com animação e feedback visual de processamento',
            description: 'Ao excluir ou enviar arquivos para a lixeira, o Cloud passou a mostrar um modal animado exibindo o documento sendo processado, com estados de sucesso e erro mais claros.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.775',
    date: '09/03/2026',
    summary: 'Cloud: melhoria visual e responsiva com painel adaptável, breadcrumb mais limpo e hierarquia de navegação mais clara.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cloud mais limpo e sem cabeçalhos redundantes',
            description: 'O topo do módulo foi simplificado com remoção do rótulo redundante `Cloud / Raiz` e do contador superior de itens, reduzindo ruído visual.',
          },
          {
            type: 'improvement',
            title: 'Responsividade e hierarquia visual refinadas',
            description: 'O painel lateral passou a ser recolhível no mobile, a toolbar agora se reorganiza melhor em telas menores e a navegação por breadcrumb ganhou mais destaque na hierarquia da interface.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.774',
    date: '09/03/2026',
    summary: 'Cloud: a Fase 3 trouxe lixeira real para arquivos e histórico recente de atividades integrado ao backend.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Lixeira real para arquivos do Cloud',
            description: 'Arquivos removidos no Cloud passaram a ser arquivados primeiro, com data de exclusão agendada, restauração rápida e opção explícita de exclusão permanente pela lateral.',
          },
          {
            type: 'feature',
            title: 'Histórico recente de ações do Cloud',
            description: 'Foi adicionada uma base de logs de atividades no backend para registrar criação, atualização, arquivamento, restauração e remoção de arquivos, pastas e links compartilhados, exibindo os eventos recentes na lateral do módulo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.773',
    date: '09/03/2026',
    summary: 'Cloud: a Fase 2 adicionou busca global, filtros avançados, favoritos e ações em lote com atalhos e menu de contexto reforçados.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Busca global com filtros avançados',
            description: 'O Cloud passou a buscar arquivos e pastas em escopo global quando há termos ou filtros ativos, com filtros por cliente, etiqueta, extensão, intervalo de datas e tamanho do arquivo.',
          },
          {
            type: 'feature',
            title: 'Favoritos e organização rápida de pastas',
            description: 'Pastas podem ser fixadas localmente em favoritos para acesso rápido na lateral e também diretamente pela lista, pelos cards e pelo menu de contexto.',
          },
          {
            type: 'improvement',
            title: 'Ações em lote e atalhos do explorador',
            description: 'O explorador do Cloud ganhou renomeação em lote, movimentação em lote, atalhos como `F2`, `Ctrl+M` e `Ctrl+Shift+R`, além de opções extras no menu de contexto para seleções múltiplas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.772',
    date: '09/03/2026',
    summary: 'Cloud: a Fase 1 trouxe fila de uploads com retry, progresso visual e envio automático na raiz com pasta dedicada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Fila de uploads com retry e progresso visual',
            description: 'O Cloud agora mostra uma fila por arquivo com estado de envio, falha, conclusão, barra de progresso por item e consolidado do lote, além de permitir tentar novamente apenas os uploads que falharam.',
          },
          {
            type: 'improvement',
            title: 'Upload automático de arquivos soltos na raiz',
            description: 'Arquivos enviados diretamente na raiz do Cloud passam a ser encaminhados automaticamente para uma pasta de upload gerada na hora, evitando bloqueios quando não há pasta previamente aberta.',
          },
          {
            type: 'improvement',
            title: 'Estrutura de pasta recriada com mais consistência no drag-and-drop',
            description: 'A leitura de diretórios arrastados passou a preservar melhor os nomes reais das entradas do navegador para recriar a hierarquia de pastas e subpastas com mais fidelidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.771',
    date: '09/03/2026',
    summary: 'Cloud: os cards de PDF passaram a mostrar a primeira página real como preview.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Preview real de PDF no modo cards',
            description: 'Os cards de arquivos PDF no Cloud deixaram de exibir apenas um placeholder textual e passaram a renderizar a primeira página do documento com `react-pdf`, facilitando a identificação visual do arquivo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.770',
    date: '09/03/2026',
    summary: 'Cloud: o nome da pasta raiz arrastada passou a ser preservado ao recriar a estrutura no upload por diretório.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Pasta raiz arrastada agora também é criada no Cloud',
            description: 'A coleta recursiva dos arquivos deixou de depender apenas do `fullPath` do navegador e passou a carregar explicitamente os segmentos da pasta raiz, garantindo a criação da pasta principal e das subpastas ao arrastar um diretório para a raiz do Cloud.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.769',
    date: '09/03/2026',
    summary: 'Cloud: suporte a pasta arrastada ficou compatível com a tipagem do navegador e build do projeto.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Leitura de diretórios compatível com o build TypeScript',
            description: 'A leitura recursiva de diretórios no drag-and-drop do Cloud passou a usar tipagem compatível com APIs específicas do navegador, mantendo o suporte a pastas inclusive na raiz sem depender de tipos DOM que podem não existir no ambiente de build.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.768',
    date: '09/03/2026',
    summary: 'Cloud: arrastar pasta com arquivos passou a funcionar usando leitura recursiva do diretório no navegador.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Upload por arraste agora aceita diretórios',
            description: 'Quando uma pasta é arrastada para o Cloud, o módulo agora percorre os arquivos internos do diretório e reaproveita o fluxo normal de upload, sem disparar erro por tentar tratar a pasta como arquivo único.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.767',
    date: '09/03/2026',
    summary: 'Cloud: arraste de pasta passou a ser rejeitado explicitamente para evitar uploads inválidos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Validação explícita no drop de diretórios',
            description: 'Quando uma pasta inteira é arrastada para o Cloud, o sistema agora bloqueia o envio com mensagem orientativa em vez de tentar tratar o diretório como arquivo e disparar erros de acesso inválido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.766',
    date: '09/03/2026',
    summary: 'Service Worker: cache incrementado para limpar URLs antigas do Cloud.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Cache do Service Worker atualizado para v6',
            description: 'A versão do cache foi incrementada para forçar a limpeza de URLs antigas que causavam `ERR_ACCESS_DENIED` ao acessar arquivos do Cloud.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.765',
    date: '09/03/2026',
    summary: 'Assinaturas: o módulo passou a tentar também o bucket cloud-files ao gerar URLs temporárias para selfie e assinatura.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Pré-visualização de selfie e assinatura agora busca no bucket cloud-files',
            description: 'O módulo de assinaturas passou a incluir o bucket `cloud-files` na resolução de URLs assinadas, evitando erros de acesso negado quando os arquivos do signatário foram armazenados fora dos buckets tradicionais do fluxo de assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.764',
    date: '09/03/2026',
    summary: 'Cloud e Assinaturas: removidos erros de bucket no frontend e ajustado o update de solicitações para não falhar com 406.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Frontend não tenta mais administrar bucket do Storage',
            description: 'O Cloud voltou a ignorar checagem/criação de bucket no navegador, eliminando os erros `400` em `storage/v1/bucket/cloud-files` causados por chamadas administrativas sem permissão.',
          },
        ],
      },
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Atualização de solicitação tolera retorno vazio do Supabase',
            description: 'O serviço de assinaturas deixou de usar coerção rígida para um único objeto no update da solicitação, evitando o erro `406` quando o Supabase não retorna exatamente uma linha no corpo da atualização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.763',
    date: '09/03/2026',
    summary: 'Peticionamento: a abertura de documentos do Cloud começou a importar o DOCX em paralelo ao carregamento do módulo.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Importação do DOCX iniciada sem esperar o loading geral',
            description: 'Quando um documento do Cloud é aberto no editor, a importação agora começa imediatamente, em paralelo ao restante da inicialização do módulo, reduzindo o tempo percebido até o arquivo começar a carregar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.747',
    date: '09/03/2026',
    summary: 'Peticionamento: ambiente de desenvolvimento deixou de reaproveitar bundle antigo do Service Worker e o import local de DOCX ficou mais seguro.',
    modules: [
      {
        moduleId: 'petition-editor',
        changes: [
          {
            type: 'fix',
            title: 'Service Worker desativado no dev',
            description: 'O ambiente de desenvolvimento não registra mais `Service Worker`, evitando cache de arquivos antigos e reduzindo falsos erros persistentes no editor durante HMR.',
          },
          {
            type: 'improvement',
            title: 'Validação explícita no carregamento local de DOCX',
            description: 'Quando o conteúdo do `.docx` não puder ser extraído localmente, o sistema agora retorna erro explícito em vez de abrir o editor em branco.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.746',
    date: '09/03/2026',
    summary: 'Peticionamento: documentos .docx passaram a abrir localmente no editor, sem chamar o Import do Syncfusion.',
    modules: [
      {
        moduleId: 'petition-editor',
        changes: [
          {
            type: 'fix',
            title: 'Abertura local de DOCX no editor',
            description: 'O SyncfusionEditor passou a carregar `.docx` localmente com `mammoth`, evitando as chamadas ao endpoint externo `Import` e removendo os erros `404` do console para esse fluxo.',
          },
          {
            type: 'improvement',
            title: 'Separação entre erro de importação e erro de banco',
            description: 'Os erros de `saved_petitions`, `petition_blocks` e `petition_default_templates` continuam identificados como timeouts do Supabase, sem relação com a abertura local dos arquivos `.docx`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.745',
    date: '09/03/2026',
    summary: 'Peticionamento: erros 404 do Syncfusion eliminados ao abrir documentos.',
    modules: [
      {
        moduleId: 'petition-editor',
        changes: [
          {
            type: 'fix',
            title: 'Endpoint Import removido do Syncfusion',
            description: 'O editor de petições deixou de depender do serviço externo de conversão do Syncfusion para arquivos `.docx`, eliminando os erros `404` que apareciam no console.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.744',
    date: '09/03/2026',
    summary: 'Cloud: previews PDF ficaram estáveis novamente e documentos do Syncfusion passaram a ter fallback quando o serviço Import falha.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Crash removido do preview de PDF nos cards',
            description: 'O modo de visualização em cards do Cloud deixou de usar a renderização que fazia o `react-pdf` falhar com erro em `<Page>`, evitando travamentos ao exibir PDFs na grade.',
          },
        ],
      },
      {
        moduleId: 'petition-editor',
        changes: [
          {
            type: 'improvement',
            title: 'Fallback automático no carregamento do Syncfusion',
            description: 'Quando a conversão via endpoint `Import` não estiver disponível para `.docx`, o editor agora tenta abrir o arquivo diretamente, reduzindo falhas por `404` no preview e na abertura de documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.743',
    date: '09/03/2026',
    summary: 'Peticionamento: a IA agora edita trechos selecionados diretamente no documento usando os blocos como base de conhecimento.',
    modules: [
      {
        moduleId: 'petition-editor',
        changes: [
          {
            type: 'feature',
            title: 'Edição com IA sobre a seleção do editor',
            description: 'O comando de IA no editor de petições agora abre um fluxo de edição da seleção atual, permitindo informar a instrução desejada e aplicar o resultado diretamente no documento.',
          },
          {
            type: 'improvement',
            title: 'Blocos usados como contexto jurídico',
            description: 'A IA passou a receber os blocos mais relevantes como referência de linguagem e estrutura argumentativa, ajudando a manter o texto mais técnico, coerente e alinhado ao acervo do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.742',
    date: '09/03/2026',
    summary: 'Cloud: criar subpasta ficou mais simples e direto.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Modal enxuto para subpasta',
            description: 'Quando a criação acontece dentro de uma pasta, o modal agora mostra apenas o nome da subpasta. As opções extras ficam reservadas para a criação de pastas principais.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.741',
    date: '09/03/2026',
    summary: 'Cloud: o preview do arquivo agora também permite girar imagens e PDFs.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Girar também no preview',
            description: 'O modal de preview do Cloud agora exibe a ação `Girar 90°` para imagens e PDFs, permitindo corrigir a orientação sem voltar para a grade de cards.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.740',
    date: '09/03/2026',
    summary: 'Cloud: rotação rápida do card corrigida e ações rápidas ficaram mais úteis.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Rotação rápida sem múltiplos giros',
            description: 'A ação de girar no card agora trava enquanto o arquivo está sendo processado, evitando que um único uso acabe aplicando rotações adicionais por cliques repetidos.',
          },
          {
            type: 'improvement',
            title: 'Download rápido no card',
            description: 'Os previews do modo `Cards` agora também exibem um atalho discreto de download, permitindo baixar o arquivo sem abrir menu contextual ou painel lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.739',
    date: '09/03/2026',
    summary: 'Cloud: ação de girar no card ficou mais discreta e limpa.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Ícone discreto de rotação no card',
            description: 'O modo `Cards` do Cloud agora mostra apenas um ícone pequeno sobre o preview para girar imagens e PDFs, reduzindo a poluição visual sem perder a ação rápida.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.738',
    date: '09/03/2026',
    summary: 'Cloud: agora dá para girar imagem e PDF direto pelo card.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Botão girar no card',
            description: 'Os cards de imagem e PDF no modo `Cards` agora exibem um botão `Girar`, aplicando rotação rápida no próprio arquivo sem precisar abrir outras ferramentas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.737',
    date: '09/03/2026',
    summary: 'Cloud: prints colados na pasta atual agora viram PDF automaticamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Print colado já vira PDF',
            description: 'Ao usar `Ctrl+V` ou o botão `Colar print` no Cloud, a imagem da área de transferência agora é convertida automaticamente para PDF antes de ser salva na pasta atual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.736',
    date: '09/03/2026',
    summary: 'Cloud: pastas podem ser arrastadas de volta para a raiz /Cloud.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Drag and drop para a raiz',
            description: 'Agora é possível arrastar pastas para o item raiz `/Cloud` no painel lateral, retornando-as para a raiz com feedback visual e mensagem de sucesso.',
          },
          {
            type: 'improvement',
            title: 'Mensagem mais clara para arquivos na raiz',
            description: 'Quando o usuário tenta mover arquivo para a raiz em um fluxo que exige pasta, o sistema mostra uma orientação explícita em vez de falhar silenciosamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.734',
    date: '09/03/2026',
    summary: 'Cloud: badge de vínculo só em pasta principal e pastas do Cloud visíveis no módulo de clientes.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Badge só em pasta principal',
            description: 'O aviso de vínculo com cliente agora aparece apenas nas pastas principais. Subpastas não exibem mais esse badge.',
          },
        ],
      },
      {
        moduleId: 'clients',
        changes: [
          {
            type: 'feature',
            title: 'Pastas do Cloud no cliente',
            description: 'O detalhe do cliente agora mostra as pastas principais do Cloud vinculadas, com status e data de atualização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.733',
    date: '09/03/2026',
    summary: 'Cloud: coluna Tamanho agora mostra também o tamanho calculado das pastas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Tamanho real das pastas',
            description: 'A coluna `Tamanho` do explorador passou a somar arquivos internos e subpastas, substituindo o traço por um valor calculado para cada pasta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.732',
    date: '09/03/2026',
    summary: 'Cloud: compartilhamento com link único por pasta e gestão completa do link existente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Fim do timeout no link compartilhado',
            description: 'A resolução pública do token deixou de usar a consulta pesada com join direto, eliminando o erro de `statement timeout` na abertura do link.',
          },
          {
            type: 'improvement',
            title: 'Link único por pasta',
            description: 'Quando a pasta já possui compartilhamento ativo, o sistema reaproveita o mesmo token em vez de gerar um novo link.',
          },
          {
            type: 'feature',
            title: 'Gerenciar link já existente',
            description: 'O modal agora permite atualizar senha e validade, remover senha e tornar a pasta privada novamente sem perder o controle do link atual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.731',
    date: '08/03/2026',
    summary: 'Cloud: cabeçalho sem duplicação e status visual de vínculo nas pastas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cabeçalho interno simplificado',
            description: 'O topo do módulo Cloud deixou de repetir o título e agora mostra apenas a navegação atual da pasta.',
          },
          {
            type: 'improvement',
            title: 'Badge de pasta vinculada',
            description: 'Pastas agora exibem badge visual de `Vinculada` ou `Sem vínculo` na árvore lateral, lista e cards.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.730',
    date: '08/03/2026',
    summary: 'Cloud: menu contextual no espaço branco, drag para árvore lateral e melhorias no Hub PDF.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Menu contextual no espaço branco',
            description: 'Botão direito no espaço vazio agora mostra opções: Nova pasta, Enviar arquivos, Colar imagem, Atualizar, e Converter imagens em PDF.',
          },
          {
            type: 'feature',
            title: 'Arrastar para árvore de pastas',
            description: 'Agora é possível arrastar arquivos e pastas para qualquer pasta na árvore lateral esquerda.',
          },
          {
            type: 'feature',
            title: 'Hub PDF: Extrair páginas',
            description: 'Nova função para extrair páginas selecionadas e criar um novo PDF.',
          },
          {
            type: 'improvement',
            title: 'Hub PDF: Seleção rápida de páginas',
            description: 'Grade visual de páginas na tela inicial com botões de selecionar todas, inverter e limpar seleção.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.729',
    date: '08/03/2026',
    summary: 'Cloud: drag and drop para mover itens, renomear, duplicar e copiar link.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Drag and drop para mover arquivos e pastas',
            description: 'Agora é possível arrastar arquivos e pastas e soltar dentro de outras pastas para movê-los. A pasta de destino fica destacada durante o arrasto.',
          },
          {
            type: 'feature',
            title: 'Renomear arquivos e pastas',
            description: 'Adicionada opção de renomear no menu contextual (botão direito) para arquivos e pastas.',
          },
          {
            type: 'feature',
            title: 'Duplicar arquivos',
            description: 'Adicionada opção de duplicar arquivos no menu contextual, criando uma cópia na mesma pasta.',
          },
          {
            type: 'feature',
            title: 'Copiar link do arquivo',
            description: 'Adicionada opção de copiar o link temporário do arquivo para a área de transferência.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.728',
    date: '08/03/2026',
    summary: 'Cloud: PDF de imagens sem espaço em branco e Alt+clique funcionando.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'PDF de imagens sem espaço em branco',
            description: 'Ao converter imagens em PDF, cada página agora tem exatamente o tamanho da imagem original, sem margens nem espaço extra.',
          },
          {
            type: 'fix',
            title: 'Alt+clique na seleção múltipla',
            description: 'Adicionado `preventDefault` para garantir que `Alt`+clique funcione corretamente na seleção múltipla do explorador.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.727',
    date: '08/03/2026',
    summary: 'Cloud: seleção múltipla com Ctrl/Alt/Cmd finalmente estabilizada.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Seleção múltipla corrigida definitivamente',
            description: 'Adicionado `stopPropagation` nos handlers de clique dos itens do explorador para evitar que o evento borbulhe para o container e limpe a seleção. Agora `Ctrl`/`Alt`/`Cmd` + clique funciona corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.726',
    date: '08/03/2026',
    summary: 'Cloud: o modal de mover arquivo passou a mostrar melhor a hierarquia das pastas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Hierarquia visual no seletor de pasta destino',
            description: 'O modal `Mover arquivo` do `Cloud` agora exibe a pasta principal e suas subpastas com indentação visual, facilitando entender a estrutura antes de escolher o destino.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.725',
    date: '08/03/2026',
    summary: 'Cloud: a multiseleção por clique com modificadores foi estabilizada no explorador.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Ctrl/Alt/Cmd+clique corrigido no explorador',
            description: 'Foi corrigido o comportamento que limpava a seleção ao clicar em áreas internas dos itens do `Cloud`. Agora a multiseleção com `Ctrl`/`Alt`/`Cmd` + clique funciona corretamente na lista e na visualização em cards.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.724',
    date: '08/03/2026',
    summary: 'Cloud: o explorador ganhou seleção total por atalho e ficou ainda mais próximo de um storage tradicional.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Ctrl+A para selecionar tudo no explorador',
            description: 'O `Cloud` agora aceita `Ctrl+A`/`Cmd+A` para selecionar todos os itens visíveis da pasta atual, complementando a seleção múltipla e a navegação por teclado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.723',
    date: '08/03/2026',
    summary: 'Cloud: o explorador voltou a ficar mais próximo de um storage, com seleção múltipla e navegação por teclado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Seleção múltipla restaurada',
            description: 'A seleção em massa do `Cloud` foi corrigida para voltar a aceitar múltiplos itens usando `Ctrl`/`Alt`/`Meta` + clique no explorador.',
          },
          {
            type: 'improvement',
            title: 'Navegação por setas no explorador',
            description: 'O `Cloud` agora permite navegar com as setas do teclado entre itens da visualização, com comportamento mais próximo de exploradores de arquivos e storages modernos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.722',
    date: '08/03/2026',
    summary: 'Cloud: o painel de detalhes voltou a aparecer por seleção e os cards ficaram mais compactos.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Detalhes exibidos apenas quando há seleção',
            description: 'O painel lateral do `Cloud` voltou a aparecer quando um arquivo ou pasta é selecionado, mas continua oculto quando não existe item selecionado.',
          },
          {
            type: 'improvement',
            title: 'Cards mais compactos',
            description: 'A grade de `Cards` do `Cloud` foi ajustada para reduzir o tamanho dos blocos e aproveitar melhor a largura disponível, chegando a até 4 cards por linha em telas largas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.721',
    date: '08/03/2026',
    summary: 'Cloud: a visualização ficou mais limpa e o detalhe lateral foi reduzido ao essencial.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cards mais limpos com badge de tipo',
            description: 'Os cards de arquivos no `Cloud` passaram a mostrar um badge com o tipo do documento e removeram informações textuais redundantes, deixando a visualização mais enxuta.',
          },
          {
            type: 'improvement',
            title: 'Clique fora limpa seleção e remove detalhe residual',
            description: 'Ao clicar fora dos itens na área branca do explorador, a seleção do `Cloud` agora é limpa corretamente. Também foi removido o painel lateral detalhado de arquivos para reduzir ruído visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.720',
    date: '08/03/2026',
    summary: 'Cloud/PDF: o hub ficou mais interativo e passou a editar direto no preview.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Ações no próprio preview do Hub PDF',
            description: 'O editor do `Hub PDF` agora permite interagir diretamente com as miniaturas das páginas: reorganizar por arrastar, girar páginas na própria visualização e selecionar/remover folhas a partir do preview.',
          },
          {
            type: 'improvement',
            title: 'Rodapé fixo com salvar e fechar',
            description: 'As ações principais do modal do `Hub PDF` passaram a ficar fixas no rodapé, mantendo `Salvar PDF` e `Fechar` sempre acessíveis durante a edição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.719',
    date: '08/03/2026',
    summary: 'Cloud: os cards agora mostram mais conteúdo visual e a preferência de exibição passou a persistir corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cards com thumbnail real para imagens e PDFs',
            description: 'Na visualização em `Cards`, arquivos de imagem agora exibem a própria miniatura e arquivos PDF mostram a primeira página como preview. Outros arquivos mantêm o ícone padrão.',
          },
          {
            type: 'fix',
            title: 'Persistência correta do modo Lista/Cards',
            description: 'A última preferência de exibição do `Cloud` agora é restaurada corretamente ao reabrir o módulo, sem voltar indevidamente para `Lista` após atualização ou retorno à tela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.718',
    date: '08/03/2026',
    summary: 'Cloud/PDF: o hub de PDF foi redesenhado para um formato mais visual e objetivo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Hub PDF em grade com foco no essencial',
            description: 'O `Hub PDF` do `Cloud` agora abre em uma tela inicial mais visual, inspirada em uma central de ferramentas, mantendo somente as ações essenciais para o fluxo atual: organizar, girar, remover páginas e juntar PDFs.',
          },
          {
            type: 'improvement',
            title: 'Páginas exibidas visualmente no editor',
            description: 'Ao entrar em uma ferramenta do hub, as páginas do PDF passam a ser mostradas em grade visual, facilitando selecionar folhas antes de reordenar, girar ou remover.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.717',
    date: '08/03/2026',
    summary: 'Cloud: o painel lateral agora mostra melhor o conteúdo do arquivo selecionado.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'View rápido com imagem e conteúdo',
            description: 'O painel lateral do `Cloud` agora exibe uma visualização rápida mais útil do arquivo selecionado. Imagens aparecem diretamente no `View`, PDFs podem ser visualizados embutidos e arquivos de texto suportados mostram o conteúdo no próprio painel.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.716',
    date: '08/03/2026',
    summary: 'Cloud: pastas arquivadas agora podem ser acessadas e restauradas com mais clareza.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Acesso às arquivadas com exclusão agendada visível',
            description: 'O `Cloud` agora mostra uma área dedicada para pastas arquivadas, permitindo acessá-las rapidamente e visualizar a data/período restante até a exclusão automática.',
          },
          {
            type: 'feature',
            title: 'Desarquivar pasta',
            description: 'Pastas arquivadas agora podem ser desarquivadas diretamente pelo painel lateral ou pelo menu contextual, removendo o agendamento de exclusão e devolvendo a pasta ao fluxo normal do explorador.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.715',
    date: '08/03/2026',
    summary: 'Cloud: modo de exibição agora pode ser alternado e salvo.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Exibição em lista ou cards com persistência',
            description: 'O explorador do `Cloud` agora permite alternar entre visualização em `Lista` e `Cards`, salvando automaticamente a preferência do usuário para reaplicar o layout escolhido nas próximas visitas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.714',
    date: '08/03/2026',
    summary: 'Cloud: seleção em massa e novo hub de ferramentas PDF.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Seleção em massa com atalhos de teclado',
            description: 'O `Cloud` agora aceita seleção múltipla com `Ctrl`/`Alt`/`Meta` + clique, além de suportar `Del` para remover itens selecionados e `Enter` para abrir o item em foco.',
          },
          {
            type: 'feature',
            title: 'Primeira versão do Hub PDF',
            description: 'Arquivos PDF no `Cloud` agora contam com um hub inicial de ferramentas para remover páginas, girar páginas selecionadas e salvar a edição por cima do arquivo atual ou como uma nova cópia.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.713',
    date: '08/03/2026',
    summary: 'Assinaturas/Cloud: a pasta da contraparte agora prioriza o nome real do contrato.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Contraparte derivada do título do contrato',
            description: 'No fluxo de `Assinaturas` para o `Cloud`, a subpasta da contraparte agora prioriza o nome do banco ou empresa presente no título do contrato antes de usar heurísticas baseadas nos signatários. Isso evita nomes genéricos e favorece estruturas como `Cliente / NUBANK / NÃO PROTOCOLAR`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.712',
    date: '08/03/2026',
    summary: 'Cloud: modais restantes foram alinhados ao visual claro do sistema.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Padronização visual dos modais do Cloud',
            description: 'Os modais restantes do `Cloud`, como `Mover arquivo` e `Compartilhar pasta`, agora seguem o mesmo padrão claro do sistema, com fundo branco, cabeçalho com destaque laranja e campos consistentes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.711',
    date: '08/03/2026',
    summary: 'Cloud: modal de imagens para PDF agora mostra miniaturas claras e arrastáveis.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Miniaturas arrastáveis no modal de imagens para PDF',
            description: 'O modal de conversão de imagens em PDF no `Cloud` agora usa visual claro e mostra miniaturas reais das imagens selecionadas. A ordenação pode ser feita arrastando os cards, além dos botões de mover para cima e para baixo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.710',
    date: '08/03/2026',
    summary: 'Cloud: pastas agora podem ser excluídas mesmo com conteúdo interno.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Exclusão recursiva de pastas no Cloud',
            description: 'O módulo `Cloud` não exige mais que a pasta esteja vazia para exclusão. Ao excluir uma pasta, o sistema agora remove automaticamente arquivos e subpastas internas em cascata.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.709',
    date: '08/03/2026',
    summary: 'Assinaturas/Cloud: contratos do mesmo cliente agora podem ser separados por réu.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Subpastas por réu/parte contrária nas assinaturas',
            description: 'No fluxo de `Assinaturas` para o `Cloud`, quando há múltiplos contratos do mesmo cliente com réus ou partes contrárias diferentes, o sistema agora cria e identifica uma subpasta com o nome dessas partes antes da pasta `NÃO PROTOCOLAR`. Se houver processo vinculado, a organização continua em `Cliente / PROCESSO <número> / <parte> / NÃO PROTOCOLAR`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.708',
    date: '08/03/2026',
    summary: 'Assinaturas/Cloud: cliente com múltiplos processos agora é identificado corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Desambiguação por processo ao criar pasta no Cloud',
            description: 'No fluxo de `Assinaturas`, quando o mesmo cliente possui mais de um processo, o sistema agora cria e identifica o destino no `Cloud` usando também o número do processo, organizando a cópia em `Cliente / PROCESSO <número> / NÃO PROTOCOLAR`. A lógica antiga sem processo continua compatível para registros anteriores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.707',
    date: '08/03/2026',
    summary: 'Assinaturas: agora fica visível quando a pasta já foi criada no Cloud.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Indicador visual de pasta criada em Assinaturas',
            description: 'O módulo `Assinaturas` agora consulta o `Cloud` para exibir um selo de `Pasta criada` nos cards/lista e no detalhe da assinatura. O status também é atualizado imediatamente após usar a ação `Criar pasta`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.706',
    date: '08/03/2026',
    summary: 'Cloud: prints podem ser colados e imagens podem ser convertidas em PDF.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Print com nome aleatório e imagens para PDF',
            description: 'O módulo `Cloud` agora permite colar prints/imagens diretamente na pasta atual com nome aleatório. Também passou a oferecer conversão de imagens em PDF com seleção múltipla, organização da ordem em modal e salvamento do arquivo final na mesma pasta com o título definido pelo usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.705',
    date: '08/03/2026',
    summary: 'Cloud: painel de detalhes agora some quando não há seleção.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Painel de detalhes oculto sem seleção',
            description: 'O módulo `Cloud` agora esconde completamente o painel lateral `Detalhes` quando nenhum item estiver selecionado. Clicar na área branca do explorador também limpa a seleção atual e fecha o painel.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.704',
    date: '08/03/2026',
    summary: 'Cloud: atualização imediata corrigida após ações vindas de Assinaturas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Refresh imediato do Cloud após cópia de assinatura',
            description: 'O `Cloud` agora recebe um evento interno logo após a cópia de documentos vindos de Assinaturas e também passou a contar com migration para publicar as tabelas `cloud_*` no `supabase_realtime`, garantindo atualização automática mais confiável.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.703',
    date: '08/03/2026',
    summary: 'Cloud: módulo agora atualiza automaticamente em tempo real.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Atualização realtime no Cloud',
            description: 'O módulo `Cloud` agora escuta alterações de pastas, arquivos e compartilhamentos via Supabase Realtime e atualiza a listagem automaticamente, sem exigir refresh manual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.702',
    date: '08/03/2026',
    summary: 'Assinaturas: documento assinado agora pode ser copiado para o Cloud automaticamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Cópia de assinatura para Cliente / NÃO PROTOCOLAR',
            description: 'No detalhe de uma assinatura concluída, a ação `Criar pasta` agora cria ou reaproveita a pasta do cliente no `Cloud`, cria a subpasta `NÃO PROTOCOLAR` e envia para lá uma cópia do documento assinado, preservando o arquivo original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.701',
    date: '08/03/2026',
    summary: 'Cloud: pastas agora podem ser arquivadas com exclusão em 30 dias.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Arquivamento de pasta com exclusão agendada',
            description: 'O módulo `Cloud` agora permite arquivar pastas. Ao arquivar, a pasta sai da listagem principal e recebe exclusão automática agendada para 30 dias.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.700',
    date: '08/03/2026',
    summary: 'Cloud: arquivos e pastas agora podem ser baixados diretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Download direto de arquivos e pastas no Cloud',
            description: 'O módulo `Cloud` agora oferece download direto de arquivos e também download de pastas; quando a pasta contém múltiplos arquivos, o sistema gera um `.zip` preservando a estrutura interna de subpastas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.699',
    date: '08/03/2026',
    summary: 'Cloud/Petição: arquivos Word voltam a abrir direto no editor de petições.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Fluxo direto restaurado para Word vindo do Cloud',
            description: 'Ao abrir arquivos Word pelo `Cloud`, o sistema voltou a enviar o documento diretamente para o editor de petições, sem abrir o modal intermediário de preview embutido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.698',
    date: '08/03/2026',
    summary: 'Cloud/Petição: editor de petições volta ao fluxo que já funcionava.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Regressão removida na abertura do editor de petições',
            description: 'O carregamento direto do editor de petições voltou ao comportamento anterior que já funcionava, enquanto a importação mais robusta do Syncfusion foi mantida apenas no preview do `Cloud` e no compartilhamento público.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.697',
    date: '08/03/2026',
    summary: 'Cloud: arquivos Word que abriam em branco agora são importados corretamente.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Importação mais robusta de .docx no Cloud',
            description: 'O carregamento de arquivos Word no `Cloud` passou a usar a conversão do serviço `Import` do Syncfusion também para `.docx`, reduzindo casos em que o editor abria em branco mesmo com arquivo válido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.696',
    date: '08/03/2026',
    summary: 'Cloud/Petição: salvar no editor agora atualiza o mesmo arquivo do Cloud.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Documento editado volta para o arquivo original do Cloud',
            description: 'Arquivos abertos do `Cloud` no editor de petições agora mantêm vínculo com o arquivo original; ao salvar, o sistema exporta o conteúdo atualizado e sobrescreve o mesmo arquivo no storage, em vez de atualizar apenas o histórico interno do editor.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.695',
    date: '08/03/2026',
    summary: 'Cloud: clique direito em arquivos volta a abrir o menu do sistema.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Menu contextual restaurado para arquivos do Cloud',
            description: 'O explorador do `Cloud` voltou a interceptar o botão direito também nos arquivos, exibindo o menu customizado com ações rápidas e evitando a abertura do menu nativo do navegador.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.694',
    date: '08/03/2026',
    summary: 'Cloud/Petição: cliente da pasta fica obrigatório no fluxo e importação ganha overlay visual.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Cliente do Cloud continua aplicado mesmo com carga assíncrona',
            description: 'O editor de petições passou a reforçar o reaproveitamento do cliente já vinculado à pasta/arquivo do `Cloud`, evitando pedidos indevidos de vínculo manual durante a abertura do documento.',
          },
          {
            type: 'improvement',
            title: 'Overlay visual de carregamento ao importar .doc',
            description: 'A importação de arquivos `.doc` agora mostra um overlay central de `Carregando documento...`, com feedback visual mais claro enquanto o arquivo é aberto no editor.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.693',
    date: '08/03/2026',
    summary: 'Cloud/Petição: .doc importado agora mostra aviso e reaproveita cliente da pasta.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Aviso de rascunho/salvamento após importar .doc',
            description: 'Após abrir um arquivo `.doc` no editor de petições, a interface passou a informar claramente que o documento foi importado, ficou em rascunho e será salvo automaticamente.',
          },
          {
            type: 'fix',
            title: 'Cliente da pasta é aplicado automaticamente no editor',
            description: 'O fluxo entre `Cloud` e editor de petições passou a reaproveitar o cliente já vinculado à pasta/arquivo antes da importação, evitando pedir vínculo manual sem necessidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.692',
    date: '08/03/2026',
    summary: 'Cloud/Petição: .doc deixa de ficar preso na tela inicial.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Editor monta direto quando há documento inicial',
            description: 'A abertura de arquivos `.doc` no fluxo entre `Cloud` e editor de petições passou a desativar a tela inicial logo na montagem quando já existe documento inicial, permitindo que a importação aconteça de fato.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.691',
    date: '08/03/2026',
    summary: 'Cloud/Petição: .doc passa a abrir via signedUrl no editor.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Fluxo de .doc deixa de trafegar em base64 no widget',
            description: 'A abertura de arquivos `.doc` entre `Cloud` e editor de petições passou a usar a URL assinada do arquivo, evitando travamentos no widget antes da importação pelo Syncfusion.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.690',
    date: '08/03/2026',
    summary: 'Cloud/Petição: .doc legado abre direto no editor de petições.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Abertura de .doc legado no editor de petições',
            description: 'Arquivos `.doc` legados agora abrem diretamente no editor de petições usando conversão server-side do Syncfusion, sem necessidade de download ou conversão manual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.689',
    date: '08/03/2026',
    summary: 'Cloud: .doc legado baixa direto para abrir no Word.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Download direto de arquivos .doc legados',
            description: 'Arquivos `.doc` legados agora são baixados diretamente para abertura no Microsoft Word instalado, já que o editor web não suporta esse formato nativamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.688',
    date: '08/03/2026',
    summary: 'Cloud/Petição: .doc legado preserva o tipo correto no importador.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Importador deixa de mascarar .doc como .docx',
            description: 'O importador usado entre `Cloud` e editor de petição passou a respeitar o tipo real de arquivos `.doc`, melhorando a compatibilidade com documentos Word legados no fluxo de abertura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.687',
    date: '08/03/2026',
    summary: 'Cloud: .doc volta a importar mesmo com editor já aberto.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Reabertura efetiva de .doc no editor de petição',
            description: 'A abertura de arquivos `.doc` a partir do `Cloud` passou a forçar uma nova importação no editor de petição, inclusive quando o widget já estiver aberto, evitando que o aviso apareça sem carregar o documento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.686',
    date: '08/03/2026',
    summary: 'Cloud: .doc abre direto importado no editor de petição.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Arquivo .doc abre direto no editor em vez da home do widget',
            description: 'O módulo `Cloud` agora envia o arquivo `.doc` com seu conteúdo para o editor de petição, fazendo a abertura ocorrer diretamente no documento importado e não mais na tela inicial genérica do widget.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.685',
    date: '08/03/2026',
    summary: 'Cloud: arquivos .doc corrigidos para abrir em fluxo de edição.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'fix',
            title: 'Arquivos .doc deixam de abrir em preview genérico',
            description: 'Os arquivos `.doc` do módulo `Cloud` passaram a seguir o fluxo de edição/documento Word, evitando abertura incorreta como preview simples quando o objetivo é editar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.684',
    date: '08/03/2026',
    summary: 'Cloud: pastas com menu de botão direito e ações rápidas.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Menu contextual em pastas do Cloud',
            description: 'As pastas do módulo `Cloud` agora possuem menu de botão direito com ações rápidas para abrir, alterar status, compartilhar, trabalhar o vínculo com cliente, criar subpasta e excluir.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.683',
    date: '08/03/2026',
    summary: 'Cloud: painel de detalhes vazio ocultado quando não há seleção.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Menos ruído no painel direito do Cloud',
            description: 'O conteúdo do painel de detalhes do módulo `Cloud` deixa de aparecer quando nenhuma pasta ou arquivo estiver selecionado, reduzindo informação desnecessária na tela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.682',
    date: '08/03/2026',
    summary: 'Cloud: mais etiquetas visíveis, preview claro e DOCX em editor cheio.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar mais etiquetas sem sumir da tela',
            description: 'A tela da pasta no módulo `Cloud` passou a manter uma área visível para cadastro de novas etiquetas, evitando que a opção desapareça após a criação inicial.',
          },
          {
            type: 'improvement',
            title: 'Preview com visual claro',
            description: 'Os overlays e modais de preview do `Cloud` foram ajustados para um visual mais claro e consistente com o restante do tema da aplicação.',
          },
          {
            type: 'feature',
            title: 'DOCX abre em editor Syncfusion em tela cheia',
            description: 'Arquivos do Word no `Cloud` agora abrem em tela cheia com o editor Syncfusion, incluindo ações de minimizar, fechar e abrir no módulo de petição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.681',
    date: '08/03/2026',
    summary: 'Cloud: etiquetas de pasta, modal refinado e upload corrigido.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Etiquetas em pastas do Cloud',
            description: 'As pastas do módulo `Cloud` agora podem receber etiquetas coloridas, com estados iniciais `Pendente` e `Concluído`, além da possibilidade de cadastrar novas etiquetas diretamente pelo fluxo de criação.',
          },
          {
            type: 'fix',
            title: 'Upload de arquivos com nomes inválidos corrigido',
            description: 'Foi corrigido o envio de arquivos com nomes problemáticos para o storage, sanitizando caracteres inválidos para evitar erros de chave no upload.',
          },
          {
            type: 'improvement',
            title: 'Modal de pasta e vínculo com cliente melhorados',
            description: 'O modal de nova pasta recebeu visual claro e mais organizado, e o painel da pasta agora permite vincular cliente diretamente quando não houver vínculo definido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.680',
    date: '08/03/2026',
    summary: 'Cloud: tema laranja, lateral útil e interface mais limpa.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cloud alinhado ao tema laranja do sistema',
            description: 'O módulo `Cloud` foi refinado para usar o tema laranja do CRM nos destaques principais, removendo o acento azul que destoava do restante do sistema.',
          },
          {
            type: 'improvement',
            title: 'Menos ruído e lateral mais útil',
            description: 'A interface passou a reduzir informações duplicadas, manter a lateral esquerda com função real de navegação/recência e enriquecer o painel direito com detalhes mais úteis dos itens selecionados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.679',
    date: '08/03/2026',
    summary: 'Cloud: layout ampliado e visual claro refinado no estilo Explorer.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cloud com largura útil maior',
            description: 'O explorador do módulo `Cloud` foi ajustado para aproveitar melhor a largura disponível da área principal, deixando a navegação e a listagem mais confortáveis.',
          },
          {
            type: 'improvement',
            title: 'Visual claro no modo claro',
            description: 'O layout principal do `Cloud` passou para uma apresentação clara no modo claro, com fundo branco, painéis suaves e contraste mais leve, mantendo a estrutura inspirada no Windows Explorer.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.678',
    date: '08/03/2026',
    summary: 'Cloud: interface redesenhada para um visual estilo Windows Explorer.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'improvement',
            title: 'Cloud com visual estilo Explorer',
            description: 'O módulo `Cloud` foi redesenhado para uma experiência visual mais próxima do Windows Explorer, com árvore de pastas na lateral, barra superior de ações, breadcrumb, listagem principal em colunas e painel de detalhes para itens selecionados.',
          },
          {
            type: 'improvement',
            title: 'Operações mantidas no novo layout',
            description: 'O novo visual preserva upload por arrastar/soltar, preview de PDF/imagem/DOCX, movimentação de arquivos, vínculo com cliente e compartilhamento público de pasta com senha.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.677',
    date: '08/03/2026',
    summary: 'Cloud: primeira base do novo explorador de arquivos com compartilhamento público.',
    modules: [
      {
        moduleId: 'cloud',
        changes: [
          {
            type: 'feature',
            title: 'Módulo Cloud inicial criado no CRM',
            description: 'Foi criada a primeira base do módulo `Cloud`, com pastas e subpastas, vínculo opcional com clientes, upload por arrastar/soltar, movimentação de arquivos entre pastas, preview de PDF/imagem e abertura de arquivos `.docx` no editor Syncfusion em modo leitura.',
          },
          {
            type: 'feature',
            title: 'Compartilhamento público de pasta com link e senha',
            description: 'Também foi adicionada a base de compartilhamento público de pastas, com geração de link, opção de senha e página pública inicial para acesso ao conteúdo compartilhado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.676',
    date: '08/03/2026',
    summary: 'Notificações: fluxos corrigidos, tipos padronizados e navegação estabilizada.',
    modules: [
      {
        moduleId: 'notificacoes',
        changes: [
          {
            type: 'fix',
            title: 'Sistema de notificações consolidado e corrigido',
            description: 'Foram corrigidos fluxos inconsistentes no sistema de notificações, incluindo auto-notificação residual em ações vindas de intimações, destinatário incorreto em menções do feed, uso de tipos mais adequados para processo criado, assinatura concluída e convite de enquete, além do alinhamento da navegação pelo sino e da remoção do fluxo legado local no `App`.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.675',
    date: '08/03/2026',
    summary: 'Notificações: criador não recebe mais aviso do próprio prazo ou compromisso.',
    modules: [
      {
        moduleId: 'notificacoes',
        changes: [
          {
            type: 'fix',
            title: 'Auto-notificação removida em prazos e agenda',
            description: 'A criação de prazos e compromissos deixou de enviar notificação para o próprio usuário que criou o item. Agora o aviso é gerado apenas quando o responsável atribuído é outra pessoa.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.674',
    date: '08/03/2026',
    summary: 'Clientes: exclusão passou a remover permanentemente o cadastro.',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'fix',
            title: 'Exclusão real de clientes restaurada',
            description: 'O fluxo do módulo de clientes e o `client.service` deixaram de apenas inativar registros ao excluir. Agora a ação remove o cliente permanentemente e os textos de confirmação refletem o comportamento real.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.673',
    date: '07/03/2026',
    summary: 'Assinatura pública: correção da data no documento final gerado pelo link público.',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Data do link público ajustada para America/Manaus',
            description: 'A edge function `template-fill` passou a gerar o placeholder `data` usando explicitamente o fuso `America/Manaus`, evitando que documentos criados por link público avancem indevidamente para o dia seguinte.',
          },
        ],
      },
      {
        moduleId: 'dev',
        changes: [
          {
            type: 'improvement',
            title: 'Deploy da correção no Supabase',
            description: 'A função pública `template-fill` foi publicada novamente para que a correção de data passe a valer em novos links públicos de assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.613',
    date: '03/03/2026',
    summary: 'Dashboard: processos urgentes agora aparecem primeiro na lista.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Ordenação por urgência no Dashboard',
            description: 'Processos marcados como urgente agora aparecem primeiro na seção "Aguardando Confecção" do Dashboard, alinhando com a ordenação do módulo Processos para consistência visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.612',
    date: '03/03/2026',
    summary: 'Processos: urgência agora aparece primeiro na lista "Aguardando Confecção".',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Ordenação por urgência na lista de processos',
            description: 'Processos marcados como urgente agora aparecem primeiro na seção "Aguardando Confecção", seguidos pelos processos normais. Isso facilita a priorização visual imediata dos processos mais importantes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.611',
    date: '03/03/2026',
    summary: 'Dashboard: badge urgência restaurado para priorização visual.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Badge urgência restaurado no Dashboard',
            description: 'Badge "Urgente" restaurado na seção de processos do Dashboard para permitir identificação rápida de processos prioritários diretamente da tela inicial.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.610',
    date: '03/03/2026',
    summary: 'Processos: badge urgência exibido apenas na seção "Aguardando Confecção".',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Badge urgência apenas em "Aguardando Confecção"',
            description: 'O badge "Urgente" agora aparece apenas na seção compacta "Aguardando Confecção" para focar na priorização de processos que precisam ser protocolados. Removido da tabela principal, cards mobile, kanban e dashboard.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.609',
    date: '03/03/2026',
    summary: 'Assinaturas: checkbox urgência na criação de processo com destaque em Processos e Dashboard.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Checkbox "Marcar como urgente" na criação de processo',
            description: 'Ao criar um processo a partir de uma assinatura, agora é possível marcar como urgente. Processos marcados como urgente aparecem com badge vermelho "Urgente" no módulo Processos e no Dashboard, facilitando a priorização visual.',
          },
        ],
      },
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'feature',
            title: 'Destaque visual para processos urgentes',
            description: 'Processos marcados como urgente exibem badge vermelho com ícone de alerta na tabela, cards mobile e kanban, destacando-os visualmente para priorização.',
          },
        ],
      },
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Badge de urgência nos processos do Dashboard',
            description: 'Na seção de processos do Dashboard, processos urgentes exibem badge vermelho "Urgente" abaixo do nome do cliente, permitindo identificação rápida de prioridades.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.608',
    date: '03/03/2026',
    summary: 'Requerimentos: badge para indeferidos com processo criado (tabela e cards).',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Badge "Processo" para requerimentos indeferidos',
            description: 'Quando um requerimento está marcado como "Indeferido" e possui um processo (principal ou MS) criado, exibe um badge azul "Processo" ao lado da data de entrada (na tabela desktop e nos cards mobile), facilitando a identificação visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.607',
    date: '03/03/2026',
    summary: 'Requerimentos: badge para indeferidos com processo criado.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Badge "Processo" para requerimentos indeferidos',
            description: 'Quando um requerimento está marcado como "Indeferido" e possui um processo (principal ou MS) criado, exibe um badge azul "Processo" ao lado da data de entrada, facilitando a identificação visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.606',
    date: '03/03/2026',
    summary: 'Assinaturas: opção "Selecionar tudo" para pasta atual no Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Botão "Selecionar tudo da pasta" no modo de seleção',
            description: 'Ao ativar o modo de seleção no Explorer, aparece botão "Selecionar tudo da pasta" que seleciona apenas os documentos da pasta atual, além do botão "Selecionar todos" que seleciona todos os documentos filtrados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.605',
    date: '03/03/2026',
    summary: 'Assinaturas: reordenação de pastas com drop entre itens mais preciso.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Drop zone com midpoint para inserir acima/abaixo',
            description: 'Melhorada a detecção da área de drop ao reorganizar pastas: a inserção é calculada pelo midpoint (eixo Y) do item e o indicador de inserção aparece entre as pastas, deixando o drop previsível.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.604',
    date: '03/03/2026',
    summary: 'Assinaturas: correção na organização de pastas (drag-and-drop).',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Pastas não viram subpastas automaticamente ao arrastar',
            description: 'Ao arrastar pastas no modo Organizar, o drop não aninha pastas em outras pastas. A organização fica restrita à reordenação (sort_order) pelas barras de inserção, e o drop em pasta permanece para mover documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.603',
    date: '03/03/2026',
    summary: 'Assinaturas: opção para organizar pastas no Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Modo de organização de pastas (arrastar e soltar)',
            description: 'Adicionada opção para ativar/desativar a reorganização de pastas por drag-and-drop no Explorer, evitando movimentações acidentais quando o modo estiver desligado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.602',
    date: '03/03/2026',
    summary: 'Assinaturas: nomes de pastas com melhor legibilidade.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Nomes de pastas com 2 linhas e tooltip',
            description: 'Reduzido truncamento agressivo no Explorer: nomes das pastas podem ocupar até 2 linhas e exibem tooltip com o texto completo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.601',
    date: '03/03/2026',
    summary: 'Assinaturas: alinhamento do menu de pastas (sidebar).',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Itens do menu alinhados à esquerda com badge à direita',
            description: 'Padronizado o alinhamento do Explorer: ícone e nome ficam à esquerda e o contador (badge) permanece à direita, evitando aparência de conteúdo centralizado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.600',
    date: '03/03/2026',
    summary: 'Assinaturas: Explorer de Pastas com hierarquia visual consistente.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Padronização visual por nível no menu de pastas',
            description: 'Pastas do mesmo nível agora têm o mesmo tamanho, alinhamento e espaçamento. Indentação e indicador visual são aplicados apenas em subpastas reais.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.599',
    date: '03/03/2026',
    summary: 'Assinaturas: sidebar fixa e scroll apenas no conteúdo.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebar de Pastas fixa com scroll independente',
            description: 'A sidebar de Pastas fica fixa na tela enquanto apenas a listagem de documentos/solicitações rola no painel à direita.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.598',
    date: '03/03/2026',
    summary: 'Atualização de versão e changelog.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Versão incrementada',
            description: 'Versão atualizada para 1.9.598 com registro no changelog.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.597',
    date: '27/02/2026',
    summary: 'Assinaturas: arrastar múltiplos itens selecionados no Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Mover vários selecionados por drag-and-drop',
            description: 'Quando o modo de seleção estiver ativo, é possível selecionar múltiplas solicitações e arrastá-las juntas para uma pasta. Itens sem permissão não são movidos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.596',
    date: '27/02/2026',
    summary: 'Assinaturas: feedback visual ao arrastar sobre pastas do Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Highlight em tempo real no alvo de drop',
            description: 'Ao arrastar um documento/solicitação, a pasta sob o cursor agora fica destacada durante dragover/dragenter, indicando claramente o destino do drop.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.595',
    date: '27/02/2026',
    summary: 'Assinaturas: Explorer com mais espaçamento e hierarquia mais legível.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Mais respiro na lista de pastas',
            description: 'Aumentado o espaçamento entre pastas/subpastas, altura das linhas e tamanho dos badges para deixar a sidebar mais organizada e fácil de ler.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.594',
    date: '27/02/2026',
    summary: 'Assinaturas: melhorias no layout das pastas do Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Pastas mais organizadas e sem “pulos” no hover',
            description: 'A sidebar de Pastas foi refinada: ações agora aparecem em overlay (sem deslocar layout), seleção/hover mais nítidos e contadores alinhados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.593',
    date: '27/02/2026',
    summary: 'Assinaturas: drag-and-drop mais confiável no modo lista.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Arrastar no modo lista sem abrir item',
            description: 'Ao arrastar itens no modo lista, o clique agora é suprimido durante o drag para evitar abrir detalhes/seleção quando a intenção era mover.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.592',
    date: '27/02/2026',
    summary: 'Assinaturas: Explorer mostra quantidade de itens por pasta.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Contador de itens por pasta',
            description: 'Sidebar do Explorer agora exibe badge com a quantidade de itens em cada pasta (inclui Sem pasta e total com subpastas).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.591',
    date: '27/02/2026',
    summary: 'Assinaturas: reordenação de pastas por drag-and-drop no Explorer.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Ordenar pastas arrastando (sort_order)',
            description: 'Agora é possível reordenar pastas e subpastas arrastando na árvore (drop entre itens), persistindo a ordenação no banco via sort_order.',
          },
          {
            type: 'fix',
            title: 'Correção de classe na tela de signatários',
            description: 'Corrigida quebra acidental em classe Tailwind que impactava o layout da etapa de confirmação de signatários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.590',
    date: '27/02/2026',
    summary: 'Assinaturas: Explorer com pastas e drag-and-drop mais profissional (preview do card e destaques).',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Pastas com visual premium',
            description: 'Sidebar de pastas com seleção em faixa laranja, hover mais limpo, hierarquia mais legível e destaque de drop mais claro.',
          },
          {
            type: 'improvement',
            title: 'Drag preview com card completo',
            description: 'Ao arrastar solicitações e documentos, agora o preview mostra o card completo acompanhando o cursor (clone visual), deixando claro qual item está sendo movido.',
          },
          {
            type: 'improvement',
            title: 'Cards e lista de documentos mais profissionais',
            description: 'Ajustado acabamento (rounded, ring, shadow) e estados de drag/hover para padronizar com o design do CRM.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.587',
    date: '22/02/2026',
    summary: 'Pipeline de Leads e Gestão de Clientes: interface otimizada e botões reposicionados.',
    modules: [
      {
        moduleId: 'leads',
        changes: [
          {
            type: 'improvement',
            title: 'Título duplicado removido',
            description: 'Removido título "Pipeline de Leads" duplicado dentro do módulo. Mantido apenas o título principal no header da aplicação.',
          },
          {
            type: 'improvement',
            title: 'Botão Novo Lead reposicionado',
            description: 'Botão flutuante "Novo Lead" removido e adicionado botão "+" funcional na coluna "Novo" do Kanban quando vazia.',
          },
          {
            type: 'improvement',
            title: 'Botão + com ação',
            description: 'Botão "+" na coluna "Novo" agora abre modal para criar novo lead. Textos adaptados: "Clique para adicionar" / "ou arraste leads para cá".',
          },
        ],
      },
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'improvement',
            title: 'Título duplicado removido',
            description: 'Removido título "Gestão de Clientes" duplicado dentro do módulo. Mantido apenas o título principal no header.',
          },
          {
            type: 'improvement',
            title: 'Botão Novo Cliente reposicionado',
            description: 'Botão "Novo Cliente" movido do topo para a seção de busca/filtros, ao lado do botão "Selecionar".',
          },
          {
            type: 'improvement',
            title: 'Layout de filtros otimizado',
            description: 'Nova ordem dos botões: [Novo Cliente] [Selecionar] [Mostrar filtros]. Botão mais acessível e visível na área de busca.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.586',
    date: '21/02/2026',
    summary: 'Chat: card de áudio com tamanho mais confortável.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Widget de áudio mais largo',
            description: 'Ajustada largura do card de áudio para evitar visual compacto. Definida largura mínima responsiva (260px no mobile e 320px no desktop), mantendo o layout limpo com player mais confortável.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.585',
    date: '21/02/2026',
    summary: 'Chat: card de áudio sem nome/tamanho de arquivo.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Card de áudio mais limpo',
            description: 'Removida a exibição do nome e tamanho do arquivo nos cards de áudio (ex.: audio_*.webm e KB). Agora o card mostra apenas ícone + player de áudio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.584',
    date: '21/02/2026',
    summary: 'Chat: widget de áudio simplificado.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Preview minimalista de áudio',
            description: 'Removido texto "Áudio" do preview de mensagens. Agora exibe apenas o emoji 🎤 para mensagens de áudio, mantendo visual limpo e minimalista sem informações de arquivo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.583',
    date: '21/02/2026',
    summary: 'Chat: widget de áudio redesenhado.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Player de áudio estilo WhatsApp',
            description: 'Widget de áudio completamente redesenhado com player customizado. Controles play/pause, barra de progresso interativa, botão de download, visual moderno com ícone de áudio e design consistente com o tema WhatsApp.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.582',
    date: '21/02/2026',
    summary: 'Chat: fundo WhatsApp na área de conversa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Background idêntico ao WhatsApp',
            description: 'Adicionado fundo exato do WhatsApp na área de conversa. Pattern SVG com cores #ece5dd e #e9dfd9, dimensões 536x113px, repetição centralizada para visual idêntico ao app original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.581',
    date: '21/02/2026',
    summary: 'Chat: redesign completo estilo WhatsApp.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Visual idêntico ao WhatsApp',
            description: 'Redesign completo com cores verde/teal (#25d366), mensagens enviadas com fundo verde claro (#dcf8c6), recebidas com fundo branco, layout limpo e pattern de fundo sutil na área de mensagens. Botões e elementos seguem paleta WhatsApp.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.580',
    date: '21/02/2026',
    summary: 'Tarefas: animação no botão Adicionar.',
    modules: [
      {
        moduleId: 'tarefas',
        changes: [
          {
            type: 'improvement',
            title: 'Loading animado e prevenção de cliques',
            description: 'Botão "Adicionar" agora exibe spinner animado e muda para cor verde durante o processo. Previne múltiplos cliques e mostra feedback visual claro com texto "Adicionando...".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.579',
    date: '21/02/2026',
    summary: 'Tarefas: removido do menu lateral.',
    modules: [
      {
        moduleId: 'tarefas',
        changes: [
          {
            type: 'improvement',
            title: 'Acesso apenas pelo header',
            description: 'Removido o botão Tarefas do menu lateral de navegação. O módulo continua acessível através do botão no header principal, que exibe o contador de tarefas pendentes em um badge verde.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.578',
    date: '21/02/2026',
    summary: 'Tarefas: header completamente removido.',
    modules: [
      {
        moduleId: 'tarefas',
        changes: [
          {
            type: 'improvement',
            title: 'Header completamente removido',
            description: 'Removido todo o header do módulo Tarefas (título e descrição). Agora exibe diretamente o formulário de adicionar tarefas e a lista, mantendo apenas o título no navbar para máxima economia de espaço visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.577',
    date: '21/02/2026',
    summary: 'Tarefas: título duplicado removido.',
    modules: [
      {
        moduleId: 'tarefas',
        changes: [
          {
            type: 'improvement',
            title: 'Título duplicado removido',
            description: 'Removido título "Tarefas" duplicado do módulo. Mantido apenas no navbar para evitar redundância visual. A descrição "Gerencie suas tarefas e lembretes" continua sendo exibida.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.576',
    date: '20/02/2026',
    summary: 'Chat: redesign visual limpo e consistente com o sistema.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Visual limpo e hierarquia refinada',
            description: 'Removidos efeitos visuais pesados, com padronização de fundos e bordas em slate, melhor contraste e organização da interface para leitura e navegação mais confortáveis.',
          },
          {
            type: 'improvement',
            title: 'Lista e composer reorganizados',
            description: 'Lista de conversas com estados ativos mais claros e campo de mensagem redesenhado com estrutura mais limpa, mantendo as cores do sistema (indigo/slate).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.575',
    date: '20/02/2026',
    summary: 'Chat: título duplicado removido e cores ajustadas.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Título duplicado removido',
            description: 'Removido título "Chat da Equipe" duplicado do módulo. Mantido apenas no navbar para evitar redundância visual.',
          },
          {
            type: 'improvement',
            title: 'Cores ajustadas ao padrão do sistema',
            description: 'Botões e elementos de destaque agora usam a cor indigo padrão do sistema (indigo-600) em vez de gradientes purple, mantendo consistência visual com o resto da aplicação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.574',
    date: '20/02/2026',
    summary: 'Chat: tema glassmorphism premium aplicado.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Design glassmorphism premium',
            description: 'Aplicado tema moderno com painéis translúcidos (backdrop-filter blur), gradientes indigo/purple nos botões de ação, bordas suaves com transparência, sombras modernas e espaçamentos refinados. Visual inspirado em designs premium com efeito de vidro fosco.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.571',
    date: '20/02/2026',
    summary: 'Prazos: correção de filtro mensal para concluídos.',
    modules: [
      {
        moduleId: 'prazos',
        changes: [
          {
            type: 'fix',
            title: 'Filtro mensal corrigido',
            description: 'Prazos concluídos agora são contabilizados no mês em que foram finalizados (completed_at), não no mês de vencimento original (due_date). Isso evita que prazos concluídos em fevereiro apareçam nas estatísticas de março.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.570',
    date: '20/02/2026',
    summary: 'Prazos: filtros avançados na mesma linha da toolbar.',
    modules: [
      {
        moduleId: 'prazos',
        changes: [
          {
            type: 'improvement',
            title: 'Filtros Avançados inline',
            description: 'Botão de Filtros Avançados agora está na mesma linha da toolbar principal, com dropdown para expandir. Texto oculto em telas menores (lg:inline) mostrando apenas ícone de filtro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.569',
    date: '20/02/2026',
    summary: 'Prazos: filtros avançados integrados na toolbar.',
    modules: [
      {
        moduleId: 'prazos',
        changes: [
          {
            type: 'improvement',
            title: 'Filtros Avançados integrados',
            description: 'Seção de Filtros Avançados agora está integrada diretamente na toolbar principal, com botão de expansão/recolhimento. Design limpo e moderno seguindo padrão da imagem fornecida.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.568',
    date: '20/02/2026',
    summary: 'Prazos: toolbar compacta em uma linha.',
    modules: [
      {
        moduleId: 'prazos',
        changes: [
          {
            type: 'improvement',
            title: 'Toolbar premium compactada',
            description: 'Toolbar redesenhada para caber tudo em uma única linha: botões de visualização, seletor de mês, busca, filtros (Tipo/Prioridade), botões de ação. Design inspirado em dashboards modernos com melhor uso do espaço.',
          },
          {
            type: 'improvement',
            title: 'Seletor de mês ao lado do calendário',
            description: 'Seletor de mês reposicionado para ficar ao lado dos botões de visualização dentro do módulo, facilitando navegação entre meses.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.567',
    date: '20/02/2026',
    summary: 'Prazos: remoção de duplicidade e seletor no navbar.',
    modules: [
      {
        moduleId: 'prazos',
        changes: [
          {
            type: 'improvement',
            title: 'Títulos duplicados removidos',
            description: 'Removidos títulos "Gestão de Prazos" e "Controle compromissos..." duplicados no módulo. Mantidos apenas no navbar para evitar redundância visual.',
          },
          {
            type: 'improvement',
            title: 'Seletor de mês no navbar',
            description: 'Seletor de mês movido para o cabeçalho ao lado do calendário, visível apenas quando o módulo Prazos está ativo. Melhora usabilidade e centraliza controles.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.566',
    date: '20/02/2026',
    summary: 'Requerimentos: header da barra de controle refinado.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Header mais limpo e alinhado',
            description: 'Refino visual do header da barra de controles com melhor hierarquia, espaçamento consistente, chips de status mais harmonizados e botões de ação com acabamento mais uniforme.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.565',
    date: '20/02/2026',
    summary: 'Requerimentos: correção de erro 400 ao gerar MS.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Erro 400 ao gerar MS corrigido',
            description: 'Removida verificação desnecessária de bucket via client que causava erro 400. O bucket generated-documents já existe e está configurado corretamente no Supabase.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.564',
    date: '20/02/2026',
    summary: 'Requerimentos: modal simples de seleção de template MS.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Modal simples de seleção de template',
            description: 'Ao clicar em "Gerar MS", agora abre um modal simples e direto onde basta clicar no modelo desejado para gerar automaticamente o documento. Não é mais necessário abrir o modal completo de gerenciamento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.563',
    date: '20/02/2026',
    summary: 'Requerimentos: preservação do nome original do arquivo MS.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Nome original do arquivo preservado',
            description: 'Ao enviar template MS, o sistema agora preserva o nome original do arquivo (sem a extensão .docx) em vez de adicionar data automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.562',
    date: '20/02/2026',
    summary: 'Requerimentos: correção de import.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Import do ícone Download',
            description: 'Corrigido erro de import do ícone Download do lucide-react que impedia o carregamento do módulo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.561',
    date: '20/02/2026',
    summary: 'Requerimentos: download e seleção de modelo MS aprimorados.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'feature',
            title: 'Botão Baixar modelo MS',
            description: 'Adicionado botão "Baixar" no modal de templates MS para fazer download do modelo Word (DOCX) hospedado no sistema.',
          },
          {
            type: 'improvement',
            title: 'Seleção de modelo ao gerar MS',
            description: 'Ao clicar em "Gerar MS", agora abre o modal para selecionar qual modelo usar antes de gerar. Botão "Gerar MS" disponível diretamente no modal quando há requerimento selecionado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.560',
    date: '20/02/2026',
    summary: 'Requerimentos: botão Gerenciar MS corrigido.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Botão Gerenciar MS corrigido',
            description: 'Corrigido botão "Gerenciar MS" que estava tentando navegar para módulo inexistente (ms-management). Agora abre diretamente o modal de gerenciamento de templates MS.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.559',
    date: '20/02/2026',
    summary: 'Requerimentos: alinhamento e refinamento visual da barra.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Barra compacta alinhada',
            description: 'A barra de status e ações foi alinhada com melhor distribuição entre chips e botões, reduzindo ruído visual e mantendo o layout compacto e consistente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.558',
    date: '20/02/2026',
    summary: 'Requerimentos/MS: filtro de templates e remoção de modelo.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Template MS filtrado + remoção',
            description: 'No modal Template MS, a lista agora exibe somente modelos do contexto MS (Requerimentos). Adicionada ação Remover para excluir o modelo selecionado com confirmação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.557',
    date: '20/02/2026',
    summary: 'Requerimentos: barra compacta sem scroll lateral.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Controles compactos e organizados',
            description: 'Barra superior reorganizada para remover scroll lateral: chips de status menores com quebra de linha, botões de ação compactos e botão Gerenciar MS fixo na área de ações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.556',
    date: '20/02/2026',
    summary: 'Requerimentos: header duplicado removido.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Header duplicado removido',
            description: 'Removido header duplicado do módulo Requerimentos (mantido apenas título no nav). Interface mais limpa sem repetição de "Sistema de Requerimentos" e "Gerencie requerimentos administrativos do INSS".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.555',
    date: '20/02/2026',
    summary: 'Assinaturas: modo cards em estilo pasta.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Cards com visual de pasta',
            description: 'Modo cards atualizado para visual estilo pasta, com aba superior, ícone FolderOpen e cartões com identidade documental para melhorar leitura e percepção de organização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.554',
    date: '20/02/2026',
    summary: 'Requerimentos: header duplicado removido.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Header duplicado removido',
            description: 'Removido header duplicado do módulo Requerimentos (mantido apenas título no nav). Interface mais limpa sem repetição de "Sistema de Requerimentos" e "Gerencie requerimentos administrativos do INSS".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.553',
    date: '20/02/2026',
    summary: 'Assinaturas: modo cards em estilo pasta.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Cards com visual de pasta',
            description: 'Modo cards atualizado para visual estilo pasta, com aba superior, ícone FolderOpen e cartões com identidade documental para melhorar leitura e percepção de organização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.552',
    date: '20/02/2026',
    summary: 'Assinaturas: modo cards redesenhado.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Modo cards redesenhado',
            description: 'Modo cards completamente redesenhado com layout moderno. Grid responsiva (xl:grid-cols-4), header com ícone e percentual, conteúdo organizado em seções, footer com status e progresso visual melhorado, hover effects e transições suaves.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.551',
    date: '20/02/2026',
    summary: 'Assinaturas: cards simplificados.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Design dos cards simplificado',
            description: 'Cards da lista simplificados para melhor UX. Removida complexidade desnecessária, layout mais limpo com cards compactos, informações essenciais apenas e interação mais direta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.550',
    date: '20/02/2026',
    summary: 'Assinaturas: cards da lista redesenhados.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Design dos cards redesenhado',
            description: 'Cards da lista completamente redesenhados com layout moderno. Melhor hierarquia visual, organização de informações, badges compactos para Processo/Req., progress bar integrada no status e botão "Ver detalhes" explícito para melhor UX.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.549',
    date: '20/02/2026',
    summary: 'Assinaturas: header vazio removido.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Header vazio removido',
            description: 'Removida barra header vazia onde estava o botão Novo documento. Interface mais limpa com apenas a toolbar principal contendo filtros e ações de forma organizada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.548',
    date: '20/02/2026',
    summary: 'Assinaturas: botão Novo documento reposicionado.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Novo documento reposicionado',
            description: 'Botão "Novo documento" reposicionado ao lado do botão "Público" no módulo Assinaturas. Removido do navigation para evitar duplicação e melhorar organização visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.547',
    date: '20/02/2026',
    summary: 'Assinaturas: erro de Hooks corrigido.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Erro de Hooks corrigido',
            description: 'Corrigido erro "Rendered more hooks than during the previous render" movendo useEffect para o topo do componente. Hooks devem sempre ser chamados na mesma ordem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.546',
    date: '20/02/2026',
    summary: 'Assinaturas: botão Novo documento integrado ao nav.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Novo documento no navigation',
            description: 'Botão "Novo documento" integrado ao navigation ao lado do perfil. Aparece apenas quando módulo Assinaturas está ativo, com acesso direto ao wizard de upload via DOM para melhor UX.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.545',
    date: '20/02/2026',
    summary: 'Assinaturas: header duplicado removido.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Header duplicado removido',
            description: 'Removido header duplicado do módulo Assinaturas (mantido apenas título no nav). Interface mais limpa sem repetição de "Assinatura Digital" e "Envie documentos e acompanhe o progresso das assinaturas".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.544',
    date: '20/02/2026',
    summary: 'Documentos: header duplicado removido.',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Header duplicado removido',
            description: 'Removido header duplicado do módulo Documentos (mantido apenas título no nav). Interface mais limpa sem repetição de "Modelos de documentos" e "Gerencie templates e documentos".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.543',
    date: '20/02/2026',
    summary: 'Processos: botão X adicionado ao header do modal.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Botão de fechar no header',
            description: 'Adicionado botão X no header do modal de exportação para fechar, seguindo exatamente o padrão da Agenda. Header agora com layout flex e botão de fechar no canto superior direito com hover effects.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.542',
    date: '20/02/2026',
    summary: 'Processos: layout dos botões do modal alinhado à Agenda.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Estrutura dos botões do modal corrigida',
            description: 'Botões "Cancelar" e "Exportar Excel" foram movidos para dentro do mesmo container interno do conteúdo, replicando a estrutura da Agenda e corrigindo espaçamento/alinhamento visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.541',
    date: '20/02/2026',
    summary: 'Processos: botão Exportar Excel corrigido.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Botão Exportar Excel corrigido',
            description: 'Botão "Exportar Excel" corrigido para usar disabled:opacity-50 em vez de bg-gray-400, mantendo o gradiente verde esmeralda visível mesmo quando desabilitado, exatamente igual ao da Agenda.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.540',
    date: '20/02/2026',
    summary: 'Processos: botões do modal corrigidos.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Botões do modal de exportação corrigidos',
            description: 'Corrigidos botões do modal de exportação para ficar idênticos aos da Agenda. Removidas classes CSS duplicadas e ajustado estado disabled para consistência visual e comportamento idêntico.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.539',
    date: '20/02/2026',
    summary: 'Processos: modal de exportação redesenhado.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Design do modal de exportação melhorado',
            description: 'Modal de exportação redesenhado seguindo o mesmo padrão visual da Agenda: labels com emojis e uppercase tracking, border-2 nos campos, cores consistentes, botões com gradiente verde esmeralda e hover effects com transform. Interface mais profissional e consistente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.538',
    date: '20/02/2026',
    summary: 'Processos: exportação profissional com filtros avançados.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de exportação com filtros avançados',
            description: 'Botão "Exportar" agora abre modal profissional com filtros avançados: status do processo, tipo de processo, advogado responsável, período (data inicial/final), ordenação (mais recente/mais antigo). Prévia em tempo real mostra quantos processos serão exportados. Não baixa automaticamente - usuário configura filtros antes de exportar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.537',
    date: '20/02/2026',
    summary: 'Processos: exportação Excel completamente melhorada.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Exportação Excel aprimorada',
            description: 'Exportação de processos completamente reformulada: adicionadas colunas "Tipo de Processo", "Status do Processo", numeração sequencial, DJEN Sincronizado, DJEN Tem Dados, Última Sync DJEN. Processos automaticamente ordenados por data de atualização (mais recente primeiro). Nome do arquivo inclui filtro de status aplicado e timestamp completo. Exporta apenas processos filtrados (respeita busca e filtros ativos).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.536',
    date: '20/02/2026',
    summary: 'Processos: badge CRON reposicionado e correção de detecção de status.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Badge CRON reposicionado',
            description: 'Badge "CRON ATIVO (03h)" movido para ao lado do botão "Mapa de Fases" no módulo Processos, melhorando a organização visual.',
          },
          {
            type: 'fix',
            title: 'Detecção de status de Recurso corrigida',
            description: 'Corrigida lógica de detecção automática de status - Recurso agora tem prioridade sobre Instrução. Inclusos termos: "sessão de julgamento", "pauta de julgamento", "turma recursal", "tribunal", "recurso inominado". Processos com intimações de tribunais superiores serão corretamente identificados como "Recurso".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.535',
    date: '20/02/2026',
    summary: 'Processos: restaurada seção Aguardando Confecção.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Seção Aguardando Confecção restaurada',
            description: 'Restaurada seção expandida "Aguardando Confecção" com formulário inline para adicionar clientes rapidamente e lista de processos aguardando confecção. Removido botão do nav principal.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.534',
    date: '20/02/2026',
    summary: 'Processos: correções de UI e acesso rápido no nav.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Título duplicado removido',
            description: 'Removido título duplicado do módulo Processos (mantido apenas no nav principal).',
          },
          {
            type: 'improvement',
            title: 'Badge CRON e Aguardando Confecção no nav',
            description: 'Badge "CRON ATIVO (03h)" e botão "AGUARDANDO CONFECÇÃO" adicionados ao nav principal, visíveis apenas quando módulo Processos está ativo. Acesso rápido ao filtro de processos aguardando confecção.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.533',
    date: '20/02/2026',
    summary: 'Processos: módulo reorganizado com design limpo e moderno.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Interface redesenhada e simplificada',
            description: 'Módulo Processos reorganizado com design mais limpo: header compacto com badge de cron discreto, remoção da seção expandida "Aguardando Confecção", cards de estatísticas redesenhados com layout mais compacto e visual seguindo padrões modernos de UI/UX.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.532',
    date: '20/02/2026',
    summary: 'Processos: sincronização DJEN agora apenas via Edge Function.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Sincronização DJEN exclusivamente via cron',
            description: 'Removida sincronização DJEN via navegador (hook useDjenSync e função handleSyncAllDjen). A sincronização agora é realizada exclusivamente via Edge Function no cron do Supabase, reduzindo carga no navegador e melhorando performance.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.531',
    date: '20/02/2026',
    summary: 'Processos: correção do erro de token no cron de status.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Erro "Token inválido" no Update Process Status',
            description: 'Desabilitada validação de token na Edge Function update-process-status para permitir execução via cron do Supabase, seguindo o mesmo padrão do run-djen-sync.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.530',
    date: '20/02/2026',
    summary: 'Intimações: monitor do cron Run DJEN Sync exibido no módulo correto.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Card Run DJEN Sync no módulo de Intimações',
            description: 'O status do cron de intimações (07h e 19h) foi realocado para o módulo Intimações com última execução, status, encontradas e salvas.',
          },
        ],
      },
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Processos mostra apenas cron de status',
            description: 'O módulo Processos agora mantém somente o monitor do Update Process Status (03h), sem duplicar o monitor de Run DJEN Sync.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.529',
    date: '20/02/2026',
    summary: 'Processos: monitor de cron separado por rotina (status x intimações).',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Monitor de Crons separado por rotina',
            description: 'O painel do módulo Processos agora exibe dois blocos distintos: Update Process Status (03h) e Run DJEN Sync (07h e 19h), cada um com última execução, status, contadores e erro da rotina.',
          },
          {
            type: 'improvement',
            title: 'Rastreabilidade do cron de status',
            description: 'A Edge Function update-process-status passou a registrar execuções no djen_sync_history (source: process_status_cron, trigger_type: update_process_status), permitindo exibição fiel no painel.',
          },
          {
            type: 'fix',
            title: 'Leitura correta dos crons no painel',
            description: 'Corrigida a leitura incorreta em que o painel mostrava apenas o cron DJEN. Agora o operador visualiza separadamente a saúde de cada automação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.523',
    date: '20/02/2026',
    summary: 'Petições: formatação inteligente com IA e correções de salvamento.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'feature',
            title: 'Formatar com IA',
            description: 'Nova funcionalidade no menu de contexto para formatar qualquer texto com IA. Detecta automaticamente tipo de texto (qualificações, endereços, textos jurídicos, listas) e aplica formatação apropriada com correção ortográfica completa, remoção de espaços extras e padronização de CPF/CEP.',
          },
          {
            type: 'improvement',
            title: 'Modelos Econômicos',
            description: 'Configurado para usar Groq Llama 3.3 (mais barato) como principal e OpenAI GPT-4o-mini como fallback, otimizando custos de formatação.',
          },
          {
            type: 'improvement',
            title: 'Animação de Loading',
            description: 'Adicionada animação elegante durante formatação com IA, com overlay visual e feedback claro do processamento.',
          },
        ],
      },
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'fix',
            title: 'Bug de Salvamento',
            description: 'Corrigido bug onde inserir bloco e depois vincular cliente bloqueava o botão Salvar. Causa: estado saving compartilhado entre documento e modais. Solução: separado em savingDoc (documento) e saving (modais).',
          },
          {
            type: 'fix',
            title: 'Closure Desatualizada',
            description: 'Corrigido stale closure ao vincular cliente que causava erro no auto-save. Agora usa savePetitionActionRef com delay adequado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.521',
    date: '15/02/2026',
    summary: 'Sistema: atualização de versões de componentes.',
    modules: [
      {
        moduleId: 'system',
        changes: [
          {
            type: 'improvement',
            title: 'Versões de Componentes',
            description: 'Atualizadas versões de componentes e incrementada versão do sistema com registro no changelog.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.520',
    date: '05/02/2026',
    summary: 'Leads: modal de detalhes padronizado.',
    modules: [
      {
        moduleId: 'leads',
        changes: [
          {
            type: 'fix',
            title: 'Design do Modal',
            description: 'Corrigido modal de detalhes do lead para seguir design padrão do sistema com faixa laranja, fundo branco e estilos consistentes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.519',
    date: '04/02/2026',
    summary: 'Requerimentos: correção do tempo em análise ao editar.',
    modules: [
      {
        moduleId: 'requirements',
        changes: [
          {
            type: 'fix',
            title: 'Tempo em Análise',
            description: 'Corrigido tempo em análise zerado ao editar requerimento, mantendo cálculo baseado na data de entrada original.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.518',
    date: '04/02/2026',
    summary: 'Requerimentos: badge "MS" para processos vinculados.',
    modules: [
      {
        moduleId: 'requirements',
        changes: [
          {
            type: 'feature',
            title: 'Badge MS',
            description: 'Adicionado badge "MS" nos requerimentos que possuem processo de Mandado de Segurança vinculado, exibido ao lado da data de entrada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.517',
    date: '04/02/2026',
    summary: 'Requerimentos: correção da data de entrada no documento MS gerado.',
    modules: [
      {
        moduleId: 'requirements',
        changes: [
          {
            type: 'fix',
            title: 'Data no Documento MS',
            description: 'Corrigida a data de entrada no documento MS gerado para evitar deslocamento por fuso horário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.516',
    date: '04/02/2026',
    summary: 'Requerimentos: correção da data de entrada para evitar deslocamento por fuso horário.',
    modules: [
      {
        moduleId: 'requirements',
        changes: [
          {
            type: 'fix',
            title: 'Data de Entrada',
            description: 'Corrigida a data de entrada no modal de edição/visualização e na geração do MS para evitar deslocamento por fuso horário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.515',
    date: '02/02/2026',
    summary: 'Chat: melhorias na interface e funcionalidades do módulo.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'Interface Otimizada',
            description: 'Melhorias na interface e funcionalidades do módulo de chat.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.491',
    date: '30/01/2026',
    summary: 'Intimações: vinculação automática no carregamento e botão de vinculação direta.',
    modules: [
      {
        moduleId: 'intimations',
        changes: [
          {
            type: 'improvement',
            title: 'Vinculação Automática no Carregamento',
            description: 'Implementada vinculação automática de intimações ao carregar o módulo, não apenas na sincronização manual.',
          },
          {
            type: 'improvement',
            title: 'Botão de Vinculação Direta',
            description: 'Transformado "Sem Vínc" em botão clicável para abrir modal de vinculação diretamente da lista.',
          },
          {
            type: 'fix',
            title: 'Correção de Sintaxe e Tipos',
            description: 'Corrigidos erros de sintaxe no IntimationsModule e tipos no changelog.',
          }
        ],
      }
    ],
  },
  {
    version: '1.9.490',
    date: '30/01/2026',
    summary: 'Chat: correção de múltiplas caixas para o mesmo usuário no widget.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Eliminação de Salas DM Duplicadas',
            description: 'Implementada verificação para evitar criação de múltiplas salas DM para o mesmo par de usuários no widget de chat.',
          }
        ],
      }
    ],
  },
  {
    version: '1.9.489',
    date: '30/01/2026',
    summary: 'Intimações: restauração do módulo mantendo alterações do Supabase e TypeScript.',
    modules: [
      {
        moduleId: 'intimations',
        changes: [
          {
            type: 'improvement',
            title: 'Restauração do Módulo de Intimações',
            description: 'Restaurado módulo de intimações do Git, preservando todas as funcionalidades do Supabase e melhorias TypeScript implementadas.',
          }
        ],
      }
    ],
  },
  {
    version: '1.9.488',
    date: '29/01/2026',
    summary: 'Editor: busca de CNPJ via OpenAI + correção de CORS no proxy.',
    modules: [
      {
        moduleId: 'editor',
        changes: [
          {
            type: 'improvement',
            title: 'Busca de CNPJ no editor usando OpenAI',
            description: 'Substituída a IA do Groq pela OpenAI na compilação/normalização de dados de empresa (CNPJ), usando a Edge Function openai-proxy para evitar CORS.',
          },
          {
            type: 'fix',
            title: 'CORS/preflight do openai-proxy',
            description: 'Ajustados headers e resposta do OPTIONS para permitir chamadas do frontend para a Edge Function sem bloqueio de CORS.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.487',
    date: '29/01/2026',
    summary: 'Processos: validação robusta de data da audiência.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Validação dupla para data da audiência',
            description: 'Adicionada validação no frontend (atributo min) e backend (verificação no submit) para garantir que datas anteriores a hoje não sejam aceitas, mesmo que o usuário consiga contornar a validação do input.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.486',
    date: '29/01/2026',
    summary: 'Validação de datas em todo o sistema: bloqueio de datas passadas.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Data da audiência não pode ser anterior a hoje',
            description: 'Adicionada validação no campo de data da audiência para impedir seleção de datas anteriores à data atual.',
          },
        ],
      },
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'fix',
            title: 'Datas de vencimento e compromissos não podem ser anteriores a hoje',
            description: 'Adicionada validação nos campos de data de vencimento de prazos e data de compromissos para impedir datas passadas.',
          },
        ],
      },
      {
        moduleId: 'calendario',
        changes: [
          {
            type: 'fix',
            title: 'Data de eventos não pode ser anterior a hoje',
            description: 'Adicionada validação no campo de data de criação de eventos para impedir datas passadas.',
          },
        ],
      },
      {
        moduleId: 'exigencias',
        changes: [
          {
            type: 'fix',
            title: 'Datas de vencimento e perícias não podem ser anteriores a hoje',
            description: 'Adicionada validação nos campos de data de vencimento de exigências e datas de perícias (médica e social) para impedir datas passadas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.485',
    date: '29/01/2026',
    summary: 'Processos: bloqueio de datas anteriores para audiência.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Data da audiência não pode ser anterior a hoje',
            description: 'Adicionada validação no campo de data da audiência para impedir seleção de datas anteriores à data atual, evitando agendamentos retroativos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.484',
    date: '29/01/2026',
    summary: 'Intimações: correção de vinculação automática por número do processo.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'fix',
            title: 'Vinculação automática funciona para processos fora de "andamento"',
            description: 'Corrigido o sync do DJEN (run-djen-sync) para considerar todos os processos cadastrados ao tentar vincular intimações por número do processo, incluindo processos arquivados e outros status. Também realizado backfill para vincular intimações já importadas sem vínculo quando houver match pelo número do processo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.483',
    date: '29/01/2026',
    summary: 'Prescrição: modal fecha ao criar compromisso e conversão automática ativada.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Modal de prescrição fecha após criar compromisso',
            description: 'Ao criar o compromisso de prescrição na agenda a partir da intimação, o modal é fechado automaticamente após sucesso.',
          },
        ],
      },
      {
        moduleId: 'calendario',
        changes: [
          {
            type: 'feature',
            title: 'Conversão automática de compromisso de prescrição em prazo',
            description: 'Criada e deployada a Edge Function (convert-prescription-deadlines) e configurado pg_cron para executar diariamente às 08:00, convertendo automaticamente compromissos de prescrição em prazos quando chega a data do aviso.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.482',
    date: '29/01/2026',
    summary: 'Prescrição: projeção de datas restaurada e conversão automática em prazo.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'fix',
            title: 'Projeção de datas restaurada no modal de prescrição',
            description: 'Restaurada a exibição das datas projetadas (prescrição estimada e aviso na agenda) no modal de prescrição das intimações.',
          },
        ],
      },
      {
        moduleId: 'calendario',
        changes: [
          {
            type: 'feature',
            title: 'Conversão automática de compromisso de prescrição em prazo',
            description: 'Criada Edge Function (convert-prescription-deadlines) que converte automaticamente compromissos de prescrição em prazos quando chega a data do aviso. A função pode ser executada via cron diário para automatizar o processo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.479',
    date: '29/01/2026',
    summary: 'Processos e Intimações: monitoramento de prescrição para execução sobrestada.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'feature',
            title: 'Execução sobrestada: criar compromisso 6 meses antes da prescrição',
            description: 'Nos detalhes do processo, adicionada seção expansível para criar um compromisso na agenda 6 meses antes da prescrição estimada (data-base + 18 meses). Inclui cadastro manual da data-base com seleção de motivo e identificação via IA/timeline. O agendamento é realizado apenas quando o motivo for prescrição.',
          },
        ],
      },
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'feature',
            title: 'Ação de prescrição nas intimações',
            description: 'Adicionado botão "Prescrição" nas ações da intimação para criar compromisso de alerta de prescrição diretamente a partir de uma intimação DJEN.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.478',
    date: '27/01/2026',
    summary: 'Chat: DM única por pessoa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Uma conversa por pessoa',
            description: 'Impedida a criação de múltiplas conversas (DM) com a mesma pessoa. Ao iniciar chat, o sistema reutiliza a conversa existente e evita duplicidades na lista.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.477',
    date: '27/01/2026',
    summary: 'Chat: Usabilidade melhorada no mobile.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Composer do chat usável no celular',
            description: 'Ajustes no composer (input e botões) para caber e operar bem no mobile, além de correção de altura usando 100dvh para evitar problemas de viewport no celular.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.476',
    date: '27/01/2026',
    summary: 'Chat: Responsividade mobile completa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Chat 100% Responsivo',
            description: 'Implementada navegação entre lista de conversas e chat ativo no mobile, com botão de voltar e ajustes de interface para telas pequenas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.475',
    date: '27/01/2026',
    summary: 'Feed: Comportamento sticky corrigido estilo Facebook.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Sidebars com rolagem estilo Facebook',
            description: 'Corrigido o comportamento "sticky" das sidebars laterais para seguir o padrão do Facebook. Agora as sidebars rolam junto com o feed até o final do seu conteúdo e permanecem fixas, evitando espaços vazios indesejados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.474',
    date: '27/01/2026',
    summary: 'Feed: Ajustado comportamento das sidebars laterais.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebars estilo Facebook',
            description: 'Ajustado comportamento das sidebars laterais para seguir o padrão do Facebook - rolam até o fim do conteúdo e permanecem fixas, sem criar espaços vazios.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.473',
    date: '27/01/2026',
    summary: 'Feed: Layout das sidebars corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Sidebars com items-start',
            description: 'Corrigido layout das sidebars com items-start no grid container - sidebars ficam alinhadas ao topo e param quando o conteúdo acaba.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.472',
    date: '27/01/2026',
    summary: 'Feed: Layout das sidebars corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Sidebars com items-start',
            description: 'Corrigido layout das sidebars com items-start no grid container - sidebars ficam alinhadas ao topo e param quando o conteúdo acaba.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.471',
    date: '27/01/2026',
    summary: 'Feed: Removido sticky das sidebars.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Sidebars sem sticky',
            description: 'Removido sticky das sidebars - agora usam self-start para ficarem alinhadas ao topo e pararem quando o conteúdo acabar. Feed central é o único eixo de rolagem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.470',
    date: '27/01/2026',
    summary: 'Feed: Widgets laterais fixos no topo.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Widgets fixos com altura máxima',
            description: 'Widgets laterais agora ficam fixos no topo com altura máxima (100vh - 2rem) e scroll interno próprio - evita áreas vazias e mantém foco no feed central.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.469',
    date: '27/01/2026',
    summary: 'Feed: Comportamento de rolagem corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Widgets laterais param no fim do conteúdo',
            description: 'Implementado comportamento correto de rolagem dos widgets laterais - rolam até o fim do conteúdo e depois ficam fixos, evitando áreas vazias e poluição visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.468',
    date: '27/01/2026',
    summary: 'Feed: Header do post melhorado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Cargo e badge no header',
            description: 'Adicionado cargo/função do usuário e badge na mesma linha do nome - layout mais informativo estilo Instagram/Facebook.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.467',
    date: '27/01/2026',
    summary: 'Feed: Badge de administrador destacado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Badge do admin mais vibrante',
            description: 'Badge de administrador agora mais destacado com gradiente vibrante (amber → orange → red), sombra forte e ring ao redor para diferenciar dos outros badges.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.466',
    date: '27/01/2026',
    summary: 'Feed: Redesign completo dos posts.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Posts estilo Instagram/Facebook',
            description: 'Redesign completo dos posts estilo Instagram/Facebook - header limpo com avatar, nome e tempo; contadores de likes/comentários separados; botões de ação centralizados e maiores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.465',
    date: '27/01/2026',
    summary: 'Feed: Card de artigo redesenhado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Artigo minimalista',
            description: 'Redesenhado card de artigo com visual minimalista e elegante - removido gradiente, design limpo estilo Medium/LinkedIn.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.464',
    date: '27/01/2026',
    summary: 'Feed: Layout do post de artigo redesenhado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Artigo institucional profissional',
            description: 'Layout do post de artigo institucional redesenhado com visual mais profissional - header com gradiente laranja, ícone destacado, corpo com melhor espaçamento e footer com informações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.461',
    date: '27/01/2026',
    summary: 'Feed: hover das menções corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Hover das menções funciona',
            description: 'Corrigido hover das menções (@Nome) no PostModal - agora ficam azuis e sublinhadas ao passar o mouse.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.460',
    date: '27/01/2026',
    summary: 'Feed: menções clicáveis no single post.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Menção (@) abre perfil',
            description: 'Menções (@Nome) no PostModal (single post) voltaram a ter comportamento de link e navegam corretamente para o perfil.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.459',
    date: '27/01/2026',
    summary: 'Feed: single post com cards completos.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Cards do PostModal completos',
            description: 'Cards de preview no PostModal (single post) agora exibem as informações completas, igual ao Feed (ex.: Cliente com nome e telefone/CPF).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.458',
    date: '27/01/2026',
    summary: 'Feed: cor do conteúdo no single post.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Menções sem azul no PostModal',
            description: 'Ajustada cor das menções (@) no PostModal para não deixar o conteúdo azul no single post.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.457',
    date: '27/01/2026',
    summary: 'Feed: single post completo.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'PostModal com # e enquete',
            description: 'Ao abrir um post individual (single post), o PostModal agora carrega/enxerga tags (#), cards de preview_data e enquetes corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.456',
    date: '27/01/2026',
    summary: 'Notificações: abrir post no Feed.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Clique na notificação abre o post',
            description: 'Notificações de menção/curtida/comentário agora abrem o post específico (single post) no Feed.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.455',
    date: '27/01/2026',
    summary: 'Dashboard: permissões aplicadas nos widgets.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Widgets respeitam permissões',
            description: 'Dashboard agora oculta widgets/contadores/atalhos de módulos sem permissão (ex.: Auxiliar não visualiza Financeiro/Intimações/Requerimentos quando não tem acesso).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.454',
    date: '27/01/2026',
    summary: 'Feed: layout do composer reorganizado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Visibilidade na linha principal e Publicar à direita',
            description: 'Dropdown de visibilidade (Público/Equipe/Privado) movido para a linha principal de ações; botão "Publicar" alinhado à direita para melhor uso do espaço.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.453',
    date: '27/01/2026',
    summary: 'Feed: erro ao postar foto corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'file_type undefined',
            description: 'Corrigido erro "Cannot read properties of undefined (reading \'startsWith\')" ao postar fotos, adicionando optional chaining em file_type.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.452',
    date: '27/01/2026',
    summary: 'Feed: z-index corrigido.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Emoji picker acima do nav',
            description: 'Ajustado z-index do emoji picker e dropdown de visibilidade de z-20 para z-50 para garantir que apareçam acima do menu de navegação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.451',
    date: '27/01/2026',
    summary: 'Feed: botão Publicar otimizado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Publicar movido',
            description: 'Botão "Publicar" movido para a linha dos ícones de ações, otimizando espaço e deixando o layout do composer mais compacto e eficiente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.450',
    date: '27/01/2026',
    summary: 'Feed: botão Agendar otimizado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Botão Agendar movido',
            description: 'Botão "Agendar" movido da linha 2 para a linha dos ícones de ações, economizando espaço e deixando a barra do composer mais compacta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.449',
    date: '27/01/2026',
    summary: 'Feed: dropdown de visibilidade.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Botões de visibilidade unificados',
            description: 'Três botões (Público/Equipe/Privado) substituídos por único botão com dropdown para seleção, economizando espaço e simplificando interface.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.448',
    date: '27/01/2026',
    summary: 'Feed: barra do composer minimalista.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Barra do composer simplificada',
            description: 'Barra de ações/visibilidade/agendar com botões compactos (ícone), cores neutras e menos ruído visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.447',
    date: '27/01/2026',
    summary: 'Feed: carregamento em segundo plano otimizado.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Background loading com requestIdleCallback',
            description: 'loadDashboardData e loadFeedPosts agora usam requestIdleCallback/setTimeout para renderizar layout primeiro; enquetes e preferências também carregam em background.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.446',
    date: '27/01/2026',
    summary: 'Feed: ajuste de UI.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Remoção de banner de atualização',
            description: 'Removida a mensagem de "atualizando em segundo plano" durante o carregamento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.445',
    date: '27/01/2026',
    summary: 'Feed: melhorias de performance.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Carregamento mais rápido do Feed',
            description: 'Removido loader em tela cheia; atualização ocorre em background com banner discreto. Perfis (menções/audiência) passam a carregar sob demanda.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.444',
    date: '27/01/2026',
    summary: 'Feed: melhoria de carregamento de avatar.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Avatar mais rápido no Feed',
            description: 'O avatar/foto agora usa renderização via <img> (mesmo padrão do Nav), melhorando velocidade e consistência do carregamento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.443',
    date: '27/01/2026',
    summary: 'Intimações: pacote de melhorias UI/UX.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Indicadores visuais de vinculação',
            description: 'Badges "Vinc" (verde) e "Sem Vínc" (cinza) nos cards para identificar rapidamente intimações com/sem vínculo.',
          },
          {
            type: 'improvement',
            title: 'Filtros avançados',
            description: 'Novos filtros por urgência (alta/média/baixa) e por estado de vinculação (vinculadas/não vinculadas).',
          },
          {
            type: 'improvement',
            title: 'Busca por nº de processo normalizado',
            description: 'Busca agora ignora pontuação (.) e traços (-) ao procurar por números de processo.',
          },
          {
            type: 'improvement',
            title: 'Ações em lote',
            description: 'Opções para vincular em lote, exportar apenas selecionadas e marcar todas como lidas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.442',
    date: '27/01/2026',
    summary: 'Intimações: vinculação automática por processo/partes.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Auto-vinculação (processo/cliente)',
            description: 'Ao sincronizar, intimações sem vínculo passam por match automático por número do processo (normalizado, ignorando pontuação) e por nomes das partes (inclui fallback pelo texto).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.441',
    date: '27/01/2026',
    summary: 'Intimações: área de visualização otimizada (~95% para conteúdo).',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Header e filtros compactos',
            description: 'Redução de padding e altura da barra superior e botões para maximizar espaço de visualização das intimações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.440',
    date: '27/01/2026',
    summary: 'Intimações: texto em largura total no agrupado por processo.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Texto em largura total (desktop)',
            description: 'Na visualização agrupada por processo, as ações foram movidas para abaixo do texto para liberar a largura completa do conteúdo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.439',
    date: '27/01/2026',
    summary: 'Intimações: refinamento visual (paleta corporativa e seleção).',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Design mais corporativo',
            description: 'Ajustes de paleta e estados de seleção para reduzir cores fortes, com destaque discreto e melhor consistência visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.438',
    date: '27/01/2026',
    summary: 'Intimações: cards mais profissionais e botões de ação lado a lado.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'UI mais neutra e organizada',
            description: 'Botões de ação ajustados para ficarem lado a lado e estilos revisados para reduzir cores fortes no card e na área de análise.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.437',
    date: '27/01/2026',
    summary: 'Correções: Intimações (erro de runtime) e Dashboard (remoção de logs).',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'fix',
            title: 'Erro de runtime ao abrir Intimações',
            description: 'Corrigido ReferenceError ao adicionar botões no topo (import do ícone Settings).',
          },
        ],
      },
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Console mais limpo',
            description: 'Removidos logs de debug no console relacionados a cache/eventos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.436',
    date: '27/01/2026',
    summary: 'Intimações: Barra superior do desktop com botões rápidos e painel de filtros avançados.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Botões rápidos no desktop',
            description: 'Adicionados botões rápidos para status (Não lidas/Lidas/Todas) e período (30/60/90) e botão "Mais filtros" para opções avançadas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.435',
    date: '27/01/2026',
    summary: 'Intimações: Filtros/controles colapsados por padrão no desktop para dar mais espaço às intimações.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Filtros colapsados no desktop',
            description: 'A área de filtros/controles do topo agora fica recolhida por padrão também no desktop, podendo ser expandida pelo botão "Filtros".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.434',
    date: '27/01/2026',
    summary: 'Dashboard/Agenda: Corrigido filtro e marcação de "Hoje" para compromissos com data em formato YYYY-MM-DD.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Datas em fuso local',
            description: 'Implementado parseLocalDateTime para tratar datas sem timezone (YYYY-MM-DD) como data local, evitando que eventos de hoje sumissem por interpretação UTC.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.433',
    date: '27/01/2026',
    summary: 'Feed: Correção de estrutura JSX e build para eliminar erro 500 no carregamento do módulo.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Estrutura JSX e build corrigidos',
            description: 'Ajustados fechamentos de tags/parênteses no ternário de posts e imports com casing correto. Removidos tipos/funções ausentes (FeedAttachment, removeAttachment, Paperclip) e corrigidos acessos opcionais (likes_count, total_votes).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.419',
    date: '26/01/2026',
    summary: 'Feed: Correção de encoding para exibir acentos corretamente.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Texto do feed com acentuação corrigida',
            description: 'Aplicada correção de encoding no script para evitar caracteres corrompidos na exibição de posts e comentários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.417',
    date: '26/01/2026',
    summary: 'Feed: Correção para exibição de enquetes e anexos (cards) nos posts.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Enquetes voltaram a aparecer nos posts',
            description: 'O card de post no feed foi atualizado para renderizar enquetes associadas ao post, incluindo votação e estado de encerramento.',
          },
          {
            type: 'fix',
            title: 'Anexos (imagens/arquivos) voltaram a aparecer nos posts',
            description: 'O card de post no feed agora exibe novamente anexos do post (galeria de imagens e arquivos para download).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.416',
    date: '25/01/2026',
    summary: 'Feed: Refatoração completa do grid e alinhamento com layout profissional.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Grid de 12 colunas (3-6-3)',
            description: 'Implementado grid fixo de 12 colunas com distribuição equilibrada: sidebar esquerda (3), feed central (6), sidebar direita (3).',
          },
          {
            type: 'improvement',
            title: 'Top-alignment consistente',
            description: 'Todas as colunas iniciam exatamente no mesmo eixo vertical com items-start, eliminando desalinhamento.',
          },
          {
            type: 'improvement',
            title: 'Padronização de widgets',
            description: 'Todos os widgets agora usam padding consistente (p-4), margin-bottom consistente (mb-4) e espaçamento uniforme.',
          },
          {
            type: 'improvement',
            title: 'Cards de métricas padronizados',
            description: 'Cards de métricas com altura idêntica (min-h-[80px]), centralização vertical e tipografia hierárquica.',
          },
          {
            type: 'improvement',
            title: 'Alinhamento interno corrigido',
            description: 'Ícones e textos centralizados verticalmente, títulos e ícones na mesma linha base, botões com alinhamento horizontal consistente.',
          },
          {
            type: 'fix',
            title: 'Remoção de sticky positioning',
            description: 'Removido lg:sticky das sidebars que causava desalinhamento vertical entre colunas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.415',
    date: '25/01/2026',
    summary: 'Feed: Melhorias de UX com filtros, posts fixados, resumo semanal e modo compacto.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'feature',
            title: 'Filtro rápido por tags',
            description: 'Barra de filtros com chips clicáveis para filtrar posts por categoria (Financeiro, Processo, Prazo, etc).',
          },
          {
            type: 'feature',
            title: 'Posts fixados (Comunicados)',
            description: 'Posts marcados como fixados aparecem no topo com badge "Comunicado" para comunicações importantes do escritório.',
          },
          {
            type: 'feature',
            title: 'Destaques da Semana',
            description: 'Seção com os 3 posts mais curtidos da semana, exibida quando não há filtro ativo.',
          },
          {
            type: 'feature',
            title: 'Modo compacto',
            description: 'Toggle para reduzir espaçamento entre posts, permitindo visualizar mais conteúdo na tela.',
          },
          {
            type: 'feature',
            title: 'Ordenação por popularidade',
            description: 'Opção de ordenar posts por "Recentes" ou "Populares" (mais curtidos).',
          },
          {
            type: 'improvement',
            title: 'Preview de anexos melhorado',
            description: 'Anexos PDF, DOC e XLS agora exibem ícones coloridos e extensão do arquivo para fácil identificação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.425',
    date: '26/01/2026',
    summary: 'Intimações DJEN: Reorganização completa, busca estendida e notificações urgentes.',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'feature',
            title: 'Interface reorganizada com abas',
            description: 'Módulo completamente reorganizado com 4 abas: Visão Geral, Lista, Análise e Configurações. Header compacto com menu dropdown de ferramentas.',
          },
          {
            type: 'feature',
            title: 'Busca estendida para 7 dias',
            description: 'Período de busca estendido de 3 para 7 dias para capturar intimações de fins de semana e feriados.',
          },
          {
            type: 'feature',
            title: 'Notificações push para intimações urgentes',
            description: 'Criação automática de notificação quando IA detecta urgência alta ou prazo ≤ 5 dias. Tipo intimation_urgent adicionado.',
          },
          {
            type: 'feature',
            title: 'Filtro por tribunal',
            description: 'Novo dropdown com lista dinâmica de tribunais únicos para filtrar intimações por tribunal específico.',
          },
          {
            type: 'improvement',
            title: 'Estatísticas corrigidas (apenas não lidas)',
            description: 'Correção crítica: badges de urgência agora mostram apenas intimações não lidas, eliminando contagem incorreta.',
          },
          {
            type: 'improvement',
            title: 'Modal de prazo com aviso destacado',
            description: 'Box amarelo com prazo final detectado pela IA e explicação sobre margem de segurança de 1 dia.',
          },
          {
            type: 'improvement',
            title: 'Otimizações mobile completas',
            description: 'Interface totalmente responsiva com botões 100% largura em mobile, layout empilhado e touch targets adequados.',
          },
          {
            type: 'feature',
            title: 'Exportação de relatórios',
            description: 'Botão Exportar Relatório com opções CSV, Excel e PDF. Cores por urgência nos relatórios gerados.',
          },
          {
            type: 'feature',
            title: 'Histórico de sincronizações',
            description: 'Sistema de histórico local com até 50 entradas de sincronizações manuais e automáticas.',
          },
          {
            type: 'fix',
            title: 'Correção de runtime e tipagem',
            description: 'Corrigidos erros de coluna no banco (run_started_at → created_at), variáveis não definidas e propriedades incorretas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.414',
    date: '25/01/2026',
    summary: 'Feed: Alinhamento do conteúdo com os widgets laterais.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Alinhamento do feed central',
            description: 'Removido o max-width e centralização que deslocavam o feed central, alinhando o conteúdo à grade com as sidebars.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.413',
    date: '25/01/2026',
    summary: 'Feed: Layout com widgets fixos e interface corporativa refinada.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Layout com widgets laterais fixos',
            description: 'Reorganizado layout para que widgets esquerdo/direito permaneçam fixos enquanto apenas o feed central rola.',
          },
          {
            type: 'improvement',
            title: 'Interface corporativa refinada',
            description: 'Aplicado design corporativo sóbrio ao post composer: cards brancos com bordas sutis, sombras leves e cores neutras.',
          },
          {
            type: 'fix',
            title: 'Correção de handlers e imports',
            description: 'Corrigidos handlers de upload de arquivo e opções de enquete, além de imports faltantes (Paperclip, BarChart3).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.412',
    date: '25/01/2026',
    summary: 'Feed: Padronização da largura com os demais módulos.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Container do Feed padronizado',
            description: 'Removido wrapper interno com max-width/padding próprio para alinhar a largura do Feed ao container global usado nas demais páginas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.411',
    date: '25/01/2026',
    summary: 'Feed: Correções de UI/UX (overflow de largura, botão Publicar e menu de reações).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Correção de overflow horizontal',
            description: 'Ajustado layout do Feed para evitar scroll horizontal/estouro de largura (containers com min-w-0 e overflow-x-hidden).',
          },
          {
            type: 'fix',
            title: 'Botão Publicar corrigido',
            description: 'Ajustado layout da barra de ações e comportamento do botão Publicar para funcionar corretamente (inclusive em telas menores).',
          },
          {
            type: 'fix',
            title: 'Menu de reações sem erro de build',
            description: 'Corrigida renderização do menu de reações e tipagens para evitar erros de JSX/TypeScript.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.410',
    date: '25/01/2026',
    summary: 'Feed: Remoção completa do widget Próximos Eventos para simplificar interface social.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Widget Próximos Eventos removido',
            description: 'Removido completamente o widget "Próximos Eventos" do módulo Feed para focar nas interações sociais e reduzir distrações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.407',
    date: '25/01/2026',
    summary: 'Feed Redesign: Implementação completa do feed estilo LinkedIn/Facebook com layout 3 colunas, widgets arrastáveis e social interactions.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'feature',
            title: 'Layout 3 colunas',
            description: 'Sidebar esquerda, feed central, sidebar direita com widgets arrastáveis.',
          },
          {
            type: 'feature',
            title: 'Novos Widgets',
            description: 'Sugestões de Pessoas, Tendências por Tags, Próximos Eventos.',
          },
          {
            type: 'feature',
            title: 'Social Interactions',
            description: 'Reactions (Curtir/Amei/Haha), Compartilhar, Salvar posts.',
          },
          {
            type: 'improvement',
            title: 'Skeleton Loaders',
            description: 'Animações suaves de carregamento para posts.',
          },
          {
            type: 'improvement',
            title: 'Composer Aprimorado',
            description: 'Placeholder dinâmico, preview de anexos com hover effects.',
          },
          {
            type: 'improvement',
            title: 'Visual Moderno',
            description: 'Cards refinados, animações suaves, shadows gradient.',
          },
          {
            type: 'feature',
            title: 'Drag-and-Drop',
            description: 'Widgets reorganizáveis entre sidebars.',
          },
          {
            type: 'feature',
            title: 'Tags Filter',
            description: 'Filtrar feed por tags através do widget de tendências.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.406',
    date: '25/01/2026',
    summary: 'Feed: Implementação inicial layout 3 colunas e widgets básicos.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'feature',
            title: 'Layout 3 colunas',
            description: 'Estrutura inicial com sidebar esquerda, feed central e sidebar direita.',
          },
          {
            type: 'feature',
            title: 'Widgets básicos',
            description: 'Implementação inicial dos widgets da sidebar direita.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.405',
    date: '25/01/2026',
    summary: 'Feed: removidos os widgets do Dashboard (dashboard restaurado como módulo próprio).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Feed sem widgets do Dashboard',
            description:
              'O módulo Feed agora exibe apenas o feed social (composer, posts e interações). Os widgets (agenda/tarefas/prazos/financeiro etc.) voltam a ficar no Dashboard.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.404',
    date: '25/01/2026',
    summary: 'Requerimentos (mobile): área superior retrátil (ações/abas/filtros) com Novo Requerimento sempre visível.',
    modules: [
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Controles superiores retráteis no mobile',
            description:
              'Ações (Exportar/Template), abas de status e filtros avançados agora podem ser recolhidos no mobile; o botão "Novo Requerimento" permanece sempre visível.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.403',
    date: '24/01/2026',
    summary: 'Assinaturas: toolbar responsiva no mobile (tabs, busca e ações sem overflow).',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'Toolbar responsiva no mobile',
            description:
              'Tabs agora têm scroll horizontal (overflow-x-auto), busca ocupa 100% da largura e ações quebram linha no mobile, evitando overflow lateral.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.402',
    date: '24/01/2026',
    summary: 'Dashboard (mobile): header reorganizado para evitar esticar o botão e melhorar alertas com chips.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Header sem “barra preta” no mobile',
            description:
              'Reorganizado o header para manter nome + botão "Novo Cliente" na mesma linha sem esticar largura.',
          },
          {
            type: 'improvement',
            title: 'Alertas em chips com texto',
            description:
              'Alertas (Prazos/Intimações/Financeiro) agora aparecem abaixo como chips com texto + contador, com wrap no mobile.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.401',
    date: '24/01/2026',
    summary: 'Dashboard e TasksModule: layout responsivo mobile-first refatorado com alertas melhorados.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Dashboard Responsivo Master',
            description: 'Refatoração completa do layout responsivo do Dashboard com foco mobile-first.',
          },
          {
            type: 'improvement',
            title: 'Header Otimizado',
            description: 'Saudação + botão "Novo Cliente" com layout flexível e alertas urgentes ao lado.',
          },
          {
            type: 'improvement',
            title: 'Estatísticas Adaptativas',
            description: 'Grid 2x2 no mobile, linha única no desktop com labels visíveis.',
          },
          {
            type: 'improvement',
            title: 'Alertas Urgentes',
            description: 'Alertas com ícone + texto + número ao lado do botão "Novo Cliente".',
          },
          {
            type: 'improvement',
            title: 'Widgets Responsivos',
            description: 'Agenda, Tarefas, Prazos, Intimações com padding e gaps otimizados para mobile.',
          },
          {
            type: 'improvement',
            title: 'TasksModule Mobile',
            description: 'Módulo de Tarefas totalmente responsivo com formulários, filtros e lista adaptados.',
          },
          {
            type: 'fix',
            title: 'Botão Novo Cliente',
            description: 'Corrigido bug que mostrava "+ +" no mobile (apenas ícone visível).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.400',
    date: '24/01/2026',
    summary: 'Dashboard: layout responsivo mobile-first refatorado.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Dashboard Mobile-First',
            description: 'Refatoração completa do layout responsivo com foco em mobile.',
          },
          {
            type: 'improvement',
            title: 'Header Compacto',
            description: 'Saudação + botão "Novo Cliente" com layout otimizado.',
          },
          {
            type: 'improvement',
            title: 'Estatísticas em Grid',
            description: 'Grid 2x2 no mobile, flex-wrap no desktop.',
          },
          {
            type: 'improvement',
            title: 'Widgets Responsivos',
            description: 'Padding, gaps e tamanhos adaptados para mobile.',
          },
          {
            type: 'fix',
            title: 'Botão Novo Cliente',
            description: 'Removido texto "+" duplicado no mobile.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.399',
    date: '24/01/2026',
    summary: 'Dashboard: modais de detalhes adequados ao tema + correção de fundo/backdrop no modo claro.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Modais de detalhes no padrão do tema',
            description:
              'Modais de detalhes do compromisso e da intimação foram padronizados com o tema (estrutura de overlay, container com shadow/ring, fita laranja e header/footer consistentes).',
          },
          {
            type: 'fix',
            title: 'Fundo/backdrop no modo claro',
            description:
              'Ajustado o backdrop e o fundo do container para evitar aparência escura no modo claro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.353',
    date: '17/01/2026',
    summary: 'Feed: UI/UX dos cards de preview melhorado (visual clean e legível).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Cards de preview com design mais profissional',
            description:
              'Cards de preview dentro dos posts foram padronizados para um visual clean (fundo branco, bordas sutis e destaque lateral por cor), removendo gradientes fortes e melhorando a hierarquia de informações, sem alterar a navegação para os modais de detalhes.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.352',
    date: '17/01/2026',
    summary: 'Feed: cards agora abrem direto o modal de detalhes (não a lista do módulo).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Cards de preview abrem detalhes do registro',
            description:
              'Ao clicar em um card (Cliente/Processo/Prazo/Agenda/Financeiro etc.), o sistema agora navega com params (`entityId`/`mode: details`) para abrir o modal de detalhes do item, em vez de levar para a lista geral do módulo. Agenda e Financeiro agora suportam deep-link por ID.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.351',
    date: '17/01/2026',
    summary: 'Feed: redesign completo com visual limpo e profissional.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'UI/UX do Feed redesenhado',
            description:
              'Avatar fallback agora usa cor neutra (slate) ao invés de gradiente roxo. Cards de preview (Financeiro, Processo, Prazo, etc) com design clean: bordas sutis, fundo branco/slate, sem gradientes saturados. Tags com cores mais discretas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.350',
    date: '17/01/2026',
    summary: 'Feed: avatar agora usa a mesma origem do Nav/Perfil (fallback via user_metadata).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Foto do avatar no Feed unificada com o Nav',
            description:
              'O Feed agora resolve a foto do usuário/autor com o mesmo padrão do Nav: prioriza profiles.avatar_url e faz fallback para user_metadata (avatar_url/picture/etc), evitando avatar vazio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.349',
    date: '15/01/2026',
    summary: 'Intimações: seção expandida melhorada no mobile com layout limpo e ações em grid.',
    modules: [
      {
        moduleId: 'intimations',
        changes: [
          {
            type: 'improvement',
            title: 'Seção expandida da intimação otimizada',
            description:
              'Removida duplicação de botões e reorganizadas as ações em grid (2 colunas no mobile). Análise IA mais compacta e visual mais limpo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.345',
    date: '11/01/2026',
    summary: 'Perfil: barra de ações do post em uma linha no mobile.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'fix',
            title: 'Barra de ações do post sem quebra de linha',
            description:
              'Ajustada a barra de ações dos posts no Perfil (Curtir/Comentar/contagens) para não quebrar linha no mobile.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.344',
    date: '11/01/2026',
    summary: 'Perfil: contato profissional no painel do mobile.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'fix',
            title: 'Contato Profissional dentro do painel expandível',
            description:
              'No mobile, o card "Contato Profissional" foi movido para dentro do mesmo painel expandível usado para as abas (Feed/Atividade/Sobre), deixando a sidebar apenas para o desktop.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.343',
    date: '11/01/2026',
    summary: 'Perfil: sidebar oculto no mobile.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'fix',
            title: 'Sidebar "Contato Profissional" oculto no mobile',
            description:
              'No mobile, a sidebar "Contato Profissional" fica oculta quando as abas estão fechadas; aparece apenas ao expandir ou em perfis de outros usuários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.342',
    date: '11/01/2026',
    summary: 'Perfil: abas ocultas por padrão no mobile.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'fix',
            title: 'Abas Feed/Atividade/Sobre ocultas no mobile',
            description:
              'No mobile, as abas Feed, Atividade e Sobre agora ficam ocultas por padrão; aparecem apenas ao clicar no botão "Ver Feed, Atividade e Sobre".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.341',
    date: '11/01/2026',
    summary: 'Chat: widget flutuante mais compacto no mobile.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Botão flutuante compacto no mobile',
            description:
              'O launcher do ChatFloatingWidget no mobile agora é um FAB pequeno (ícone + badge), evitando cobrir conteúdo das páginas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.340',
    date: '11/01/2026',
    summary: 'Perfil: correções de responsividade no mobile.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'fix',
            title: 'Perfil responsivo no mobile',
            description:
              'Ajustado layout do Perfil para telas pequenas (banner, avatar, botões e abas com scroll horizontal), evitando sobreposição com o widget flutuante.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.339',
    date: '11/01/2026',
    summary: 'Atualização de sistema e correções diversas.',
    modules: [
      {
        moduleId: 'core',
        changes: [
          {
            type: 'improvement',
            title: 'Atualização de versão',
            description: 'Incremento de versão para 1.9.339 com atualização de changelog.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.320',
    date: '11/01/2026',
    summary: 'Feed Social: Design premium dos filtros e cards com gradientes e sombras.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Design premium dos filtros',
            description: 'Filtros do Feed Social redesenhados com gradientes e sombras elegantes.',
          },
          {
            type: 'improvement',
            title: 'Cards de posts premium',
            description: 'Cards com sombras suaves, transições elegantes e header redesenhado.',
          },
          {
            type: 'improvement',
            title: 'Botões e comentários modernizados',
            description: 'Botões de curtir/comentar com estados visuais melhorados e seção de comentários com design moderno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.311',
    date: '10/01/2026',
    summary: 'Feed Social: Menções funcionando e notificando usuários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Dropdown de menções nos comentários',
            description: 'Dropdown de @ agora aparece corretamente ao digitar @ no campo de comentário.',
          },
          {
            type: 'feature',
            title: 'Notificação de menção',
            description: 'Usuários mencionados com @ nos comentários agora recebem notificação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.310',
    date: '10/01/2026',
    summary: 'Feed Social: Dropdown de menções visível nos comentários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Dropdown de menções nos comentários',
            description: 'Dropdown de @ agora aparece abaixo do input de comentário, não mais escondido/cortado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.309',
    date: '10/01/2026',
    summary: 'Feed Social: Clique em comentários abre comentários inline.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Abrir comentários ao clicar no contador',
            description: 'Ao clicar em “X comentários”, a lista de comentários agora é expandida abaixo do post.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.308',
    date: '10/01/2026',
    summary: 'Feed Social: Melhorias em enquetes e menções em comentários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Quem votou na enquete',
            description: 'Agora é possível ver quem votou e as opções escolhidas ao clicar em “X votos”.',
          },
          {
            type: 'fix',
            title: 'Expiração da enquete',
            description: 'Texto “Encerra em Agora” corrigido; exibe tempo restante e encerra automaticamente quando todos os participantes votarem.',
          },
          {
            type: 'fix',
            title: 'Menções em comentários',
            description: 'Dropdown de @ não fica mais escondido/cortado no card do post.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.307',
    date: '10/01/2026',
    summary: 'Feed Social: Ajustes no fluxo de enquete.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Criar enquete (feedback e limpeza)',
            description: 'Ao publicar uma enquete, o criador agora fecha automaticamente, limpa os campos e mostra confirmação. O botão Publicar só habilita com enquete válida.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.306',
    date: '10/01/2026',
    summary: 'Feed Social: Avatar do usuário no composer/comentários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Avatar real no Feed',
            description: 'Composer e comentários agora priorizam avatar do perfil e fazem fallback para a foto do login (evita imagem genérica).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.305',
    date: '10/01/2026',
    summary: 'Feed Social: Menções em comentários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Menções em comentários',
            description: 'Agora é possível mencionar colaboradores (@nome) nos comentários dos posts. O dropdown aparece ao digitar @.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.304',
    date: '10/01/2026',
    summary: 'Dashboard: Ajuste visual do card Aguardando Confecção.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Consistência visual',
            description: 'Card Aguardando Confecção ajustado para combinar com os demais widgets (fundo branco, border simples).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.303',
    date: '10/01/2026',
    summary: 'Dashboard: Card Aguardando Confecção redesenhado.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Card Aguardando Confecção',
            description: 'Visual premium com header gradiente, cards internos com sombras e hover effects, ícones com gradiente e layout mais moderno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.302',
    date: '10/01/2026',
    summary: 'Feed Social: Edição de posts com visibilidade e destinatários.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Editar visibilidade do post',
            description: 'Ao editar um post, agora é possível alterar a visibilidade (Público/Equipe/Privado) e selecionar destinatários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.301',
    date: '10/01/2026',
    summary: 'Feed Social: Correções de privacidade em posts privados.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Privacidade de posts',
            description: 'Posts privados/equipe agora só aparecem para destinatários selecionados. Menções não dão acesso automático.',
          },
          {
            type: 'fix',
            title: 'Notificações de menção',
            description: 'Em posts privados, só notifica mencionados que estão na lista de destinatários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.300',
    date: '10/01/2026',
    summary: 'Correções de bugs no Feed Social e Financeiro.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Menção na posição do cursor',
            description: 'Ao clicar em Mencionar (@) ou Tag (#), o símbolo agora é inserido na posição atual do cursor, não no final do texto.',
          },
        ],
      },
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'fix',
            title: 'Status de acordos encerrados',
            description: 'Acordos com status "concluído" agora mostram corretamente "ENCERRADO" em vez de "A SALDAR" ou "PARCIAL".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.299',
    date: '10/01/2026',
    summary: 'Feed Social: destinatários para posts Privado/Equipe.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Privado/Equipe com destinatários',
            description: 'Posts Privado e Equipe agora exigem seleção de pessoas específicas e/ou departamentos (Cargo).',
          },
        ],
      },
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'feature',
            title: 'Privado/Equipe com destinatários',
            description: 'No Perfil, o composer também permite selecionar pessoas/departamentos para posts Privado/Equipe.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.298',
    date: '10/01/2026',
    summary: 'Feed Social: UI do composer no Perfil atualizada.',
    modules: [
      {
        moduleId: 'perfil',
        changes: [
          {
            type: 'improvement',
            title: 'Composer do Perfil',
            description: 'Barra de ações em 2 linhas, visibilidade em tabs (Público/Equipe/Privado) e agendamento de posts.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.297',
    date: '10/01/2026',
    summary: 'Feed Social: UI/UX melhorada no composer e referências de entidades.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Composer reorganizado',
            description: 'Barra de ações em 2 linhas para melhor responsividade. Visibilidade em formato de tabs (Público/Equipe/Privado).',
          },
          {
            type: 'fix',
            title: 'Referências de entidades',
            description: 'Marcações de clientes, processos, requerimentos, etc. agora são renderizadas com cores e são clicáveis para navegar ao módulo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.296',
    date: '10/01/2026',
    summary: 'Feed Social: optimistic updates para likes.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Likes instantâneos',
            description: 'Ao curtir um post, a UI atualiza imediatamente (optimistic update). Se houver erro, reverte automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.295',
    date: '10/01/2026',
    summary: 'Feed Social: comentários carregados ao abrir via menção.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Comentários em menções',
            description: 'Ao clicar em uma notificação de menção (@), os comentários do post agora são expandidos e carregados automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.294',
    date: '10/01/2026',
    summary: 'Feed Social: visibilidade e agendamento de posts.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Visibilidade de posts',
            description: 'Posts podem ser públicos (todos veem), privados (só mencionados) ou equipe (só colaboradores). Badge visual no post.',
          },
          {
            type: 'feature',
            title: 'Agendar publicação',
            description: 'Agende posts para serem publicados em data/hora futura. Posts agendados não aparecem no feed até a hora programada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.293',
    date: '10/01/2026',
    summary: 'Performance: correção de carregamento infinito de publicações no Feed.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Carregando publicações (loop)',
            description: 'Corrigido cenário onde o Feed podia ficar mostrando "Carregando publicações..." indefinidamente devido a re-fetch/loop de efeito. Agora há proteção contra chamadas concorrentes e timeout.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.292',
    date: '10/01/2026',
    summary: 'Performance: loading de publicações corrigido.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Loading de publicações',
            description: 'Não mostra "Carregando publicações..." se já tem posts do cache. Mostra posts instantâneos e atualiza em background.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.291',
    date: '10/01/2026',
    summary: 'Performance: publicações do Feed com cache instantâneo.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Cache de publicações',
            description: 'Publicações do Feed carregadas do cache instantaneamente. Atualização em background sem bloquear UI. Enquetes carregadas em paralelo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.290',
    date: '10/01/2026',
    summary: 'Performance: carregamento instantâneo do Feed e módulos.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Carregamento instantâneo',
            description: 'Cache carregado sincronamente no início do componente, eliminando loading visível. Dados atualizados em background sem bloquear a UI.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.289',
    date: '10/01/2026',
    summary: 'Permissões: eventos filtrados por módulo de origem.',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'fix',
            title: 'Eventos de módulos sem permissão',
            description: 'Eventos do calendário e widget de agenda agora filtrados por permissão do módulo de origem (pagamentos só aparecem com acesso ao financeiro, audiências com acesso a processos, etc.).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.288',
    date: '10/01/2026',
    summary: 'Performance: corrigida lentidão crítica no carregamento de páginas.',
    modules: [
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'fix',
            title: 'Lentidão no carregamento (30s+)',
            description: 'Funções de permissão agora memoizadas com useCallback/useMemo. Guard de permissões com proteção contra loops de re-render.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.287',
    date: '10/01/2026',
    summary: 'Permissões: bloqueio real por can_view + widgets/menus filtrados por visualização.',
    modules: [
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'fix',
            title: 'Acesso a módulos com permissão zero',
            description: 'A navegação agora é bloqueada quando o usuário não possui permissão de visualização (can_view=false), impedindo acesso por atalhos/notificações/URL.',
          },
        ],
      },
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Widgets e indicadores respeitam permissões',
            description: 'Widgets do Feed e barra de indicadores agora aparecem somente para módulos em que o usuário tem permissão de visualizar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.286',
    date: '10/01/2026',
    summary: 'Feed: widgets da direita agora aparecem também em telas menores e para Admin.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Widgets do Feed em telas menores (Admin)',
            description: 'Os widgets da coluna direita (ex.: Prazos/Financeiro/Navegação) agora também são renderizados fora do breakpoint XL (abaixo do feed), garantindo que o Administrador veja o widget de prazos em qualquer resolução.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.285',
    date: '10/01/2026',
    summary: 'Feed: widget de prazos agora mostra os 5 próximos vencimentos (sem urgente).',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Widget de prazos no Feed',
            description: 'O widget "Prazos" agora lista os 5 próximos prazos por ordem de vencimento (não apenas urgentes), garantindo que sempre haja visibilidade dos vencimentos futuros.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.284',
    date: '10/01/2026',
    summary: 'Dashboard: widget de prazos urgentes, métricas reais e renomeação para Feed.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Widget Prazos Urgentes',
            description: 'Adicionado widget na sidebar direita exibindo prazos com vencimento em até 3 dias, com indicação de atrasado/dias restantes.',
          },
          {
            type: 'improvement',
            title: 'Métricas reais',
            description: 'Barra de indicadores substituída por métricas reais: Clientes, Processos, Requerimentos, Prazos, Tarefas (sem percentuais fictícios).',
          },
          {
            type: 'improvement',
            title: 'Renomeação para Feed',
            description: '"Dashboard" renomeado para "Feed" no menu lateral e no título do header.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.257',
    date: '10/01/2026',
    summary: 'Perfil: título no header, foto maior e cards de posts mais visíveis.',
    modules: [
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'fix',
            title: 'Título no header/nav',
            description: 'Agora aparece "Perfil do Usuário" no header quando estiver na página de perfil.',
          },
          {
            type: 'improvement',
            title: 'Foto de perfil maior',
            description: 'Avatar aumentado de w-28/36 para w-32/40 para melhor visualização.',
          },
          {
            type: 'improvement',
            title: 'Cards de posts mais visíveis',
            description: 'Posts agora têm sombra mais forte (shadow-md) e efeito hover (shadow-lg).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.256',
    date: '10/01/2026',
    summary: 'Perfil: máscara na capa, avatar sem corte e cards mais compactos.',
    modules: [
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'improvement',
            title: 'Máscara na imagem de capa',
            description: 'Capa do perfil agora tem overlay reforçado para melhorar contraste/legibilidade.',
          },
          {
            type: 'fix',
            title: 'Foto de perfil sem corte',
            description: 'Avatar agora exibe a imagem inteira dentro do círculo (sem recorte).',
          },
          {
            type: 'improvement',
            title: 'Cards mais compactos',
            description: 'Cards de Informações/Estatísticas ficaram menores e com menos arredondamento.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.255',
    date: '10/01/2026',
    summary: 'Perfil: banners jurídicos, banner padrão, estética melhorada e campo CPF.',
    modules: [
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'improvement',
            title: 'Banners com temas jurídicos',
            description: 'Imagens de banners jurídicos: biblioteca, tribunal, escritório de advocacia, documentos, etc.',
          },
          {
            type: 'improvement',
            title: 'Banner padrão jurídico',
            description: 'Quando o usuário não selecionou nenhum banner, exibe automaticamente uma imagem de biblioteca jurídica.',
          },
          {
            type: 'improvement',
            title: 'Estética do perfil melhorada',
            description: 'Avatar maior com borda branca e ring, capa maior com overlay escuro, cards com headers coloridos, ícones em círculos coloridos.',
          },
          {
            type: 'feature',
            title: 'Campo CPF no perfil',
            description: 'Adicionado campo CPF nas informações do perfil do usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.254',
    date: '10/01/2026',
    summary: 'Feed: adicionado card de preview para #Documento.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Card de preview para #Documento',
            description: 'Adicionado card indigo com ícone FileText para exibir preview de documentos no post.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.253',
    date: '10/01/2026',
    summary: 'Feed: clique em @menção navega para perfil + layout do perfil mais compacto.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Clique em @menção navega para perfil',
            description: 'Ao clicar no nome mencionado (@nome) no post, o sistema navega para a página de perfil da pessoa.',
          },
        ],
      },
      {
        moduleId: 'configuracoes',
        changes: [
          {
            type: 'improvement',
            title: 'Layout do perfil mais compacto',
            description: 'Reduzida altura da capa (h-32/40/48), tamanho do avatar (xl) e tamanho do nome (xl/2xl).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.252',
    date: '10/01/2026',
    summary: 'Feed: novas tags #Assinatura e #Requerimento, foto maior no post, navegação direta ao registro.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'feature',
            title: 'Tags #Assinatura e #Requerimento',
            description: 'Novas tags para mencionar assinaturas (pink) e requerimentos (orange) com busca, preview e cards coloridos.',
          },
          {
            type: 'improvement',
            title: 'Foto maior no post',
            description: 'Imagens anexadas agora exibem em tamanho maior (max-h-80) em vez de miniatura 28x28.',
          },
          {
            type: 'improvement',
            title: 'Navegação direta ao registro',
            description: 'Clicar no card de preview agora passa selectedId para abrir diretamente o registro específico no módulo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.251',
    date: '10/01/2026',
    summary: 'Feed: #Petição agora busca na tabela saved_petitions (petições salvas/recentes).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Tabela correta para #Petição',
            description: 'Tag #Petição agora busca na tabela saved_petitions (onde estão "Sem título", "PETIÇÃO CONSUMIDOR", etc.) em vez de petition_documents (templates).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.250',
    date: '10/01/2026',
    summary: 'Feed: #Petição exibe nome amigável (title) e card de preview cyan.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Nome correto em #Petição',
            description: 'Invertida prioridade: agora exibe title (nome amigável) em vez de file_name (.html), com fallback para nome sem extensão.',
          },
          {
            type: 'improvement',
            title: 'Card de preview para #Petição',
            description: 'Adicionado card cyan com ícone ScrollText no post ao usar a tag #Petição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.249',
    date: '10/01/2026',
    summary: 'Feed: #Petição exibe nome correto (file_name/title) e busca em ambos os campos.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Nome correto em #Petição',
            description: 'A listagem e o texto inserido agora priorizam file_name (nome do arquivo), com fallback para title e "Sem título" quando vazio.',
          },
          {
            type: 'improvement',
            title: 'Busca por file_name ou title',
            description: 'O filtro de busca da tag #Petição agora pesquisa em file_name e title.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.248',
    date: '10/01/2026',
    summary: 'Feed: correção de permissões (RLS) para listar #Petição + logs de erro nas tags de documentos.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Permissão de leitura em petition_documents',
            description: 'Adicionada policy de SELECT (RLS) na tabela petition_documents para permitir listagem no frontend ao usar a tag #Petição.',
          },
          {
            type: 'improvement',
            title: 'Logs de erro do Supabase',
            description: 'Adicionados logs de error nas queries do Supabase para as tags #Petição e #Documento, evitando falhas silenciosas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.247',
    date: '10/01/2026',
    summary: 'Feed: criada tag #Petição para buscar petições na tabela petition_documents.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Nova tag #Petição',
            description: 'Adicionada tag #Petição para buscar petições na tabela petition_documents (3 registros). A tag #Documento continua buscando documentos gerados em generated_petition_documents.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.246',
    date: '10/01/2026',
    summary: 'Feed: corrigido tag #Documento para usar tabela generated_petition_documents.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Tabela de documentos',
            description: 'Tag #Documento agora busca na tabela generated_petition_documents (14 registros) em vez de generated_documents (vazia).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.245',
    date: '10/01/2026',
    summary: 'Feed: adicionado campo de busca no dropdown de registros da tag #Cliente.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Busca em registros de tag',
            description: 'Adicionado campo de busca no dropdown de registros da tag #Cliente para filtrar clientes por nome.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.244',
    date: '10/01/2026',
    summary: 'Feed: tradução de event_type no #Agenda (hearing → audiência).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Tradução de event_type',
            description: 'Mapeamento de tradução para event_type no #Agenda: hearing → audiência, meeting → reunião, appointment → compromisso, deadline → prazo, reminder → lembrete, task → tarefa, other → outro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.243',
    date: '10/01/2026',
    summary: 'Feed: corrigido Invalid Date no #Prazo e tag Audiência ajustada para Agenda.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Invalid Date no #Prazo',
            description: 'Formatação segura para deadlines.due_date (timestamptz) evitando exibir Invalid Date no dropdown da tag #Prazo.',
          },
          {
            type: 'fix',
            title: 'Tag Audiência → Agenda',
            description: 'Tag no composer ajustada de Audiência para Agenda para refletir compromissos do calendário (calendar_events).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.242',
    date: '10/01/2026',
    summary: 'Feed: referências financeiras azuis e clicáveis para abrir modal do acordo.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'improvement',
            title: 'Referências financeiras clicáveis',
            description: 'Referências financeiras (#financeiro) agora são azuis e clicáveis para abrir o modal do acordo financeiro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.241',
    date: '10/01/2026',
    summary: 'Feed: corrigido nome da coluna total_amount → total_value na query do #financeiro.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Tag #financeiro (coluna incorreta)',
            description: 'Corrigido nome da coluna de total_amount para total_value conforme estrutura real da tabela agreements.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.240',
    date: '10/01/2026',
    summary: 'Feed: correção definitiva do erro 400 no autocomplete/preview do #financeiro.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Tag #financeiro (autocomplete/preview)',
            description: 'Removido embed PostgREST de agreements → clients e substituído por busca em batch de clientes via client_id, evitando erro 400 no autocomplete/preview.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.239',
    date: '10/01/2026',
    summary: 'Feed: corrigido erro 400 ao carregar registros da tag #financeiro.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Tag #financeiro (preview de registros)',
            description: 'Corrigido embed PostgREST em agreements → clients usando o constraint correto, evitando erro 400 ao carregar sugestões/preview da tag #financeiro.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.238',
    date: '10/01/2026',
    summary: 'Enquete: checkboxes para selecionar participantes 1 a 1 e design melhorado (sem roxo).',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Seleção de participantes da enquete',
            description: 'Substituído select multiple por checkboxes individuais para selecionar participantes 1 a 1.',
          },
          {
            type: 'improvement',
            title: 'Design da enquete melhorado',
            description: 'Removido roxo do design, agora usa azul/cinza mais bonito e moderno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.237',
    date: '10/01/2026',
    summary: 'Notificações: RPC create_user_notification para corrigir erro 403 ao notificar menções.',
    modules: [
      {
        moduleId: 'feed',
        changes: [
          {
            type: 'fix',
            title: 'Erro 403 ao criar notificações de menção',
            description: 'Criação de notificações agora usa RPC create_user_notification (SECURITY DEFINER) para bypass RLS e corrigir erro 403 ao notificar usuários mencionados em posts.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.204',
    date: '09/01/2026',
    summary: 'Build: import .tsx habilitado para resolver conflito Dashboard/dashboard.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Conflito de import no Windows',
            description: 'Habilitado allowImportingTsExtensions para permitir import explícito de Dashboard.tsx, evitando conflito de resolução com a pasta components/dashboard.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.203',
    date: '09/01/2026',
    summary: 'Dashboard/Build: correções de import e filtros iniciais.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Build e navegação do Dashboard',
            description: 'Corrigidos conflitos de import por casing (Dashboard/dashboard) e padronizado o uso de parâmetros para abrir Processos/Requerimentos já filtrados em Aguardando Confecção.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.202',
    date: '09/01/2026',
    summary: 'Dashboard: aguardando confecção (processos/requerimentos) + hover corrigido.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Widgets Aguardando Confecção',
            description: 'Adicionados widgets para Processos e Requerimentos em status aguardando_confeccao, com contagem e navegação já filtrada.',
          },
          {
            type: 'fix',
            title: 'Hover dos cards',
            description: 'Corrigido hover dos cards do Dashboard (classe dinâmica do Tailwind não era aplicada).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.201',
    date: '09/01/2026',
    summary: 'Dashboard: layout mais estilo Facebook (financeiro apenas no sidebar).',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Layout estilo Facebook',
            description: 'Removido o card de perfil e o resumo duplicado do financeiro no feed. O Financeiro fica apenas no sidebar direito para um layout mais limpo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.200',
    date: '09/01/2026',
    summary: 'Dashboard: limpeza do social + widget financeiro + #financeiro.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'fix',
            title: 'Ajustes no Dashboard Social',
            description: 'Removidos itens sem uso (ações e seções que não existem no CRM), adicionado widget de Financeiro e menção #financeiro no feed.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.199',
    date: '09/01/2026',
    summary: 'Dashboard: novo layout estilo rede social com 3 colunas.',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'feature',
            title: 'Dashboard Social',
            description: 'Novo layout inspirado em redes sociais com sidebar esquerda (agenda jurídica, tarefas pendentes, intimações DJEN), feed central (cards de estatísticas, caixa de postagem, feed de atualizações) e sidebar direita (perfil do usuário, navegação rápida, áreas de atuação).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.198',
    date: '09/01/2026',
    summary: 'Chat: corrigido crash de hooks no widget flutuante.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Correção do erro de hooks no ChatFloatingWidget',
            description: 'Removido cenário onde hooks eram pulados por retorno antecipado, evitando o erro "Rendered fewer hooks than expected".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.197',
    date: '09/01/2026',
    summary: 'Notificações: intimações agora são restritas por cargo (Admin/Advogado).',
    modules: [
      {
        moduleId: 'notificacoes',
        changes: [
          {
            type: 'fix',
            title: 'Restrição de intimações por cargo',
            description: 'Ajustado o filtro de notificações de intimações para permitir apenas cargos Administrador e Advogado, impedindo visualização, contagem e popups para os demais perfis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.196',
    date: '09/01/2026',
    summary: 'Notificações: intimações agora respeitam permissões por perfil.',
    modules: [
      {
        moduleId: 'notificacoes',
        changes: [
          {
            type: 'fix',
            title: 'Permissões de intimações (sino e módulo)',
            description: 'Ajustado o sino e o módulo de notificações para filtrar eventos de intimações quando o usuário não possui permissão de visualização do módulo "intimacoes", evitando contagem, som e popups indevidos (ex.: perfil Auxiliar).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.195',
    date: '09/01/2026',
    summary: 'Chat: avatar do remetente em imagens mais confiável no launcher.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Detecção de imagem por mimeType',
            description: 'Ajustada a lógica do launcher para identificar mensagens de imagem pelo mimeType do anexo, garantindo que o avatar do remetente apareça mesmo quando o preview não bate exatamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.194',
    date: '09/01/2026',
    summary: 'Chat: launcher mostra avatar do remetente em notificações de imagem.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Avatar do remetente (imagem)',
            description: 'Quando chega uma mensagem de imagem, o launcher do widget exibe o avatar de quem enviou a foto no canto direito, facilitando identificar o remetente sem abrir o chat.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.193',
    date: '09/01/2026',
    summary: 'Chat: widget flutuante com badge de não-lidas persistente no refresh.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Badge de não-lidas após refresh',
            description: 'Adicionada persistência local e reidratação do contador de não-lidas do widget, com merge com os dados do banco para evitar o badge sumir ao atualizar a página.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.192',
    date: '09/01/2026',
    summary: 'Petições/Chat: launcher combinado com Editor na mesma cor de Mensagens.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Divisor laranja (Editor sem fundo laranja)',
            description: 'Ajustado o launcher combinado para o segmento "Editor" usar o mesmo fundo do botão "Mensagens", mantendo apenas o divisor laranja entre eles.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.191',
    date: '09/01/2026',
    summary: 'Petições/Chat: launcher combinado Mensagens + Editor sem sobreposição.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Botão combinado Mensagens + Editor (minimizado)',
            description: 'Quando o editor de petições está minimizado, o launcher do chat passa a exibir um segmento "Editor" com divisória laranja, evitando sobreposição entre botões e mantendo o chat disponível na tela de edição.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.190',
    date: '09/01/2026',
    summary: 'Chat: widget flutuante com modal sem contração durante carregamento.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Altura fixa do modal do widget',
            description: 'Fixada a altura do modal do widget (com limite por viewport) para evitar contrair/expandir quando alterna entre "Carregando mensagens..." e o conteúdo do chat.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.189',
    date: '09/01/2026',
    summary: 'Chat: widget flutuante sem contração ao carregar mensagens.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Remover maxHeight fixo do container',
            description: 'Removido o maxHeight fixo (280px) do container de mensagens e adicionado min-h-[200px] para evitar contração visual ao carregar mensagens no mini-chat do widget.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.188',
    date: '09/01/2026',
    summary: 'Chat: widget flutuante com foco automático no input.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Foco automático após enviar mensagem',
            description: 'Ajustado o mini-chat do widget para manter o foco no input após enviar mensagem, permitindo continuar digitando sem precisar clicar novamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.187',
    date: '09/01/2026',
    summary: 'Chat: widget flutuante com header de largura fixa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Header do widget sem encolhimento',
            description: 'Ajustado o header do mini-chat para manter largura fixa, evitando encolhimento visual ao truncar nomes longos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.186',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com abertura de anexos (PDF) no mini-chat.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Abrir PDF/anexos no widget',
            description: 'Ajustado o mini-chat do widget para renderizar link assinado em anexos (ex.: PDF), permitindo abrir o arquivo em nova aba.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.185',
    date: '08/01/2026',
    summary: 'Chat: correção de mensagens/anexos que sumiam após envio.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Mensagens/anexos sumindo',
            description: 'Corrigida a listagem de mensagens para sempre buscar as últimas N mensagens, evitando que mensagens/anexos recém-enviados sumissem após recarregar (limit).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.184',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com layout refinado do header e badge verificado.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Design do widget flutuante',
            description: 'Ajustado o layout do header (avatar + nome + verificado) e o toast de notificação para melhor alinhamento visual; badge verificado refinado (admin gold / advogado azul).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.183',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com badge de não lidas consistente.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Badge de não lidas (widget flutuante)',
            description: 'Corrigida inconsistência entre o total de não lidas e o badge por conversa no widget flutuante, unificando o cálculo pelo mapa de não lidas por sala e evitando sobrescrita por carregamento do banco.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.182',
    date: '08/01/2026',
    summary: 'Chat: correção de visto por último quando last_seen_at é nulo.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Status / visto por último',
            description: 'Ajustado o módulo Chat para não chamar formatLastSeen quando last_seen_at está nulo, evitando erro e exibindo Offline corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.181',
    date: '08/01/2026',
    summary: 'Chat: imagens com zoom (lightbox) no módulo e no widget flutuante.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Zoom de imagens no chat',
            description: 'Adicionado lightbox para ampliar imagens ao clicar no preview, tanto no módulo Chat quanto no mini-chat do widget flutuante.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.180',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com badges de verificado (admin/advogado).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Badges de verificado no widget',
            description: 'Adicionado badge de verificado no widget flutuante: Administrador (gold) e Advogado (azul).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.179',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com status Online/Offline mais confiável.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Status Online/Offline no widget flutuante',
            description: 'Corrigido o status Online/Offline no widget flutuante usando Presence em tempo real, evitando casos de "falso offline" por dados desatualizados no perfil.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.178',
    date: '08/01/2026',
    summary: 'Chat: mini-chat do widget com envio de áudio, anexos e emojis.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Ações do mini-chat (widget flutuante)',
            description: 'Adicionado ao mini-chat do widget flutuante: envio de áudio (gravação), envio de anexos (upload) e seletor de emojis.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.177',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com altura do mini-chat ajustada.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Altura do widget flutuante',
            description: 'Reduzida a altura máxima do painel do widget/mini-chat para evitar ocupar muito espaço na tela.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.176',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com indicador de não lido por conversa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Não lido por conversa no widget',
            description: 'Adicionado badge de não lidas por conversa na lista do widget flutuante e limpeza automática ao abrir a conversa no widget.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.175',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com toast/áudio corrigidos.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Toast de notificação do widget',
            description: 'Corrigida a renderização do toast de notificação (avatar + preview) para ocorrer no container do widget (e não dentro do componente Avatar), garantindo funcionamento correto junto com o som de notificação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.174',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com toast/áudio de notificação ajustados.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Toast e som de notificação',
            description: 'Corrigido o posicionamento/renderização do toast de notificação (avatar/nome/preview) e ajustado o som para ser habilitado após a primeira interação do usuário, garantindo funcionamento consistente no navegador.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.173',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante com notificação por som e toast com avatar/preview.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Notificação do widget flutuante',
            description: 'Adicionado som e toast de notificação (avatar + preview) ao receber novas mensagens no widget flutuante.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.172',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante (mini-chat) com notificação mais confiável.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Notificação do widget flutuante (subscription)',
            description: 'Ajustado o widget flutuante para manter a subscription de mensagens estável e usar refs para estado atual, evitando perda de eventos ao abrir/fechar e garantindo que o badge notifique novas mensagens.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.171',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante (mini-chat) com notificação/badge corrigida.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Notificação do widget flutuante',
            description: 'Ajustado o widget flutuante para exibir badge de novas mensagens de forma consistente (inclui contador local de notificações) e marcar como lida a conversa quando aberta pelo widget.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.170',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante (mini-chat) com preview de foto/anexo e correções de scroll.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Mini-chat (widget flutuante)',
            description: 'Corrigido o mini-chat do widget flutuante para renderizar preview de imagem/áudio (anexos) via signed URL, eliminar scroll horizontal e abrir/manter a conversa no final ao carregar/receber novas mensagens.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.169',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante de Mensagens agora é um mini-chat (abre conversa dentro do widget).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Mini-chat no widget flutuante',
            description: 'O widget flutuante agora permite abrir conversas diretamente dentro dele (sem navegar para o módulo Chat), com lista de mensagens em tempo real e input para enviar mensagens.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.168',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante de Mensagens com botão fixo ao abrir painel.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Botão fixo do widget flutuante',
            description: 'Corrigido o posicionamento para manter o botão do widget ancorado no canto (não desloca para a esquerda ao abrir o painel).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.167',
    date: '08/01/2026',
    summary: 'Chat: widget flutuante de Mensagens fora do módulo Chat.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Widget flutuante de Mensagens',
            description: 'Adicionado widget flutuante para acessar mensagens fora do módulo Chat: botão com badge de não-lidas, painel com lista de conversas e atalho para abrir o Chat diretamente na conversa selecionada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.166',
    date: '08/01/2026',
    summary: 'Chat: correção do indicador "digitando..." em tempo real.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Indicador "digitando..."',
            description: 'Corrigido o envio de status de digitação para reutilizar o mesmo Realtime Presence channel do chat (evita criar channel novo a cada tecla), fazendo o header mostrar "X está digitando..." corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.165',
    date: '08/01/2026',
    summary: 'Chat: correção de policies (RLS) do bucket anexos_chat e preview de imagens nas mensagens.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Upload de anexos/áudio (RLS)',
            description: 'Ajustadas as policies do Supabase Storage (storage.objects) para permitir upload no bucket anexos_chat por usuários autenticados, eliminando erro "new row violates row-level security policy" ao enviar anexos/áudio.',
          },
          {
            type: 'improvement',
            title: 'Preview de imagem no chat',
            description: 'Ao enviar imagens (mimeType image/*), o chat agora exibe o preview inline via signed URL (mantendo a validade/expiração de 6 meses na UI).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.164',
    date: '08/01/2026',
    summary: 'Chat: envio de mensagens de áudio via MediaRecorder API, armazenadas no bucket anexos_chat com validade de 6 meses.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Mensagens de áudio',
            description: 'Implementado envio de mensagens de áudio usando MediaRecorder API. Botão de microfone com timer de gravação. Áudios armazenados no bucket anexos_chat com validade de 6 meses. Player de áudio nativo nas mensagens.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.163',
    date: '08/01/2026',
    summary: 'Chat: indicador "digitando..." em tempo real e "visto por último" no header.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Indicador "digitando..."',
            description: 'Implementado indicador de digitação em tempo real usando Supabase Realtime Presence. Quando alguém está digitando, aparece "X está digitando..." no header do chat.',
          },
          {
            type: 'improvement',
            title: 'Visto por último',
            description: 'Adicionado display de "visto por último" no header do chat quando o usuário está offline. Formato inteligente: "Visto há 5 min", "Visto há 2h", "Visto ontem", etc.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.162',
    date: '08/01/2026',
    summary: 'Chat: e-mail substituído por badge de função (role) no header, lista de contatos e drawer.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Badge de função em vez de e-mail',
            description: 'Substituído e-mail por badge de função (role) no header do chat, na lista de contatos do modal Nova Conversa e no drawer de informações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.161',
    date: '08/01/2026',
    summary: 'Chat: anexos (bucket anexos_chat) + emoji e expiração de 6 meses para downloads.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Anexos no chat',
            description: 'Adicionado envio de arquivos para o bucket anexos_chat e exibição no chat com card e botão de download (link temporário).',
          },
          {
            type: 'fix',
            title: 'Validade de anexos (6 meses)',
            description: 'Anexos expiram após 6 meses: UI indica expiração e o botão de download fica indisponível.',
          },
          {
            type: 'improvement',
            title: 'Seletor de emojis',
            description: 'Adicionado popover de emojis para inserir rapidamente no campo de mensagem mantendo o cursor.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.160',
    date: '08/01/2026',
    summary: 'Chat: modal Nova Conversa padronizado (estilo CRM) e remoção de tons residuais que deixavam o layout “bege”.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Modal Nova Conversa (padrão CRM)',
            description: 'Modal refeito no mesmo padrão visual dos modais do sistema: overlay, header com hierarquia, botão X com contraste correto e corpo com scroll interno.',
          },
          {
            type: 'fix',
            title: 'Remoção de “bege”/amber residual',
            description: 'Removidos estilos amber que estavam impactando spinner e hover da lista, mantendo o tema indigo/slate consistente no chat.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.159',
    date: '08/01/2026',
    summary: 'Chat: esquema de cores profissional (indigo/slate) aplicado em todo o módulo.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Cores profissionais aplicadas',
            description: 'Todas as cores do chat foram alteradas para um esquema profissional usando indigo (azul roxo) e slate (cinza azulado), substituindo o amarelo/laranja.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.158',
    date: '08/01/2026',
    summary: 'Chat: cores do sistema (laranja/amber), tradução completa para português, modal redesenhado e melhorias de UX.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Cores do sistema aplicadas',
            description: 'Todas as cores do chat foram alteradas de teal/verde para amber/laranja, seguindo o padrão visual do sistema.',
          },
          {
            type: 'improvement',
            title: 'Tradução completa para português',
            description: 'Todos os textos em inglês foram traduzidos: "No new messages" → "Nenhuma mensagem ainda", "Type a message" → "Digite uma mensagem", "Today" → "Hoje", etc.',
          },
          {
            type: 'improvement',
            title: 'Modal Nova Conversa redesenhado',
            description: 'Modal agora segue o padrão do sistema com faixa laranja no topo, botão X visível e cores consistentes.',
          },
          {
            type: 'improvement',
            title: 'Botão de som adicionado',
            description: 'Substituído o botão de 3 pontos (sem função) por um toggle de notificação sonora (sino).',
          },
          {
            type: 'fix',
            title: 'Altura ajustada',
            description: 'Altura do chat ajustada para calc(100vh - 7rem) eliminando scroll residual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.157',
    date: '08/01/2026',
    summary: 'Chat: correção definitiva da altura usando calc(100vh - 5rem).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Altura do chat corrigida',
            description: 'Container do chat agora usa height: calc(100vh - 5rem) via style inline, garantindo que ocupe exatamente a viewport disponível sem gerar scroll no body.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.155',
    date: '08/01/2026',
    summary: 'Chat: correção definitiva da altura (overflow) usando calc(100vh - 14rem).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Altura do chat corrigida',
            description: 'Alterado de h-full para h-[calc(100vh-14rem)] para garantir que o chat ocupe a altura correta dentro do container do App, compensando header, footer, padding do main (py-4 sm:py-6) e banners, eliminando overflow e bugs de scroll.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.154',
    date: '08/01/2026',
    summary: 'Chat: correções de altura/overflow e ajustes de cores (modal/drawer) para melhor contraste.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Altura/overflow do chat',
            description: 'Ajustado layout flex com min-h-0 para eliminar bugs de altura e garantir scroll correto em sidebar e mensagens.',
          },
          {
            type: 'improvement',
            title: 'Cores do modal/drawer (botão X visível)',
            description: 'Botões de fechar (X) no modal e drawer foram padronizados na cor do CRM (#208b8b) com texto branco, melhorando contraste e acessibilidade.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.153',
    date: '08/01/2026',
    summary: 'Chat: ajustes de UX (layout, modal nova conversa, drawer de informações e fundo consistente).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Posicionamento do chat',
            description: 'Removida centralização e altura fixa, fazendo o chat ocupar corretamente a área do módulo.',
          },
          {
            type: 'improvement',
            title: 'Fundo consistente do chat',
            description: 'Padronizado overlay do background para evitar variações de cor durante o scroll.',
          },
          {
            type: 'improvement',
            title: 'Informações do contato no header',
            description: 'Clique no avatar/nome do header abre drawer lateral com dados do outro usuário (DM).',
          },
          {
            type: 'improvement',
            title: 'Nova Conversa (modal)',
            description: 'Modal redesenhado para ficar no padrão visual do chat e com busca separada.',
          },
          {
            type: 'improvement',
            title: 'Remover aviso de criptografia',
            description: 'Removido o banner “Messages are end-to-end encrypted for client confidentiality.”',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.152',
    date: '08/01/2026',
    summary: 'Chat: ajuste final de UI para ficar idêntico ao template (scrollbar custom).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'improvement',
            title: 'Scrollbar do chat igual ao template',
            description: 'Adicionado CSS global da classe custom-scrollbar (incluindo dark mode) para reproduzir exatamente o comportamento visual do HTML no ChatModule.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.151',
    date: '08/01/2026',
    summary: 'Chat: UI idêntica ao template HTML enviado (estilo WhatsApp) com as cores do CRM e suporte a dark mode.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'Layout igual ao template (WhatsApp-like)',
            description: 'Refeito o layout para bater com o HTML: header da sidebar, busca, lista com item ativo (barra esquerda), área do chat com background estilo papel, bubbles e footer com input e botões.',
          },
          {
            type: 'improvement',
            title: 'Paleta do CRM + dark mode',
            description: 'Aplicadas as cores do sistema (primary #208b8b) e classes dark para manter o mesmo visual do template em tema escuro.',
          },
          {
            type: 'improvement',
            title: 'Avatares e estados visuais',
            description: 'Avatar atualizado para suportar classes específicas do template (ring, offset) e estados como offline (grayscale/opacity).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.150',
    date: '08/01/2026',
    summary: 'Chat: corrigido preview de conversas (não fica mais "Nenhuma mensagem ainda" quando já existe mensagem).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Preview da última mensagem na lista de conversas',
            description: 'Quando last_message_at existe e last_message_preview vem vazio, o sistema busca a última mensagem real e preenche o preview. Também adicionada assinatura realtime global para atualizar previews em conversas não selecionadas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.149',
    date: '08/01/2026',
    summary: 'Chat: UI/UX completamente reformulada com fotos de perfil reais, chat individual visível e design profissional.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'Fotos de perfil reais',
            description: 'Componente Avatar que exibe foto do usuário (avatar_url) ou iniciais com gradiente. Indicador de status online/offline.',
          },
          {
            type: 'feature',
            title: 'Chat individual visível',
            description: 'DMs agora mostram corretamente o nome e foto do outro usuário. Busca de membros por sala para identificar o contato.',
          },
          {
            type: 'improvement',
            title: 'UI/UX profissional',
            description: 'Design limpo com sidebar de conversas, área de mensagens com balões estilo WhatsApp, indicador de leitura (check duplo), input moderno.',
          },
          {
            type: 'improvement',
            title: 'Modal de nova conversa melhorado',
            description: 'Lista de usuários com foto, nome, email e indicador de presença. Busca integrada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.148',
    date: '08/01/2026',
    summary: 'Chat: redesign completo seguindo template HTML com sidebar esquerda (navegação), sidebar de conversas, área principal e sidebar direita com detalhes do contato.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'Redesign completo do Chat',
            description: 'Sidebar esquerda com navegação (Dashboard, Chat, Users, Files, Settings), sidebar de conversas com filtros (All, Leads, Team, Unread), área principal de chat e sidebar direita com detalhes do contato.',
          },
          {
            type: 'feature',
            title: 'Sidebar direita com informações do contato',
            description: 'Seção About com avatar, nome e cargo; Contact Information (email, telefone, localização); Active Deals com progresso; Shared Files; Tags coloridas.',
          },
          {
            type: 'improvement',
            title: 'Cores e design profissional',
            description: 'Paleta de cores teal (#208b8b), fundo claro (#fdfdfd), bordas sutis (#e2e8f0), avatares com gradiente, indicadores de presença.',
          },
          {
            type: 'improvement',
            title: 'Filtros de conversas',
            description: 'Botões All, Leads, Team e Unread para filtrar conversas na sidebar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.147',
    date: '08/01/2026',
    summary: 'Chat: UI estilo WhatsApp com sidebar de conversas individuais/DMs, preview da última mensagem, avatares, timestamps e badges de não lidas.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'UI estilo WhatsApp',
            description: 'Sidebar com conversas individuais/DMs, preview da última mensagem, avatares (iniciais com gradiente), timestamps (agora, 5min, 2h, ontem, etc.) e badges de não lidas.',
          },
          {
            type: 'feature',
            title: 'Modal de nova conversa',
            description: 'Modal para iniciar conversas privadas/DMs clicando em usuários, com busca e indicador de presença.',
          },
          {
            type: 'improvement',
            title: 'Preview da última mensagem',
            description: 'Adicionado campo last_message_preview no tipo ChatRoom para mostrar preview das conversas na sidebar.',
          },
          {
            type: 'improvement',
            title: 'Header com ações de chamada',
            description: 'Header da conversa agora mostra ícones de chamada de voz, vídeo e mais opções (estilo WhatsApp).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.146',
    date: '08/01/2026',
    summary: 'Chat: correção definitiva do RLS via MCP e reativação completa de salas privadas/membros/não-lidas; som de notificação via WebAudio (sem mp3).',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Corrigir RLS (erro 42P17) via MCP',
            description: 'Policies de chat_rooms/chat_room_members/chat_messages foram recriadas sem recursão, eliminando o erro "infinite recursion detected".',
          },
          {
            type: 'improvement',
            title: 'Reativar fluxo completo de membros e não-lidas',
            description: 'Reativados listRooms (públicas + privadas do usuário), markAsRead e getUnreadCount, e inserção de membros em DMs.',
          },
          {
            type: 'fix',
            title: 'Som de notificação sem arquivo mp3',
            description: 'Removida dependência do /notification.mp3 (erro 416). Agora usa beep via WebAudio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.145',
    date: '08/01/2026',
    summary: 'Correção crítica no Chat: remover completamente uso de chat_room_members para evitar erro RLS.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Remover completamente chat_room_members',
            description: 'listRooms agora busca apenas salas públicas, markAsRead e getUnreadCount desabilitados para evitar recursão infinita nas políticas RLS.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.144',
    date: '08/01/2026',
    summary: 'Correção no Chat: remover inserção de membros do createDirectMessage para evitar erro RLS.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Remover inserção de membros do createDirectMessage',
            description: 'A inserção em chat_room_members causa recursão nas políticas RLS. Agora cria apenas a sala DM.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.143',
    date: '08/01/2026',
    summary: 'Correção no Chat: simplificar createDirectMessage para evitar erro RLS de recursão infinita.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Simplificar createDirectMessage',
            description: 'Removida verificação de DM existente que causava recursão nas políticas RLS. Agora cria nova sala DM diretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.142',
    date: '08/01/2026',
    summary: 'Correção no Chat: remover avatar_url do schema pois a coluna não existe na tabela chat_rooms.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Remover avatar_url do ChatRoom',
            description: 'A coluna avatar_url não existe na tabela chat_rooms no Supabase. Removido do tipo e do código para evitar erro de schema cache.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.141',
    date: '08/01/2026',
    summary: 'Correções no Chat: erro RLS ao criar DM, avatares nas salas de conversa.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'fix',
            title: 'Corrigir erro de RLS (infinite recursion) ao criar DM',
            description: 'O createDirectMessage agora busca membros separadamente para evitar recursão nas políticas RLS do Supabase.',
          },
          {
            type: 'feature',
            title: 'Avatares nas salas de conversa',
            description: 'Salas DM agora mostram a foto do usuário (avatar_url) ou iniciais com gradiente como fallback.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.140',
    date: '08/01/2026',
    summary: 'Chat Corporativo completo: criar salas, DM, broadcast, notificações com som, lista de usuários online.',
    modules: [
      {
        moduleId: 'chat',
        changes: [
          {
            type: 'feature',
            title: 'Criar salas de equipe e conversas privadas',
            description: 'Modal para criar novas salas com seleção de membros, tipo (equipe/DM) e descrição.',
          },
          {
            type: 'feature',
            title: 'Enviar mensagem para todos',
            description: 'Botão "Enviar para todos" para broadcast na sala geral.',
          },
          {
            type: 'feature',
            title: 'Lista de usuários online',
            description: 'Exibe todos os usuários com status de presença; clique para iniciar DM.',
          },
          {
            type: 'feature',
            title: 'Sistema de notificações',
            description: 'Badge com contador de não lidas, painel de notificações recentes, som de notificação (toggle) e notificações nativas do navegador.',
          },
          {
            type: 'improvement',
            title: 'Realtime completo',
            description: 'Mensagens em tempo real via Supabase Realtime, marcação automática de lido ao abrir sala.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.139',
    date: '08/01/2026',
    summary: 'Login via CPF: agora tenta localizar o usuário em profiles.cpf e mostra mensagem clara quando o client não possui e-mail.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Login via CPF sem depender de clients.email',
            description: 'Ao digitar CPF no login, o sistema busca primeiro o usuário em profiles (cpf com e sem máscara) para obter o e-mail e autenticar. Se o CPF existir apenas em clients sem e-mail, exibe orientação para cadastrar/vincular o e-mail.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.138',
    date: '08/01/2026',
    summary: 'CPF no Perfil: CPF do client (clients.cpf_cnpj) agora é aplicado no estado/cache do perfil imediatamente e persistido em profiles.cpf.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'CPF do client aparece no Perfil',
            description: 'Ao carregar o perfil, o sistema busca o CPF em clients.cpf_cnpj (por CPF do login ou por e-mail) e preenche o campo CPF no Perfil imediatamente, além de persistir em profiles.cpf quando estiver vazio.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.137',
    date: '08/01/2026',
    summary: 'CPF sincronizado com clients: ao fazer login via CPF, o sistema busca o CPF da tabela clients.cpf_cnpj e grava em profiles.cpf.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'CPF do client vira CPF do perfil',
            description: 'Quando o login é feito via CPF, o sistema busca o CPF em clients.cpf_cnpj e o salva em profiles.cpf, garantindo que o Perfil exiba o CPF correto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.136',
    date: '08/01/2026',
    summary: 'CPF do login: ao autenticar com CPF, o sistema preenche profiles.cpf automaticamente quando estiver vazio.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'CPF do login vira CPF do perfil',
            description: 'Quando o login é feito via CPF, o sistema usa esse CPF como fallback e grava em profiles.cpf (se ainda estiver vazio), mantendo o Perfil preenchido automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.135',
    date: '08/01/2026',
    summary: 'CPF persistente: perfil carrega e mantém CPF corretamente no app (API + cache).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'CPF no cache do Perfil',
            description: 'O App passou a incluir cpf no mapping do perfil (carregado do Supabase) e no cache (sessionStorage), evitando o CPF “sumir” ao reabrir o Perfil.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.134',
    date: '08/01/2026',
    summary: 'CPF resiliente: salva Perfil mesmo quando a coluna cpf ainda não existe no schema cache do Supabase.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Salvar Perfil sem quebrar quando coluna cpf ainda não existe',
            description: 'Se o Supabase retornar erro de schema cache para a coluna cpf, o sistema faz fallback e salva o restante do perfil sem cpf (até a migration ser aplicada).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.133',
    date: '08/01/2026',
    summary: 'CPF com máscara: campos de CPF agora formatam automaticamente para 000.000.000-00.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Campo CPF no Perfil',
            description: 'Adicionado campo CPF na aba "Dados Pessoais" do modal de perfil, com máscara 000.000.000-00 e persistência no banco.',
          },
          {
            type: 'feature',
            title: 'CPF no cadastro de usuários',
            description: 'Modal de criar/editar usuário em Configurações agora inclui campo CPF, alinhado com o perfil.',
          },
          {
            type: 'improvement',
            title: 'Máscara automática do CPF',
            description: 'Ao digitar, o sistema aplica automaticamente o formato 000.000.000-00 no Perfil e em Configurações → Usuários.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.131',
    date: '08/01/2026',
    summary: 'Perfil e permissões: cargo consistente, abas por cargo e menu filtrado por permissões reais.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Cargo correto no Perfil (sem cair em Advogado)',
            description: 'O Perfil agora respeita o cargo salvo em profiles.role (Financeiro/Secretária etc.), sem default incorreto por cache/fallback.',
          },
          {
            type: 'fix',
            title: 'Aba Profissional restrita a Advogados',
            description: 'Campos de advogado (OAB e nome para documentos) não aparecem para cargos não-Advogado.',
          },
          {
            type: 'fix',
            title: 'Estatísticas por permissão',
            description: 'Aba de Estatísticas exibe apenas seções dos módulos que o cargo pode visualizar.',
          },
          {
            type: 'fix',
            title: 'Menu do App filtrado por permissões',
            description: 'Sidebar minimalista do App agora oculta módulos com 0 permissões (view/create/edit/delete).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.130',
    date: '08/01/2026',
    summary: 'Correção de permissões: módulos novos adicionados e filtro de menu corrigido.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Filtro de permissões corrigido',
            description: 'Menu agora aguarda carregamento das permissões antes de exibir módulos. Módulos sem permissão não aparecem.',
          },
          {
            type: 'feature',
            title: 'Novos módulos nas permissões',
            description: 'Adicionados módulos: Assinaturas, Petições, Chat, Tarefas ao sistema de permissões.',
          },
          {
            type: 'improvement',
            title: 'Sincronização de módulos',
            description: 'Lista de módulos sincronizada entre Sidebar, MobileSidebar e Configurações → Permissões.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.129',
    date: '08/01/2026',
    summary: 'Menu inteligente: módulos ocultos se usuário não tem nenhuma permissão. Exclusão de usuário remove do Auth.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Menu baseado em permissões',
            description: 'Módulos sem nenhuma permissão (view/create/edit/delete) não aparecem no menu lateral para o usuário.',
          },
          {
            type: 'fix',
            title: 'Exclusão completa de usuário',
            description: 'Ao excluir usuário pelo painel, agora também é removido do Supabase Auth (não apenas soft delete).',
          },
          {
            type: 'security',
            title: 'Edge Function delete-user',
            description: 'Criada Edge Function para deletar usuários de forma segura via admin API.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.128',
    date: '08/01/2026',
    summary: 'Edição de cargo de usuários e hook de permissões para módulos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Editar cargo de usuário',
            description: 'Agora é possível editar o cargo de usuários existentes diretamente na lista de usuários.',
          },
          {
            type: 'feature',
            title: 'Hook usePermissions',
            description: 'Criado hook usePermissions para verificar permissões de usuário por módulo (view, create, edit, delete).',
          },
          {
            type: 'fix',
            title: 'Seu cargo atualizado para Administrador',
            description: 'Corrigido cargo do usuário principal para Administrador no banco de dados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.127',
    date: '08/01/2026',
    summary: 'Cargos unificados: Administrador, Advogado, Auxiliar, Secretária, Financeiro, Estagiário.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Cargos padronizados em todo o sistema',
            description: 'Lista de cargos unificada entre criação de usuários e permissões: Administrador, Advogado, Auxiliar, Secretária, Financeiro, Estagiário.',
          },
          {
            type: 'fix',
            title: 'Banco de dados atualizado',
            description: 'Tabela role_permissions atualizada para usar "administrador" em vez de "admin".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.126',
    date: '08/01/2026',
    summary: 'Advogados agora podem criar Sócio, Advogado, Auxiliar e Estagiário. Apenas Administradores criam Administradores.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Advogado pode criar mais cargos',
            description: 'Advogados agora podem criar usuários com cargo Sócio, Advogado, Auxiliar e Estagiário. Apenas Administradores podem criar Administradores.',
          },
          {
            type: 'fix',
            title: 'Filtro de cargos no modal de criação',
            description: 'Corrigido filtro que mostrava apenas Auxiliar/Estagiário para Advogados. Agora exibe todos os cargos permitidos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.125',
    date: '08/01/2026',
    summary: 'Configurações: gestão de usuários/cargos ajustada e criação de colaboradores sem auto-cadastro.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Gestão de usuários dentro de Configurações',
            description: 'O gerenciamento de colaboradores foi centralizado em Configurações → Usuários, removendo fluxo de auto-cadastro no login.',
          },
          {
            type: 'fix',
            title: 'Cargos e permissões alinhados ao padrão do sistema',
            description: 'Padronizados cargos e validações (Administrador/Advogado/Auxiliar/Estagiário/Sócio) com normalização de acentos e compatibilidade com role_permissions.',
          },
          {
            type: 'security',
            title: 'Criação de colaborador via Edge Function',
            description: 'Criação de novos colaboradores passa a ser feita via Edge Function (admin) para não trocar a sessão do usuário logado e manter regras de permissão na origem.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.124',
    date: '08/01/2026',
    summary: 'Chat: novo módulo de chat em tempo real entre equipes (Supabase Realtime).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Chat realtime entre equipes',
            description:
              'Implementado módulo de Chat com salas e mensagens em tempo real via Supabase Realtime (postgres_changes), com tabelas chat_rooms/chat_room_members/chat_messages e RLS para controle de acesso.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.123',
    date: '08/01/2026',
    summary: 'Central de Notificações: investigado motivo de intimações "sumidas" (limpeza automática de 30 dias ou ações manuais no módulo de Intimações).',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'fix',
            title: 'Intimações antigas removidas automaticamente',
            description: 'Investigado e documentado que intimações com mais de 30 dias são removidas automaticamente pelo módulo de Intimações (cleanOldIntimations). A Central apenas lista; não deleta.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.115',
    date: '08/01/2026',
    summary: 'Agenda: campo Tipo do evento agora exibe rótulo amigável (ex.: Audiência).',
    modules: [
      {
        moduleId: 'agenda',
        changes: [
          {
            type: 'fix',
            title: 'Tipo do evento com rótulo PT-BR',
            description:
              'No modal de detalhes do evento, o campo Tipo não exibe mais o valor técnico (ex.: hearing). Agora exibe o rótulo amigável (ex.: Audiência).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.114',
    date: '08/01/2026',
    summary: 'Processos: datas de audiência/distribuição não voltam mais 1 dia (timezone).',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Data de audiência/distribuição consistente',
            description:
              'Corrigido problema onde datas no formato YYYY-MM-DD/ISO eram interpretadas em UTC e exibidas com -1 dia em alguns fusos. Agora datas date-only são formatadas sem conversão de fuso.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.113',
    date: '07/01/2026',
    summary: 'Documentos: geração agora inclui anexos do template (ZIP para Word, PDF mesclado).',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Geração de documentos com anexos',
            description:
              'Corrigido problema onde apenas o documento principal era gerado. Agora os anexos (template_files) são processados e incluídos: Word baixa como ZIP, PDF mescla todos em um único arquivo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.112',
    date: '07/01/2026',
    summary: 'Assinatura Pública (Kit Consumidor): preenchimento agora é salvo automaticamente no cache local (localStorage).',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'improvement',
            title: 'Rascunho automático no formulário público',
            description:
              'O formulário /preencher/:token salva automaticamente os dados no navegador e restaura ao recarregar. O cache é limpo após a geração do link de assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.111',
    date: '07/01/2026',
    summary: 'Assinatura Pública (Kit Consumidor): correção no fluxo de validação de endereço após confirmação do CEP.',
    modules: [
      {
        moduleId: 'assinatura-publica',
        changes: [
          {
            type: 'fix',
            title: 'CEP reconhecido não volta em loop',
            description:
              'Ao confirmar o endereço, Endereço/Bairro (preenchidos automaticamente pelo ViaCEP) não são mais considerados campos faltantes, evitando retorno indevido para o passo do CEP.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.95',
    date: '06/01/2026',
    summary: 'Financeiro (Acordos): resumo do acordo ajustado para honorários fixos.',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'fix',
            title: 'Resumo do acordo sem valor líquido (fixo)',
            description:
              'Quando o tipo de honorário é fixo, o Resumo do Acordo não exibe mais "Valor Líquido Cliente", pois não se aplica nesse contexto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.94',
    date: '05/01/2026',
    summary: 'Financeiro (Acordos): corrigido exibição de honorários fixos nas parcelas.',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'fix',
            title: 'Honorários fixos nas parcelas',
            description:
              'Quando honorários são fixos, agora mostra o valor total (não dividido por parcelas) e oculta "Valor Cliente" por parcela, pois não se aplica nesse contexto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.93',
    date: '05/01/2026',
    summary: 'Assinaturas (ADM): redesign completo da toolbar com layout mais limpo e intuitivo.',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Redesign da toolbar de assinaturas',
            description:
              'Filtros de status em formato de tabs, busca centralizada, botões de ação agrupados à direita, painel de autenticação pública com ícone Globe e toggles inline. Layout mais limpo e funcional.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.92',
    date: '05/01/2026',
    summary: 'Assinatura Pública: painel de autenticação mais compacto e auto-salvamento no ADM.',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'improvement',
            title: 'Configuração de autenticação pública compacta e sem botão Salvar',
            description:
              'O painel de Modos de autenticação da assinatura pública no módulo Assinaturas (ADM) foi compactado e agora salva automaticamente ao alternar Google, E-mail (OTP) e Telefone (OTP), liberando mais espaço para a lista de documentos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.91',
    date: '05/01/2026',
    summary: 'Assinatura Pública: opção no ADM para ativar/desativar Google/E-mail/Telefone.',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'feature',
            title: 'Controle de métodos de autenticação da assinatura pública',
            description:
              'Adicionada configuração no módulo de Assinatura (ADM) para ativar/desativar os modos Google, E-mail (OTP) e Telefone (OTP). A página pública passa a respeitar a configuração e remove opções desativadas automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.90',
    date: '05/01/2026',
    summary: 'Build: corrigido erro de compilação formatDateTime em ProcessesModule.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'fix',
            title: 'Função formatDateTime adicionada',
            description: 'Corrigido erro de compilação "Cannot find name formatDateTime" em ProcessesModule.tsx. Adicionada função local formatDateTime para exibir data/hora nas notas do processo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.89',
    date: '05/01/2026',
    summary: 'Assinatura Pública: corrigido erro de RLS (401) e CORS/preflight ao assinar documento.',
    modules: [
      {
        moduleId: 'assinatura',
        changes: [
          {
            type: 'fix',
            title: 'Edge Function para assinatura pública',
            description: 'Criada Edge Function public-sign-document com service role para evitar erros de RLS em páginas públicas sem sessão autenticada.',
          },
          {
            type: 'fix',
            title: 'CORS/preflight corrigido',
            description: 'Adicionados headers Access-Control-Allow-Methods e resposta OPTIONS com HTTP 200. Deploy com verify_jwt=false.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.87',
    date: '05/01/2026',
    summary: 'Petições: loading “Carregando...” em Recentes e botão laranja no Visualizar Bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Recentes: texto do loading atualizado',
            description: 'O indicador de carregamento em Recentes agora exibe “Carregando...” enquanto busca as petições salvas.',
          },
          {
            type: 'improvement',
            title: 'Visualizar Bloco: “Adicionar no documento” no tema do sistema',
            description: 'O botão “Adicionar no documento” no modal Visualizar Bloco foi ajustado para seguir o tema laranja do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.86',
    date: '05/01/2026',
    summary: 'Petições: loading “Procurando...” em Recentes.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Recentes: indicador de carregamento',
            description: 'Ao abrir o Editor de Petições, a seção Recentes agora exibe “Procurando...” até concluir a busca das petições salvas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.85',
    date: '04/01/2026',
    summary: 'Petições: botão Editar com tema laranja no Visualizar Bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Visualizar Bloco: botão Editar no tema do sistema',
            description: 'O botão Editar no modal Visualizar Bloco foi ajustado para seguir o tema laranja do sistema.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.84',
    date: '04/01/2026',
    summary: 'Petições: clique na sidebar abre Visualizar Bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'fix',
            title: 'Blocos: clique na sidebar abre Visualizar',
            description: 'Ao clicar em um bloco na sidebar, o sistema agora abre o modal Visualizar Bloco (em vez de inserir diretamente no documento).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.83',
    date: '04/01/2026',
    summary: 'Petições: botão Editar no Visualizar Bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Blocos: botão Editar no Visualizar Bloco',
            description: 'O modal Visualizar Bloco agora possui um botão Editar para abrir o editor do bloco diretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.82',
    date: '04/01/2026',
    summary: 'Petições: bloqueio de acesso no mobile.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'fix',
            title: 'Mobile: Petições indisponível',
            description: 'Em dispositivos móveis, o atalho de Petições no menu exibe uma mensagem de indisponibilidade em vez de abrir o editor. O widget minimizado também fica oculto.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.81',
    date: '04/01/2026',
    summary: 'Widget: ajustes de tamanho no modo minimizado.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget: ícone menor e layout mais compacto',
            description: 'Ajustado tamanho do ícone e do botão do widget minimizado para ficar mais equilibrado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.80',
    date: '04/01/2026',
    summary: 'Widget: identificação no modo minimizado.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget: label “Editor” no modo minimizado',
            description: 'O widget minimizado agora exibe um pequeno label “Editor” para ficar mais claro do que se trata.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.79',
    date: '04/01/2026',
    summary: 'Widget: refinamentos visuais.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget: sombra e glow refinados',
            description: 'Refinamentos no visual do widget minimizado (sombra, glow e tamanhos) para um aspecto mais limpo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.78',
    date: '04/01/2026',
    summary: 'Editor de Petições: widget minimizado só com ícone.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget: modo minimalista (ícone apenas)',
            description: 'O botão flutuante do Editor de Petições (minimizado) agora usa apenas o ícone, ocupando menos espaço visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.77',
    date: '04/01/2026',
    summary: 'Editor de Petições: widget minimizado com visual premium.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Widget: botão minimizado mais bonito e chamativo',
            description: 'O botão flutuante do Editor de Petições (quando minimizado) foi redesenhado para ficar mais moderno, com melhor contraste, sombra e microinterações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.76',
    date: '04/01/2026',
    summary: 'Petições: ao adicionar bloco, fechar modal de busca.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Blocos: fechar busca ao adicionar no documento',
            description: 'No Visualizar Bloco, ao clicar em “Adicionar no documento”, o sistema agora fecha automaticamente o modal de busca de blocos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.75',
    date: '04/01/2026',
    summary: 'Petições: Visualizar Bloco sem fechar a busca.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'fix',
            title: 'Blocos: fechar Visualizar não fecha a busca',
            description: 'Ao abrir o Visualizar Bloco a partir da lista de busca, o modal de busca permanece aberto em segundo plano. Ao fechar o Visualizar, você volta para a busca automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.74',
    date: '04/01/2026',
    summary: 'Petições: destacar “Inserir bloco” no menu de contexto.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Editor: “Inserir bloco” em laranja forte por padrão',
            description: 'No clique direito do editor, o item “Inserir bloco” agora aparece destacado com laranja forte por padrão para facilitar o acesso rápido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.73',
    date: '04/01/2026',
    summary: 'Petições: menu de contexto com ordem preservada (Adicionar bloco sempre visível).',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'fix',
            title: 'Editor: “Adicionar bloco” visível (desabilita sem seleção)',
            description: 'No clique direito, “Adicionar bloco” agora permanece visível e é desabilitado quando não há texto selecionado, mantendo a ordem dos itens do menu conforme esperado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.72',
    date: '04/01/2026',
    summary: 'Petições: menu de contexto reordenado + hover laranja.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Editor: ordem do menu de contexto + destaque no hover',
            description: 'No clique direito do editor, a ordem ficou: Inserir bloco (1º), Adicionar bloco (2º), Buscar empresa (3º). Também foi aplicado um hover laranja para facilitar a visualização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.71',
    date: '04/01/2026',
    summary: 'Petições: capturar e salvar fonte automaticamente ao carregar documento.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Editor: fonte padrão automática do documento carregado',
            description: 'Ao importar um DOCX ou abrir uma petição salva (SFDT), o editor agora captura a fonte (família e tamanho) do início do documento e salva como padrão, mantendo a consistência nas próximas inserções/digitação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.70',
    date: '04/01/2026',
    summary: 'Petições: opção de atualizar bloco existente ao cadastrar novo bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Cadastro de Bloco: atualizar bloco existente',
            description: 'No modal de “Novo Bloco”, você pode marcar “Atualizar bloco existente”, escolher o bloco alvo e salvar como atualização, evitando duplicidade quando o conteúdo é repetido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.69',
    date: '04/01/2026',
    summary: 'Petições: tags automáticas por palavra no cadastro de bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Cadastro de Bloco: tags automáticas por espaço (sem conectores)',
            description: 'Ao adicionar tags no cadastro do bloco, a frase agora é quebrada automaticamente por espaço e conectores (de/da/do/etc.) são ignorados; funciona via Enter/Adicionar, sem botão extra.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.68',
    date: '04/01/2026',
    summary: 'Petições: quebra automática de frases em tags ao cadastrar bloco.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Cadastro de Bloco: “Quebrar frases” em tags',
            description: 'Ao cadastrar um bloco, o campo de tags agora permite colar uma frase e clicar em “Quebrar frases” para criar várias tags automaticamente, separando por conectivos e palavras-chave comuns.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.67',
    date: '04/01/2026',
    summary: 'Petições: busca fuzzy mais forte no “Adicionar Bloco”.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: tolerância a typos “pesados”',
            description: 'A busca do “Adicionar Bloco” foi refinada para manter sugestões mesmo com múltiplos termos errados e digitação bem fora do padrão, usando fuzzy mais forte e ranking pelos melhores termos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.66',
    date: '04/01/2026',
    summary: 'Petições: busca tolerante a erros no “Adicionar Bloco”.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: tolerância a termo errado/extra',
            description: 'A busca do “Adicionar Bloco” foi refinada para ignorar ruídos comuns (termos muito curtos e conectivos) e manter resultados mesmo com um termo digitado errado/extra em buscas com vários termos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.65',
    date: '04/01/2026',
    summary: 'Petições: prévia maior do conteúdo no “Adicionar Bloco”.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: mais conteúdo na prévia',
            description: 'A lista de resultados do “Adicionar Bloco” agora mostra mais linhas/caracteres do texto e permite rolagem, facilitando avaliar o bloco antes de inserir.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.64',
    date: '04/01/2026',
    summary: 'Petições: modal “Adicionar Bloco” mais amplo e tags mais legíveis.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: modal mais largo + tags aprimoradas',
            description: 'Melhorias visuais no modal “Adicionar Bloco”: layout mais amplo e apresentação das tags em chips mais legíveis (com truncamento e indicador +N).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.63',
    date: '04/01/2026',
    summary: 'Petições: busca por blocos com relevância melhor (tags com prioridade).',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: ranking priorizando tags (com conteúdo no score)',
            description: 'A busca do “Adicionar Bloco” foi ajustada para priorizar correspondências em tags, mantendo título e conteúdo como sinais importantes para ordenar melhor os resultados.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.62',
    date: '04/01/2026',
    summary: 'Petições: busca de blocos mais rápida no “Adicionar Bloco”.',
    modules: [
      {
        moduleId: 'peticoes',
        changes: [
          {
            type: 'improvement',
            title: 'Adicionar Bloco: busca otimizada (mais rápida)',
            description: 'Melhorada a performance da busca de blocos com debounce e indexação/cache do texto dos blocos (reduz processamento do SFDT a cada tecla), deixando o modal “Adicionar Bloco” e a lista da sidebar mais responsivos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.61',
    date: '04/01/2026',
    summary: 'Processos: Mapa de Fases (visão por etapas) para listar processos por fase com um clique.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'feature',
            title: 'Mapa de Fases (Conciliação, Instrução, etc.)',
            description: 'Novo modal “Mapa de Fases” no módulo de Processos: cards por etapa com contagem. Ao clicar, mostra os processos daquela fase com busca e atalhos para abrir o processo ou a timeline completa.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.60',
    date: '04/01/2026',
    summary: 'Processos: Linha do Tempo Geral para buscar movimentações/publicações do DJEN.',
    modules: [
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'feature',
            title: 'Linha do Tempo Geral (feed unificado) com busca',
            description: 'Novo modal “Timeline Geral” no módulo de Processos: lista as publicações do DJEN sincronizadas no banco e permite buscar por cliente/número/órgão/texto, com atalhos para abrir o processo ou a timeline completa.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.59',
    date: '04/01/2026',
    summary: 'Notificações: assinatura sem duplicar (apenas 1 popup/notificação) e correção de build.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Assinatura: evitar duplicação de notificação/popup',
            description: 'Implementado dedupe no NotificationBell (por request_id em assinatura concluída) e idempotência no trigger do banco para impedir inserções duplicadas.',
          },
          {
            type: 'fix',
            title: 'Build: correção de erro TS18047 no PetitionEditorModule',
            description: 'Ajustado filtro para tratar valores null e evitar falha de compilação no TypeScript.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.58',
    date: '04/01/2026',
    summary: 'Assinatura: texto da validade jurídica (MP 2.200-2/2001) atualizado no PDF.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'PDF assinado: texto da validade jurídica mais completo e formal',
            description: 'Atualizado o texto da fundamentação legal (MP 2.200-2/2001) na página de registro de assinatura do PDF, com redação mais completa que menciona a ICP-Brasil e detalha melhor os efeitos jurídicos da assinatura eletrônica.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.57',
    date: '04/01/2026',
    summary: 'Assinatura: cores do OTP por e-mail padronizadas para o tema laranja.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Assinatura pública: tema laranja no fluxo de OTP por e-mail',
            description: 'Padronizadas as cores do fluxo de verificação por e-mail (botões e destaques) para o tema laranja do projeto, mantendo consistência visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.56',
    date: '04/01/2026',
    summary: 'Assinatura: template do e-mail OTP padronizado e melhorias visuais no envio por e-mail.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'OTP por e-mail: template compatível e nas cores do projeto',
            description: 'E-mail de verificação foi atualizado para um layout mais compatível (Gmail/Outlook) e padronizado com o tema laranja do projeto.',
          },
          {
            type: 'improvement',
            title: 'Assinatura pública: feedback visual no envio/validação do OTP por e-mail',
            description: 'Adicionadas animações de envio/validação e ajustes na ordem dos botões de autenticação para melhorar a experiência do usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.55',
    date: '04/01/2026',
    summary: 'Assinatura: Edge Functions de e-mail OTP sem non-2xx no invoke.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'OTP por e-mail: respostas com status 200 e erro no payload',
            description: 'Ajustadas as Edge Functions email-send-otp/email-verify-otp para retornarem sempre status HTTP 200 com { success: false, error }, evitando o erro genérico "Edge Function returned a non-2xx status code" no frontend e exibindo a mensagem real.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.54',
    date: '04/01/2026',
    summary: 'Assinatura: correção da etapa “Continuar com E-mail” (modal em branco).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Assinatura pública: etapa de OTP por e-mail renderizando corretamente',
            description: 'Corrigida a etapa “Continuar com E-mail” que ficava em branco no modal, adicionando a renderização da etapa email_otp (envio e validação do código).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.53',
    date: '04/01/2026',
    summary: 'Assinatura: autenticação por código via e-mail (OTP).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Código por e-mail na assinatura pública',
            description: 'Novo método de autenticação por código via e-mail (OTP) no fluxo de assinatura, com Edge Functions email-send-otp/email-verify-otp e persistência em signature_email_otps.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.52',
    date: '04/01/2026',
    summary: 'Preencher: validação de telefone/WhatsApp agora exige 11 dígitos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Validação de telefone/WhatsApp no formulário público',
            description: 'O campo de telefone/WhatsApp na página /preencher agora exige exatamente 11 dígitos (DDD + 9) e não permite avançar com 10 dígitos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.46',
    date: '01/01/2026',
    summary: 'Peticionamento: removida numeração automática na inserção de blocos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Removida numeração automática na inserção de blocos',
            description: 'Blocos não são mais numerados automaticamente ao serem inseridos no documento (não aparece "1 -", "2 -", etc.).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.45',
    date: '01/01/2026',
    summary: 'Peticionamento: removida numeração automática na listagem de blocos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Removida numeração automática na listagem de blocos',
            description: 'Não é mais exibido número de ordem ao lado dos blocos na sidebar e na busca.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.44',
    date: '01/01/2026',
    summary: 'Peticionamento: refinamento da busca de blocos (UI e fluxo).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Busca de blocos: exibir todas as tags e porcentagem de match',
            description: 'Resultados da busca agora mostram todas as tags (sem truncar) e uma porcentagem de relevância baseada no score do ranking.',
          },
          {
            type: 'feature',
            title: 'Busca de blocos: fluxo de visualização antes de inserir',
            description: 'Ao clicar em um resultado da busca, abre o modal "Visualizar Bloco" com botão "Adicionar no documento" em vez de inserir diretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.43',
    date: '01/01/2026',
    summary: 'Peticionamento: refinamento da busca de blocos (lógica e ranking).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Busca refinada: stopwords, frase exata e AND',
            description: 'Ignora stopwords (de/da/do), suporta busca por frase exata com aspas e exige todos os termos (AND).',
          },
          {
            type: 'improvement',
            title: 'Ranking mais estrito: prioriza título e tags',
            description: 'Aumenta peso de título e tags, reduz peso de conteúdo e eleva threshold mínimo para diminuir resultados genéricos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.30',
    date: '31/12/2025',
    summary: 'Peticionamento: correções Supabase (evita 406 no modelo padrão e reduz 400 repetidos).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Modelo padrão: leitura sem 406',
            description: 'Leitura do modelo padrão usa maybeSingle() para evitar 406 quando não existe registro ainda.',
          },
          {
            type: 'fix',
            title: 'Supabase auth: getUser async',
            description: 'Correção do getUser async no service (evita user_id vazio/undefined).',
          },
          {
            type: 'fix',
            title: 'Blocos: reduzir 400 repetidos',
            description: 'Melhorada detecção de ausência da coluna document_type para reduzir erros 400 repetidos ao listar blocos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.29',
    date: '31/12/2025',
    summary: 'Peticionamento: modelo padrão migrado do localStorage para Supabase (persistência e sincronização entre dispositivos).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Modelo padrão salvo no Supabase',
            description: 'Modelo padrão agora é salvo no Supabase em vez do localStorage, sincronizando entre dispositivos.',
          },
          {
            type: 'feature',
            title: 'Tabela petition_default_templates',
            description: 'Criada tabela petition_default_templates com RLS por usuário para armazenar o modelo padrão.',
          },
          {
            type: 'improvement',
            title: 'Fallback para localStorage',
            description: 'Fallback para localStorage mantido em caso de falha no banco.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.28',
    date: '31/12/2025',
    summary: 'Peticionamento: otimização de consumo Supabase (throttle no instant-save e debounce no refresh via realtime).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Throttle no salvamento instantâneo',
            description: 'Salvamento instantâneo limitado (máx 1 save a cada 15s) para evitar múltiplos saves durante digitação.',
          },
          {
            type: 'improvement',
            title: 'Debounce no refresh via realtime',
            description: 'Refresh das petições via realtime com debounce (1.5s) para reduzir leituras.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.18',
    date: '30/12/2025',
    summary: 'Assinaturas ↔ Requerimentos: correção do vínculo automático.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Badge de requerimento',
            description:
              'Corrigido o fluxo de criação de requerimento via assinatura para manter o signature_id até o momento de salvar, garantindo que o requirement_id seja atualizado corretamente e o badge "Requerimento Criado" apareça no card da assinatura.',
          },
        ],
      },
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'fix',
            title: 'Persistência do prefill',
            description:
              'O módulo de requerimentos agora persiste o identificador da assinatura de origem localmente durante a criação, mesmo após o consumo dos parâmetros de navegação.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.17',
    date: '30/12/2025',
    summary: 'Assinaturas ↔ Requerimentos: integração automática implementada.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Vinculação automática',
            description:
              'Ao criar um requerimento a partir de uma assinatura, o sistema agora atualiza automaticamente o requirement_id na assinatura, fazendo com que o badge "Requerimento Criado" apareça instantaneamente no card da assinatura.',
          },
        ],
      },
      {
        moduleId: 'requerimentos',
        changes: [
          {
            type: 'improvement',
            title: 'Origem da assinatura',
            description:
              'O módulo de requerimentos agora aceita e processa o campo signature_id no prefillData, permitindo rastrear e atualizar a assinatura de origem automaticamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.16',
    date: '30/12/2025',
    summary: 'Assinaturas: indicadores visuais de processo e requerimento.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Badges de criação',
            description:
              'Cards de assinatura agora exibem badges coloridos quando um processo ou requerimento é criado a partir da assinatura. Badge azul para "Processo Criado" e badge verde para "Requerimento Criado", seguindo o design de referência.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.15',
    date: '30/12/2025',
    summary: 'Assinaturas: botões de ação convertidos para estilo de links.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Links estilizados',
            description:
              'Os botões "Abrir processo" e "Requerimento" foram convertidos para estilo de texto sem fundo, comportando-se como links estilizados com ícones, hover effects (cor laranja) e animações de escala, seguindo o padrão de UI moderno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.14',
    date: '30/12/2025',
    summary: 'Assinaturas: botões de ação secundários mais compactos.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Botões compactos',
            description:
              'Os botões "Criar processo" e "Requerimento" foram redimensionados para ficarem mais compactos, com padding reduzido (py-2.5), fonte menor (text-xs) e ícones ajustados (w-3.5 h-3.5), resultando em uma interface mais limpa e menos chamativa.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.08',
    date: '30/12/2025',
    summary: 'Assinaturas: ajuste fino no design das ações de processo/requerimento.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Design das ações refinado',
            description:
              'Os botões de "Processo" e "Requerimento" no detalhe da assinatura foram redesenhados para ficarem lado a lado, com ícones atualizados e um visual mais limpo, conforme o novo padrão de UI.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.07',
    date: '30/12/2025',
    summary: 'Assinaturas: modal de detalhes mais compacto e organizado.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Detalhes mais compactos',
            description:
              'No detalhe da assinatura, o modal ficou menor e as ações de Processo/Requerimento foram movidas para abaixo das ações principais, com visual mais discreto e criação de processo em bloco interno.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.06',
    date: '30/12/2025',
    summary: 'Assinaturas: correção de estabilidade no módulo.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Crash no módulo de Assinaturas',
            description:
              'Corrigido erro "Cannot access detailsRequest before initialization" que podia impedir o carregamento do módulo de Assinaturas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.05',
    date: '30/12/2025',
    summary: 'Assinaturas: botão Processo abre criação quando não há vínculo.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Fluxo de criar processo no detalhe',
            description:
              'No detalhe da assinatura, se não existir processo vinculado, o botão Processo abre diretamente a criação (Aguardando Confecção) com seleção de área.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.04',
    date: '30/12/2025',
    summary: 'Assinaturas: criar processo (Aguardando Confecção) direto do detalhe.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Criar processo a partir da assinatura',
            description:
              'No detalhe da assinatura, quando não há processo vinculado, agora é possível selecionar a área e criar um Processo com status "Aguardando Confecção".',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.03',
    date: '30/12/2025',
    summary: 'Assinaturas: botão Abrir processo corrigido no detalhe.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Abrir processo no detalhe (fallback)',
            description:
              'Quando não há process_id, o sistema tenta localizar o processo pelo número e abre o detalhe automaticamente. Também houve ajuste visual para evitar botões “bugados”.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.02',
    date: '30/12/2025',
    summary: 'Assinaturas: atalhos no detalhe após assinatura (processo e requerimento).',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'feature',
            title: 'Abrir processo / criar requerimento',
            description:
              'No detalhe da assinatura, quando todos assinam, agora há atalhos para abrir o Processo vinculado e iniciar um Requerimento Administrativo (a confeccionar).',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.01',
    date: '30/12/2025',
    summary: 'Assinatura: selo "Recomendado" reposicionado para não sobrepor o botão do Google.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Selo Recomendado (posição)',
            description:
              'Selo "Recomendado" foi reposicionado acima do botão do Google, sem interferir no clique.',
          },
        ],
      },
    ],
  },
  {
    version: '1.9.00',
    date: '30/12/2025',
    summary: 'Assinatura: destaque visual "Recomendado" no login com Google.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Login Google recomendado',
            description:
              'Adicionado selo "Recomendado" na opção "Fazer Login com o Google" durante a confirmação de identidade no fluxo de assinatura.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.99',
    date: '30/12/2025',
    summary: 'Assinatura: ajustada escala da assinatura para 1.5x.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'improvement',
            title: 'Escala da assinatura ajustada',
            description:
              'Assinatura agora é renderizada com escala 1.5x (meio termo entre muito pequena e muito grande).',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.98',
    date: '30/12/2025',
    summary: 'Assinatura: documentos DOCX agora mostram o documento completo com assinatura, não apenas o relatório.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Documento DOCX completo',
            description:
              'Corrigido problema onde documentos DOCX assinados mostravam apenas o relatório de assinatura. Agora renderiza o documento completo com a assinatura aplicada.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.97',
    date: '30/12/2025',
    summary: 'Assinatura: corrigido tamanho excessivo da assinatura no PDF gerado.',
    modules: [
      {
        moduleId: 'assinaturas',
        changes: [
          {
            type: 'fix',
            title: 'Tamanho da assinatura no PDF',
            description:
              'Removida escala 2x que causava assinaturas muito grandes no documento final. Agora a assinatura respeita o tamanho do campo definido.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.96',
    date: '30/12/2025',
    summary: 'Editor de Petições e Clientes: exclusão de petições nos Recentes e no Detalhes do Cliente.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Excluir petições nos Recentes',
            description:
              'Adicionado botão de lixeira em cada item da lista de Recentes no Editor de Petições, com confirmação via modal de cálculo matemático.',
          },
        ],
      },
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'feature',
            title: 'Petições vinculadas no Detalhes do Cliente',
            description:
              'Nova seção "Petições vinculadas" no painel do cliente, permitindo abrir e excluir petições com confirmação via modal de cálculo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.95',
    date: '30/12/2025',
    summary: 'Editor de Petições: Documento padrão com fallback em memória quando o storage do navegador falhar.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Persistência do Documento padrão',
            description:
              'Quando o navegador não consegue persistir o Documento padrão (armazenamento cheio), o sistema avisa e mantém um fallback em memória para a sessão atual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.94',
    date: '30/12/2025',
    summary: 'Editor de Petições: Documento padrão agora carrega o template selecionado após importação.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Documento padrão após importar',
            description:
              'Ao importar um arquivo Word, ele passa a ser armazenado como Documento padrão, permitindo abrir pelo atalho "Novo → Documento padrão".',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.93',
    date: '30/12/2025',
    summary: 'Clientes: melhorias na seção de documentos assinados/gerados no Detalhes do Cliente.',
    modules: [
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'improvement',
            title: 'Documento/Contratos assinados (Vinculado)',
            description:
              'A seção agora exibe o item "Vinculado" e organiza o conteúdo em "Assinados" e "Gerados", mantendo a mensagem de vazio abaixo das listas.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.92',
    date: '30/12/2025',
    summary: 'Editor de Petições: Documento padrão volta a abrir pelo Novo.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Novo → Documento padrão',
            description:
              'O carregamento do documento padrão foi ajustado para aguardar o editor estar pronto e evitar falha silenciosa ao abrir o template cadastrado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.91',
    date: '30/12/2025',
    summary: 'Editor de Petições: nome do usuário com capitalização correta na tela inicial.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Capitalização do nome do usuário',
            description:
              'A saudação na tela inicial agora formata o nome para exibição correta (ex.: "Pedro"), incluindo nomes compostos e conectivos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.90',
    date: '30/12/2025',
    summary: 'Editor de Petições: salvar só com cliente, limpeza de órfãos e Documento padrão corrigido.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Salvar apenas com cliente vinculado',
            description:
              'O salvamento (manual e automático) passa a ocorrer somente quando há cliente selecionado, evitando documentos sem vínculo.',
          },
          {
            type: 'fix',
            title: 'Remoção de documentos sem vinculação',
            description:
              'Documentos antigos sem `client_id` são removidos automaticamente para manter a lista de Recentes consistente.',
          },
          {
            type: 'fix',
            title: 'Documento padrão no Novo',
            description:
              'O atalho "Novo → Documento padrão" foi ajustado para garantir que o editor esteja montado antes de carregar o template.',
          },
          {
            type: 'improvement',
            title: 'Nome do usuário na saudação',
            description:
              'A saudação na tela inicial passa a exibir o nome do usuário logado (via user_metadata), com fallback sem exibir o e-mail completo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.89',
    date: '30/12/2025',
    summary: 'Editor de Petições: abrir recentes mais estável (sem documento vazio) e atalho Documento padrão.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Abrir recente sem salvar vazio',
            description:
              'Corrigida condição de corrida ao abrir documentos recentes (múltiplos cliques) que podia carregar o editor vazio e disparar autosave em branco.',
          },
          {
            type: 'improvement',
            title: 'Atalho Documento padrão',
            description:
              'O atalho "Modelo" foi renomeado para "Documento padrão", refletindo o template padrão já configurado.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.88',
    date: '30/12/2025',
    summary: 'Editor de Petições: atalhos de modelo/importação e exclusões mais claras em Recentes.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Atalhos: Modelo e Importar arquivo',
            description:
              'Na abertura do Editor de Petições, a seção "Novo" passou a incluir atalhos para carregar o modelo padrão e importar arquivo Word.',
          },
          {
            type: 'improvement',
            title: 'Confirmação de exclusão mais completa',
            description:
              'Ao excluir um item (ou todos) em Recentes, a confirmação agora exibe detalhes como documento, cliente e total, seguindo o padrão dos outros módulos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.87',
    date: '30/12/2025',
    summary: 'Editor de Petições: tela inicial com nome do usuário (sem e-mail), botões e recentes com cliente.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Abertura com nome do usuário e saudação',
            description:
              'A tela inicial do Editor de Petições mostra o nome do usuário logado (sem e-mail) e a saudação varia conforme o horário (bom dia/boa tarde/boa noite).',
          },
          {
            type: 'improvement',
            title: 'Controles no topo (widget)',
            description:
              'Adicionados botões de minimizar e fechar no canto superior direito quando aberto como widget.',
          },
          {
            type: 'improvement',
            title: 'Recentes com cliente vinculado',
            description:
              'A lista de recentes exibe o nome do arquivo e o cliente vinculado, facilitando encontrar o documento certo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.86',
    date: '30/12/2025',
    summary: 'Editor de Petições: salvamento apenas com cliente e limpeza de documentos salvos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Salvar apenas com cliente vinculado',
            description:
              'O salvamento (inclusive automático) passa a ocorrer somente quando há cliente selecionado, evitando documentos soltos sem vínculo.',
          },
          {
            type: 'improvement',
            title: 'Limpar documentos salvos',
            description:
              'Adicionada ação para excluir todos os documentos salvos e a listagem de recentes agora considera apenas itens com cliente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.85',
    date: '30/12/2025',
    summary: 'Editor de Petições: tela inicial remodelada no estilo Word e nome do usuário visível.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Tela inicial estilo Word (Novo/Recentes)',
            description:
              'A abertura do Editor de Petições foi reorganizada para um layout estilo Word, com seção "Novo" e lista de "Recentes", além de exibir o nome do usuário.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.84',
    date: '30/12/2025',
    summary: 'Editor de Petições: cabeçalho agora é inserido sem numeração.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Cabeçalho sem numeração',
            description:
              'Blocos da categoria "cabecalho" agora são inseridos sem o prefixo numérico ("1 - "), mantendo o cabeçalho limpo.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.83',
    date: '30/12/2025',
    summary: 'Editor de Petições: correção de listagem de blocos, estabilidade do Syncfusion e inserção sem travar.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Listagem de blocos sem erro 400',
            description:
              'Corrigida a ordenação no Supabase quando a coluna `order` é usada para ordenar os blocos, evitando falha 400 (Bad Request).',
          },
          {
            type: 'fix',
            title: 'Mitigação de crashes do ruler/selection',
            description:
              'O editor passa a inicializar com um documento válido e o ruler é habilitado somente após o componente estar pronto, reduzindo erros internos do Syncfusion.',
          },
          {
            type: 'improvement',
            title: 'Inserção de bloco mais leve (sem travar digitação)',
            description:
              'Placeholders do cliente são processados antes da inserção, evitando chamadas de substituição pesadas no editor principal e melhorando a fluidez após inserir blocos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.82',
    date: '30/12/2025',
    summary: 'Editor de Petições: performance extrema e correção definitiva de travamento.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Performance ao inserir blocos',
            description:
              'Placeholders de dados do cliente agora são processados instantaneamente antes da inserção, eliminando o congelamento da interface.',
          },
          {
            type: 'fix',
            title: 'Repaint automático',
            description: 'Corrigido bug onde o texto digitado só aparecia após rolar a página; agora o editor força a atualização visual imediata.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.81',
    date: '30/12/2025',
    summary: 'Editor de Petições: simplificação do foco após inserir bloco.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Edição funciona após inserir bloco',
            description:
              'Simplificado o mecanismo de foco após inserir bloco (focusIn + moveToDocumentEnd) para resolver bug onde não era possível editar.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.80',
    date: '30/12/2025',
    summary: 'Editor de Petições: correção de repaint após inserir bloco.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Texto digitado aparece imediatamente após inserir bloco',
            description:
              'Após inserir bloco, o foco do editor força atualização do viewer (repaint/scroll) para evitar que o texto digitado só apareça depois de rolar a página.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.79',
    date: '30/12/2025',
    summary: 'Editor de Petições: digitação fluida após inserir blocos.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Digitação não trava após inserir bloco',
            description:
              'As substituições de placeholders (dados do cliente) após inserir bloco agora são executadas de forma assíncrona e fatiada para evitar congelamento do editor.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.78',
    date: '30/12/2025',
    summary: 'Editor de Petições: numeração automática e correção de digitação travada.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'feature',
            title: 'Numeração automática dos blocos',
            description: 'Ao inserir um bloco, agora é adicionado automaticamente um prefixo numérico (1 - , 2 - , etc.) antes do conteúdo.',
          },
          {
            type: 'fix',
            title: 'Digitação travada após inserir bloco',
            description: 'Corrigido bug onde a digitação ficava lenta/travada após inserir um bloco. O foco agora é restaurado corretamente.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.77',
    date: '30/12/2025',
    summary: 'Editor de Petições: correções em blocos (numeração e foco após inserir).',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'fix',
            title: 'Numeração dos blocos restaurada',
            description: 'A lista de blocos voltou a exibir a numeração/ordem para facilitar a organização.',
          },
          {
            type: 'fix',
            title: 'Edição após inserir bloco',
            description: 'Após inserir um bloco, o foco retorna ao editor automaticamente para permitir continuar editando.',
          },
        ],
      },
    ],
  },
  {
    version: '1.8.76',
    date: '29/12/2025',
    summary: 'Editor de Petições: ajustes no toolbar para preservar área de edição.',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Toolbar do editor ajustada para manter mais espaço de edição',
            description:
              'Toolbar do Syncfusion foi ajustada/remodelada para evitar que itens empurrem o documento e para preservar a área de edição em 100% de zoom.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.66',
    date: '28/12/2025',
    summary: 'Ajustes de responsividade nas notificações.',
    modules: [
      {
        moduleId: 'notificacoes',
        changes: [
          {
            type: 'fix',
            title: 'Responsividade do Dropdown Mobile',
            description:
              'Dropdown de notificações agora usa posicionamento fixo em mobile para evitar cortes laterais e garantir usabilidade em telas pequenas.',
          },
          {
            type: 'improvement',
            title: 'Layout do Módulo de Notificações',
            description:
              'Melhorias de layout no módulo de notificações para evitar overflow de texto e garantir que filtros e botões se adaptem a telas menores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.38',
    date: '28/12/2025',
    summary: 'Documentos: busca para filtrar modelos no seletor',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Busca rápida no seletor de modelos (templates/petições)',
            description:
              'Adicionado campo de busca para filtrar modelos por nome/descrição ao selecionar o modelo, facilitando o uso quando houver muitos templates/arquivos (Petições Padrões e Novo Documento).',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.37',
    date: '27/12/2025',
    summary: 'Cache/Sincronização: clientes atualizam em tempo real + ajustes no modal de documentos',
    modules: [
      {
        moduleId: 'dashboard',
        changes: [
          {
            type: 'improvement',
            title: 'Dashboard atualizado automaticamente após mudanças de clientes',
            description:
              'Implementado mecanismo de sincronização via eventos globais para recarregar o dashboard automaticamente após criar/editar/excluir clientes, eliminando a necessidade de atualizar a página.',
          },
        ],
      },
      {
        moduleId: 'clientes',
        changes: [
          {
            type: 'improvement',
            title: 'Listas e buscas de clientes atualizam sem refresh',
            description:
              'Módulos passam a reagir a eventos de mudança de clientes, garantindo consistência imediata entre telas após cadastros e atualizações.',
          },
        ],
      },
      {
        moduleId: 'processos',
        changes: [
          {
            type: 'improvement',
            title: 'Processos: seleção/listagem de clientes sincronizada',
            description:
              'Atualização automática das listas usadas para seleção de cliente após mudanças cadastrais, garantindo que novos clientes fiquem disponíveis imediatamente.',
          },
        ],
      },
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Financeiro recarrega dados quando clientes mudam',
            description:
              'O módulo Financeiro passa a recarregar seus dados quando ocorrerem alterações no cadastro de clientes, evitando inconsistências em filtros e listagens.',
          },
        ],
      },
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Modal de templates: nome/estado resetados corretamente ao abrir',
            description:
              'Ao abrir o modal de "Adicionar Template", os campos do formulário são reinicializados para evitar valores residuais de aberturas anteriores.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.35',
    date: '27/12/2025',
    summary: 'Documentos: Petições Padrões — adequação ao padrão visual do CRM',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Petições Padrões com visual padrão do CRM',
            description:
              'A UI de Petições Padrões foi completamente adequada ao padrão visual dos demais módulos: header branco com ícone azul, botões laranja, cards de estatísticas separados, remoção de gradientes escuros e consistência de cores em todos os elementos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.34',
    date: '27/12/2025',
    summary: 'Documentos: Petições Padrões — ajustes de tema e dark mode',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'improvement',
            title: 'Petições Padrões com tema do CRM (incluindo dark mode)',
            description:
              'A UI de Petições Padrões foi padronizada para o tema do CRM (cores/bordas/inputs/botões) com suporte a dark mode, incluindo os modais de criar/editar, campos personalizados e visualização.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.33',
    date: '27/12/2025',
    summary: 'Documentos: correção do dropdown de seleção de cliente',
    modules: [
      {
        moduleId: 'documentos',
        changes: [
          {
            type: 'fix',
            title: 'Dropdown de clientes não fica atrás do rodapé/overflow',
            description:
              'A lista de sugestões do campo "Buscar cliente" passou a abrir em overlay (portal) com posicionamento fixo, evitando ser cortada por containers com overflow ou sobreposição do rodapé.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.32',
    date: '27/12/2025',
    summary: 'Performance: carregamento mais rápido dos módulos',
    modules: [
      {
        moduleId: 'sistema',
        changes: [
          {
            type: 'improvement',
            title: 'Prefetch em background dos módulos principais',
            description:
              'Após login, o sistema pré-carrega os chunks dos módulos mais usados em background (idle), reduzindo o tempo de carregamento ao navegar entre módulos.',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.31',
    date: '27/12/2025',
    summary: 'Documentação: redesign para o padrão visual do sistema',
    modules: [
      {
        moduleId: 'docs',
        changes: [
          {
            type: 'improvement',
            title: 'Página de Documentação com layout limpo/profissional',
            description:
              'A superpágina de documentação foi redesenhada para o padrão visual do CRM (sem gradientes chamativos e sem aparência de template), mantendo sidebar, busca e seções (Início, Guia, Changelog, FAQ).',
          },
        ],
      },
    ],
  },
  {
    version: '1.3.7',
    date: '27/12/2025',
    summary: 'Intimações DJEN: header simplificado para barra compacta única',
    modules: [
      {
        moduleId: 'intimacoes',
        changes: [
          {
            type: 'improvement',
            title: 'Header compacto do módulo Intimações',
            description: 'Header simplificado para uma única barra compacta com título, última atualização inline e botões essenciais (Sincronizar, Exportar, Configurações), liberando espaço significativo para a lista de intimações.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.69',
    date: '2025-12-26',
    summary: 'Financeiro: separadores visuais entre parcelas no modo escuro',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Separadores brilhantes entre parcelas',
            description:
              'Adicionadas linhas decorativas com gradiente via-white/15 entre cards de parcelas no modo escuro quando há mais de uma parcela, melhorando a organização visual.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1.68',
    date: '2025-12-26',
    summary: 'Financeiro: cartão de parcelas em atraso com gradiente vinho no modo escuro',
    modules: [
      {
        moduleId: 'financeiro',
        changes: [
          {
            type: 'improvement',
            title: 'Gradiente vinho para cartões em atraso',
            description:
              'Cartões de parcelas em atraso agora usam gradiente vinho (#3f0b1d → #09090b) no modo escuro, com badges/pílulas em #4c0e1f e indicador numérico em #fb7185.',
          },
        ],
      },
    ],
  },
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
