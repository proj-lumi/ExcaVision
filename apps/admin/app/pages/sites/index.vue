<script setup lang="ts">
import type { InvitationStatus, Site } from "~/types/mock";

definePageMeta({ layout: "admin", title: "Sites" });
useSeoMeta({ title: "Sites" });

const { data, pending } = useAdminStore();
const search = ref("");
const accessFilter = ref<"all" | InvitationStatus>("all");
type SiteSort = "name-asc" | "name-desc" | "updated";
const sortOrder = ref<SiteSort>("name-asc");
const accessOptions = [
  { label: "All", value: "all" },
  { label: "Not invited", value: "not_invited" },
  { label: "Invited", value: "invited" },
  { label: "Activated", value: "activated" },
];
const sortOptions = [
  { label: "Name A–Z", value: "name-asc" },
  { label: "Name Z–A", value: "name-desc" },
  { label: "Updated", value: "updated" },
];
const activeSites = computed(() => data.value.sites.filter((site) => !site.archived_at));
function customerFor(site: Site) {
  return data.value.profiles.find((profile) => profile.id === site.customer_id);
}
const filtered = computed(() => activeSites.value.filter((site) => {
  const customer = customerFor(site);
  const key = `${site.name} ${site.address_label} ${customer?.full_name ?? ""} ${customer?.email ?? ""} ${customer?.phone ?? ""} ${site.company_name}`.toLowerCase();
  return (accessFilter.value === "all" || site.invitation_status === accessFilter.value)
    && key.includes(search.value.trim().toLowerCase());
}).sort((a, b) => {
  if (sortOrder.value === "updated") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const difference = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return sortOrder.value === "name-asc" ? difference : -difference;
}));
const filtersActive = computed(() => Boolean(search.value.trim()) || accessFilter.value !== "all" || sortOrder.value !== "name-asc");

function clearFilters() {
  search.value = "";
  accessFilter.value = "all";
  sortOrder.value = "name-asc";
}

function unitCount(site_id: string) {
  return data.value.units.filter((unit) => unit.site_id === site_id && !unit.archived_at).length;
}

</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header"><h1>Sites</h1></header>
    <AdminTableShell>
      <template #toolbar>
        <AdminFilterBar :clear-visible="filtersActive" @clear="clearFilters">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search site, location, contact, or email" size="sm" class="min-w-0 flex-1 text-sm" aria-label="Search sites" />
          <USelect v-model="accessFilter" :items="accessOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Filter sites by access"><template #default="{ modelValue }">Access: {{ accessOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
          <USelect v-model="sortOrder" :items="sortOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Sort sites"><template #default="{ modelValue }">Sort: {{ sortOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
        </AdminFilterBar>
      </template>
      <AdminListSkeleton v-if="pending" :rows="5" />
      <table v-else class="admin-data-table w-full min-w-[860px] border-collapse text-left text-sm">
        <thead class="bg-default text-xs text-muted"><tr><th class="px-4 py-3 font-semibold">Site</th><th class="px-4 py-3 font-semibold">Contact</th><th class="px-4 py-3 font-semibold">Location</th><th class="px-4 py-3 font-semibold">Access</th><th class="px-4 py-3 font-semibold">Units</th><th class="px-4 py-3 text-right font-semibold">Actions</th></tr></thead>
        <tbody class="divide-y divide-default">
          <tr v-for="site in filtered" :key="site.id" class="odd:bg-default/30 hover:bg-primary/5">
            <td class="px-4 py-3 font-medium text-highlighted">{{ site.name }}</td>
            <td class="px-4 py-3"><p class="text-toned">{{ customerFor(site)?.full_name ?? "Not assigned" }}</p><p class="mt-1 text-xs text-muted">{{ customerFor(site)?.email ?? "—" }}</p></td>
            <td class="max-w-64 px-4 py-3 text-muted"><p class="line-clamp-2">{{ site.address_label }}</p></td>
            <td class="px-4 py-3"><AdminStatusBadge kind="access" :value="site.invitation_status" /></td>
            <td class="px-4 py-3 tabular-nums text-toned">{{ unitCount(site.id) }}</td>
            <td class="px-4 py-2 text-right"><UTooltip text="View site"><UButton :to="`/sites/${site.slug}`" color="neutral" variant="ghost" icon="i-lucide-eye" :aria-label="`View ${site.name}`" size="sm" square class="admin-accent-control justify-center" /></UTooltip></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6" class="p-0"><UEmpty icon="i-lucide-map-pin" title="No sites" class="min-h-64" /></td></tr>
        </tbody>
      </table>
      <template #footer><span>{{ filtered.length }} of {{ activeSites.length }}</span></template>
    </AdminTableShell>

  </div>
</template>
