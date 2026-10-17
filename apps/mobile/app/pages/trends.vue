<script setup lang="ts">
import type { Database } from '~/types/database.types'
import type { CustomerUnit, TrendPoint } from '~/types/mock'
import { compareUnitAttention, formatPhilippineDateTime, formatPhilippineDay, formatPhilippineTime, nodeDisplayName, nodeRole, peakTilt, readingTextClass, unitHealthStatus, unitReadingStatus } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Trends' })

const route = useRoute()
const router = useRouter()
const { state, data, isLoading, refresh } = useCustomerStore()
const preferences = useAccessibilityPreferences()
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')
const selectedUnitId = ref(typeof route.query.unitId === 'string' ? route.query.unitId : 'all')
const selectedNodeId = ref(typeof route.query.nodeId === 'string' ? route.query.nodeId : 'all')
const selectedSensorId = ref(typeof route.query.sensorId === 'string' ? route.query.sensorId : 'all')
// When a trend is opened from an alert, show the readings around that moment.
// The default history window only holds the most recent readings, so a live
// 1 Hz stream would push the alerting reading out before anyone could see it.
const alertAt = ref(typeof route.query.eventAt === 'string' ? route.query.eventAt : '')
const supabase = useSupabaseClient<Database>()
const alertWindow = ref<TrendPoint[]>([])
const alertWindowLoading = ref(false)

const selectedUnit = computed(() => data.value?.units.find(unit => unit.id === selectedUnitId.value))
const allUnits = computed(() => [...(data.value?.units ?? [])].sort(compareUnitAttention))
const visibleUnits = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return allUnits.value

  return allUnits.value.filter(unit => [
    unit.name,
    ...unit.nodes.flatMap(node => [nodeDisplayName(node), nodeRole(node), ...node.sensors.map(sensor => `sensor ${sensor.position}`)])
  ].some(value => value.toLowerCase().includes(query)))
})
const nodeItems = computed(() => [
  { label: 'All', value: 'all' },
  ...(selectedUnit.value?.nodes ?? []).map(node => ({ label: `${nodeDisplayName(node)} · ${nodeRole(node)}`, value: node.id }))
])
const selectedNode = computed(() => selectedNodeId.value === 'all' ? undefined : selectedUnit.value?.nodes.find(node => node.id === selectedNodeId.value))
const sensorItems = computed(() => [
  { label: 'All', value: 'all' },
  ...(selectedNode.value?.sensors ?? []).map(sensor => ({ label: `Sensor ${sensor.position}`, value: sensor.id }))
])
const selectedSensor = computed(() => selectedSensorId.value === 'all' ? undefined : selectedNode.value?.sensors.find(sensor => sensor.id === selectedSensorId.value))
// The plotted period, stated outright: with a real time axis a window can span
// days, and an alert from last week must not read as if it just happened.
const trendPeriod = computed(() => {
  const points = displayTrend.value
  if (points.length === 0) return ''
  const first = points[0]?.recorded_at
  const last = points[points.length - 1]?.recorded_at
  if (!first || !last) return ''
  return formatPhilippineDay(first) === formatPhilippineDay(last)
    ? `${formatPhilippineDay(first)} · ${formatPhilippineTime(first)}–${formatPhilippineTime(last)}`
    : `${formatPhilippineDateTime(first)} – ${formatPhilippineDateTime(last)}`
})

const displayTrend = computed<TrendPoint[]>(() => {
  if (alertWindow.value.length) return alertWindow.value
  if (selectedSensor.value) return selectedSensor.value.history
  if (selectedNode.value) return nodeTrend(selectedNode.value)
  return selectedUnit.value?.trend ?? []
})
const trendTitle = computed(() => selectedSensor.value
  ? `${selectedNode.value ? nodeDisplayName(selectedNode.value) : 'Node'} · Sensor ${selectedSensor.value.position}`
  : selectedNode.value ? nodeDisplayName(selectedNode.value) : selectedUnit.value?.name ?? 'Trends')
const trendSubtitle = computed(() => selectedSensor.value ? 'Sensor history' : selectedNode.value ? 'Peak sensor reading' : 'Unit peak tilt')
const latestPoint = computed(() => displayTrend.value.at(-1))
const chartColor = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
  if (!selectedUnit.value || !latestPoint.value || unitReadingStatus(selectedUnit.value, data.value?.anomaly_events ?? []) === 'No data') return 'neutral'
  return trendColor(latestPoint.value.value_deg, selectedUnit.value.alert_threshold_deg)
})

// Load the readings surrounding an alert so its moment is always visible,
// even when the live stream has already scrolled past it.
async function loadAlertWindow() {
  alertWindow.value = []
  if (!alertAt.value || selectedSensorId.value === 'all') return
  const center = new Date(alertAt.value).getTime()
  if (!Number.isFinite(center)) return
  alertWindowLoading.value = true
  try {
    const from = new Date(center - 15 * 60_000).toISOString()
    const to = new Date(center + 5 * 60_000).toISOString()
    const { data: rows, error } = await supabase
      .from('sensor_readings')
      .select('recorded_at,tilt_deg')
      .eq('sensor_id', selectedSensorId.value)
      .gte('recorded_at', from)
      .lte('recorded_at', to)
      .order('recorded_at', { ascending: true })
      .limit(400)
    if (error || !rows?.length) return
    alertWindow.value = rows.map(row => ({ recorded_at: row.recorded_at, value_deg: row.tilt_deg }))
  } finally {
    alertWindowLoading.value = false
  }
}

// The alert window is a historical view: fetching it again on every live update
// made the chart shift every couple of seconds. It is loaded once per alert, and
// only re-read while the window's right edge is still in the future.
let lastAlertWindowFetch = 0
const loadedAlertKey = ref('')
watch([selectedSensorId, alertAt, data], ([sensorId, at, loaded]) => {
  if (!loaded || !at) return
  const key = `${sensorId}:${at}`
  const center = new Date(at).getTime()
  const stillLive = Number.isFinite(center) && center + 5 * 60_000 > Date.now() - 60_000
  const freshFetchDue = stillLive && Date.now() - lastAlertWindowFetch > 60_000
  if (loadedAlertKey.value === key && !freshFetchDue) return
  loadedAlertKey.value = key
  lastAlertWindowFetch = Date.now()
  void loadAlertWindow()
}, { immediate: true })

watch(data, loaded => {
  if (!loaded) return
  if (selectedUnitId.value !== 'all' && !loaded.units.some(unit => unit.id === selectedUnitId.value)) selectedUnitId.value = 'all'
  if (selectedUnitId.value === 'all') {
    selectedNodeId.value = 'all'
    selectedSensorId.value = 'all'
    return
  }

  const unit = loaded.units.find(item => item.id === selectedUnitId.value)
  if (selectedNodeId.value !== 'all' && !unit?.nodes.some(node => node.id === selectedNodeId.value)) selectedNodeId.value = 'all'
  const node = unit?.nodes.find(item => item.id === selectedNodeId.value)
  if (selectedSensorId.value !== 'all' && !node?.sensors.some(sensor => sensor.id === selectedSensorId.value)) selectedSensorId.value = 'all'
}, { immediate: true })

watch(selectedUnitId, (value, previous) => {
  if (value !== previous) {
    selectedNodeId.value = 'all'
    selectedSensorId.value = 'all'
  }
})

watch(selectedNodeId, (value, previous) => {
  if (value !== previous) selectedSensorId.value = 'all'
})

watch([searchQuery, selectedUnitId, selectedNodeId, selectedSensorId], ([search, unitId, nodeId, sensorId]) => {
  const query: Record<string, string> = {}
  if (search.trim()) query.search = search.trim()
  if (unitId !== 'all') query.unitId = unitId
  if (nodeId !== 'all') query.nodeId = nodeId
  if (sensorId !== 'all') query.sensorId = sensorId
  void router.replace({ path: '/trends', query })
})

function clearScope() {
  searchQuery.value = ''
  selectedUnitId.value = 'all'
  selectedNodeId.value = 'all'
  selectedSensorId.value = 'all'
}

function selectUnit(unitId: string) {
  const unit = allUnits.value.find(item => item.id === unitId)
  searchQuery.value = unit?.name ?? ''
  selectedUnitId.value = unitId
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function nodeTrend(node: CustomerUnit['nodes'][number]) {
  const points = new Map<string, number[]>()
  for (const sensor of node.sensors) {
    for (const point of sensor.history) {
      const values = points.get(point.recorded_at) ?? []
      values.push(point.value_deg)
      points.set(point.recorded_at, values)
    }
  }
  return [...points.entries()].map(([recorded_at, values]) => ({ recorded_at, value_deg: Math.max(...values) }))
}

function pattern(values: number[]) {
  const first = values.at(0) ?? 0
  const last = values.at(-1) ?? 0
  const change = last - first
  if (change >= 0.1) return 'Rising'
  if (change <= -0.1) return 'Falling'
  return 'Stable'
}

function trendColor(value: number, threshold: number) {
  if (value >= threshold) return 'error'
  if (value >= threshold * 0.75) return 'warning'
  return 'success'
}

function unitChartColor(unit: CustomerUnit): 'success' | 'warning' | 'error' | 'neutral' {
  const latest = unit.trend.at(-1)
  if (!latest || unitReadingStatus(unit, data.value?.anomaly_events ?? []) === 'No data') return 'neutral'
  return trendColor(latest.value_deg, unit.alert_threshold_deg)
}

</script>

<template>
  <div class="grid min-w-0 gap-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-highlighted">Trends</h1>
    </div>

    <UAlert v-if="state.status === 'error'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Trend data unavailable" :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: refresh }]" />

    <template v-else-if="isLoading">
      <UCard>
        <div class="grid gap-4"><USkeleton class="h-12 w-full" /><USkeleton v-for="item in 6" :key="item" class="h-20 w-full rounded-lg" /></div>
      </UCard>
    </template>

    <template v-else-if="data">
      <FilterBar :clear-visible="searchQuery.trim().length > 0 || selectedUnitId !== 'all' || selectedNodeId !== 'all' || selectedSensorId !== 'all'" @clear="clearScope">
        <UInput v-model="searchQuery" icon="i-lucide-search" placeholder="Search units, nodes, or sensors" size="sm" class="w-full text-sm sm:w-auto sm:flex-1 hover:bg-primary/10 focus-within:ring-primary/60" aria-label="Search units, nodes, or sensors" />
        <USelect v-if="selectedUnit" v-model="selectedNodeId" :items="nodeItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by node"><template #default="{ modelValue }">Node: {{ nodeItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
        <USelect v-if="selectedNode" v-model="selectedSensorId" :items="sensorItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by sensor"><template #default="{ modelValue }">Sensor: {{ sensorItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
      </FilterBar>

      <section v-if="!selectedUnit" class="grid gap-3" aria-label="All unit trends">
        <div class="text-sm font-semibold text-highlighted">
          <ResultSummary :count="visibleUnits.length" noun="unit" :qualifier="searchQuery.trim() ? 'matching' : ''" />
        </div>
        <div v-if="visibleUnits.length" class="grid gap-3 lg:grid-cols-2">
          <UCard v-for="unit in visibleUnits" :key="unit.id" role="button" tabindex="0" :aria-label="`Select trends for ${unit.name}`" class="group cursor-pointer transition-colors hover:bg-primary/5 hover:ring-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" @click="selectUnit(unit.id)" @keydown.enter="selectUnit(unit.id)" @keydown.space.prevent="selectUnit(unit.id)">
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <h2 class="font-semibold text-highlighted">{{ unit.name }}</h2>
              <UnitStatusSummary :health="unitHealthStatus(unit)" :reading="unitReadingStatus(unit, data?.anomaly_events ?? [])" />
            </div>
          </template>

          <div class="grid gap-3 text-sm sm:grid-cols-3">
            <div><span class="block text-xs text-muted">Peak tilt</span><strong class="font-mono" :class="[preferences.large_telemetry ? 'text-lg sm:text-xl' : 'text-base', readingTextClass(unitReadingStatus(unit, data?.anomaly_events ?? []))]">{{ peakTilt(unit)?.toFixed(2) ?? '—' }}°</strong></div>
            <div><span class="block text-xs text-muted">Threshold</span><strong class="font-mono">{{ unit.alert_threshold_deg.toFixed(2) }}°</strong></div>
            <div><span class="block text-xs text-muted">Pattern</span><strong>{{ pattern(unit.trend.map(point => point.value_deg)) }}</strong></div>
          </div>

          <div class="mt-3">
            <ClientOnly>
              <TrendChart
                :title="`${unit.name} trend preview`"
                :points="unit.trend"
                :threshold="unit.alert_threshold_deg"
                :color="unitChartColor(unit)"
                :reduce-motion="preferences.reduce_motion"
                compact
              />
              <template #fallback>
                <USkeleton class="h-24 w-full rounded-lg" />
              </template>
            </ClientOnly>
          </div>

          <div class="mt-3 flex justify-end border-t border-default pt-2">
            <span class="flex min-h-10 items-center gap-1 text-sm font-medium text-primary">View trend <UIcon name="i-lucide-chevron-right" class="size-4" /></span>
          </div>
          </UCard>
        </div>
        <UEmpty v-else icon="i-lucide-search-x" title="No matching units" />
      </section>

      <UCard v-else>
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm text-muted">{{ trendSubtitle }}</p>
              <h2 class="font-semibold text-highlighted">{{ trendTitle }}</h2>
            </div>
            <UnitStatusSummary :health="unitHealthStatus(selectedUnit)" :reading="unitReadingStatus(selectedUnit, data?.anomaly_events ?? [])" />
          </div>
        </template>

        <UAlert v-if="unitReadingStatus(selectedUnit, data?.anomaly_events ?? []) === 'No data'" color="neutral" variant="subtle" icon="i-lucide-database-zap" :title="`Last data received ${formatPhilippineTime(selectedUnit.updated_at)}`" />

        <div class="mt-4 grid gap-3 border-b border-default pb-4 text-sm sm:grid-cols-3">
          <div><span class="block text-xs text-muted">Last peak tilt</span><strong class="font-mono" :class="[preferences.large_telemetry ? 'text-lg sm:text-xl' : 'text-base', readingTextClass(unitReadingStatus(selectedUnit, data?.anomaly_events ?? []))]">{{ latestPoint?.value_deg.toFixed(2) ?? '—' }}°</strong></div>
          <div><span class="block text-xs text-muted">Average</span><strong class="font-mono" :class="preferences.large_telemetry ? 'text-lg sm:text-xl' : 'text-base'">{{ average(displayTrend.map(point => point.value_deg)).toFixed(2) }}°</strong></div>
          <div><span class="block text-xs text-muted">Pattern</span><strong>{{ pattern(displayTrend.map(point => point.value_deg)) }}</strong></div>
        </div>

        <UAlert
          v-if="alertAt"
          class="mt-4"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`Alert time: ${formatPhilippineDateTime(alertAt)}`"
        />

        <div v-if="displayTrend.length" class="mt-4" aria-label="Trend chart">
          <ClientOnly>
            <TrendChart
              :title="trendTitle"
              :points="displayTrend"
              :threshold="selectedUnit.alert_threshold_deg"
              :color="chartColor"
              :mark-at="alertAt || null"
              :reduce-motion="preferences.reduce_motion"
            />
            <template #fallback>
              <USkeleton class="h-80 w-full rounded-lg" />
            </template>
          </ClientOnly>
        </div>
        <UEmpty v-else icon="i-lucide-database-zap" title="No trend readings" />

        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>Threshold {{ selectedUnit.alert_threshold_deg.toFixed(1) }}°</span>
            <span>{{ displayTrend.length }} readings<template v-if="trendPeriod"> · {{ trendPeriod }}</template></span>
          </div>
        </template>
      </UCard>
    </template>
  </div>
</template>
