<script setup lang="ts">
import type { NodeStatus } from "~/types/mock";
import { nodeRole } from "~/utils/catalog";

definePageMeta({ layout: "admin", title: "Nodes" });
useSeoMeta({ title: "Nodes" });

const { data, pending } = useAdminStore();
const search = ref("");
type ActiveNodeStatus = Exclude<NodeStatus, "archived">;
const statusFilter = ref<"all" | ActiveNodeStatus>("all");
type NodeSort = "mac-asc" | "mac-desc" | "position";
const sortOrder = ref<NodeSort>("mac-asc");
const statusOptions = [
  { label: "All", value: "all" },
  { label: "Unassigned", value: "unassigned" },
  { label: "Assigned", value: "assigned" },
];
const sortOptions = [
  { label: "MAC A–Z", value: "mac-asc" },
  { label: "MAC Z–A", value: "mac-desc" },
  { label: "Position", value: "position" },
];
const activeSites = computed(() => new Map(data.value.sites.filter((site) => !site.archived_at).map((site) => [site.id, site])));
const activeUnits = computed(() => new Map(data.value.units.filter((unit) => !unit.archived_at && activeSites.value.has(unit.site_id)).map((unit) => [unit.id, unit])));
const visibleNodes = computed(() => data.value.nodes.filter((node) => node.status !== "archived" && (node.status === "unassigned" || (node.unit_id !== null && activeUnits.value.has(node.unit_id)))));
const filtered = computed(() => visibleNodes.value.filter((node) => {
  const unit = node.unit_id ? activeUnits.value.get(node.unit_id) : undefined;
  const site = unit ? activeSites.value.get(unit.site_id) : undefined;
  const key = `${node.mac_address} ${unit?.name ?? ""} ${site?.name ?? ""}`.toLowerCase();
  return (statusFilter.value === "all" || node.status === statusFilter.value)
    && key.includes(search.value.trim().toLowerCase());
}).sort((a, b) => {
  if (sortOrder.value === "position") {
    const aPosition = a.position ?? Number.MAX_SAFE_INTEGER;
    const bPosition = b.position ?? Number.MAX_SAFE_INTEGER;
    return aPosition - bPosition || a.mac_address.localeCompare(b.mac_address);
  }
  const difference = a.mac_address.localeCompare(b.mac_address, undefined, { sensitivity: "base" });
  return sortOrder.value === "mac-asc" ? difference : -difference;
}));
const filtersActive = computed(() => Boolean(search.value.trim()) || statusFilter.value !== "all" || sortOrder.value !== "mac-asc");

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  sortOrder.value = "mac-asc";
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header"><h1>Nodes</h1></header>
    <AdminTableShell>
      <template #toolbar>
        <AdminFilterBar :clear-visible="filtersActive" @clear="clearFilters">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search MAC address, unit, or site" size="sm" class="min-w-0 flex-1 text-sm" aria-label="Search nodes" />
          <USelect v-model="statusFilter" :items="statusOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Filter nodes by status"><template #default="{ modelValue }">Status: {{ statusOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
          <USelect v-model="sortOrder" :items="sortOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Sort nodes"><template #default="{ modelValue }">Sort: {{ sortOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
        </AdminFilterBar>
      </template>
      <AdminListSkeleton v-if="pending" :rows="6" />
      <table v-else class="admin-data-table w-full min-w-[860px] border-collapse text-left text-sm">
        <thead class="bg-default text-xs text-muted"><tr><th class="px-3 py-2 font-semibold">Mac address</th><th class="px-3 py-2 font-semibold">Status</th><th class="px-3 py-2 font-semibold">Unit</th><th class="px-3 py-2 font-semibold">Site</th><th class="px-3 py-2 font-semibold">Position</th><th class="px-3 py-2 font-semibold">Role</th><th class="px-3 py-2 text-right font-semibold">Action</th></tr></thead>
        <tbody class="divide-y divide-default">
          <tr v-for="node in filtered" :key="node.id" class="odd:bg-default/30 hover:bg-primary/5">
            <td class="px-4 py-3 font-mono text-xs text-highlighted">{{ node.mac_address }}</td>
            <td class="px-4 py-3"><AdminStatusBadge kind="node" :value="node.status" /></td>
            <td class="px-4 py-3 text-toned">{{ node.unit_id ? activeUnits.get(node.unit_id)?.name : '—' }}</td>
            <td class="px-4 py-3 text-toned">{{ node.unit_id ? activeSites.get(activeUnits.get(node.unit_id)?.site_id ?? '')?.name : '—' }}</td>
            <td class="px-4 py-3 tabular-nums text-toned">{{ node.position ? `Node ${node.position}` : '—' }}</td>
            <td class="px-4 py-3 text-toned">{{ nodeRole(node.position) }}</td>
            <td class="px-3 py-1.5 text-right"><UTooltip v-if="node.unit_id && activeUnits.get(node.unit_id)" text="View node"><UButton :to="`/units/${activeUnits.get(node.unit_id)?.slug}#node-${node.position}`" color="neutral" variant="ghost" icon="i-lucide-eye" :aria-label="`View Node ${node.position}`" size="sm" square class="admin-accent-control justify-center" /></UTooltip><span v-else class="text-muted">—</span></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="7" class="p-0"><UEmpty icon="i-lucide-cpu" title="No nodes" class="min-h-64" /></td></tr>
        </tbody>
      </table>
      <template #footer><span>{{ filtered.length }} of {{ visibleNodes.length }}</span></template>
    </AdminTableShell>
  </div>
</template>
