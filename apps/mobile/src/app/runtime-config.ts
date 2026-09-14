export interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

declare global {
  interface Window {
    EXCAVISION_CONFIG?: Partial<RuntimeConfig>;
  }
}

export function runtimeConfig(): RuntimeConfig {
  return {
    supabaseUrl: (window.EXCAVISION_CONFIG?.supabaseUrl ?? '').replace(/\/$/, ''),
    supabasePublishableKey: window.EXCAVISION_CONFIG?.supabasePublishableKey ?? '',
  };
}
