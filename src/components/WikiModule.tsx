import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileKey,
  HelpCircle,
  Loader2,
  Network,
  PlayCircle,
  Search,
  ShieldCheck,
  TriangleAlert,
  Usb,
  Wrench,
  XCircle,
} from 'lucide-react';
import { wikiService, type WikiArticle, type WikiArticleSummary, type WikiCategory, type WikiNote } from '../services/wiki.service';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  start: PlayCircle,
  network: Network,
  certificate: FileKey,
  routine: ClipboardCheck,
  troubleshooting: Wrench,
  security: ShieldCheck,
};

const PRIMARY_GUIDE_SLUG = 'comece-aqui-token-remoto';

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const NOTE_STYLE: Record<WikiNote['type'], { icon: typeof CircleAlert; box: string; iconColor: string }> = {
  info: { icon: CircleAlert, box: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30', iconColor: 'text-sky-600' },
  warning: { icon: TriangleAlert, box: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30', iconColor: 'text-amber-600' },
  success: { icon: CheckCircle2, box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30', iconColor: 'text-emerald-600' },
  danger: { icon: XCircle, box: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30', iconColor: 'text-red-600' },
};

const ExternalButton: React.FC<{ href: string; label: string; description?: string }> = ({ href, label, description }) => (
  <a href={href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-xl border border-[#d8d7d2] bg-white px-4 py-3 text-left transition hover:border-[#36c] hover:bg-[#f8f9fa] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-sky-600 dark:hover:bg-zinc-800">
    <span><b className="block text-sm text-[#36c] group-hover:underline dark:text-sky-400">{label}</b>{description && <small className="mt-0.5 block text-xs text-[#54595d] dark:text-zinc-400">{description}</small>}</span>
    <ExternalLink className="h-4 w-4 shrink-0 text-[#72777d]" />
  </a>
);

const LoadingState = () => (
  <div className="flex min-h-[420px] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-[#36c]" /><p className="mt-3 text-sm text-slate-500">Carregando a Central de ajuda…</p></div></div>
);

const WikiModule: React.FC = () => {
  const [categories, setCategories] = useState<WikiCategory[]>([]);
  const [articles, setArticles] = useState<WikiArticleSummary[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [article, setArticle] = useState<WikiArticle | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [articleLoading, setArticleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([wikiService.listCategories(), wikiService.listArticles()])
      .then(([loadedCategories, loadedArticles]) => {
        if (!active) return;
        setCategories(loadedCategories);
        setArticles(loadedArticles);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a Central de ajuda.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedSlug) { setArticle(null); return; }
    let active = true;
    setArticleLoading(true);
    setError(null);
    wikiService.getArticle(selectedSlug)
      .then((loaded) => {
        if (!active) return;
        setArticle(loaded);
        window.requestAnimationFrame(() => document.getElementById('wiki-article-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir este manual.'); })
      .finally(() => { if (active) setArticleLoading(false); });
    return () => { active = false; };
  }, [selectedSlug]);

  const primaryGuide = useMemo(
    () => articles.find((item) => item.slug === PRIMARY_GUIDE_SLUG) ?? null,
    [articles],
  );
  const referenceArticles = useMemo(
    () => articles.filter((item) => item.slug !== PRIMARY_GUIDE_SLUG),
    [articles],
  );
  const filteredArticles = useMemo(() => {
    const term = normalize(query.trim());
    return referenceArticles.filter((item) => {
      if (selectedCategory !== 'all' && item.category_id !== selectedCategory) return false;
      if (!term) return true;
      return normalize([item.title, item.summary, item.audience, ...item.tags].join(' ')).includes(term);
    });
  }, [query, referenceArticles, selectedCategory]);

  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const visibleCategories = useMemo(
    () => categories.filter((category) => referenceArticles.some((item) => item.category_id === category.id)),
    [categories, referenceArticles],
  );
  const openArticle = (slug: string) => { setSelectedSlug(slug); setQuery(''); };

  const copyCommand = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedCommand(value);
    window.setTimeout(() => setCopiedCommand((current) => current === value ? null : current), 1800);
  };

  if (loading) return <LoadingState />;

  if (selectedSlug) {
    if (articleLoading && !article) return <LoadingState />;
    if (error || !article) return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30"><XCircle className="mx-auto h-8 w-8 text-red-600" /><h2 className="mt-3 text-lg font-semibold">Não foi possível abrir o manual</h2><p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p><button onClick={() => setSelectedSlug(null)} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Voltar à Central de ajuda</button></div>
    );

    const category = categoryById.get(article.category_id);
    const related = articles.filter((item) => item.category_id === article.category_id && item.id !== article.id).slice(0, 3);

    return (
      <div id="wiki-article-top" className="mx-auto w-full max-w-[1320px] pb-14 text-[#202122] dark:text-zinc-200">
        <button onClick={() => setSelectedSlug(null)} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#36c] hover:underline dark:text-sky-400"><ArrowLeft className="h-4 w-4" /> Voltar à Central de ajuda</button>
        <header className="border-b border-[#d8d7d2] pb-6 dark:border-zinc-800">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#54595d] dark:text-zinc-400"><span>Central de ajuda</span><ChevronRight className="h-3.5 w-3.5" /><span>{category?.name ?? 'Manual'}</span></div>
          <h1 className="max-w-5xl font-serif text-4xl font-normal tracking-tight text-[#101418] dark:text-white sm:text-[46px]">{article.title}</h1>
          <p className="mt-3 max-w-4xl text-[15px] leading-7 text-[#54595d] dark:text-zinc-400">{article.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-[#eaecf0] px-3 py-1.5 dark:bg-zinc-800">Para: {article.audience}</span><span className="rounded-full bg-[#eaecf0] px-3 py-1.5 dark:bg-zinc-800">Nível: {article.difficulty}</span><span className="rounded-full bg-[#eaecf0] px-3 py-1.5 dark:bg-zinc-800">Tempo: cerca de {article.estimated_minutes} min</span></div>
        </header>

        <div className="mt-7 grid items-start gap-8 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden xl:block"><div className="sticky top-20 border-t border-[#a2a9b1] pt-3"><b className="text-sm">Neste manual</b><nav className="mt-2 space-y-1 border-l border-[#eaecf0] pl-3 dark:border-zinc-800">{article.body.sections.map((section, index) => <button key={section.id} onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth' })} className="block w-full py-1 text-left text-[13px] leading-5 text-[#36c] hover:underline dark:text-sky-400">{index + 1}. {section.title}</button>)}</nav></div></aside>

          <article className="min-w-0">
            {article.body.introduction && <p className="mb-6 border-l-4 border-[#36c] bg-sky-50 p-4 text-[15px] leading-7 dark:bg-sky-950/30">{article.body.introduction}</p>}
            {article.body.prerequisites && article.body.prerequisites.length > 0 && <section className="mb-8 rounded-2xl border border-[#d8d7d2] bg-[#f8f9fa] p-5 dark:border-zinc-700 dark:bg-zinc-900"><h2 className="flex items-center gap-2 text-base font-bold"><ClipboardCheck className="h-5 w-5 text-[#36c]" />Antes de começar</h2><ul className="mt-3 space-y-2 text-sm">{article.body.prerequisites.map((item) => <li key={item} className="flex gap-2"><span className="font-bold text-[#36c]">□</span><span>{item}</span></li>)}</ul></section>}

            {article.body.sections.map((section, sectionIndex) => (
              <section key={section.id} className="mb-11 space-y-5">
                <h2 id={section.id} className="scroll-mt-24 border-b border-[#d8d7d2] pb-2 font-serif text-[28px] font-normal tracking-tight dark:border-zinc-700 dark:text-white">{sectionIndex + 1}. {section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph} className="text-[15px] leading-7">{paragraph}</p>)}
                {section.steps && section.steps.length > 0 && <ol className="space-y-4">{section.steps.map((step, index) => <li key={`${section.id}-${step.title}`} className="relative rounded-2xl border border-[#d8d7d2] bg-white p-5 pl-[68px] shadow-[0_2px_10px_rgba(15,23,42,0.04)] dark:border-zinc-700 dark:bg-zinc-900"><span className="absolute left-5 top-5 grid h-8 w-8 place-items-center rounded-full bg-[#36c] text-sm font-bold text-white">{index + 1}</span><h3 className="text-base font-bold text-[#202122] dark:text-white">{step.title}</h3><p className="mt-1 text-sm leading-6 text-[#54595d] dark:text-zinc-400">{step.description}</p>{step.action && <div className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm leading-6 dark:bg-amber-950/30"><b>O que fazer: </b>{step.action}</div>}{step.links && step.links.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{step.links.map((link) => <ExternalButton key={link.href} href={link.href} label={link.label} description={link.description} />)}</div>}{step.expected && <div className="mt-3 flex gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Como saber se deu certo: </b>{step.expected}</span></div>}</li>)}</ol>}
                {section.commands?.map((command) => <div key={command.value} className="overflow-hidden rounded-xl border border-zinc-700 bg-[#202122] text-white"><div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-zinc-300"><span>{command.label}</span><button onClick={() => copyCommand(command.value)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/10">{copiedCommand === command.value ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copiedCommand === command.value ? 'Copiado' : 'Copiar'}</button></div><pre className="overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[13px] leading-6">{command.value}</pre>{command.expected && <div className="border-t border-white/10 bg-emerald-950/40 px-4 py-3 text-xs leading-5 text-emerald-200"><b>Resultado esperado:</b> {command.expected}</div>}</div>)}
                {section.checklist && section.checklist.length > 0 && <div className="rounded-xl border border-[#d8d7d2] bg-[#f8f9fa] p-4 dark:border-zinc-700 dark:bg-zinc-900"><b className="text-sm">Confira antes de continuar</b><ul className="mt-3 space-y-2 text-sm">{section.checklist.map((item) => <li key={item} className="flex gap-2"><span className="font-bold text-[#36c]">□</span>{item}</li>)}</ul></div>}
                {section.notes?.map((note) => { const config = NOTE_STYLE[note.type] ?? NOTE_STYLE.info; const NoteIcon = config.icon; return <div key={`${note.title}-${note.text}`} className={`flex gap-3 rounded-xl border p-4 text-sm leading-6 ${config.box}`}><NoteIcon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconColor}`} /><div><b className="block">{note.title}</b><span>{note.text}</span></div></div>; })}
                {section.links && section.links.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{section.links.map((link) => <ExternalButton key={link.href} href={link.href} label={link.label} description={link.description} />)}</div>}
              </section>
            ))}

            {related.length > 0 && <section className="border-t border-[#d8d7d2] pt-7 dark:border-zinc-700"><h2 className="font-serif text-2xl">Manuais relacionados</h2><div className="mt-4 grid gap-3 md:grid-cols-3">{related.map((item) => <button key={item.id} onClick={() => openArticle(item.slug)} className="rounded-xl border border-[#d8d7d2] bg-white p-4 text-left hover:border-[#36c] dark:border-zinc-700 dark:bg-zinc-900"><b className="block text-sm">{item.title}</b><span className="mt-1 block text-xs leading-5 text-[#54595d] dark:text-zinc-400">{item.summary}</span></button>)}</div></section>}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1380px] pb-14 text-[#202122] dark:text-zinc-200">
      <header className="rounded-2xl border border-[#d8d7d2] bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h1 className="font-serif text-[28px] font-normal tracking-tight text-[#101418] dark:text-white sm:text-[32px]">Central de ajuda</h1><p className="mt-1 max-w-2xl text-[13px] leading-5 text-[#54595d] dark:text-zinc-400">Instalação guiada em uma única página e conteúdos para consultas específicas.</p></div><label className="relative block w-full lg:w-[340px]"><span className="sr-only">Pesquisar assuntos</span><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#72777d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar um assunto" className="h-10 w-full rounded-lg border border-[#a2a9b1] bg-[#f8f9fa] pl-10 pr-3 text-sm outline-none transition focus:border-[#36c] focus:ring-2 focus:ring-[#36c]/15 dark:border-zinc-700 dark:bg-zinc-950" /></label></div></header>
      {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><XCircle className="h-5 w-5 shrink-0" />{error}</div>}

      {primaryGuide && <section className="mt-4 rounded-2xl border border-[#36c]/35 bg-[#f5f8ff] p-4 dark:bg-sky-950/25 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#36c] text-white"><PlayCircle className="h-5 w-5" /></span><div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#36c] dark:text-sky-400">Fluxo principal · {primaryGuide.estimated_minutes} min</div><h2 className="mt-0.5 text-lg font-bold leading-6 text-[#101418] dark:text-white">{primaryGuide.title}</h2><p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#54595d] dark:text-zinc-300">{primaryGuide.summary}</p><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[#72777d]"><span>WARP</span><ChevronRight className="h-3 w-3" /><span>VirtualHere</span><ChevronRight className="h-3 w-3" /><span>SafeSign</span><ChevronRight className="h-3 w-3" /><span>PJeOffice</span><ChevronRight className="h-3 w-3" /><span>PJe</span></div></div></div><button onClick={() => openArticle(primaryGuide.slug)} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#36c] px-4 text-sm font-bold text-white transition hover:bg-[#2a4b8d]">Iniciar instalação<ChevronRight className="h-4 w-4" /></button></div></section>}

      <section className="mt-9"><div><h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#54595d] dark:text-zinc-400">Pesquisar por assunto</h2><p className="mt-1 text-sm text-[#72777d]">Use estes tópicos para tirar dúvidas ou resolver uma etapa específica.</p></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{visibleCategories.map((category) => { const Icon = CATEGORY_ICONS[category.icon_key] ?? BookOpen; const count = referenceArticles.filter((item) => item.category_id === category.id).length; const active = selectedCategory === category.id; return <button key={category.id} onClick={() => setSelectedCategory(active ? 'all' : category.id)} className={`rounded-2xl border p-4 text-left transition ${active ? 'border-[#36c] bg-sky-50 ring-2 ring-[#36c]/10 dark:bg-sky-950/30' : 'border-[#d8d7d2] bg-white hover:-translate-y-0.5 hover:border-[#a2a9b1] hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900'}`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaecf0] text-[#36c] dark:bg-zinc-800 dark:text-sky-400"><Icon className="h-5 w-5" /></span><b className="mt-3 block text-sm">{category.name}</b><small className="mt-1 block text-xs text-[#72777d]">{count} {count === 1 ? 'tópico' : 'tópicos'}</small></button>; })}</div></section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d8d7d2] pb-3 dark:border-zinc-700"><div><h2 className="font-serif text-2xl">{selectedCategory === 'all' ? 'Conteúdos de consulta' : categoryById.get(selectedCategory)?.name}</h2><p className="mt-1 text-xs text-[#72777d]">{filteredArticles.length} resultado{filteredArticles.length === 1 ? '' : 's'}</p></div>{selectedCategory !== 'all' && <button onClick={() => setSelectedCategory('all')} className="text-sm font-semibold text-[#36c] hover:underline dark:text-sky-400">Ver todos os assuntos</button>}</div>
        {filteredArticles.length > 0 ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredArticles.map((item) => { const category = categoryById.get(item.category_id); const Icon = CATEGORY_ICONS[category?.icon_key ?? ''] ?? BookOpen; return <button key={item.id} onClick={() => openArticle(item.slug)} className="group flex min-h-[190px] flex-col rounded-2xl border border-[#d8d7d2] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#36c] hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-sky-600"><div className="flex items-start justify-between gap-3"><span className="inline-flex items-center gap-2 rounded-full bg-[#f1f0ec] px-2.5 py-1 text-[11px] font-semibold text-[#54595d] dark:bg-zinc-800 dark:text-zinc-300"><Icon className="h-3.5 w-3.5" />{category?.name}</span><ChevronRight className="h-5 w-5 text-[#a2a9b1] transition group-hover:translate-x-0.5 group-hover:text-[#36c]" /></div><h3 className="mt-4 text-[16px] font-bold leading-6 text-[#202122] group-hover:text-[#36c] dark:text-white dark:group-hover:text-sky-400">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-[#54595d] dark:text-zinc-400">{item.summary}</p><div className="mt-auto flex items-center gap-3 pt-4 text-[11px] text-[#72777d]"><span>{item.difficulty}</span><span>•</span><span>{item.estimated_minutes} min</span></div></button>; })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-[#a2a9b1] bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900"><HelpCircle className="mx-auto h-8 w-8 text-[#72777d]" /><h3 className="mt-3 font-semibold">Nenhum manual encontrado</h3><p className="mt-1 text-sm text-[#72777d]">Tente palavras como “WARP”, “Windows”, “Mac”, “SafeSign” ou “PJe”.</p></div>}
      </section>

      <footer className="mt-10 flex flex-col gap-4 rounded-2xl border border-[#d8d7d2] bg-[#f8f9fa] p-5 dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-white dark:bg-zinc-800"><Usb className="h-5 w-5 text-[#36c]" /></div><div><b className="block text-sm">Status do Token Bridge</b><span className="text-xs text-[#72777d]">Portal de apoio e disponibilidade</span></div></div><a href="https://token.jurius-api.com/" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#36c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2a4b8d]">Abrir portal do token<ExternalLink className="h-4 w-4" /></a></footer>
    </div>
  );
};

export default WikiModule;
