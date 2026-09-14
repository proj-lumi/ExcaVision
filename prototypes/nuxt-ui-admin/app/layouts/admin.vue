<script setup lang="ts">
const route = useRoute()
const title = computed(() => String(route.meta.title ?? 'Admin'))

const navigation = [[
  { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/', exact: true },
  { label: 'Requests', icon: 'i-lucide-inbox', to: '/requests' },
  { label: 'Installations', icon: 'i-lucide-hard-hat', to: '/installations' },
  { label: 'Inventory', icon: 'i-lucide-cpu', to: '/inventory' },
  { label: 'Sites', icon: 'i-lucide-map-pin', to: '/sites' }
]]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :min-size="14" :default-size="17" :max-size="22">
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-2">
          <UAvatar alt="EV" size="sm" />
          <strong v-if="!collapsed">ExcaVision</strong>
        </div>
      </template>

      <UNavigationMenu :items="navigation" orientation="vertical" tooltip popover />

      <template #footer="{ collapsed }">
        <UButton color="neutral" variant="ghost" block :square="collapsed" icon="i-lucide-user-round" :label="collapsed ? undefined : 'Miguel · Admin'" />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar :title="title">
          <template #right>
            <UBadge color="success" variant="subtle">Mock data</UBadge>
            <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" label="Reset on refresh" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
