import { Injectable, computed, signal } from '@angular/core';
import { runtimeConfig } from './runtime-config';

export interface CustomerUser {
  id: string;
  email?: string;
}

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: CustomerUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = runtimeConfig();
  private readonly storageKey = 'excavision-customer-session';
  private refreshPromise: Promise<AuthSession> | null = null;
  readonly session = signal<AuthSession | null>(this.restoreSession());
  readonly signedIn = computed(() => Boolean(this.session()));

  get configured(): boolean {
    return Boolean(this.config.supabaseUrl && this.config.supabasePublishableKey);
  }

  async signIn(email: string, password: string): Promise<void> {
    this.assertConfigured();
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.publicHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const body = await this.readBody(response);
    if (!response.ok) throw new Error(String(body['msg'] || body['error_description'] || 'Sign in failed.'));
    this.saveSession(this.normalizeSession(body));
  }

  acceptInvitationFromUrl(): boolean {
    const values = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = values.get('access_token');
    const refreshToken = values.get('refresh_token');
    const expiresIn = Number(values.get('expires_in') || 3600);
    if (!accessToken || !refreshToken) return false;
    const user = this.userFromJwt(accessToken);
    if (!user) return false;
    this.saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user,
    });
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return true;
  }

  async setPassword(password: string): Promise<void> {
    const token = await this.accessToken();
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { ...this.publicHeaders(), Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
    const body = await this.readBody(response);
    if (!response.ok) throw new Error(String(body['msg'] || body['error_description'] || 'Could not set the password.'));
  }

  async accessToken(): Promise<string> {
    const current = this.session();
    if (!current) throw new Error('Sign in to continue.');
    if (current.expires_at > Math.floor(Date.now() / 1000) + 60) return current.access_token;
    return (await this.refreshSession()).access_token;
  }

  signOut(): void {
    const current = this.session();
    this.session.set(null);
    localStorage.removeItem(this.storageKey);
    if (current) {
      void fetch(`${this.config.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { ...this.publicHeaders(), Authorization: `Bearer ${current.access_token}` },
      });
    }
  }

  publicConfig(): { url: string; key: string } {
    this.assertConfigured();
    return { url: this.config.supabaseUrl, key: this.config.supabasePublishableKey };
  }

  private async refreshSession(): Promise<AuthSession> {
    if (this.refreshPromise) return this.refreshPromise;
    const current = this.session();
    if (!current) throw new Error('Sign in to continue.');
    this.refreshPromise = (async () => {
      const response = await fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: this.publicHeaders(),
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const body = await this.readBody(response);
      if (!response.ok) {
        this.signOut();
        throw new Error('Your session ended. Sign in again.');
      }
      const session = this.normalizeSession(body);
      this.saveSession(session);
      return session;
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private normalizeSession(body: Record<string, unknown>): AuthSession {
    const accessToken = String(body['access_token'] ?? '');
    const refreshToken = String(body['refresh_token'] ?? '');
    const expiresIn = Number(body['expires_in'] ?? 3600);
    const userBody = body['user'] as Record<string, unknown> | undefined;
    const user = userBody?.['id']
      ? { id: String(userBody['id']), email: String(userBody['email'] ?? '') }
      : this.userFromJwt(accessToken);
    if (!accessToken || !refreshToken || !user) throw new Error('Authentication returned an invalid session.');
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user,
    };
  }

  private userFromJwt(token: string): CustomerUser | null {
    try {
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as Record<string, unknown>;
      const id = String(payload['sub'] ?? '');
      return id ? { id, email: String(payload['email'] ?? '') } : null;
    } catch {
      return null;
    }
  }

  private restoreSession(): AuthSession | null {
    try {
      const value = localStorage.getItem(this.storageKey);
      if (!value) return null;
      const session = JSON.parse(value) as AuthSession;
      return session.access_token && session.refresh_token ? session : null;
    } catch {
      localStorage.removeItem(this.storageKey);
      return null;
    }
  }

  private saveSession(session: AuthSession): void {
    localStorage.setItem(this.storageKey, JSON.stringify(session));
    this.session.set(session);
  }

  private publicHeaders(): Record<string, string> {
    return { apikey: this.config.supabasePublishableKey, 'Content-Type': 'application/json' };
  }

  private assertConfigured(): void {
    if (!this.configured) throw new Error('Customer app configuration is missing.');
  }

  private async readBody(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
  }
}
