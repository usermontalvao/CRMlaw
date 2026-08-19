// DEV-ONLY: bancada do discador (?dialerpreview=1).
//
// Existe porque o discador vive em dois lugares que a tela de login esconde: o
// botão dentro da pill da pesquisa (barra do topo) e a janela flutuante. Sem
// esta bancada, conferir uma mudança de espaçamento no botão exigia entrar no
// CRM com uma sessão de verdade — e o estado que mais importa conferir, o de
// "linha indisponível", é justamente o que não se consegue provocar de dentro.
//
// A barra aqui é uma RÉPLICA da barra real (mesmas medidas e mesmas cores do
// `App.tsx`), não a barra real: montar o app inteiro traria autenticação,
// permissões e roteamento junto, que é tudo o que a bancada quer evitar.
import React, { useEffect, useState } from 'react';
import { Bell, CheckSquare, Menu, Moon, Scale, Search } from 'lucide-react';
import { DialerLauncher } from '../components/whatsapp/DialerLauncher';
import { DialerWindow } from '../components/whatsapp/DialerWindow';
import { dialerStore } from '../services/wacalls/dialerStore';
import { formatDialed, readDial } from '../services/wacalls/dialerInput';
import { primeDialPermissionForPreview } from '../services/wacalls/dialPermissionData';
import { waCallsStore } from '../services/wacalls/callStore';
import type { CallLine } from '../services/wacalls/callLine';

const NUMEROS_DEMO = ['65996128787', '6530254410', '65996', 'montal'];

/**
 * As situações de LINHA que valem a pena olhar — e que a inbox real não deixa
 * provocar, porque dependem de contas pareadas no serviço de voz e de cadastro
 * de membro no canal.
 */
const linha = (over: Partial<CallLine> & { label: string; phone: string }): CallLine => ({
  key: over.key || over.channelId || over.sessionId || over.label,
  sessionId: null, channelId: null, online: true, authorized: true, block: null, ...over,
});

const CENARIOS: Array<{ chave: string; titulo: string; nota: string; linhas: CallLine[] }> = [
  {
    chave: 'uma',
    titulo: 'Uma linha',
    nota: 'O escritório hoje: dois canais, um só com voz. A lista mostra os dois — e o Comercial aparece dizendo que ainda não tem conta pareada.',
    linhas: [
      linha({ sessionId: 'default', channelId: 'c1', label: 'Pedro', phone: '5565984046375' }),
      linha({ channelId: 'c2', label: 'Comercial', phone: '5565992797030', online: false, block: 'no-voice' }),
    ],
  },
  {
    chave: 'duas',
    titulo: 'Duas linhas autorizadas',
    nota: 'Os dois canais com voz: a lista deixa escolher de verdade. É o que acontece no dia em que a segunda conta for pareada.',
    linhas: [
      linha({ sessionId: 'comercial', channelId: 'c2', label: 'Comercial', phone: '5565992797030' }),
      linha({ sessionId: 'pedro', channelId: 'c1', label: 'Pedro', phone: '5565984046375' }),
    ],
  },
  {
    chave: 'restrita',
    titulo: 'Linha restrita a outros',
    nota: 'A única conta pareada é de um canal restrito do qual esta pessoa não é membro: o discador abre, diz o motivo e o botão verde não liga.',
    linhas: [
      linha({
        sessionId: 'pedro', channelId: 'c1', label: 'Pedro', phone: '5565984046375',
        authorized: false, block: 'not-member',
      }),
    ],
  },
  {
    chave: 'semvoz',
    titulo: 'Serviço de voz fora',
    nota: 'Nenhuma conta pareada respondendo. A faixa continua nomeando o canal e dizendo o que falta — era aqui que ela caía num “Linha do escritório” sem número.',
    linhas: [
      linha({ channelId: 'c1', label: 'Pedro', phone: '5565984046375', online: false, block: 'no-voice' }),
      linha({ channelId: 'c2', label: 'Comercial', phone: '5565992797030', online: false, block: 'no-voice' }),
    ],
  },
];

const DialerPreview: React.FC = () => {
  const [cenario, setCenario] = useState(CENARIOS[0]);

  // A bancada existe para olhar o discador SEM sessão. Sem estas duas portas
  // ela veria o que um estranho vê: nada, porque o discador agora pede
  // permissão (ver `dialPermission.ts`).
  useEffect(() => { primeDialPermissionForPreview('allowed', false); }, []);
  useEffect(() => { waCallsStore.primeLinesForPreview(cenario.linhas); }, [cenario]);

  return (
  <div className="min-h-screen bg-[#f5f5f3]">
    {/* ── réplica da barra do topo ── */}
    <header className="sticky top-0 z-30 border-b border-[#e7e5df] bg-[#f8f7f5] shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="px-4 lg:px-6">
        <div className="flex h-[62px] items-center gap-4">
          <div className="flex w-[190px] flex-none items-center gap-3">
            <Menu className="h-5 w-5 text-slate-600 md:hidden" />
            <div className="hidden min-w-0 select-none items-center gap-2 md:flex">
              <Scale className="h-[15px] w-[15px] flex-shrink-0 text-slate-400" />
              <span className="truncate text-[13.5px] font-semibold text-slate-700">Processos</span>
            </div>
          </div>

          <div className="hidden flex-1 justify-center md:flex">
            <div className="group flex w-full max-w-[420px] items-center rounded-xl border border-[#e7e5df] bg-[#f7f6f3] pl-4 pr-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition hover:border-[#d4d2cc] hover:bg-[#f2f1ee]">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-[13px] text-slate-400 transition group-hover:text-slate-600"
              >
                <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <span className="flex-1 truncate text-left">Pesquisa global...</span>
                <span className="rounded-md border border-[#e0ddd8] bg-white px-1.5 py-0.5 text-[11px] text-slate-400 shadow-sm">⌘K</span>
              </button>
              <span aria-hidden className="mx-1.5 h-4 w-px flex-shrink-0 bg-[#e0ddd8]" />
              <DialerLauncher />
            </div>
          </div>

          <div className="flex flex-none items-center gap-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500"><CheckSquare className="h-[18px] w-[18px]" /></span>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500"><Bell className="h-[18px] w-[18px]" /></span>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500"><Moon className="h-[18px] w-[18px]" /></span>
            <div className="ml-1.5 flex items-center gap-3 border-l border-[#e7e5df] pl-3.5">
              <div className="hidden w-[190px] text-right leading-tight lg:block">
                <p className="truncate text-[14.5px] font-semibold text-slate-900">Pedro Montalvão</p>
                <p className="truncate text-[12px] text-slate-500">Advogado · sócio</p>
              </div>
              <div className="h-11 w-11 rounded-full border border-amber-500 bg-amber-100 shadow-md" />
            </div>
          </div>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Bancada do discador</h1>
      <p className="mt-2 max-w-[62ch] text-[14.5px] leading-relaxed text-slate-600">
        O botão fica na pill acima, depois do fio. Abra com <b>⌘⇧L</b> (ou Ctrl+Shift+L), arraste
        pela tarja de cima, minimize no <b>—</b> e confira que esta página continua clicável com a
        janela de pé — é a diferença entre janela e modal.
      </p>

      {/* As três situações de linha. */}
      <div className="mt-6 flex flex-wrap gap-2">
        {CENARIOS.map(c => (
          <button
            key={c.chave}
            type="button"
            onClick={() => setCenario(c)}
            className={`rounded-lg border px-3 py-2 text-[13px] font-medium shadow-sm transition ${
              c.chave === cenario.chave
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-[#e7e5df] bg-white text-slate-700 hover:border-emerald-300'
            }`}
          >
            {c.titulo}
          </button>
        ))}
      </div>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-slate-500">{cenario.nota}</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {NUMEROS_DEMO.map(valor => (
          <button
            key={valor}
            type="button"
            onClick={() => dialerStore.open({ phone: valor, label: 'Bancada' })}
            className="rounded-lg border border-[#e7e5df] bg-white px-3 py-2 text-[13px] font-medium text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
          >
            Abrir com “{valor}”
          </button>
        ))}
        <button
          type="button"
          onClick={() => dialerStore.close()}
          className="rounded-lg border border-[#e7e5df] bg-white px-3 py-2 text-[13px] font-medium text-slate-500 shadow-sm"
        >
          Fechar
        </button>
      </div>

      {/* O módulo puro por trás do campo, respondendo ao vivo: é o que separa
          "o campo está bonito" de "o campo está certo". */}
      <div className="mt-8 overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
        <p className="border-b border-[#e7e5df] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
          O que <code>dialerInput</code> responde
        </p>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-2 font-semibold">Digitado</th>
              <th className="px-5 py-2 font-semibold">Na tela</th>
              <th className="px-5 py-2 font-semibold">Disca</th>
              <th className="px-5 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0eee9]">
            {['6', '659', '65996', '65996128787', '+55 65 99612-8787', '6530254410', 'montal'].map(v => {
              const estado = readDial(v);
              return (
                <tr key={v}>
                  <td className="px-5 py-2 font-mono text-slate-700">{v}</td>
                  <td className="px-5 py-2 tabular-nums text-slate-900">{estado.text}</td>
                  <td className="px-5 py-2 font-mono text-slate-500">{estado.phone || '—'}</td>
                  <td className="px-5 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      estado.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {estado.ready ? 'pronto' : estado.block}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-[12.5px] text-slate-400">
        Sem sessão, a agenda e o histórico voltam vazios e a linha aparece como indisponível — que é
        exatamente o estado que a inbox real não deixa provocar. Exemplo de máscara:{' '}
        <span className="tabular-nums">{formatDialed('65996128787')}</span>.
      </p>
    </main>

    <DialerWindow />
  </div>
  );
};

export default DialerPreview;
