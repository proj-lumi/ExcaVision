<script setup lang="ts">
import type { UnitStatus } from "~/types/mock";

definePageMeta({ layout: "admin", title: "Units" });
useSeoMeta({ title: "Units" });

const { data, pending } = useAdminStore();
const search = ref("");
type ActiveUnitStatus = Exclude<UnitStatus, "archived">;
const statusFilter = ref<"all" | ActiveUnitStatus>("all");
type UnitSort = "name-asc" | "name-desc" | "updated";
const sortOrder = ref<UnitSort>("name-asc");
const statusOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Setup pending", value: "setup_pending" },
];
const sortOptions = [
  { label: "Name A–Z", value: "name-asc" },
  { label: "Name Z–A", value: "name-desc" },
  { label: "Updated", value: "updated" },
];
const activeSites = computed(() => new Map(data.value.sites.filter((site) => !site.archived_at).map((site) => [site.id, site])));
const activeUnits = computed(() => data.value.units.filter((unit) => !unit.archived_at && activeSites.value.has(unit.site_id)));
const filtered = computed(() => activeUnits.value.filter((unit) => {
  const site = activeSites.value.get(unit.site_id);
  const key = `${unit.name} ${site?.name ?? ""}`.toLowerCase();
  return (statusFilter.value === "all" || unit.status === statusFilter.value)
    && key.includes(search.value.trim().toLowerCase());
}).sort((a, b) => {
  if (sortOrder.value === "updated") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const aName = `${activeSites.value.get(a.site_id)?.name ?? ""} ${a.name}`;
  const bName = `${activeSites.value.get(b.site_id)?.name ?? ""} ${b.name}`;
  const difference = aName.localeCompare(bName, undefined, { sensitivity: "base" });
  return sortOrder.value === "name-asc" ? difference : -difference;
}));
const filtersActive = computed(() => Boolean(search.value.trim()) || statusFilter.value !== "all" || sortOrder.value !== "name-asc");

function assignedNodeCount(unit_id: string) {
  return data.value.nodes.filter((node) => node.unit_id === unit_id && node.status === "assigned").length;
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sortOrder.value = "name-asc";
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header"><h1>Units</h1></header>
    <AdminTableShell>
      <template #toolbar>
        <AdminFilterBar :clear-visible="filtersActive" @clear="clearFilters">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search unit or site" size="sm" class="min-w-0 flex-1 text-sm" aria-label="Search units" />
          <USelect v-model="statusFilter" :items="statusOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Filter units by status"><template #default="{ modelValue }">Status: {{ statusOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
          <USelect v-model="sortOrder" :items="sortOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Sort units"><template #default="{ modelValue }">Sort: {{ sortOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
        </AdminFilterBar>
      </template>
      <AdminListSkeleton v-if="pending" :rows="5" />
      <table v-else class="admin-data-table w-full min-w-[720px] border-collapse text-left text-sm">
        <thead class="bg-default text-xs text-muted"><tr><th class="px-4 py-3 font-semibold">Unit</th><th class="px-4 py-3 font-semibold">Site</th><th class="px-4 py-3 font-semibold">Nodes</th><th class="px-4 py-3 font-semibold">Status</th><th class="px-4 py-3 text-right font-semibold">Action</th></tr></thead>
        <tbody class="divide-y divide-default">
          <tr v-for="unit in filtered" :key="unit.id" class="odd:bg-default/30 hover:bg-primary/5">
            <td class="px-4 py-3 font-medium text-highlighted">{{ unit.name }}</td>
            <td class="px-4 py-3 text-toned">{{ activeSites.get(unit.site_id)?.name }}</td>
            <td class="px-4 py-3 tabular-nums text-toned">{{ assignedNodeCount(unit.id) }}</td>
            <td class="px-4 py-3"><AdminStatusBadge kind="unit" :value="unit.status" /></td>
            <td class="px-4 py-2 text-right"><UTooltip text="View unit"><UButton :to="`/units/${unit.slug}`" color="neutral" variant="ghost" icon="i-lucide-eye" :aria-label="`View ${unit.name}`" size="sm" square class="admin-accent-control justify-center" /></UTooltip></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="5" class="p-0"><UEmpty icon="i-lucide-layers-3" title="No units" class="min-h-64" /></td></tr>
        </tbody>
      </table>
      <template #footer><span>{{ filtered.length }} of {{ activeUnits.length }}</span></template>
    </AdminTableShell>
  </div>
</template>
