const buildEnv = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@nuxtjs/supabase"],
  icon: {
    clientBundle: {
      // Cloudflare Pages has no icon API fallback. Bundle literal icons and
      // the status icons returned dynamically by presentation.ts.
      scan: true,
      icons: [
        "lucide:heart-pulse", "lucide:heart-crack", "lucide:gauge",
        "lucide:triangle-alert", "lucide:octagon-alert", "lucide:database-zap",
        "lucide:circle-help", "lucide:user-round",
      ],
    },
  },
  // Cloudflare Pages build target. `nuxt dev` is unaffected.
  nitro: { preset: "cloudflare_pages" },
  supabase: {
    redirect: true,
    cookiePrefix: "sb-excavision-mobile",
    redirectOptions: { login: "/login", callback: "/confirm", exclude: ["/invite", "/forgot-password", "/reset-password"] },
    cookieOptions: { secure: !import.meta.dev },
  },
  css: ["~/assets/css/main.css"],
  devtools: { enabled: import.meta.dev },
  app: {
    head: {
      titleTemplate: "%s · ExcaVision",
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "theme-color", content: "#12161a" },
      ],
      link: [
        { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
        { rel: "icon", href: "/icon-32.png", sizes: "32x32", type: "image/png" },
        { rel: "apple-touch-icon", href: "/icon-192.png", sizes: "192x192" },
        { rel: "manifest", href: "/manifest.webmanifest" },
      ],
    },
  },
  colorMode: { preference: "dark", fallback: "dark", classSuffix: "" },
  runtimeConfig: {
    public: {
      landingUrl: buildEnv.NUXT_PUBLIC_LANDING_URL ?? "",
      vapidKey: buildEnv.NUXT_PUBLIC_VAPID_KEY ?? "",
    },
  },
  compatibilityDate: "2026-09-14",
});
