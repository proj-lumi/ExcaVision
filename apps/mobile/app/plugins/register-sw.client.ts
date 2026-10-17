export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'excavision-push-subscription-changed') {
      window.dispatchEvent(new Event('excavision-push-subscription-changed'))
    }
  })
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }))
})
