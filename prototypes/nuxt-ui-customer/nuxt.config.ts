export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  app: {
    head: {
      titleTemplate: '%s · ExcaVision Customer prototype',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#ffffff' }
      ],
      link: [{ rel: 'manifest', href: '/manifest.webmanifest' }]
    }
  },
  colorMode: { preference: 'light', fallback: 'light', classSuffix: '' },
  compatibilityDate: '2026-09-14'
})
