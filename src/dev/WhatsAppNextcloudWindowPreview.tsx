// DEV-ONLY: bancada da janela de arquivos do cliente (?wanextcloudpreview=1).
//
// Serve para olhar a janela — bloco x lista, seleção múltipla, prévia em janela
// própria, arrasto — sem servidor Nextcloud, sem cliente cadastrado e sem
// login. Os dublês substituem os métodos do `nextcloudService` em memória; nada
// disto entra no pacote de produção (o bloco em `main.tsx` é `isDev`).
import React, { useState } from 'react';
import { ToastProvider } from '../contexts/ToastContext';
import { nextcloudService, type NextcloudEntry } from '../services/nextcloud.service';
import { NextcloudClientWindow } from '../components/whatsapp/nextcloudClientWindow';

const CLIENTE = 'cliente-de-mentira';
const iso = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

const dir = (path: string): NextcloudEntry => ({
  name: path.split('/').pop()!, path, isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(1),
});
const arq = (path: string, size: number, mime: string, dias = 2): NextcloudEntry => ({
  name: path.split('/').pop()!, path, isDir: false, size, mime, mtime: iso(dias),
});

const ARVORE: Record<string, NextcloudEntry[]> = {
  'Clientes/Isabel Maria': [
    dir('Clientes/Isabel Maria/INSS'),
    dir('Clientes/Isabel Maria/Pessoais'),
    arq('Clientes/Isabel Maria/Procuração assinada.pdf', 240_000, 'application/pdf'),
    arq('Clientes/Isabel Maria/Contrato de honorários.docx', 96_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    arq('Clientes/Isabel Maria/RG frente.jpg', 820_000, 'image/jpeg'),
    arq('Clientes/Isabel Maria/Comprovante de residência.pdf', 310_000, 'application/pdf'),
    arq('Clientes/Isabel Maria/Anotações.txt', 1_800, 'text/plain'),
  ],
  'Clientes/Isabel Maria/INSS': [
    arq('Clientes/Isabel Maria/INSS/CNIS.pdf', 1_200_000, 'application/pdf'),
    arq('Clientes/Isabel Maria/INSS/Carta de indeferimento.pdf', 480_000, 'application/pdf'),
  ],
  'Clientes/Isabel Maria/Pessoais': [
    arq('Clientes/Isabel Maria/Pessoais/Certidão de nascimento.pdf', 210_000, 'application/pdf'),
  ],
  'Processos/0001234-56.2026 — Isabel': [
    arq('Processos/0001234-56.2026 — Isabel/Petição inicial.docx', 140_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    arq('Processos/0001234-56.2026 — Isabel/Sentença.pdf', 520_000, 'application/pdf'),
  ],
};

/** Substitui os métodos usados pela janela. Só nesta bancada. */
function instalarDubles() {
  const servico = nextcloudService as unknown as Record<string, unknown>;
  servico.getFolderLinks = async () => ({
    'Clientes/Isabel Maria': CLIENTE,
    'Processos/0001234-56.2026 — Isabel': CLIENTE,
    'Clientes/Outro qualquer': 'outro-cliente',
  });
  servico.list = async (path: string) => ARVORE[path] ?? [];
  servico.search = async (query: string, path: string) =>
    Object.values(ARVORE).flat()
      .filter(e => e.path.startsWith(path) && e.name.toLowerCase().includes(query.toLowerCase()));
  servico.readFile = async (path: string) => (
    path.endsWith('.txt')
      ? new Blob(['Cliente ligou pedindo o andamento.\nRetornar na quinta.'], { type: 'text/plain' })
      : new Blob([new Uint8Array(8)], { type: 'application/octet-stream' })
  );
  servico.writeFileWithProgress = async (
    _path: string,
    _blob: Blob,
    opts: { onProgress?: (l: number, t: number) => void } = {},
  ) => {
    opts.onProgress?.(50, 100);
    opts.onProgress?.(100, 100);
    return { ok: true, etag: null };
  };
}

instalarDubles();

const WhatsAppNextcloudWindowPreview: React.FC = () => {
  const [aberta, setAberta] = useState(true);
  const [enviados, setEnviados] = useState<string[]>([]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#efeae2] p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · UI</p>
        <h1 className="mt-1 text-[22px] font-bold text-slate-800">Arquivos do cliente (Nextcloud)</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-slate-500">
          Bancada da janela flutuante. Dados de mentira: duas pastas vinculadas, subpastas,
          PDF, docx, imagem e texto. Arraste pelo título, redimensione pelo canto,
          marque vários e mande na "conversa".
        </p>

        <div className="mt-4 flex gap-2">
          <button onClick={() => setAberta(true)} disabled={aberta}
            className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40">
            Abrir a janela
          </button>
          <button onClick={() => setEnviados([])}
            className="rounded-lg border border-[#e2e0d9] bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-600">
            Limpar o que foi "enviado"
          </button>
        </div>

        {enviados.length > 0 && (
          <ul className="mt-4 max-w-md space-y-1 rounded-xl border border-[#e7e5df] bg-white p-3">
            {enviados.map((n, i) => (
              <li key={`${n}-${i}`} className="text-[12.5px] text-slate-600">→ {n}</li>
            ))}
          </ul>
        )}

        {aberta && (
          <NextcloudClientWindow
            clientId={CLIENTE}
            clientName="Isabel Maria"
            onClose={() => setAberta(false)}
            onSendToConversation={files => setEnviados(prev => [...prev, ...files.map(f => f.name)])}
          />
        )}
      </div>
    </ToastProvider>
  );
};

export default WhatsAppNextcloudWindowPreview;
