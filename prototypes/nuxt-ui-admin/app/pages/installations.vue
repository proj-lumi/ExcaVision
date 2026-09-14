<script setup lang="ts">
import { statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'admin', title: 'Installations' })
useSeoMeta({ title: 'Installations' })

const { data, advanceInstallation, assignNextNode } = useMockStore()
const search = ref('')
const stage = ref('All stages')
const stages = ['All stages', 'Planning', 'Field ready', 'Commissioning', 'Active']
const filtered = computed(() => data.value.installations.filter(unit => {
  const key = `${unit.name} ${unit.site}`.toLowerCase()
  return (stage.value === 'All stages' || unit.stage === stage.value) && key.includes(search.value.toLowerCase())
}))

function actionLabel(value: string) {
  return ({ Planning: 'Mark field-ready', 'Field ready': 'Start commissioning', Commissioning: 'Complete commissioning' } as Record<string, string>)[value] ?? 'Active'
}
</script>

<template>
  <div class="admin-page">
    <div class="page-heading">
      <div><h1 class="text-2xl font-semibold">Installations</h1><p>Prepare hardware, perform field work, and commission each unit.</p></div>
    </div>

    <div class="toolbar">
      <UInput v-model="search" class="toolbar-search" icon="i-lucide-search" placeholder="Search monitoring unit or site" />
      <USelect v-model="stage" :items="stages" />
    </div>

    <div class="unit-list">
      <UCard v-for="unit in filtered" :key="unit.id">
        <div class="unit-row">
          <div class="unit-main">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor(unit.stage)" variant="subtle">{{ unit.stage }}</UBadge>
              <span class="text-xs text-muted">{{ unit.id }}</span>
            </div>
            <h3 class="mt-3">{{ unit.name }}</h3>
            <p>{{ unit.site }}</p>
            <div class="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div><span class="block text-muted">Planned</span><strong>{{ unit.plannedNodes }}</strong></div>
              <div><span class="block text-muted">Assigned</span><strong>{{ unit.assignedNodes }}</strong></div>
              <div><span class="block text-muted">Gateway</span><strong>{{ unit.gatewayReady ? 'Ready' : 'Missing' }}</strong></div>
            </div>
          </div>
          <div class="row-actions">
            <UButton v-if="unit.stage === 'Planning' && unit.assignedNodes < unit.plannedNodes" color="neutral" variant="outline" icon="i-lucide-plus" label="Assign node" :disabled="!data.inventory.some(node => node.state === 'Available')" @click="assignNextNode(unit.id)" />
            <UButton v-if="unit.stage !== 'Active'" :label="actionLabel(unit.stage)" :disabled="unit.stage === 'Planning' && unit.assignedNodes < unit.plannedNodes" @click="advanceInstallation(unit.id)" />
            <UBadge v-else color="success" variant="subtle">Commissioned</UBadge>
          </div>
        </div>
      </UCard>
      <UCard v-if="!filtered.length"><UEmpty icon="i-lucide-hard-hat" title="No matching installations" /></UCard>
    </div>
  </div>
</template>
