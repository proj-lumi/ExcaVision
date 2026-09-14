<script setup lang="ts">
import { statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'admin', title: 'Sites' })
useSeoMeta({ title: 'Sites' })

const { data } = useMockStore()
const search = ref('')
const filtered = computed(() => data.value.sites.filter(site => `${site.name} ${site.customer} ${site.location}`.toLowerCase().includes(search.value.toLowerCase())))
</script>

<template>
  <div class="admin-page">
    <div class="page-heading">
      <div><h1 class="text-2xl font-semibold">Customer sites</h1><p>Reference customer access and commissioned monitoring units.</p></div>
    </div>

    <div class="toolbar"><UInput v-model="search" class="toolbar-search" icon="i-lucide-search" placeholder="Search site, customer, or location" /></div>

    <div class="site-list">
      <UCard v-for="site in filtered" :key="site.id">
        <div class="site-row">
          <div class="site-main">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="statusColor(site.customerAccess)" variant="subtle">{{ site.customerAccess }}</UBadge>
              <span class="text-xs text-muted">{{ site.id }}</span>
            </div>
            <h3 class="mt-3">{{ site.name }}</h3>
            <p>{{ site.customer }} · {{ site.location }}</p>
            <p>{{ site.activeUnits }} active monitoring {{ site.activeUnits === 1 ? 'unit' : 'units' }}</p>
          </div>
          <div class="row-actions">
            <UButton to="/installations" color="neutral" variant="outline" label="Installations" />
            <UButton v-if="site.customerAccess === 'Not invited'" label="Invite customer" />
            <UButton v-else color="neutral" variant="ghost" label="View customer" />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
