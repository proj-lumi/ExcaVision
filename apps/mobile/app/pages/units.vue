<script setup lang="ts">
import type { CustomerUnit } from '~/types/mock'
import { compareUnitAttention, reportingSensorCount, sensorCount, unitHealthStatus, unitReadingStatus } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Units' })

const route = useRoute()
const router = useRouter()
const { state, data, isLoading, refresh } = useCustomerStore()
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')
const coverageOpen = ref(false)
type HealthFilter = 'all' | 'healthy' | 'attention'
type ReadingFilter = 'all' | 'normal' | 'warning' | 'critical' | 'no-data'

const healthItems = [
  { label: 'All', value: 'all' },
  { label: 'Healthy', value: 'healthy' },
  { label: 'Attention', value: 'attention' }
]
const readingItems = [
  { label: 'All', value: 'all' },
  { label: 'Normal', value: 'normal' },
  { label: 'Warning', value: 'warning' },
  { label: 'Critical', value: 'critical' },
  { label: 'No data', value: 'no-data' }
]
const healthFilter = ref<HealthFilter>(['healthy', 'attention'].includes(String(route.query.health)) ? route.query.health as HealthFilter : 'all')
const readingFilter = ref<ReadingFilter>(['normal', 'warning', 'critical', 'no-data'].includes(String(route.query.reading)) ? route.query.reading as ReadingFilter : 'all')
const filtersActive = computed(() => searchQuery.value.trim().length > 0 || healthFilter.value !== 'all' || readingFilter.value !== 'all')

const filteredUnits = computed(() => (data.value?.units ?? [])
  .filter(unit => {
    const searchMatches = !searchQuery.value.trim() || unit.name.toLowerCase().includes(searchQuery.value.trim().toLowerCase())
    const healthMatches = healthFilter.value === 'all'
      || (healthFilter.value === 'healthy' && unitHealthStatus(unit) === 'Healthy')
      || (healthFilter.value === 'attention' && unitHealthStatus(unit) === 'Attention')
    const readingMatches = readingFilter.value === 'all' || unitReadingStatus(unit, data.value?.anomaly_events ?? []).toLowerCase().replace(' ', '-') === readingFilter.value
    return searchMatches && healthMatches && readingMatches
  })
  .sort(compareUnitAttention))

watch([searchQuery, healthFilter, readingFilter], ([search, health, reading]) => {
  const query: Record<string, string> = {}
  if (search.trim()) query.search = search.trim()
  if (health !== 'all') query.health = health
  if (reading !== 'all') query.reading = reading
  void router.replace({ path: '/units', query })
})

function clearFilters() {
  searchQuery.value = ''
  healthFilter.value = 'all'
  readingFilter.value = 'all'
}


function reportingTotal(unit: CustomerUnit) {
  return unit.nodes.reduce((total, node) => total + reportingSensorCount(node), 0)
}

function sensorTotal(unit: CustomerUnit) {
  return unit.nodes.reduce((total, node) => total + sensorCount(node), 0)
}
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-highlighted">Units</h1>
      </div>
      <UButton icon="i-lucide-plus" label="Add unit" size="sm" class="shrink-0" @click="coverageOpen = true" />
    </div>

    <CoverageRequestModal v-model:open="coverageOpen" />

    <UAlert v-if="state.status === 'error'" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Unit data unavailable" :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: refresh }]" />

    <template v-else-if="isLoading">
      <div class="grid gap-3">
        <UCard v-for="item in 4" :key="item" :ui="{ body: 'p-3 sm:p-4' }">
          <div class="flex items-center justify-between gap-3"><USkeleton class="h-5 w-48" /><USkeleton class="h-6 w-52" /></div>
          <USkeleton class="mt-3 h-4 w-72 max-w-full" />
        </UCard>
      </div>
    </template>

    <template v-else-if="data">
      <FilterBar :clear-visible="filtersActive" @clear="clearFilters">
        <UInput v-model="searchQuery" icon="i-lucide-search" placeholder="Search units" size="sm" class="w-full text-sm sm:w-auto sm:flex-1 hover:bg-primary/10 focus-within:ring-primary/60" aria-label="Search units" />
        <USelect v-model="healthFilter" :items="healthItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by health"><template #default="{ modelValue }">Health: {{ healthItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
        <USelect v-model="readingFilter" :items="readingItems" value-key="value" size="sm" class="w-full text-sm sm:w-40 hover:bg-primary/10 focus-within:ring-primary/60" :ui="{ item: 'data-highlighted:not-data-disabled:before:bg-primary/10 data-highlighted:not-data-disabled:text-primary' }" aria-label="Filter by reading"><template #default="{ modelValue }">Reading: {{ readingItems.find((item) => item.value === modelValue)?.label }}</template></USelect>
      </FilterBar>

      <div class="text-sm font-semibold text-highlighted">
        <ResultSummary :count="filteredUnits.length" noun="unit" :qualifier="filtersActive ? 'matching' : ''" />
      </div>

      <div v-if="filteredUnits.length" class="grid gap-3">
        <NuxtLink v-for="unit in filteredUnits" :key="unit.id" :to="`/unit/${unit.id}`" class="group block w-full min-w-0 max-w-full rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <UCard :ui="{ root: 'w-full min-w-0 max-w-full overflow-hidden transition-colors group-hover:bg-primary/5 group-hover:ring-primary/50', body: 'min-w-0 p-3 sm:p-4' }">
          <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 class="min-w-0 break-words font-semibold text-highlighted">{{ unit.name }}</h3>
                <UnitStatusSummary :health="unitHealthStatus(unit)" :reading="unitReadingStatus(unit, data?.anomaly_events ?? [])" class="shrink-0" />
              </div>
              <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:flex sm:flex-wrap sm:items-center">
                <span>{{ unit.nodes.length }} nodes</span>
                <span>{{ reportingTotal(unit) }}/{{ sensorTotal(unit) }} sensors reporting</span>
                <span class="col-span-2 sm:col-span-1">Updated {{ formatPhilippineTime(unit.updated_at) }}</span>
              </div>
            </div>
            <span class="ml-auto flex min-h-10 shrink-0 items-center gap-1 text-sm font-medium text-primary">View unit <UIcon name="i-lucide-chevron-right" class="size-4" /></span>
          </div>
          </UCard>
        </NuxtLink>
      </div>
      <UEmpty v-else icon="i-lucide-filter-x" title="No matching units" />
    </template>
  </div>
</template>
