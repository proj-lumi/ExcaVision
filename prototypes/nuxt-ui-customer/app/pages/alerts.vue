<script setup lang="ts">
import { statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Alerts' })

const { data, acknowledgeAlert } = useMockStore()
const filter = ref('All alerts')
const filters = ['All alerts', 'Unseen', 'Early Advisory', 'Threshold Warning']
const filtered = computed(() => data.value.customerAlerts.filter(alert => {
  if (filter.value === 'Unseen') return !alert.acknowledged
  if (filter.value === 'All alerts') return true
  return alert.kind === filter.value
}))
</script>

<template>
  <div class="grid gap-4">
    <div class="page-heading">
      <div><p class="text-sm text-muted">Site events</p><h1 class="text-2xl font-semibold">Alerts</h1></div>
      <USelect v-model="filter" :items="filters" />
    </div>

    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" title="Two separate warning paths" description="Early Advisories come from AI analysis. Threshold Warnings come directly from the configured movement limit." />

    <section class="alert-list">
      <UCard v-for="alert in filtered" :key="alert.id">
        <div class="alert-row">
          <div class="alert-main">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor(alert.kind)" variant="subtle">{{ alert.kind }}</UBadge>
              <UBadge v-if="alert.acknowledged" color="neutral" variant="outline">Seen</UBadge>
            </div>
            <h3 class="mt-3">{{ alert.detail }}</h3>
            <p>{{ alert.unit }} · {{ alert.value.toFixed(2) }}° · {{ alert.time }}</p>
          </div>
          <UButton v-if="!alert.acknowledged" color="neutral" variant="outline" label="Acknowledge" @click="acknowledgeAlert(alert.id)" />
        </div>
      </UCard>
      <UCard v-if="!filtered.length"><UEmpty icon="i-lucide-bell-off" title="No matching alerts" /></UCard>
    </section>
  </div>
</template>
