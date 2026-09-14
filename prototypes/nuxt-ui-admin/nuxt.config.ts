export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  app: {
    head: {
      titleTemplate: '%s · ExcaVision Admin prototype',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  },
  colorMode: { preference: 'light', fallback: 'light', classSuffix: '' },
  compatibilityDate: '2026-09-14'
})
