export default defineNuxtConfig({
  modules: ["@nuxt/ui", "@nuxtjs/supabase"],
  icon: {
    clientBundle: {
      // Cloudflare Pages has no icon API fallback. Bundle static UI icons and
      // the status badges selected dynamically in AdminStatusBadge.vue.
      scan: true,
      icons: [
        "lucide:circle-dot", "lucide:circle-check", "lucide:shield-alert",
        "lucide:user-round-x", "lucide:mail-check", "lucide:badge-check",
        "lucide:clock-3", "lucide:archive", "lucide:circle-dashed",
        "lucide:circle-x",
      ],
    },
  },
  // Cloudflare Pages build target. `nuxt dev` is unaffected.
  nitro: { preset: "cloudflare_pages" },
  supabase: {
    redirect: true,
    cookiePrefix: "sb-excavision-admin",
    cookieOptions: { secure: !import.meta.dev },
  },
  css: ["~/assets/css/main.css"],
  devtools: { enabled: import.meta.dev },
  app: {
    head: {
      titleTemplate: "%s · ExcaVision Admin",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "theme-color", content: "#12161A" },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    },
  },
  colorMode: { preference: "dark", fallback: "dark", classSuffix: "" },
  runtimeConfig: {
    // Mobile app origin + /invite, where customer invite links point. Override with NUXT_INVITE_REDIRECT_URL.
    inviteRedirectUrl: "",
    public: {
      // Local Auth email is captured here instead of being delivered to a real inbox.
      localMailpitUrl: import.meta.dev ? "http://127.0.0.1:54324" : "",
    },
  },
  compatibilityDate: "2026-09-14",
});
