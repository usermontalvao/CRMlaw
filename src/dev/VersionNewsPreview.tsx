import React from 'react';

import VersionNewsPanel from '../components/VersionNewsPanel';

/**
 * BANCADA DO AVISO DE VERSÃO (`?novidadespreview=1`).
 *
 * O painel de "o que mudou" só aparece em produção, uma vez por versão — o que
 * é exatamente o que se quer no CRM e exatamente o que impede de conferi-lo. A
 * bancada monta o painel sobre uma tela falsa e usa o mesmo modo de ensaio do
 * componente (`?novidades=…`), que não grava marca nenhuma.
 *
 * Os botões abaixo trocam desde qual versão o aviso deve contar a história:
 * é assim que se vê uma versão só, o empilhamento de várias e o teto de dez.
 */

const CENARIOS: Array<{ label: string; since: string; nota: string }> = [
  { label: '1 versão', since: '1.10.337', nota: 'o deploy comum, um commit' },
  { label: '3 versões', since: '1.10.335', nota: 'um push com três commits' },
  { label: '12 versões', since: '1.10.326', nota: 'passou da conta: teto de 10' },
];

const VersionNewsPreview: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const atual = params.get('novidades') || '';
  // A bancada não tem o ThemeProvider do CRM: `&tema=escuro` liga o modo escuro
  // do mesmo jeito que o app liga, pela classe no <html>.
  const escuro = params.get('tema') === 'escuro';
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
  }, [escuro]);

  const irPara = (since: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('novidadespreview', '1');
    params.set('novidades', since);
    window.location.search = params.toString();
  };

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Bancada — aviso de versão</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          O painel abre sozinho à direita. Escolha desde qual versão ele deve contar o que mudou.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {CENARIOS.map((cenario) => (
            <button
              key={cenario.since}
              type="button"
              onClick={() => irPara(cenario.since)}
              className={`rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                atual === cenario.since
                  ? 'bg-orange-600 text-white'
                  : 'bg-white text-zinc-700 ring-1 ring-[#e7e5df] hover:bg-zinc-50'
              }`}
            >
              {cenario.label}
              <span className="ml-2 font-normal opacity-70">{cenario.nota}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl bg-white p-5 ring-1 ring-black/[0.04] dark:bg-zinc-900 dark:ring-white/[0.06]">
              <div className="h-2.5 w-40 rounded bg-zinc-200" />
              <div className="mt-3 h-2 w-full rounded bg-zinc-100" />
              <div className="mt-2 h-2 w-2/3 rounded bg-zinc-100" />
            </div>
          ))}
        </div>
      </div>

      <VersionNewsPanel enabled userId="bancada" />
    </div>
  );
};

export default VersionNewsPreview;
