<script setup lang="ts">
definePageMeta({ layout: 'admin', title: 'Overview' })
useSeoMeta({ title: 'Admin overview' })

const { data } = useMockStore()
const openRequests = computed(() => data.value.requests.filter(request => request.status !== 'completed'))
const fieldWork = computed(() => data.value.installations.filter(unit => ['Field ready', 'Commissioning'].includes(unit.stage)))
const availableNodes = computed(() => data.value.inventory.filter(node => node.state === 'Available'))
const attention = computed(() => [
  ...data.value.requests.filter(request => request.status === 'intake').map(request => ({ label: request.site, detail: 'Installation intake needs review', to: '/admin/requests' })),
  ...data.value.inventory.filter(node => node.state === 'Needs inspection').map(node => ({ label: node.serial, detail: 'Hardware needs inspection', to: '/admin/inventory' }))
])
</script>

<template>
  <div class="admin-page">
    <div class="page-heading">
      <div><h1 class="text-2xl font-semibold">Operations at a glance</h1><p>Start with work that is blocked or waiting for staff.</p></div>
      <UButton to="/admin/requests" icon="i-lucide-inbox" label="Open work queue" />
    </div>

    <section class="metric-grid" aria-label="Operational totals">
      <UCard><span class="text-sm text-muted">Open requests</span><strong class="metric-value">{{ openRequests.length }}</strong></UCard>
      <UCard><span class="text-sm text-muted">Field work</span><strong class="metric-value">{{ fieldWork.length }}</strong></UCard>
      <UCard><span class="text-sm text-muted">Active units</span><strong class="metric-value">{{ data.installations.filter(unit => unit.stage === 'Active').length }}</strong></UCard>
      <UCard><span class="text-sm text-muted">Available nodes</span><strong class="metric-value">{{ availableNodes.length }}</strong></UCard>
    </section>

    <section class="split-grid">
      <UCard>
        <template #header><div><h2 class="font-semibold">Needs attention</h2><p class="muted-copy">Items that cannot move without a decision.</p></div></template>
        <div class="record-list">
          <div v-for="item in attention" :key="item.label" class="record-row">
            <div class="record-main"><h3>{{ item.label }}</h3><p>{{ item.detail }}</p></div>
            <UButton :to="item.to" color="neutral" variant="outline" label="Review" />
          </div>
          <UAlert v-if="!attention.length" color="success" variant="subtle" title="Nothing is blocked" description="All current records have a clear next step." />
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-semibold">Installation progress</h2></template>
        <div class="grid gap-4">
          <div v-for="unit in data.installations.filter(item => item.stage !== 'Active')" :key="unit.id">
            <div class="stat-line"><span>{{ unit.name }}</span><span>{{ unit.assignedNodes }}/{{ unit.plannedNodes }} nodes</span></div>
            <UProgress class="mt-2" :model-value="(unit.assignedNodes / unit.plannedNodes) * 100" />
          </div>
        </div>
        <template #footer><UButton to="/admin/installations" color="neutral" variant="ghost" block label="View installations" /></template>
      </UCard>
    </section>
  </div>
</template>
