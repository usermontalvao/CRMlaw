import React from 'react';
import { ArrowLeft, Printer, FileText, Bookmark, ShieldCheck, CheckCircle2 } from 'lucide-react';

type PageType = 'terms' | 'privacy';

type DocumentSection = {
  title: string;
  description: string;
  bullets: string[];
};

type PageConfig = {
  title: string;
  subtitle: string;
  badge: string;
  highlights: string[];
  sections: DocumentSection[];
};

const pageConfig: Record<PageType, PageConfig> = {
  terms: {
    title: 'Termos de Uso jurius.com.br',
    subtitle: 'Regras claras para garantir transparência, segurança e excelência no uso da plataforma.',
    badge: 'TERMOS DE USO',
    highlights: ['Relacionamento transparente', 'Compromisso com compliance'],
    sections: [
      {
        title: '1. Concordância e acesso',
        description: 'Ao utilizar o jurius.com.br, você concorda com estes termos e declara possuir poderes para representar seu escritório.',
        bullets: [
          'Uso permitido apenas para fins profissionais jurídicos',
          'Modificações nos termos serão notificadas no painel',
          'Aceite contínuo mediante o uso do sistema',
        ],
      },
      {
        title: '2. Licença e propriedade',
        description: 'Mantemos os direitos sobre a plataforma e concedemos licença de uso limitada e não transferível.',
        bullets: [
          'É vedada a revenda ou engenharia reversa',
          'Componentes visuais e código são protegidos por copyright',
          'Dados inseridos pertencem exclusivamente ao escritório',
        ],
      },
      {
        title: '3. Obrigações do usuário',
        description: 'Atue com responsabilidade, confidencialidade e respeito às boas práticas de segurança digital.',
        bullets: [
          'Não compartilhar credenciais',
          'Respeitar LGPD e sigilo profissional',
          'Utilizar recursos conforme limites contratados',
        ],
      },
      {
        title: '4. Suporte e disponibilidade',
        description: 'Oferecemos suporte especializado e monitoramos a disponibilidade do sistema 24/7.',
        bullets: [
          'Canais de suporte via e-mail e chat',
          'Janela de manutenção comunicada antecipadamente',
          'Registro de incidentes críticos com SLA definido',
        ],
      },
      {
        title: '5. Encerramento',
        description: 'Você pode encerrar o contrato a qualquer momento e solicitaremos confirmação para exclusão definitiva dos dados.',
        bullets: [
          'Exportação dos dados sob demanda',
          'Retenção mínima por obrigações legais',
          'Reativação possível mediante nova contratação',
        ],
      },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    subtitle: 'Protegemos informações sensíveis de clientes e escritórios com padrões de segurança corporativos.',
    badge: 'PRIVACIDADE & LGPD',
    highlights: ['Criptografia ponta a ponta', 'Hospedagem no Brasil'],
    sections: [
      {
        title: '1. Coleta responsável',
        description: 'Capturamos apenas dados necessários para operar o CRM jurídico e cumprir obrigações legais.',
        bullets: [
          'Dados cadastrais, logs e métricas de uso',
          'Cookies apenas para desempenho e segurança',
          'Sem venda ou compartilhamento indevido',
        ],
      },
      {
        title: '2. Uso e finalidade',
        description: 'Utilizamos as informações para autenticação, suporte, melhorias e integrações autorizadas.',
        bullets: [
          'Processamento automatizado de prazos e intimações',
          'Envio de comunicações transacionais',
          'Integração com serviços judiciais sob consentimento',
        ],
      },
      {
        title: '3. Segurança e armazenamento',
        description: 'Aplicamos camadas de criptografia, backups redundantes e monitoramento contínuo.',
        bullets: [
          'Criptografia TLS 1.3 e AES-256 at rest',
          'Backups diários com retenção de 30 dias',
          'Acesso restrito e auditável pela equipe jurius.com.br',
        ],
      },
      {
        title: '4. Direitos do titular',
        description: 'Cumprimos integralmente a LGPD e disponibilizamos canais para exercer direitos.',
        bullets: [
          'Solicitar acesso, correção ou exclusão',
          'Portabilidade mediante solicitação formal',
          'Canal direto: pedro@advcuiaba.com',
        ],
      },
      {
        title: '5. Retenção e descarte',
        description: 'Mantemos dados apenas pelo período necessário ao cumprimento contratual e legal.',
        bullets: [
          'Eliminação segura ao término do contrato',
          'Anonimização para fins estatísticos',
          'Relatórios de descarte enviados ao escritório',
        ],
      },
    ],
  },
};

const Toolbar: React.FC<{ formattedDate: string }> = ({ formattedDate }) => (
  <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
    <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <button
        onClick={() => {
          window.location.hash = '/login';
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 transition"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </button>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="hidden sm:flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          Documento oficial
        </span>
        <span className="w-px h-4 bg-slate-200 hidden sm:block" />
        <span>Atualizado em {formattedDate}</span>
        <button
          onClick={() => window.print()}
          className="ml-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimir
        </button>
      </div>
    </div>
  </div>
);

const DocumentCard: React.FC<{
  config: PageConfig;
  currentYear: number;
}> = ({ config, currentYear }) => (
  <article className="relative rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.09)] overflow-hidden print:shadow-none print:border-0">
    <header className="px-10 pt-12 pb-10 border-b border-slate-100 space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-900 text-white font-semibold flex items-center justify-center tracking-tight">
          J
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-900">jurius.com.br</span>
          <span className="text-xs text-slate-500">Gestão Jurídica Inteligente</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold tracking-[0.3em] text-slate-600">
          {config.badge}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-400">jurius.com.br</span>
      </div>
      <h1 className="text-[34px] font-serif font-semibold leading-tight text-slate-900 tracking-tight">{config.title}</h1>
      <p className="text-base text-slate-500 max-w-3xl leading-relaxed">{config.subtitle}</p>
      <div className="grid gap-4 text-[11px] text-slate-500 sm:grid-cols-3">
        <div className="space-y-1">
          <p className="uppercase tracking-[0.3em] text-slate-400 text-[10px]">Versão</p>
          <p className="text-slate-700 font-semibold">3.2 · 2025</p>
        </div>
        <div className="space-y-1">
          <p className="uppercase tracking-[0.3em] text-slate-400 text-[10px]">Revisão</p>
          <p className="text-slate-700 font-semibold">Março / 2025</p>
        </div>
        <div className="space-y-1">
          <p className="uppercase tracking-[0.3em] text-slate-400 text-[10px]">Compliance</p>
          <p className="text-slate-700 font-semibold">LGPD · ISO 27001</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {config.highlights.map((item) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
            {item}
          </div>
        ))}
      </div>
    </header>

    <div className="relative divide-y divide-slate-100">
      {config.sections.map((section, idx) => (
        <section key={section.title} id={`section-${idx}`} className="px-10 py-8 scroll-mt-36">
          <div className="flex items-baseline gap-4 mb-6">
            <span className="text-xs font-semibold tracking-[0.6em] text-slate-300">§{idx + 1}</span>
            <div className="space-y-1">
              <p className="text-[13px] uppercase tracking-[0.4em] text-slate-400">{section.title.split('.')[0]}</p>
              <h2 className="text-[22px] font-semibold text-slate-900">{section.title.replace(/^\d+\.\s*/, '')}</h2>
            </div>
          </div>
          <p className="text-slate-600 text-sm leading-relaxed mb-5">{section.description}</p>
          <ul className="space-y-3 text-sm text-slate-600 leading-relaxed pl-5 list-disc marker:text-slate-400">
            {section.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </section>
      ))}
      <div className="px-10 py-8 bg-slate-50 print:bg-transparent">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 flex flex-wrap items-center gap-4 text-sm text-slate-600 print:border print:bg-transparent">
          <ShieldCheck className="h-5 w-5 text-slate-500" />
          <div className="flex-1">
            <p className="font-semibold text-slate-800">Assinatura & conformidade</p>
            <p className="text-xs text-slate-500">Documento autenticado digitalmente · Auditoria anual · Registro em cartório disponível sob demanda.</p>
          </div>
          <a
            href="mailto:pedro@advcuiaba.com"
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition print:hidden"
          >
            Solicitar via e-mail
          </a>
        </div>
      </div>
    </div>

    <footer className="px-10 py-8 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap items-center gap-4 justify-between">
      <div>
        <p className="font-semibold text-slate-700">Equipe jurius.com.br</p>
        <p>
          Contato oficial:{' '}
          <a href="mailto:pedro@advcuiaba.com" className="text-orange-600 hover:text-orange-500">
            pedro@advcuiaba.com
          </a>
        </p>
      </div>
      <p>© {currentYear} jurius.com.br · Todos os direitos reservados</p>
    </footer>
  </article>
);

const Sidebar: React.FC<{ sections: DocumentSection[] }> = ({ sections }) => (
  <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start print:hidden">
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-[0.3em] mb-4">Resumo</p>
      <p className="text-sm text-slate-600 leading-relaxed">
        Documento alinhado às melhores práticas de compliance jurídico, com foco em segurança da informação e responsabilidade digital do escritório.
      </p>
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-3">
        <Bookmark className="h-4 w-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-800">Sumário</p>
      </div>
      <ol className="space-y-3 text-sm text-slate-600">
        {sections.map((section, idx) => (
          <li key={section.title}>
            <a
              href={`#section-${idx}`}
              className="inline-flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50 text-left transition"
            >
              <span className="text-[11px] font-semibold text-slate-400">§{idx + 1}</span>
              <span>{section.title.replace(/^\d+\.\s*/, '')}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <p className="text-sm font-semibold text-slate-800">Compromissos</p>
      <ul className="space-y-2 text-xs text-slate-500">
        <li className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Suporte dedicado · SLA 99,5%
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Monitoramento 24/7 · Logs auditáveis
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Conformidade LGPD · Hospedagem Brasil
        </li>
      </ul>
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <p className="text-sm font-semibold text-slate-800">Contato</p>
      <p className="text-xs text-slate-500 leading-relaxed">
        Solicite histórico de versões, ata de aprovação ou checklist de conformidade enviando um e-mail para{' '}
        <a href="mailto:pedro@advcuiaba.com" className="font-semibold underline">
          pedro@advcuiaba.com
        </a>.
      </p>
    </div>
  </aside>
);

const TermsPrivacyPage: React.FC<{ type: PageType }> = ({ type }) => {
  const config = pageConfig[type];
  const currentYear = new Date().getFullYear();
  const formattedDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Toolbar formattedDate={formattedDate} />

      <main className="max-w-6xl mx-auto px-4 py-10 lg:py-14 print:px-0 print:py-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_1fr]">
          <DocumentCard config={config} currentYear={currentYear} />
          <Sidebar sections={config.sections} />
        </div>
      </main>
    </div>
  );
};

export default TermsPrivacyPage;
