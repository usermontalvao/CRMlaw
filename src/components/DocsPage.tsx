import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Search,
  Scale,
  Settings,
  Shield,
  Users,
  Zap,
  FileSignature,
  Briefcase,
  Clock,
  DollarSign,
  Bell,
  FolderOpen,
  CalendarDays,
  UserPlus,
  Gavel,
  X,
  History,
  Home,
  Lightbulb,
  MessageCircleQuestion,
  TrendingUp,
  Bug,
  AlertTriangle,
  LayoutDashboard,
  Megaphone,
  Menu,
} from 'lucide-react';

const CURRENT_VERSION = '1.3.31';
const VERSION_CODENAME = 'Café Premium';

type DocSection = 'inicio' | 'guia' | 'changelog' | 'faq';

const DOC_SECTIONS = [
  { id: 'inicio' as DocSection, name: 'Início', icon: Home, description: 'Visão geral' },
  { id: 'guia' as DocSection, name: 'Guia do Sistema', icon: BookOpen, description: 'Módulos' },
  { id: 'changelog' as DocSection, name: 'Changelog', icon: History, description: 'Atualizações' },
  { id: 'faq' as DocSection, name: 'FAQ', icon: MessageCircleQuestion, description: 'Dúvidas' },
];

const SYSTEM_MODULES = [
  { id: 'dashboard', name: 'Dashboard', description: 'Visão geral do escritório com métricas e indicadores.', icon: LayoutDashboard, features: ['Resumo de processos', 'Gráficos de evolução', 'Indicadores de prazos', 'Métricas financeiras'], tips: ['Use filtros de período', 'Clique nos cards para detalhes'] },
  { id: 'processos', name: 'Processos', description: 'Gestão completa de processos judiciais e administrativos.', icon: Briefcase, features: ['Cadastro completo', 'Histórico de movimentações', 'Upload de documentos', 'Busca avançada'], tips: ['Mantenha status atualizado', 'Use tags para categorizar'] },
  { id: 'clientes', name: 'Clientes', description: 'Cadastro e gestão de clientes PF e PJ.', icon: Users, features: ['Cadastro PF e PJ', 'Dados de contato', 'Documentos do cliente', 'Histórico de processos'], tips: ['Valide CPF/CNPJ', 'Mantenha contatos atualizados'] },
  { id: 'prazos', name: 'Prazos', description: 'Controle de prazos processuais com alertas automáticos.', icon: Clock, features: ['Alertas automáticos', 'Visualização em calendário', 'Prazos fatais destacados', 'Notificações push'], tips: ['Configure alertas com antecedência', 'Marque como cumprido ao concluir'] },
  { id: 'financeiro', name: 'Financeiro', description: 'Gestão financeira completa do escritório.', icon: DollarSign, features: ['Receitas e despesas', 'Honorários por processo', 'Fluxo de caixa', 'Geração de recibos'], tips: ['Categorize lançamentos', 'Vincule honorários aos processos'] },
  { id: 'documentos', name: 'Documentos', description: 'Repositório central de documentos com modelos.', icon: FolderOpen, features: ['Upload múltiplo', 'Modelos de documentos', 'Geração automática', 'Visualização de PDFs'], tips: ['Use nomes descritivos', 'Crie modelos frequentes'] },
  { id: 'assinaturas', name: 'Assinaturas', description: 'Assinatura digital com validade jurídica.', icon: FileSignature, features: ['Múltiplos signatários', 'Verificação facial com IA', 'Autenticação Google/telefone', 'QR Code de verificação'], tips: ['Ative verificação facial', 'Acompanhe pendentes'] },
  { id: 'agenda', name: 'Agenda', description: 'Calendário para compromissos e audiências.', icon: CalendarDays, features: ['Visualização diária/semanal/mensal', 'Lembretes automáticos', 'Arrastar e soltar', 'Log de exclusões'], tips: ['Vincule audiências aos processos', 'Use cores por tipo'] },
  { id: 'intimacoes', name: 'Intimações', description: 'Gestão de intimações eletrônicas com integração DJEN.', icon: Bell, features: ['Captura automática (DJEN)', 'Análise com IA', 'Criação de prazos', 'Alertas de urgência'], tips: ['Configure integração', 'Processe diariamente'] },
  { id: 'requerimentos', name: 'Requerimentos', description: 'Gestão de requerimentos INSS/BPC com geração de MS.', icon: Gavel, features: ['Acompanhamento de status', 'Alerta de MS (90+ dias)', 'Geração de MS em Word', 'Histórico de notas'], tips: ['Acompanhe tempo em análise', 'Gere MS após 90 dias'] },
  { id: 'leads', name: 'Leads', description: 'Gestão de potenciais clientes e funil de vendas.', icon: UserPlus, features: ['Funil de conversão', 'Histórico de contatos', 'Conversão para cliente', 'Métricas'], tips: ['Registre origem', 'Faça follow-up regular'] },
  { id: 'notificacoes', name: 'Notificações', description: 'Central de alertas do sistema em tempo real.', icon: Megaphone, features: ['Notificações realtime', 'Alertas de prazos', 'Push no navegador', 'Histórico'], tips: ['Ative push', 'Verifique diariamente'] },
  { id: 'configuracoes', name: 'Configurações', description: 'Personalize o sistema e gerencie usuários.', icon: Settings, features: ['Gestão de usuários', 'Permissões', 'Integrações', 'Tema claro/escuro'], tips: ['Revise permissões', 'Mantenha integrações atualizadas'] },
];

const FAQ_ITEMS = [
  { category: 'Geral', question: 'Como faço para acessar o sistema?', answer: 'Acesse pelo navegador usando seu e-mail e senha. Use "Esqueci minha senha" se necessário.' },
  { category: 'Geral', question: 'Funciona em dispositivos móveis?', answer: 'Sim! O Jurius é totalmente responsivo e funciona em smartphones, tablets e computadores.' },
  { category: 'Processos', question: 'Como cadastrar um novo processo?', answer: 'Acesse Processos, clique em "Novo Processo", preencha os dados e salve.' },
  { category: 'Prazos', question: 'Como configurar alertas de prazos?', answer: 'Ao cadastrar um prazo, defina a data/hora e configure o alerta (1 dia antes, 3 dias antes, etc.).' },
  { category: 'Assinaturas', question: 'A assinatura digital tem validade jurídica?', answer: 'Sim! Segue a MP 2.200-2/2001 e Lei 14.063/2020, tendo validade quando as partes concordam.' },
  { category: 'Intimações', question: 'Como sincronizar intimações do DJEN?', answer: 'No módulo Intimações, clique em "Sincronizar". Configure credenciais nas configurações.' },
  { category: 'Segurança', question: 'Meus dados estão seguros?', answer: 'Sim! Usamos criptografia SSL, Supabase, autenticação robusta e backups automáticos.' },
];

const CHANGELOG = [
  { version: '1.3.29', date: '27/12/2025', summary: 'Autenticidade: exibição do contato real do signatário', changes: [{ type: 'improvement' as const, module: 'Assinaturas', title: 'Contato real na autenticidade' }] },
  { version: '1.3.28', date: '27/12/2025', summary: 'Selfie: anti-falso-negativo na validação', changes: [{ type: 'fix' as const, module: 'Assinaturas', title: 'Anti-falso-negativo na selfie' }] },
  { version: '1.3.27', date: '27/12/2025', summary: 'Selfie: critérios de IA ajustados', changes: [{ type: 'improvement' as const, module: 'Assinaturas', title: 'Critérios de validação relaxados' }] },
  { version: '1.3.26', date: '27/12/2025', summary: 'Validação de selfie com IA na assinatura pública', changes: [{ type: 'feature' as const, module: 'Assinaturas', title: 'Validação de selfie com IA' }] },
  { version: '1.3.25', date: '26/12/2025', summary: 'Validação de foto facial com IA', changes: [{ type: 'feature' as const, module: 'Assinaturas', title: 'Validação com OpenAI Vision' }] },
  { version: '1.3.24', date: '26/12/2025', summary: 'Notificações do navegador', changes: [{ type: 'feature' as const, module: 'Notificações', title: 'Notificação push do navegador' }] },
  { version: '1.3.23', date: '26/12/2025', summary: 'Notificações fixas na tela', changes: [{ type: 'improvement' as const, module: 'Notificações', title: 'Popups fixos até fechar' }] },
  { version: '1.3.22', date: '26/12/2025', summary: 'Notificações para todas as intimações', changes: [{ type: 'improvement' as const, module: 'Intimações', title: 'Notificação para todas as intimações' }] },
  { version: '1.3.21', date: '25/12/2025', summary: 'Integração de Requerimentos nas notificações', changes: [{ type: 'feature' as const, module: 'Requerimentos', title: 'Alertas de MS/tempo em análise' }] },
  { version: '1.3.20', date: '25/12/2025', summary: 'Popup de notificação por 60 minutos', changes: [{ type: 'improvement' as const, module: 'Notificações', title: 'Popup permanece por 60 minutos' }] },
];

const CHANGE_TYPE_CONFIG = {
  feature: { label: 'Novo', icon: Zap, color: 'text-emerald-700', bg: 'bg-emerald-100' },
  improvement: { label: 'Melhoria', icon: TrendingUp, color: 'text-blue-700', bg: 'bg-blue-100' },
  fix: { label: 'Correção', icon: Bug, color: 'text-amber-700', bg: 'bg-amber-100' },
  security: { label: 'Segurança', icon: Shield, color: 'text-red-700', bg: 'bg-red-100' },
  breaking: { label: 'Breaking', icon: AlertTriangle, color: 'text-purple-700', bg: 'bg-purple-100' },
};

const DocsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<DocSection>('inicio');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedFAQ, setExpandedFAQ] = useState<Set<number>>(new Set());
  const mainRef = useRef<HTMLDivElement>(null);

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const toggleFAQ = (idx: number) => {
    setExpandedFAQ((prev) => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  };

  const filteredModules = useMemo(() => {
    if (!searchQuery.trim()) return SYSTEM_MODULES;
    const q = searchQuery.toLowerCase();
    return SYSTEM_MODULES.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [searchQuery]);

  const filteredFAQ = useMemo(() => {
    if (!searchQuery.trim()) return FAQ_ITEMS;
    const q = searchQuery.toLowerCase();
    return FAQ_ITEMS.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q));
  }, [searchQuery]);

  const filteredChangelog = useMemo(() => {
    if (!searchQuery.trim()) return CHANGELOG;
    const q = searchQuery.toLowerCase();
    return CHANGELOG.filter((c) => c.version.includes(q) || c.summary.toLowerCase().includes(q));
  }, [searchQuery]);

  const handleBack = () => window.history.back();

  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [activeSection]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-200 transform transition-transform duration-300 lg:translate-x-0 lg:static ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center">
                <Scale className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Jurius</h1>
                <p className="text-xs text-slate-500">Documentação</p>
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-500">
              v{CURRENT_VERSION} · {VERSION_CODENAME}
            </div>
          </div>
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {DOC_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button key={section.id} onClick={() => { setActiveSection(section.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition ${isActive ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <Icon className={`w-5 h-5 ${isActive ? 'text-slate-700' : 'text-slate-400'}`} />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">{section.name}</div>
                    <div className="text-xs text-slate-400">{section.description}</div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="p-4 border-t border-slate-100">
            <button
              onClick={handleBack}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition font-medium text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar ao Sistema
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-slate-100"><Menu className="w-5 h-5 text-slate-600" /></button>
            <div className="flex items-center gap-2"><Scale className="w-5 h-5 text-slate-900" /><span className="font-semibold text-slate-900">Documentação</span></div>
            <div className="w-9" />
          </div>
        </header>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar na documentação..."
                className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-200 transition" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-100"><X className="w-4 h-4 text-slate-400" /></button>}
            </div>
          </div>

          {/* INÍCIO */}
          {activeSection === 'inicio' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Documentação</h1>
                    <p className="mt-1 text-sm text-slate-600">Guia de módulos, changelog e ajuda.</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Versão</div>
                    <div className="text-sm font-semibold text-slate-900">v{CURRENT_VERSION}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => setActiveSection('guia')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition">
                    <BookOpen className="w-4 h-4" />Guia do Sistema
                  </button>
                  <button onClick={() => setActiveSection('changelog')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-medium hover:bg-slate-200 transition">
                    <History className="w-4 h-4" />Changelog
                  </button>
                  <button onClick={() => setActiveSection('faq')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-medium hover:bg-slate-200 transition">
                    <MessageCircleQuestion className="w-4 h-4" />FAQ
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Módulos</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{SYSTEM_MODULES.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Funcionalidades</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{SYSTEM_MODULES.reduce((acc, m) => acc + m.features.length, 0)}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">Versões</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{CHANGELOG.length}+</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-500">FAQs</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{FAQ_ITEMS.length}</div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">Acesso rápido</h2>
                  <button onClick={() => setActiveSection('guia')} className="text-sm text-slate-600 hover:text-slate-900 font-medium">Ver todos</button>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {SYSTEM_MODULES.slice(0, 6).map((mod) => {
                    const Icon = mod.icon;
                    return (
                      <button
                        key={mod.id}
                        onClick={() => { setActiveSection('guia'); setExpandedModules(new Set([mod.id])); }}
                        className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 transition text-left"
                      >
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-slate-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900">{mod.name}</div>
                          <div className="text-xs text-slate-500 truncate">{mod.features.length} itens</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* GUIA */}
          {activeSection === 'guia' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Guia do Sistema</h1>
                    <p className="mt-1 text-sm text-slate-600">Módulos e funcionalidades.</p>
                  </div>
                  <div className="text-xs text-slate-500">{SYSTEM_MODULES.length} módulos</div>
                </div>
              </div>
              {filteredModules.length === 0 ? (<div className="text-center py-12"><Search className="w-12 h-12 text-slate-300 mx-auto mb-4" /><p className="text-slate-500">Nenhum módulo encontrado</p></div>) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredModules.map((mod) => { const Icon = mod.icon; const isExpanded = expandedModules.has(mod.id); return (
                    <div key={mod.id} className={`bg-white rounded-xl border overflow-hidden transition-all ${isExpanded ? 'border-slate-300' : 'border-slate-200'}`}>
                      <button onClick={() => toggleModule(mod.id)} className="w-full p-5 flex items-start gap-4 text-left hover:bg-slate-50/50 transition">
                        <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-6 h-6 text-slate-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-base font-semibold text-slate-900">{mod.name}</h3>
                            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                          <p className="text-sm text-slate-600 mt-1 line-clamp-2">{mod.description}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-slate-400">{mod.features.length} itens</span>
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-5 border-t border-slate-100">
                          <div className="pt-4 space-y-4">
                            <div>
                              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-emerald-500" />Funcionalidades
                              </h4>
                              <ul className="space-y-2">
                                {mod.features.map((feature, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    {feature}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            {mod.tips && mod.tips.length > 0 && (
                              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                                  <Lightbulb className="w-3.5 h-3.5" />Dicas
                                </h4>
                                <ul className="space-y-1">
                                  {mod.tips.map((tip, idx) => (
                                    <li key={idx} className="text-sm text-slate-700">{tip}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ); })}
                </div>
              )}
            </div>
          )}

          {/* CHANGELOG */}
          {activeSection === 'changelog' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Changelog</h1>
                    <p className="mt-1 text-sm text-slate-600">Histórico de alterações.</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Versão atual</div>
                    <div className="text-sm font-semibold text-slate-900">v{CURRENT_VERSION}</div>
                  </div>
                </div>
              </div>
              {filteredChangelog.length === 0 ? (<div className="text-center py-12"><Search className="w-12 h-12 text-slate-300 mx-auto mb-4" /><p className="text-slate-500">Nenhuma versão encontrada</p></div>) : (
                <div className="space-y-4">
                  {filteredChangelog.map((entry) => (
                    <article key={entry.version} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="p-5 border-b border-slate-100 bg-slate-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center text-white font-bold text-sm">
                              {entry.version.split('.').slice(-1)[0]}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900">v{entry.version}</div>
                              <div className="text-xs text-slate-500">{entry.summary}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Calendar className="w-3.5 h-3.5" />
                            {entry.date}
                          </div>
                        </div>
                      </div>
                      <div className="p-5 space-y-3">
                        {entry.changes.map((change, idx) => { const typeConfig = CHANGE_TYPE_CONFIG[change.type]; const TypeIcon = typeConfig.icon; return (
                          <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${typeConfig.bg} ${typeConfig.color} flex-shrink-0`}>
                              <TypeIcon className="w-3 h-3" />
                              {typeConfig.label}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-slate-400">{change.module}</span>
                              </div>
                              <div className="text-sm font-medium text-slate-800">{change.title}</div>
                            </div>
                          </div>
                        ); })}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* FAQ */}
          {activeSection === 'faq' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Perguntas Frequentes</h1>
                    <p className="mt-1 text-sm text-slate-600">Dúvidas comuns e respostas rápidas.</p>
                  </div>
                  <div className="text-xs text-slate-500">{FAQ_ITEMS.length} itens</div>
                </div>
              </div>
              {filteredFAQ.length === 0 ? (<div className="text-center py-12"><Search className="w-12 h-12 text-slate-300 mx-auto mb-4" /><p className="text-slate-500">Nenhuma pergunta encontrada</p></div>) : (
                <div className="space-y-3">
                  {filteredFAQ.map((faq, idx) => { const isExpanded = expandedFAQ.has(idx); return (
                    <div key={idx} className={`bg-white rounded-xl border overflow-hidden transition-all ${isExpanded ? 'border-slate-300' : 'border-slate-200'}`}>
                      <button onClick={() => toggleFAQ(idx)} className="w-full p-5 flex items-start gap-4 text-left hover:bg-slate-50/50 transition">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <MessageCircleQuestion className="w-4 h-4 text-slate-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{faq.question}</h3><ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></div>
                          <span className="text-xs text-slate-500 font-medium">{faq.category}</span>
                        </div>
                      </button>
                      {isExpanded && (<div className="px-5 pb-5 border-t border-slate-100"><p className="pt-4 text-sm text-slate-600 leading-relaxed">{faq.answer}</p></div>)}
                    </div>
                  ); })}
                </div>
              )}
            </div>
          )}

          <footer className="mt-12 text-center"><p className="text-xs text-slate-400">Jurius · Sistema de Gestão Jurídica · v{CURRENT_VERSION}</p></footer>
        </div>
      </main>
    </div>
  );
};

export default DocsPage;
