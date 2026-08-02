import { useState } from 'react';
import { BirthDateRequiredGate, BirthdayMailToast } from '../components/BirthdayExperience';

/**
 * Harness visual (só em dev): ?birthdaypreview=gate | ?birthdaypreview=toast.
 * O vídeo tem link próprio — ?aniversarioanimado.
 */
export default function BirthdayPreview() {
  const initialMode = new URLSearchParams(window.location.search).get('birthdaypreview');
  const [mode, setMode] = useState<'gate' | 'toast'>(initialMode === 'toast' ? 'toast' : 'gate');

  return (
    <div className="min-h-screen bg-slate-100 p-8 dark:bg-slate-950">
      <div className="mx-auto flex max-w-xl gap-2">
        <button
          type="button"
          onClick={() => setMode('gate')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'gate' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}
        >
          Cadastro obrigatório
        </button>
        <button
          type="button"
          onClick={() => setMode('toast')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'toast' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}
        >
          Aviso de correspondência
        </button>
        <a
          href="?aniversarioanimado=1"
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Vídeo animado →
        </a>
      </div>

      {mode === 'gate' ? (
        <BirthDateRequiredGate
          personName="Pedro Rodrigues"
          onSave={async () => setMode('toast')}
          onSignOut={async () => undefined}
        />
      ) : (
        <BirthdayMailToast
          personName="Pedro Rodrigues"
          onOpen={() => {
            window.location.search = '?aniversarioanimado=1';
          }}
          onDismiss={() => setMode('gate')}
        />
      )}
    </div>
  );
}
