<script setup lang="ts">
useSeoMeta({ title: 'Choose prototype' })
</script>

<template>
  <main class="prototype-choice">
    <div class="grid w-full max-w-3xl gap-6">
      <div class="text-center">
        <UBadge color="neutral" variant="subtle">Frontend-only comparison</UBadge>
        <h1 class="mt-3 text-3xl font-semibold">ExcaVision UI prototype</h1>
        <p class="mt-2 text-muted">Choose a surface. Both use the same local JSON and Nuxt UI components.</p>
      </div>
      <div class="prototype-choice-grid">
        <UCard>
          <template #header>
            <div class="flex items-center gap-3"><UIcon name="i-lucide-layout-dashboard" class="size-6" /><strong>Staff Admin</strong></div>
          </template>
          <p class="text-sm text-muted">Requests, sites, installations, commissioning, and hardware inventory.</p>
          <template #footer><UButton to="/admin" block label="Open Admin" trailing-icon="i-lucide-arrow-right" /></template>
        </UCard>
        <UCard>
          <template #header>
            <div class="flex items-center gap-3"><UIcon name="i-lucide-smartphone" class="size-6" /><strong>Customer PWA</strong></div>
          </template>
          <p class="text-sm text-muted">Current movement, advisories, threshold settings, and service requests.</p>
          <template #footer><UButton to="/app" block label="Open Customer PWA" trailing-icon="i-lucide-arrow-right" /></template>
        </UCard>
      </div>
    </div>
  </main>
</template>
