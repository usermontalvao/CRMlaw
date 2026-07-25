// Vite empacota o worker LOCALMENTE (emite como asset e devolve a URL final).
// Isso remove a dependência de rede do unpkg — o app carrega o worker do próprio
// domínio, sem quebrar quando o CDN externo estiver bloqueado/indisponível.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** URL final (com hash) do worker do PDF.js empacotado com o app. */
export const pdfWorkerUrl = workerUrl;

type PdfWorkerHost = { GlobalWorkerOptions: { workerSrc: string } };

/**
 * Aponta o worker do PDF.js para o bundle local (idempotente).
 * Recebe a MESMA instância de `pdfjs` que o chamador usa (ex.: a reexportada
 * pelo react-pdf) para garantir que API e worker sejam da mesma versão.
 */
export function setLocalPdfWorker(pdfjsInstance: PdfWorkerHost): void {
  if (pdfjsInstance.GlobalWorkerOptions.workerSrc === workerUrl) return;
  pdfjsInstance.GlobalWorkerOptions.workerSrc = workerUrl;
}
