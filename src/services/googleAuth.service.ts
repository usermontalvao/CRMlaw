/**
 * Serviço de autenticação Google OAuth para página de assinatura pública
 */

const GOOGLE_CLIENT_ID = '249483607462-bgh9hg63orddsjdai5tuicl5gd9p1jj0.apps.googleusercontent.com';

interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
  sub: string; // Google user ID
}

interface GoogleAuthResponse {
  credential: string;
  select_by: string;
}

class GoogleAuthService {
  private initialized = false;
  private googleUser: GoogleUser | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      // Carregar script do Google Identity Services
      if (document.getElementById('google-identity-script')) {
        this.initialized = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this.initialized = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Falha ao carregar Google Identity Services'));
      };
      document.head.appendChild(script);
    });
  }

  async signIn(buttonElement: HTMLElement): Promise<GoogleUser> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      try {
        // @ts-ignore - Google Identity Services global
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: GoogleAuthResponse) => {
            try {
              const user = this.decodeJwt(response.credential);
              this.googleUser = user;
              resolve(user);
            } catch (err) {
              reject(new Error('Erro ao processar resposta do Google'));
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Renderizar botão do Google
        // @ts-ignore
        google.accounts.id.renderButton(buttonElement, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 300,
        });

        // Também mostrar One Tap
        // @ts-ignore
        google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            console.log('Google One Tap não exibido:', notification.getNotDisplayedReason?.() || notification.getSkippedReason?.());
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Método alternativo usando popup OAuth
  async signInWithPopup(): Promise<GoogleUser> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin;
      const scope = 'email profile';
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=token&` +
        `scope=${encodeURIComponent(scope)}&` +
        `prompt=select_account`;

      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'google-auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error('Popup bloqueado pelo navegador'));
        return;
      }

      // Verificar se o popup foi fechado ou redirecionado
      const checkInterval = setInterval(async () => {
        try {
          if (popup.closed) {
            clearInterval(checkInterval);
            reject(new Error('Autenticação cancelada'));
            return;
          }

          // Verificar se voltou para nossa origem
          if (popup.location.origin === window.location.origin) {
            clearInterval(checkInterval);
            
            const hash = popup.location.hash;
            popup.close();

            if (hash) {
              const params = new URLSearchParams(hash.substring(1));
              const accessToken = params.get('access_token');
              
              if (accessToken) {
                // Buscar informações do usuário
                const userInfo = await this.getUserInfo(accessToken);
                this.googleUser = userInfo;
                resolve(userInfo);
              } else {
                reject(new Error('Token de acesso não encontrado'));
              }
            } else {
              reject(new Error('Resposta de autenticação inválida'));
            }
          }
        } catch (e) {
          // Cross-origin error - popup ainda está no Google
        }
      }, 500);

      // Timeout após 5 minutos
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!popup.closed) {
          popup.close();
        }
        reject(new Error('Tempo limite de autenticação excedido'));
      }, 5 * 60 * 1000);
    });
  }

  private async getUserInfo(accessToken: string): Promise<GoogleUser> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Erro ao obter informações do usuário');
    }

    const data = await response.json();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture,
      sub: data.sub,
    };
  }

  private decodeJwt(token: string): GoogleUser {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    return {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      sub: payload.sub,
    };
  }

  getUser(): GoogleUser | null {
    return this.googleUser;
  }

  signOut(): void {
    this.googleUser = null;
    // @ts-ignore
    if (typeof google !== 'undefined' && google.accounts?.id) {
      // @ts-ignore
      google.accounts.id.disableAutoSelect();
    }
  }

  isAuthenticated(): boolean {
    return this.googleUser !== null;
  }
}

export const googleAuthService = new GoogleAuthService();
export type { GoogleUser };
