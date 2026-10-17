<script setup lang="ts">
import type { Unit } from "~/types/mock";

definePageMeta({ layout: "admin", title: "Site details" });
useSeoMeta({ title: "Site details" });

const route = useRoute();
const router = useRouter();
const { data, pending, archiveUnit, archiveSite } = useAdminStore();
const toast = useAppToast();
const addUnitOpen = ref(false);
const inviteOpen = ref(false);
const archiveUnitOpen = ref(false);
const archiveSiteOpen = ref(false);
const archiveTarget = ref<Unit | null>(null);
const archiveBusy = ref<"unit" | "site" | null>(null);
const site = computed(() => data.value.sites.find((item) => item.slug === String(route.params.id) && !item.archived_at));
const customer = computed(() => data.value.profiles.find((profile) => profile.id === site.value?.customer_id));
const units = computed(() => data.value.units.filter((unit) => unit.site_id === site.value?.id && !unit.archived_at));
const installationComplete = computed(() => data.value.service_requests.some((request) =>
  request.id === site.value?.source_request_id
  && request.request_type === "site_installation"
  && request.status === "completed",
));

function activeNodeCount(unit_id: string) {
  return data.value.nodes.filter((node) => node.unit_id === unit_id && node.status === "assigned").length;
}
function askArchiveUnit(unit: Unit) { archiveTarget.value = unit; archiveUnitOpen.value = true; }
async function confirmArchiveUnit() {
  if (!archiveTarget.value || archiveBusy.value) return;
  archiveBusy.value = "unit";
  try {
    const result = await archiveUnit(archiveTarget.value.id);
    if (!result.ok) { toast.add({ title: "Unit not archived", description: result.message, color: "error" }); return; }
    archiveUnitOpen.value = false;
    toast.add({ title: "Unit archived", color: "success" });
  } finally {
    archiveBusy.value = null;
  }
}
async function confirmArchiveSite() {
  if (!site.value || archiveBusy.value) return;
  archiveBusy.value = "site";
  try {
    const result = await archiveSite(site.value.id);
    if (!result.ok) { toast.add({ title: "Site not archived", description: result.message, color: "error" }); return; }
    archiveSiteOpen.value = false;
    toast.add({ title: "Site archived", color: "success" });
    void router.push("/sites");
  } finally {
    archiveBusy.value = null;
  }
}
</script>

<template>
  <div class="admin-page">
    <h1 class="sr-only">{{ site?.name ?? "Site" }}</h1>
    <AdminDetailSkeleton v-if="pending" />
    <UCard v-else-if="!site"><UEmpty icon="i-lucide-map-pin-off" title="Site not found" class="min-h-64"><template #actions><UButton to="/sites" label="Back" class="admin-accent-control" /></template></UEmpty></UCard>
    <template v-else>
      <section class="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]" aria-label="Site information and customer access">
        <UCard>
          <template #header><div class="flex items-center justify-between gap-3"><h2 class="font-semibold text-highlighted">Site information</h2><UButton color="error" variant="ghost" size="sm" icon="i-lucide-archive" label="Archive" @click="archiveSiteOpen = true" /></div></template>
          <dl class="grid gap-4 text-sm sm:grid-cols-2">
            <div class="sm:col-span-2"><dt class="text-xs text-muted">Location</dt><dd class="mt-2"><LocationMap :latitude="site.latitude" :longitude="site.longitude" :label="site.address_label" /></dd></div>
            <div><dt class="text-xs text-muted">Company</dt><dd class="mt-1 text-highlighted">{{ site.company_name || "Not provided" }}</dd></div>
          </dl>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">Customer access</h2></template>
          <div class="grid gap-3 text-sm">
            <div><span class="block text-xs text-muted">Contact</span><span class="text-highlighted">{{ customer?.full_name ?? "Not assigned" }}</span></div>
            <div><span class="block text-xs text-muted">Email</span><span class="break-all text-highlighted">{{ customer?.email ?? "—" }}</span></div>
            <div><span class="block text-xs text-muted">Phone</span><span class="text-highlighted">{{ customer?.phone ?? "—" }}</span></div>
            <div><span class="block text-xs text-muted">Access</span><AdminStatusBadge class="mt-1" kind="access" :value="site.invitation_status" /></div>
          </div>
          <template #footer><UButton v-if="installationComplete && site.invitation_status !== 'activated'" block icon="i-lucide-send" :label="site.invitation_status === 'invited' ? 'Resend' : 'Invite'" size="sm" class="admin-accent-control" @click="inviteOpen = true" /></template>
        </UCard>
      </section>

      <section class="grid min-w-0 gap-3" aria-labelledby="units-heading">
        <div class="flex items-center justify-between gap-3"><h2 id="units-heading" class="font-semibold text-highlighted">Units</h2><UButton icon="i-lucide-plus" label="Add unit" size="sm" class="admin-accent-control" @click="addUnitOpen = true" /></div>
        <AdminTableShell>
          <table class="admin-data-table w-full min-w-[620px] border-collapse text-left text-sm">
            <thead class="bg-default text-xs text-muted"><tr><th class="px-4 py-3 font-semibold">Unit</th><th class="px-4 py-3 font-semibold">Nodes</th><th class="px-4 py-3 font-semibold">Status</th><th class="px-4 py-3 text-right font-semibold">Actions</th></tr></thead>
            <tbody class="divide-y divide-default">
              <tr v-for="unit in units" :key="unit.id" class="odd:bg-default/30 hover:bg-primary/5">
                <td class="px-4 py-3 font-medium text-highlighted">{{ unit.name }}</td>
                <td class="px-4 py-3 tabular-nums text-toned">{{ activeNodeCount(unit.id) }}</td>
                <td class="px-4 py-3"><AdminStatusBadge kind="unit" :value="unit.status" /></td>
                <td class="px-4 py-2"><div class="flex justify-end gap-1"><UTooltip text="View unit"><UButton :to="`/units/${unit.slug}`" color="neutral" variant="ghost" icon="i-lucide-eye" :aria-label="`View ${unit.name}`" size="sm" square class="admin-accent-control justify-center" /></UTooltip><UTooltip text="Archive unit"><UButton color="error" variant="ghost" size="sm" square icon="i-lucide-archive" :aria-label="`Archive ${unit.name}`" class="justify-center" @click="askArchiveUnit(unit)" /></UTooltip></div></td>
              </tr>
              <tr v-if="!units.length"><td colspan="4" class="p-0"><UEmpty icon="i-lucide-layers-3" title="No units" class="min-h-52" /></td></tr>
            </tbody>
          </table>
          <template #footer><span>{{ units.length }} units</span></template>
        </AdminTableShell>
      </section>
    </template>

    <UnitFormModal v-if="site" v-model:open="addUnitOpen" :site-id="site.id" />
    <InviteUserModal v-if="site" v-model:open="inviteOpen" :site="site" />
    <UModal v-model:open="archiveUnitOpen" title="Archive unit" :description="archiveTarget?.name"><template #body><UAlert color="error" variant="subtle" icon="i-lucide-archive" title="Archive this unit?" description="Its assigned nodes will also be archived." /></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="Boolean(archiveBusy)" @click="archiveUnitOpen = false" /><UButton color="error" :label="archiveBusy === 'unit' ? 'Archiving…' : 'Archive unit'" :loading="archiveBusy === 'unit'" :disabled="Boolean(archiveBusy)" class="min-h-12" @click="confirmArchiveUnit" /></div></template></UModal>
    <UModal v-model:open="archiveSiteOpen" title="Archive site" :description="site?.name"><template #body><UAlert color="error" variant="subtle" icon="i-lucide-archive" title="Archive this site?" description="Its units and assigned nodes will also be archived." /></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="Boolean(archiveBusy)" @click="archiveSiteOpen = false" /><UButton color="error" :label="archiveBusy === 'site' ? 'Archiving…' : 'Archive site'" :loading="archiveBusy === 'site'" :disabled="Boolean(archiveBusy)" class="min-h-12" @click="confirmArchiveSite" /></div></template></UModal>
  </div>
</template>
