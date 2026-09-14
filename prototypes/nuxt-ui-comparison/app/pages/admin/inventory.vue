<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InventoryNode } from '~/types/mock'

definePageMeta({ layout: 'admin', title: 'Inventory' })
useSeoMeta({ title: 'Inventory' })

const { data } = useMockStore()
const search = ref('')
const state = ref('All states')
const states = ['All states', 'Available', 'Assigned', 'Deployed', 'Needs inspection']
const filtered = computed(() => data.value.inventory.filter(node => {
  const key = `${node.serial} ${node.mac} ${node.assignment ?? ''}`.toLowerCase()
  return (state.value === 'All states' || node.state === state.value) && key.includes(search.value.toLowerCase())
}))
const rows = computed(() => filtered.value.map(node => ({
  serial: node.serial,
  mac: node.mac,
  state: node.state,
  assignment: node.assignment ?? 'Unassigned'
})))
const columns: TableColumn<Pick<InventoryNode, 'serial' | 'mac' | 'state'> & { assignment: string }>[] = [
  { accessorKey: 'serial', header: 'Serial' },
  { accessorKey: 'mac', header: 'MAC address' },
  { accessorKey: 'state', header: 'State' },
  { accessorKey: 'assignment', header: 'Assignment' }
]
</script>

<template>
  <div class="admin-page">
    <div class="page-heading">
      <div><h1 class="text-2xl font-semibold">Hardware inventory</h1><p>Register, inspect, assign, and locate manufactured nodes.</p></div>
      <UButton icon="i-lucide-plus" label="Register node" />
    </div>

    <div class="toolbar">
      <UInput v-model="search" class="toolbar-search" icon="i-lucide-search" placeholder="Search serial, MAC, or assignment" />
      <USelect v-model="state" :items="states" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="rows" :columns="columns" sticky empty="No matching hardware" />
    </UCard>
  </div>
</template>
