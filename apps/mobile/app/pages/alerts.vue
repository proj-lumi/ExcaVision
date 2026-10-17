<script setup lang="ts">
import type { Database } from '~/types/database.types'
import { alertStatus, alertSummary, combinedAlerts, type AlertItem } from '~/utils/alerts'
import { formatPhilippineTime, readingIcon } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Alerts' })

const route = useRoute()
const router = useRouter()
const supabase = useSupabaseClient<Database>()
const { state, data, isLoading, refresh, acknowledgeThresholdEvent, acknowledgeAnomalyEvent } = useCustomerStore()
const toast = useAppToast()

type SeverityFilter = 'all' | 'warning' | 'critical'
type ReviewFilter = 'all' | 'open' | 'seen'
type SortOrder = 'newest' | 'oldest'

const eventId = ref(typeof route.query.event === 'string' ? route.query.event : '')
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')
const severityFilter = ref<SeverityFilter>(['warning', 'critical'].includes(String(route.query.severity)) ? route.query.severity as SeverityFilter : 'all')
const reviewFilter = ref<ReviewFilter>(['all', 'open', 'seen'].includes(String(route.query.state)) ? route.query.state as ReviewFilter : eventId.value ? 'all' : 'open')
const sortOrder = ref<SortOrder>(route.query.sort === 'oldest' ? 'oldest' : 'newest')
const acknowledgingId = ref('')

const severityItems = [
  { label: 'All', value: 'all' },
  { label: 'Warning', value: 'warning' },
  { label: 'Critical', value: 'critical' }
]
const reviewItems = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Seen', value: 'seen' }
]
const sortItems = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' }
]
const alerts = computed(() => combinedAlerts(data.value))
const focusedAlert = computed(() => eventId.value ? alerts.value.find(alert => alert.id === eventId.value) : undefined)
const focusedLoadAttempted = ref('')
const filtersActive = computed(() => eventId.value.length > 0 || searchQuery.value.trim().length > 0 || severityFilter.value !== 'all' || reviewFilter.value !== 'open' || sortOrder.value !== 'newest')
const filteredAlerts = computed(() => alerts.value
  .filter(alert => {
    const query = searchQuery.value.trim().toLowerCase()
    const searchMatches = !query || [alert.location, alert.kind, alertSummary(alert)].some(value => value.toLowerCase().includes(query))
    const severityMatches = severityFilter.value === 'all' || alertStatus(alert).toLowerCase() === severityFilter.value
    const reviewMatches = reviewFilter.value === 'all'
      || (reviewFilter.value === 'open' && !alert.acknowledged)
      || (reviewFilter.value === 'seen' && alert.acknowledged)
    return searchMatches && severityMatches && reviewMatches
  })
  .sort((a, b) => {
    const dateOrder = new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    return (sortOrder.value === 'newest' ? dateOrder : -dateOrder)
      || Number(alertStatus(b) === 'Critical') - Number(alertStatus(a) === 'Critical')
  }))
const openFilteredAlerts = computed(() => filteredAlerts.value.filter(alert => !alert.acknowledged).length)

watch([searchQuery, severityFilter, reviewFilter, sortOrder], ([search, severity, review, sort]) => {
  const query: Record<string, string> = {}
  if (search.trim()) query.search = search.trim()
  if (severity !== 'all') query.severity = severity
  if (review !== 'open') query.state = review
  if (sort !== 'newest') query.sort = sort
  if (eventId.value) query.event = eventId.value
  void router.replace({ path: '/alerts', query })
})

async function loadFocusedAlert() {
  const id = eventId.value
  if (!id || !data.value || focusedLoadAttempted.value === id || focusedAlert.value) return
  focusedLoadAttempted.value = id

  const [thresholdRes, anomalyRes] = await Promise.all([
    supabase.from('threshold_events').select('id,unit_id,sensor_id,observed_value_deg,threshold_deg,detected_at,acknowledged_at').eq('id', id).maybeSingle(),
    supabase.from('anomaly_events').select('id,unit_id,node_id,sensor_id,detection_method,observed_value_deg,baseline_value_deg,anomaly_score,anomalous_readings,window_size,model_version,window_started_at,detected_at,acknowledged_at').eq('id', id).maybeSingle()
  ])
  if (thresholdRes.data) data.value.threshold_events.unshift(thresholdRes.data)
  else if (anomalyRes.data) data.value.anomaly_events.unshift(anomalyRes.data)
}

watch([data, eventId], async ([nextData, nextEventId]) => {
  if (!nextData || !nextEventId) return
  await loadFocusedAlert()
  if (!import.meta.client) return
  await nextTick()
  document.getElementById(`alert-${nextEventId}`)?.scrollIntoView({ block: 'center' })
}, { immediate: true })

function alertUnitName(alert: AlertItem) {
  return data.value?.units.find(unit => unit.id === alert.unit_id)?.name ?? alert.location
}

function clearFilters() {
  eventId.value = ''
  searchQuery.value = ''
  severityFilter.value = 'all'
  reviewFilter.value = 'open'
  sortOrder.value = 'newest'
}

async function acknowledgeAlertItem(alert: AlertItem) {
  if (acknowledgingId.value) return
  acknowledgingId.value = alert.id
  try {
    const result = alert.kind === 'anomaly'
      ? await acknowledgeAnomalyEvent(alert.id)
      : await acknowledgeThresholdEvent(alert.id)
    if (!result.ok) {
      toast.add({ title: 'Alert not updated', description: result.message, color: 'error' })
    }
  } finally {
    acknowledgingId.value = ''
  }
}
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-highlighted">Alerts</h1>
    </div>

    <UAlert v-if="state.status === 'error'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Alerts unavailable" :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: refresh }]" />

    <template v-else-if="isLoading">
      <UCard>
        <div class="grid gap-4"><USkeleton v-for="item in 3" :key="item" class="h-32 w-full rounded-lg" /></div>
      </UCard>
    </template>

    <template v-else-if="data">
      <FilterBar :clear-visible="filtersActive" @clear="clearFilters">
        <UInput v-model="searchQuery" icon="i-lucide-search" placeholder="Search alerts or units" size="sm" class="w-full text-sm sm:w-auto sm:flex-1 hover:bg-primary/10 focus-within:ring-primary/60" aria-label="Search alerts or units" />
        <USelect v-model="severityFilter" :items="severityItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by severity"><template #default="{ modelValue }">Severity: {{ severityItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
        <USelect v-model="reviewFilter" :items="reviewItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by state"><template #default="{ modelValue }">State: {{ reviewItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
        <USelect v-model="sortOrder" :items="sortItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Sort alerts by date and time"><template #default="{ modelValue }">Sort: {{ sortItems.find((option) => option.value === modelValue)?.label }}</template></USelect>
      </FilterBar>

      <section class="grid gap-3" aria-labelledby="alerts-heading">
        <div v-if="eventId && !focusedAlert" class="text-sm text-muted">This alert is no longer available.</div>
        <div class="flex items-center justify-between gap-3">
          <h2 id="alerts-heading" class="text-sm font-semibold text-highlighted">
            <ResultSummary
              :count="filteredAlerts.length"
              noun="alert"
              :qualifier="reviewFilter === 'all' ? '' : reviewFilter"
              :secondary-count="reviewFilter === 'all' ? openFilteredAlerts : undefined"
              secondary-label="open"
            />
          </h2>
        </div>

        <div v-if="filteredAlerts.length" class="grid gap-3">
          <UCard v-for="alert in filteredAlerts" :id="`alert-${alert.id}`" :key="alert.id" class="group transition-colors hover:bg-primary/5 hover:ring-primary/50" :class="eventId === alert.id ? 'ring-2 ring-primary/70' : ''" :ui="{ root: 'h-full flex flex-col', body: 'flex-1' }">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <StatusBadge :label="alertStatus(alert)" :icon="readingIcon(alertStatus(alert))" :color="alertStatus(alert) === 'Critical' ? 'error' : 'warning'" />
                </div>
                <h3 class="mt-2 font-semibold text-highlighted">{{ alert.location }}</h3>
                <p class="mt-3 text-sm text-muted">{{ alertSummary(alert) }}</p>
                <AnomalyScore v-if="alert.kind === 'anomaly'" :score="alert.anomaly_score" class="mt-4 border-t border-default pt-3" />
                <p class="mt-1 text-xs text-muted">{{ formatPhilippineTime(alert.detected_at) }}</p>
              </div>
              <span v-if="alert.acknowledged" class="text-xs text-muted">Seen</span>
            </div>
            <template #footer>
              <div class="flex flex-wrap justify-end gap-2">
                <UButton v-if="alert.unit_id" :to="{ path: '/trends', query: { search: alertUnitName(alert), unitId: alert.unit_id, nodeId: alert.node_id, sensorId: alert.sensor_id, eventAt: alert.detected_at } }" color="neutral" variant="outline" size="sm" icon="i-lucide-chart-line" label="Trend" class="min-h-10 px-3 hover:bg-primary/10 hover:border-primary/60 hover:text-primary" />
                <UButton v-if="!alert.acknowledged" color="neutral" variant="ghost" size="sm" icon="i-lucide-check" :label="acknowledgingId === alert.id ? 'Saving…' : 'Seen'" :loading="acknowledgingId === alert.id" :disabled="Boolean(acknowledgingId)" class="min-h-10 px-3 hover:bg-primary/10 hover:text-primary" @click="acknowledgeAlertItem(alert)" />
              </div>
            </template>
          </UCard>
        </div>
        <UEmpty v-else icon="i-lucide-filter-x" title="No matching alerts" />
      </section>
    </template>
  </div>
</template>
