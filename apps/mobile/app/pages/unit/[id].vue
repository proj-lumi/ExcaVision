<script setup lang="ts">
// WBS 2.0 — Manage Requests: repair submission.
// WBS 6.0 — Monitor Sites: readings, health, and fixed-threshold settings.
import type { CustomerUnit, MonitoringNode, RepairUnitReport, SensorSnapshot } from '~/types/mock'
import { formatPhilippineTime, gatewayNode, healthIcon, nodeDisplayName, nodeHealthStatus, nodeRole, readingIcon, reportingSensorCount, sensorCount, sensorValue, statusColor, unitHealthStatus, unitReadingStatus } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Unit' })

const route = useRoute()
const { state, data, isLoading, refresh, submitCustomerRequest, updateThreshold } = useCustomerStore()
const preferences = useAccessibilityPreferences()
const toast = useAppToast()
const thresholdOpen = ref(false)
const coverageOpen = ref(false)
const thresholdDraft = ref(2)
const thresholdError = ref('')
const thresholdSaving = ref(false)
const repairOpen = ref(false)
const repairSubmitted = ref(false)
const repairSubmitting = ref(false)
const repairDetail = ref('')
const repairAttachments = ref<File[]>([])

const unit = computed<CustomerUnit | undefined>(() => data.value?.units.find(item => item.id === route.params.id))
const gateway = computed(() => unit.value ? gatewayNode(unit.value) : undefined)
const reportingTotal = computed(() => unit.value?.nodes.reduce((total, node) => total + reportingSensorCount(node), 0) ?? 0)
const totalSensors = computed(() => unit.value?.nodes.reduce((total, node) => total + sensorCount(node), 0) ?? 0)

function nodeDepth(nodeIndex: number) {
  return `${nodeIndex * 3}–${(nodeIndex + 1) * 3} m`
}

function sensorAdvisory(node: MonitoringNode, sensor: SensorSnapshot) {
  return data.value?.anomaly_events.find(event => event.node_id === node.id && event.sensor_id === sensor.id && event.acknowledged_at === null)
}

function sensorBadge(node: MonitoringNode, sensor: SensorSnapshot, threshold: number) {
  if (sensor.reading_status !== 'reporting') {
    return { label: 'No data', icon: readingIcon('No data'), color: 'neutral' as const }
  }
  if (sensor.current_value_deg !== null && Math.abs(sensor.current_value_deg) > threshold) {
    return { label: 'Critical', icon: readingIcon('Critical'), color: 'error' as const }
  }
  if (sensorAdvisory(node, sensor)) {
    return { label: 'Warning', icon: readingIcon('Warning'), color: 'warning' as const }
  }
  return null
}

function repairSensorStatus(node: MonitoringNode, sensor: SensorSnapshot, threshold: number): RepairUnitReport['nodes'][number]['sensors'][number]['status'] {
  return sensorBadge(node, sensor, threshold)?.label as RepairUnitReport['nodes'][number]['sensors'][number]['status'] ?? 'Normal'
}

const repairCanSubmit = computed(() => Boolean(unit.value))

function openThreshold() {
  if (!unit.value) return
  thresholdDraft.value = unit.value.alert_threshold_deg
  thresholdError.value = ''
  thresholdOpen.value = true
}

async function saveThreshold() {
  if (thresholdSaving.value) return
  if (!unit.value || thresholdDraft.value < 0.1 || thresholdDraft.value > 45) {
    thresholdError.value = 'Use a threshold from 0.1° to 45°.'
    return
  }
  thresholdSaving.value = true
  try {
    const result = await updateThreshold(unit.value.id, Number(thresholdDraft.value))
    if (!result.ok) {
      thresholdError.value = result.message
      toast.add({ title: 'Threshold not saved', description: result.message, color: 'error' })
      return
    }
    thresholdOpen.value = false
  } finally {
    thresholdSaving.value = false
  }
}

function openRepair() {
  repairDetail.value = ''
  repairAttachments.value = []
  repairSubmitted.value = false
  repairOpen.value = true
}

async function submitRepair() {
  if (repairSubmitting.value || !unit.value) return

  repairSubmitting.value = true
  try {
    const currentUnit = unit.value
    const report: RepairUnitReport = {
      version: 2,
      captured_at: new Date().toISOString(),
      unit: {
        id: currentUnit.id,
        name: currentUnit.name,
        reading_status: unitReadingStatus(currentUnit, data.value?.anomaly_events ?? []),
        health_status: unitHealthStatus(currentUnit),
        threshold_deg: currentUnit.alert_threshold_deg,
      },
      nodes: currentUnit.nodes.map(node => ({
        id: node.id,
        name: nodeDisplayName(node),
        position: node.position,
        role: nodeRole(node),
        health_status: nodeHealthStatus(node, gateway.value),
        connection_state: node.connection_state,
        last_seen_at: node.last_seen_at,
        sensors: node.sensors.map(sensor => ({
          id: sensor.id,
          position: sensor.position,
          label: sensor.label,
          value_deg: sensor.current_value_deg,
          reading_status: sensor.reading_status,
          status: repairSensorStatus(node, sensor, currentUnit.alert_threshold_deg),
          last_recorded_at: sensor.last_recorded_at,
          sample_count: sensor.latest_sample_count,
          failure_count: sensor.latest_failure_count,
        })),
      })),
    }
    const id = await submitCustomerRequest('repair', repairDetail.value.trim(), repairAttachments.value, currentUnit.id, undefined, undefined, report)
    if (!id) return
    repairSubmitted.value = true
    repairDetail.value = ''
  } finally {
    repairSubmitting.value = false
  }
}

</script>

<template>
  <div class="grid min-w-0 gap-4">
    <div class="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 -mx-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-default bg-default/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div class="flex min-w-0 items-center gap-2">
        <UButton to="/units" color="neutral" variant="ghost" icon="i-lucide-arrow-left" aria-label="Back" size="sm" class="shrink-0 justify-center hover:bg-primary/10 hover:text-primary" />
        <USkeleton v-if="isLoading" class="h-8 w-56 max-w-[calc(100vw-8rem)]" />
        <h1 v-else class="min-w-0 max-w-full break-words text-lg font-semibold text-highlighted sm:text-xl">{{ unit?.name ?? 'Unit' }}</h1>
      </div>
      <UButton v-if="unit" icon="i-lucide-plus" label="Add nodes" size="sm" class="shrink-0" @click="coverageOpen = true" />
    </div>

    <UAlert v-if="state.status === 'error'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Unit data unavailable" :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: refresh }]" />

    <template v-else-if="isLoading">
      <UCard>
        <div class="grid gap-4"><USkeleton class="h-8 w-56" /><USkeleton class="h-16 w-full" /><USkeleton v-for="item in 3" :key="item" class="h-28 w-full rounded-lg" /></div>
      </UCard>
    </template>

    <template v-else-if="unit">
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm text-muted">Monitoring profile</p>
              <h2 class="font-semibold text-highlighted">{{ unit.nodes.length }} nodes · {{ totalSensors }} sensors · {{ unit.nodes.length * 3 }} m</h2>
              <div class="mt-3">
                <UnitStatusSummary :health="unitHealthStatus(unit)" :reading="unitReadingStatus(unit, data?.anomaly_events ?? [])" />
              </div>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton color="neutral" variant="ghost" icon="i-lucide-wrench" label="Repair unit" size="sm" class="hover:bg-primary/10 hover:text-primary" @click="openRepair" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-sliders-horizontal" label="Threshold" size="sm" class="hover:bg-primary/10 hover:text-primary" @click="openThreshold" />
            </div>
          </div>
        </template>

        <div class="grid grid-cols-2 gap-3 border-b border-default pb-4 text-sm sm:grid-cols-3">
          <div><span class="block text-xs text-muted">{{ unitReadingStatus(unit, data?.anomaly_events ?? []) === 'No data' ? 'Last data received' : 'Data received' }}</span><strong>{{ formatPhilippineTime(unit.updated_at) }}</strong></div>
          <div><span class="block text-xs text-muted">Sensors</span><strong>{{ reportingTotal }}/{{ totalSensors }}</strong></div>
          <div><span class="block text-xs text-muted">Threshold</span><strong class="font-mono">{{ unit.alert_threshold_deg.toFixed(2) }}°</strong></div>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-muted">Vertical sensor profile</h2>
          <span class="text-xs text-muted">3 m per node</span>
        </div>

        <div class="mt-3 rounded-lg bg-default/30 p-2 ring ring-accented">
          <div class="grid max-h-[70vh] gap-3 overflow-y-auto px-1 py-1">
            <UCard v-for="(node, nodeIndex) in unit.nodes" :key="node.id" variant="soft" class="min-w-0">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm font-semibold text-highlighted">Node {{ nodeIndex + 1 }}</span>
                  <span class="text-xs text-muted">{{ nodeRole(node) }} · {{ nodeDepth(nodeIndex) }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs text-muted">Health</span>
                  <StatusBadge :label="nodeHealthStatus(node, gateway)" :icon="healthIcon(nodeHealthStatus(node, gateway))" :color="statusColor(nodeHealthStatus(node, gateway))" />
                </div>
              </div>
            </template>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div v-for="sensor in node.sensors" :key="sensor.id" class="grid gap-1 rounded-md bg-default p-3 ring ring-accented">
                <span class="text-xs text-muted">Reading · Sensor {{ sensor.position }}</span>
                <strong class="font-mono tabular-nums text-highlighted" :class="preferences.large_telemetry ? 'text-xl sm:text-2xl' : 'text-lg'">{{ sensorValue(sensor) }}</strong>
                <StatusBadge
                  v-if="sensorBadge(node, sensor, unit.alert_threshold_deg)"
                  :label="sensorBadge(node, sensor, unit.alert_threshold_deg)?.label ?? ''"
                  :icon="sensorBadge(node, sensor, unit.alert_threshold_deg)?.icon ?? 'i-lucide-circle-help'"
                  :color="sensorBadge(node, sensor, unit.alert_threshold_deg)?.color"
                />
              </div>
            </div>

            <template #footer>
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs text-muted">{{ reportingSensorCount(node) }}/{{ sensorCount(node) }} sensors reporting</span>
                <div class="flex flex-wrap justify-end gap-2">
                  <UButton :to="{ path: '/trends', query: { search: unit.name, unitId: unit.id, nodeId: node.id } }" color="neutral" variant="ghost" icon="i-lucide-chart-line" label="Trend" size="sm" class="hover:bg-primary/10 hover:text-primary" />
                </div>
              </div>
            </template>
            </UCard>
          </div>
        </div>
      </UCard>
    </template>

    <UEmpty v-else icon="i-lucide-circle-help" title="Unit not found" />

    <CoverageRequestModal v-if="unit" v-model:open="coverageOpen" :unit-id="unit.id" nodes-only />

    <UModal v-model:open="thresholdOpen" :title="unit ? `${unit.name} threshold` : 'Threshold'">
      <template #body>
        <div class="grid gap-4">
          <UFormField label="Threshold" required>
            <UInput v-model.number="thresholdDraft" type="number" min="0.1" max="45" step="0.1" size="xl">
              <template #trailing>°</template>
            </UInput>
          </UFormField>
          <UAlert v-if="thresholdError" color="error" variant="subtle" :description="thresholdError" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-12 hover:bg-primary/10 hover:border-primary/60 hover:text-primary" @click="thresholdOpen = false" />
          <UButton size="lg" :label="thresholdSaving ? 'Saving…' : 'Save'" :loading="thresholdSaving" :disabled="thresholdSaving" class="min-h-12" @click="saveThreshold" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="repairOpen" title="Repair unit">
      <template #body>
        <div v-if="repairSubmitted" class="grid gap-4">
          <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" title="Request sent" description="Your repair request has been sent to the site team." />
          <UButton block size="xl" label="Done" class="min-h-12" @click="repairOpen = false" />
        </div>
        <div v-else-if="unit" class="grid gap-5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0"><h2 class="truncate font-semibold text-highlighted">{{ unit.name }}</h2><p class="mt-1 text-sm text-muted">{{ unit.nodes.length }} nodes · {{ totalSensors }} sensors captured</p></div>
            <UnitStatusSummary :health="unitHealthStatus(unit)" :reading="unitReadingStatus(unit, data?.anomaly_events ?? [])" />
          </div>
          <UFormField label="Problem details (Optional)">
            <UTextarea v-model="repairDetail" :rows="4" :maxlength="1000" placeholder="Describe the issue" size="xl" :ui="{ base: 'resize-none' }" class="w-full" />
          </UFormField>
          <RequestAttachments v-model="repairAttachments" />
        </div>
      </template>
      <template v-if="!repairSubmitted" #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" size="lg" label="Cancel" class="min-h-12 hover:bg-primary/10 hover:border-primary/60 hover:text-primary" @click="repairOpen = false" />
          <UButton size="lg" :label="repairSubmitting ? 'Sending…' : 'Send'" :loading="repairSubmitting" :disabled="!repairCanSubmit || repairSubmitting" class="min-h-12" @click="submitRepair" />
        </div>
      </template>
    </UModal>
  </div>
</template>
