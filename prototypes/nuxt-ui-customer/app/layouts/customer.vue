<script setup lang="ts">
const links = [
  { label: 'Overview', icon: 'i-lucide-house', to: '/' },
  { label: 'Alerts', icon: 'i-lucide-bell', to: '/alerts' },
  { label: 'Service', icon: 'i-lucide-wrench', to: '/service' }
]
</script>

<template>
  <div class="customer-shell">
    <header class="customer-header">
      <UContainer class="customer-header-inner">
        <div>
          <strong>ExcaVision</strong>
          <p class="m-0 text-xs text-muted">Rest & Relax Guesthouse</p>
        </div>
        <UButton color="neutral" variant="ghost" icon="i-lucide-log-out" label="Sign out" />
      </UContainer>
    </header>

    <UContainer class="customer-content">
      <slot />
    </UContainer>

    <nav class="customer-bottom-nav" aria-label="Customer navigation">
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to">
        <UIcon :name="link.icon" class="size-5" />
        <span>{{ link.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
