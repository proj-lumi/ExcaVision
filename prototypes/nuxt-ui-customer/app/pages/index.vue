<script setup lang="ts">
import type { CustomerUnit } from '~/types/mock'
import { statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'My site' })

const { data, updateThreshold } = useMockStore()
const editingUnit = ref<CustomerUnit | null>(null)
const thresholdOpen = ref(false)
const thresholdDraft = ref(2)
const error = ref('')
const latestAdvisory = computed(() => data.value.customerAlerts.find(alert => alert.kind === 'Early Advisory' && !alert.acknowledged))

function openThreshold(unit: CustomerUnit) {
  editingUnit.value = unit
  thresholdDraft.value = unit.threshold
  error.value = ''
  thresholdOpen.value = true
}

function saveThreshold() {
  if (!editingUnit.value || thresholdDraft.value < 0.1 || thresholdDraft.value > 45) {
    error.value = 'Enter a threshold from 0.1° to 45°.'
    return
  }
  updateThreshold(editingUnit.value.id, Number(thresholdDraft.value))
  thresholdOpen.value = false
}
</script>

<template>
  <div class="grid gap-4">
    <div class="page-heading">
      <div><p class="text-sm text-muted">Monitoring site</p><h1 class="text-2xl font-semibold">Rest & Relax Guesthouse</h1></div>
      <UBadge color="success" variant="subtle" size="lg"><span class="mr-1 inline-block size-2 rounded-full bg-success" />Live</UBadge>
    </div>

    <UAlert v-if="latestAdvisory" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="latestAdvisory.detail" :description="`${latestAdvisory.unit} · ${latestAdvisory.time}`" :actions="[{ label: 'View alerts', to: '/alerts', color: 'warning', variant: 'outline' }]" />

    <section class="unit-grid" aria-label="Monitoring units">
      <UCard v-for="unit in data.customerUnits" :key="unit.id">
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <div><p class="m-0 text-xs text-muted">Monitoring unit</p><h2 class="mt-1 font-semibold">{{ unit.name }}</h2></div>
            <UBadge :color="statusColor(unit.status)" variant="subtle">{{ unit.status }}</UBadge>
          </div>
        </template>

        <p class="m-0 text-sm text-muted">Current tilt</p>
        <p class="reading-value">{{ unit.currentTilt.toFixed(2) }}°</p>
        <UProgress :model-value="Math.min((unit.currentTilt / unit.threshold) * 100, 100)" :color="unit.currentTilt >= unit.threshold ? 'error' : 'primary'" />
        <div class="stat-line mt-2"><span>0°</span><span>Warning at {{ unit.threshold.toFixed(1) }}°</span></div>

        <div class="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><span class="block text-muted">Sensors</span><strong>{{ unit.sensorCount }}</strong></div>
          <div><span class="block text-muted">Updated</span><strong>{{ unit.updated }}</strong></div>
        </div>

        <template #footer>
          <div class="flex gap-2">
            <UButton color="neutral" variant="outline" block icon="i-lucide-chart-no-axes-column-increasing" label="View readings" />
            <UButton color="neutral" variant="ghost" block icon="i-lucide-sliders-horizontal" label="Threshold" @click="openThreshold(unit)" />
          </div>
        </template>
      </UCard>
    </section>

    <UModal v-model:open="thresholdOpen" title="Edit warning threshold" :description="editingUnit ? `This setting applies only to ${editingUnit.name}.` : ''">
      <template #body>
        <div class="grid gap-4">
          <UFormField label="Warning threshold" description="The direct warning activates when tilt reaches this value." required>
            <UInput v-model.number="thresholdDraft" type="number" min="0.1" max="45" step="0.1"><template #trailing>°</template></UInput>
          </UFormField>
          <UAlert v-if="error" color="error" variant="subtle" :description="error" />
          <UAlert color="neutral" variant="subtle" description="The monitoring gateway may take about 15 seconds to receive the new value." />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" @click="thresholdOpen = false" />
          <UButton label="Save threshold" @click="saveThreshold" />
        </div>
      </template>
    </UModal>
  </div>
</template>
