<script setup lang="ts">
import type { ServiceRequest } from '~/types/mock'
import { requestStatusLabel, statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'admin', title: 'Requests' })
useSeoMeta({ title: 'Requests' })

const { data, setRequestStatus } = useMockStore()
const queue = ref<'intake' | 'work'>('intake')
const search = ref('')
const type = ref('All types')
const selected = ref<ServiceRequest | null>(null)
const detailsOpen = ref(false)

const queueTabs = [
  { label: 'Intake review', value: 'intake', icon: 'i-lucide-shield-check' },
  { label: 'Work queue', value: 'work', icon: 'i-lucide-list-checks' }
]
const types = ['All types', 'Installation', 'Repair', 'More coverage']
const filtered = computed(() => data.value.requests.filter(request => {
  const inQueue = queue.value === 'intake' ? request.status === 'intake' : request.status !== 'intake'
  const matchesType = type.value === 'All types' || request.type === type.value
  const key = `${request.id} ${request.customer} ${request.company} ${request.email} ${request.site}`.toLowerCase()
  return inQueue && matchesType && key.includes(search.value.toLowerCase())
}))

function inspect(request: ServiceRequest) {
  selected.value = request
  detailsOpen.value = true
}

function primaryAction(request: ServiceRequest) {
  if (request.status === 'intake') {
    setRequestStatus(request.id, 'approved')
    queue.value = 'work'
  } else if (request.status === 'approved') setRequestStatus(request.id, 'in_progress')
  else if (request.status === 'in_progress') setRequestStatus(request.id, 'completed')
  detailsOpen.value = false
}

function actionLabel(status: string) {
  return ({ intake: 'Accept intake', approved: 'Start work', in_progress: 'Mark complete', completed: 'Completed' } as Record<string, string>)[status]
}
</script>

<template>
  <div class="admin-page">
    <div class="page-heading">
      <div><h1 class="text-2xl font-semibold">Request workflow</h1><p>Review public intake separately from approved customer work.</p></div>
    </div>

    <UTabs v-model="queue" :items="queueTabs" :content="false" variant="link" />

    <div class="toolbar">
      <UInput v-model="search" class="toolbar-search" icon="i-lucide-search" placeholder="Search site, customer, company, or email" />
      <USelect v-model="type" :items="types" />
      <UBadge color="neutral" variant="subtle">{{ filtered.length }} requests</UBadge>
    </div>

    <div class="record-list">
      <UCard v-for="request in filtered" :key="request.id">
        <div class="record-row">
          <div class="record-main">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor(request.status)" variant="subtle">{{ requestStatusLabel(request.status) }}</UBadge>
              <UBadge color="neutral" variant="outline">{{ request.type }}</UBadge>
              <span class="text-xs text-muted">{{ request.id }} · {{ request.submitted }}</span>
            </div>
            <h3 class="mt-3">{{ request.site }}</h3>
            <p>{{ request.customer }} · {{ request.company }}</p>
            <p class="line-clamp-2">{{ request.summary }}</p>
          </div>
          <div class="row-actions">
            <UButton color="neutral" variant="outline" label="View details" @click="inspect(request)" />
            <UButton v-if="request.status !== 'completed'" :label="actionLabel(request.status)" @click="primaryAction(request)" />
          </div>
        </div>
      </UCard>
      <UCard v-if="!filtered.length"><UEmpty icon="i-lucide-inbox" title="No matching requests" description="Try another search or request type." /></UCard>
    </div>

    <UModal v-model:open="detailsOpen" :title="selected?.site" :description="selected ? `${selected.id} · ${selected.type}` : ''">
      <template #body>
        <div v-if="selected" class="grid gap-4">
          <UAlert color="neutral" variant="subtle" :title="selected.summary" />
          <dl class="grid grid-cols-2 gap-4 text-sm">
            <div><dt class="text-muted">Customer</dt><dd>{{ selected.customer }}</dd></div>
            <div><dt class="text-muted">Company</dt><dd>{{ selected.company }}</dd></div>
            <div><dt class="text-muted">Email</dt><dd>{{ selected.email }}</dd></div>
            <div><dt class="text-muted">Status</dt><dd>{{ requestStatusLabel(selected.status) }}</dd></div>
          </dl>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Close" @click="detailsOpen = false" />
          <UButton v-if="selected && selected.status !== 'completed'" :label="actionLabel(selected.status)" @click="primaryAction(selected)" />
        </div>
      </template>
    </UModal>
  </div>
</template>
