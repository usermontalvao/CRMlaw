import type { SVGProps } from 'react';

/**
 * Marca vetorial do Nextcloud usada na navegação e dentro do explorador.
 * Mantém identidade própria sem reutilizar o ícone genérico do módulo Cloud.
 */
export function NextcloudIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 24"
      role="img"
      aria-label="Nextcloud"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 12h4M29 12h4" />
      <circle cx="9" cy="12" r="5.2" />
      <circle cx="24" cy="12" r="7" />
      <circle cx="39" cy="12" r="5.2" />
    </svg>
  );
}

export default NextcloudIcon;
