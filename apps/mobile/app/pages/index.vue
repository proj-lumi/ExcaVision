<script setup lang="ts">
// WBS 6.0 — Monitor Sites
import type { CustomerUnit } from '~/types/mock'
import { alertStatus, alertSummary, combinedAlerts } from '~/utils/alerts'
import { compareUnitAttention, formatPhilippineTime, healthIcon, nodeDisplayName, peakSensor, peakTilt, readingIcon, readingTextClass, reportingSensorCount, sensorCount, statusColor, tiltStatus, unitHealthStatus, unitReadingStatus } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Overview' })

const { state, data, isLoading, refresh } = useCustomerStore()
const preferences = useAccessibilityPreferences()

const sortedUnits = computed(() => [...(data.value?.units ?? [])].sort(compareUnitAttention))
const featuredAlerts = computed(() => combinedAlerts(data.value)
  .filter(alert => !alert.acknowledged)
  .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
  .slice(0, 2))

function sensorTotal(unit: CustomerUnit) {
  return unit.nodes.reduce((total, node) => total + sensorCount(node), 0)
}

function reportingTotal(unit: CustomerUnit) {
  return unit.nodes.reduce((total, node) => total + reportingSensorCount(node), 0)
}


</script>

<template>
  <div class="grid w-full min-w-0 max-w-full gap-4">
    <div class="flex items-center justify-between gap-3">
      <USkeleton v-if="isLoading" class="h-7 w-64 max-w-full sm:h-8" />
      <h1 v-else class="min-w-0 max-w-full break-words text-xl font-semibold text-highlighted sm:text-2xl">{{ data?.site.name ?? 'Site overview' }}</h1>
    </div>

    <UAlert
      v-if="state.status === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Monitoring unavailable"
      :actions="[{ label: 'Retry', color: 'error', variant: 'outline', onClick: refresh }]"
    />

    <template v-else-if="isLoading">
      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Loading units">
        <UCard v-for="item in 4" :key="item" :ui="{ body: 'p-3 sm:p-4' }">
          <div class="flex justify-between gap-3"><USkeleton class="h-5 w-40" /><USkeleton class="h-4 w-16" /></div>
          <div class="mt-3 flex gap-3"><USkeleton class="h-6 w-28" /><USkeleton class="h-6 w-28" /></div>
          <USkeleton class="mt-3 h-10 w-32" />
          <USkeleton class="mt-3 h-2 w-full rounded-full" />
          <div class="mt-3 flex justify-between border-t border-default pt-3"><USkeleton class="h-4 w-20" /><USkeleton class="h-4 w-28" /></div>
          <div class="mt-3 flex justify-end gap-2 border-t border-default pt-2"><USkeleton class="h-10 w-24 rounded-md" /><USkeleton class="h-10 w-24 rounded-md" /></div>
        </UCard>
      </section>
    </template>

    <template v-else-if="data">
      <section class="grid w-full min-w-0 max-w-full gap-3" aria-labelledby="units-heading">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="units-heading" class="text-sm font-semibold text-muted">
            <ResultSummary :count="sortedUnits.length" noun="unit" />
          </h2>
          <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 8, collisionPadding: 16 }">
            <UButton color="neutral" variant="ghost" icon="i-lucide-circle-help" aria-label="Open status key" class="min-h-12 min-w-12 justify-center hover:bg-primary/10 hover:text-primary" />
            <template #content>
              <div class="grid w-80 max-w-[calc(100vw-2rem)] grid-cols-2 gap-x-5 gap-y-3 p-4">
                <h3 class="col-span-2 font-semibold text-highlighted">Status key</h3>
                <div class="grid content-start gap-2">
                  <p class="text-xs font-semibold text-muted">Health</p>
                  <StatusBadge label="Healthy" :icon="healthIcon('Healthy')" color="success" />
                  <StatusBadge label="Attention" :icon="healthIcon('Attention')" color="warning" />
                </div>
                <div class="grid content-start gap-2">
                  <p class="text-xs font-semibold text-muted">Reading</p>
                  <StatusBadge label="Normal" :icon="readingIcon('Normal')" color="success" />
                  <StatusBadge label="Warning" :icon="readingIcon('Warning')" color="warning" />
                  <StatusBadge label="Critical" :icon="readingIcon('Critical')" color="error" />
                  <StatusBadge label="No data" :icon="readingIcon('No data')" color="neutral" />
                </div>
              </div>
            </template>
          </UPopover>
        </div>
        <div class="grid w-full min-w-0 max-w-full gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <NuxtLink v-for="unit in sortedUnits" :key="unit.id" :to="{ path: '/units', query: { search: unit.name } }" class="group block w-full min-w-0 max-w-full h-full rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <UCard :ui="{ root: 'h-full w-full min-w-0 max-w-full transition-colors group-hover:bg-primary/5 group-hover:ring-primary/50', body: 'flex h-full min-w-0 max-w-full flex-col p-3 sm:p-4' }">
            <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h3 class="min-w-0 max-w-full break-words text-sm font-semibold text-highlighted">{{ unit.name }}</h3>
              <span class="max-w-[42%] shrink-0 truncate text-xs text-muted">{{ reportingTotal(unit) }}/{{ sensorTotal(unit) }} sensors</span>
            </div>

            <UnitStatusSummary :health="unitHealthStatus(unit)" :reading="unitReadingStatus(unit, data?.anomaly_events ?? [])" class="mt-2 sm:mt-3" />

            <div class="mt-2 sm:mt-3">
              <p class="text-xs text-muted">{{ tiltStatus(unit) === 'Data unavailable' ? 'Last peak tilt' : 'Peak tilt' }}</p>
              <p class="font-mono font-bold leading-none tabular-nums" :class="[preferences.large_telemetry ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl', readingTextClass(unitReadingStatus(unit, data?.anomaly_events ?? []))]">
                {{ peakTilt(unit)?.toFixed(2) ?? '—' }}°
              </p>
              <p v-if="peakSensor(unit)" class="mt-1 break-words text-xs text-muted">{{ peakSensor(unit)?.node ? nodeDisplayName(peakSensor(unit)!.node) : '' }} · Sensor {{ peakSensor(unit)?.sensor.position }}</p>
            </div>

            <div class="mt-2 sm:mt-3">
              <UProgress
                v-if="tiltStatus(unit) !== 'Data unavailable'"
                :model-value="Math.min(((peakTilt(unit) ?? 0) / unit.alert_threshold_deg) * 100, 100)"
                :color="statusColor(unitReadingStatus(unit, data?.anomaly_events ?? []))"
                size="sm"
              />
              <div v-else class="h-1 w-full rounded-full bg-accented" aria-label="No current reading">
                <span class="sr-only">No current reading</span>
              </div>
            </div>

            <div class="mt-2 grid grid-cols-2 gap-3 border-t border-default pt-2 text-xs sm:mt-3 sm:pt-3">
              <div><span class="text-muted">Threshold</span> <strong class="font-mono font-normal text-highlighted">{{ unit.alert_threshold_deg.toFixed(1) }}°</strong></div>
              <div class="min-w-0 text-right"><span class="text-muted">Updated</span> <strong class="block truncate font-mono font-semibold tabular-nums text-highlighted">{{ formatPhilippineTime(unit.updated_at) }}</strong></div>
            </div>

            <div class="mt-auto flex items-center justify-between gap-1 border-t border-default pt-2">
              <span class="ml-auto flex min-h-10 items-center gap-1 text-sm font-medium text-primary">View unit <UIcon name="i-lucide-chevron-right" class="size-4" /></span>
            </div>
            </UCard>
          </NuxtLink>
        </div>
      </section>
    </template>

    <section v-if="featuredAlerts.length" class="grid w-full min-w-0 max-w-full gap-3" aria-labelledby="alerts-heading">
      <div class="flex items-center justify-between gap-3">
        <h2 id="alerts-heading" class="text-lg font-semibold text-highlighted">Recent alerts</h2>
        <NuxtLink to="/alerts" class="flex min-h-10 shrink-0 items-center gap-1 text-sm font-medium text-primary no-underline hover:text-primary/75">
          View all
          <UIcon name="i-lucide-chevron-right" class="size-4" />
        </NuxtLink>
      </div>
      <div class="grid w-full min-w-0 max-w-full gap-3 sm:grid-cols-2">
        <NuxtLink v-for="alert in featuredAlerts" :key="alert.id" :to="{ path: '/alerts', query: { search: alert.location } }" class="group block h-full w-full min-w-0 max-w-full rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <UCard :ui="{ root: 'h-full min-w-0 max-w-full flex flex-col transition-colors group-hover:bg-primary/5 group-hover:ring-primary/50', body: 'min-w-0 flex-1 p-3 sm:p-4' }">
          <div class="min-w-0 max-w-full">
            <div class="flex min-w-0 flex-wrap items-start gap-2 sm:justify-between">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-muted">{{ alert.kind === 'anomaly' ? 'Movement warning' : 'Threshold exceeded' }}</p>
                <h3 class="mt-1 break-words font-medium text-highlighted">{{ alert.location }}</h3>
              </div>
              <StatusBadge :label="alertStatus(alert)" :icon="readingIcon(alertStatus(alert))" :color="alertStatus(alert) === 'Critical' ? 'error' : 'warning'" class="shrink-0" />
            </div>
            <p class="mt-2 break-words text-sm text-muted">{{ alertSummary(alert) }}</p>
            <AnomalyScore v-if="alert.kind === 'anomaly'" :score="alert.anomaly_score" class="mt-4 border-t border-default pt-3" />
            <p class="mt-1 text-xs text-muted">{{ formatPhilippineTime(alert.detected_at) }}</p>
          </div>
          <template #footer>
            <div class="flex justify-end">
              <span class="flex min-h-10 items-center gap-1 text-sm font-medium text-primary">View alert <UIcon name="i-lucide-chevron-right" class="size-4" /></span>
            </div>
          </template>
          </UCard>
        </NuxtLink>
      </div>
    </section>

  </div>
</template>
