<script setup lang="ts">
const route = useRoute()
const {
  load,
  backgroundRefresh,
  data,
  refreshLiveness,
  startRealtime,
  stopRealtime
} = useCustomerStore()
const preferences = useAccessibilityPreferences()
let refreshTimer: number | undefined
let livenessTimer: number | undefined
const isOnline = ref(true)

const links = [
  { label: 'Overview', icon: 'i-lucide-house', to: '/' },
  { label: 'Units', icon: 'i-lucide-layers-3', to: '/units' },
  { label: 'Trends', icon: 'i-lucide-chart-line', to: '/trends' },
  { label: 'Alerts', icon: 'i-lucide-bell', to: '/alerts' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
]

function isLinkActive(to: string) {
  return route.path === to || (to === '/units' && route.path.startsWith('/unit/'))
}

function updateConnectionStatus() {
  isOnline.value = navigator.onLine
}

function refreshIfVisible() {
  if (document.visibilityState === 'visible') void backgroundRefresh()
}

onMounted(async () => {
  await load()
  startRealtime()
  refreshLiveness()
  updateConnectionStatus()
  refreshTimer = window.setInterval(refreshIfVisible, 15_000)
  livenessTimer = window.setInterval(refreshLiveness, 5_000)
  window.addEventListener('online', updateConnectionStatus)
  window.addEventListener('offline', updateConnectionStatus)
  document.addEventListener('visibilitychange', refreshIfVisible)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (livenessTimer) window.clearInterval(livenessTimer)
  void stopRealtime()
  window.removeEventListener('online', updateConnectionStatus)
  window.removeEventListener('offline', updateConnectionStatus)
  document.removeEventListener('visibilitychange', refreshIfVisible)
})
</script>

<template>
  <div
    class="min-h-dvh min-w-80 overflow-x-clip bg-default pb-[calc(5rem+env(safe-area-inset-bottom))]"
    :class="preferences.reduce_motion ? '[&_*]:animate-none [&_*]:transition-none' : ''"
  >
    <header class="sticky top-0 z-20 border-b border-default bg-default/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <UContainer class="flex min-h-16 items-center">
        <NuxtLink to="/" class="flex items-center gap-2 text-highlighted no-underline">
          <img src="/logo.svg" alt="" width="32" height="32" class="size-8" />
          <strong class="text-base font-semibold tracking-[-0.03em]">ExcaVision</strong>
        </NuxtLink>
        <NuxtLink to="/settings" class="ml-auto flex min-w-0 items-center gap-2 text-highlighted no-underline hover:text-primary">
          <UIcon name="i-lucide-user-round" class="size-5 shrink-0 text-primary" />
          <span class="max-w-[45vw] truncate text-sm font-medium sm:max-w-72 lg:max-w-96">{{ data?.profile?.full_name ?? 'Account' }}</span>
        </NuxtLink>
      </UContainer>
    </header>

    <UContainer v-if="!isOnline" class="pt-4">
      <UAlert color="warning" variant="subtle" icon="i-lucide-cloud-off" title="No internet connection · Readings may be outdated" />
    </UContainer>

    <UContainer class="grid min-w-0 gap-4 py-4 sm:py-6">
      <slot />
    </UContainer>

    <nav
      class="fixed bottom-0 left-0 z-30 w-screen border-t border-default bg-default px-[max(0.75rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)]"
      aria-label="Customer navigation"
    >
      <div class="mx-auto grid max-w-2xl grid-cols-5 gap-1 py-2">
        <UButton
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :icon="link.icon"
          :label="link.label"
          color="neutral"
          :variant="isLinkActive(link.to) ? 'soft' : 'ghost'"
          class="min-h-14 flex-col justify-center gap-0.5 rounded-lg text-xs hover:bg-primary/10 hover:text-primary"
          :class="isLinkActive(link.to) ? 'text-primary' : 'text-muted'"
        />
      </div>
    </nav>
  </div>
</template>
