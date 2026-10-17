<script setup lang="ts">
import type { Node } from "~/types/mock";
import { nodeRole } from "~/utils/catalog";

definePageMeta({ layout: "admin", title: "Unit" });
useSeoMeta({ title: "Unit" });

const route = useRoute();
const { data, pending, archiveNode, reorderUnitNode } = useAdminStore();
const toast = useAppToast();
const assignNodeOpen = ref(false);
const registerNodeOpen = ref(false);
const setupPacketOpen = ref(false);
const archiveOpen = ref(false);
const archiveTarget = ref<Node | null>(null);
const archiving = ref(false);
const promoteOpen = ref(false);
const promoteTarget = ref<Node | null>(null);
const reordering = ref(false);
const unit = computed(() => data.value.units.find((item) => item.slug === String(route.params.id) && !item.archived_at));
const site = computed(() => data.value.sites.find((item) => item.id === unit.value?.site_id && !item.archived_at));
const nodes = computed(() => data.value.nodes
  .filter((node) => node.unit_id === unit.value?.id && node.status === "assigned")
  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));

function askArchive(node: Node) {
  archiveTarget.value = node;
  archiveOpen.value = true;
}

async function confirmArchive() {
  if (!archiveTarget.value || archiving.value) return;
  archiving.value = true;
  try {
    const result = await archiveNode(archiveTarget.value.id);
    if (!result.ok) {
      toast.add({ title: "Node not archived", description: result.message, color: "error" });
      return;
    }
    archiveOpen.value = false;
    toast.add({ title: "Node archived", color: "success" });
  } finally {
    archiving.value = false;
  }
}

function requestMove(node: Node, targetPosition: number) {
  if (reordering.value || node.position === targetPosition) return;
  if (targetPosition === 1 && node.position !== 1) {
    promoteTarget.value = node;
    promoteOpen.value = true;
    return;
  }
  void moveNode(node, targetPosition);
}

async function moveNode(node: Node, targetPosition: number) {
  if (reordering.value) return false;
  reordering.value = true;
  try {
    const result = await reorderUnitNode(node.id, targetPosition);
    if (!result.ok) {
      toast.add({ title: "Node order not updated", description: result.message, color: "error" });
      return false;
    }
    toast.add({ title: "Node order updated", color: "success" });
    return true;
  } finally {
    reordering.value = false;
  }
}

async function confirmPromotion() {
  if (!promoteTarget.value) return;
  if (await moveNode(promoteTarget.value, 1)) promoteOpen.value = false;
}
</script>

<template>
  <div class="admin-page">
    <h1 class="sr-only">{{ unit?.name ?? "Unit" }}</h1>
    <AdminDetailSkeleton v-if="pending" />
    <UCard v-else-if="!unit"><UEmpty icon="i-lucide-layers-3" title="Unit not found" class="min-h-64"><template #actions><UButton to="/sites" label="Back" class="admin-accent-control" /></template></UEmpty></UCard>
    <template v-else>
      <UCard>
        <template #header><h2 class="font-semibold text-highlighted">Unit</h2></template>
        <dl class="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-muted">Site</dt><dd class="mt-1"><NuxtLink v-if="site" :to="`/sites/${site.slug}`" class="text-primary hover:underline">{{ site.name }}</NuxtLink></dd></div>
          <div><dt class="text-xs text-muted">Nodes</dt><dd class="mt-1 tabular-nums text-highlighted">{{ nodes.length }}</dd></div>
        </dl>
      </UCard>

      <section class="grid min-w-0 gap-3" aria-labelledby="nodes-heading">
        <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="nodes-heading" class="font-semibold text-highlighted">Nodes</h2><div class="flex flex-wrap justify-end gap-2"><UButton icon="i-lucide-file-up" label="Paste code" size="sm" class="admin-accent-control" @click="setupPacketOpen = true" /><UButton icon="i-lucide-plus" label="Register" size="sm" color="neutral" variant="outline" class="admin-accent-control" @click="registerNodeOpen = true" /><UButton icon="i-lucide-link" label="Assign" size="sm" color="neutral" variant="outline" class="admin-accent-control" @click="assignNodeOpen = true" /></div></div>
        <AdminTableShell>
          <table class="admin-data-table w-full min-w-[640px] border-collapse text-left text-sm">
            <thead class="bg-default text-xs text-muted"><tr><th class="px-4 py-3 font-semibold">Position</th><th class="px-4 py-3 font-semibold">Role</th><th class="px-4 py-3 font-semibold">MAC address</th><th class="px-4 py-3 text-right font-semibold">Action</th></tr></thead>
            <tbody class="divide-y divide-default">
              <tr v-for="node in nodes" :id="`node-${node.position}`" :key="node.id" class="scroll-mt-4 odd:bg-default/30 hover:bg-primary/5 target:bg-primary/10">
                <td class="px-4 py-3 font-medium tabular-nums text-highlighted">Node {{ node.position }}</td>
                <td class="px-4 py-3 text-toned">{{ nodeRole(node.position) }}</td>
                <td class="px-4 py-3 font-mono text-xs text-muted">{{ node.mac_address }}</td>
                <td class="px-4 py-2"><div class="flex justify-end gap-1"><UTooltip v-if="node.position !== 1" text="Make gateway"><UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-arrow-up-to-line" aria-label="Make gateway" class="admin-accent-control justify-center" :disabled="reordering" @click="requestMove(node, 1)" /></UTooltip><UTooltip text="Move up"><UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-arrow-up" aria-label="Move node up" class="admin-accent-control justify-center" :disabled="reordering || node.position === 1" @click="requestMove(node, (node.position ?? 1) - 1)" /></UTooltip><UTooltip text="Move down"><UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-arrow-down" aria-label="Move node down" class="admin-accent-control justify-center" :disabled="reordering || node.position === nodes.length" @click="requestMove(node, (node.position ?? nodes.length) + 1)" /></UTooltip><UTooltip text="Archive node"><UButton color="error" variant="ghost" size="sm" square icon="i-lucide-archive" :aria-label="`Archive Node ${node.position}`" class="justify-center" :disabled="reordering" @click="askArchive(node)" /></UTooltip></div></td>
              </tr>
              <tr v-if="!nodes.length"><td colspan="4" class="p-0"><UEmpty icon="i-lucide-cpu" title="No assigned nodes" class="min-h-52" /></td></tr>
            </tbody>
          </table>
          <template #footer><span>{{ nodes.length }} assigned nodes</span></template>
        </AdminTableShell>
      </section>
    </template>

    <SetupPacketModal v-if="unit" v-model:open="setupPacketOpen" :unit-id="unit.id" />
    <RegisterNodeModal v-if="unit" v-model:open="registerNodeOpen" :unit-id="unit.id" />
    <NodeFormModal v-if="unit" v-model:open="assignNodeOpen" :unit-id="unit.id" />
    <UModal v-model:open="archiveOpen" title="Archive node" :description="archiveTarget ? `Node ${archiveTarget.position}` : undefined"><template #body><UAlert color="error" variant="subtle" icon="i-lucide-archive" title="Archive this node?" description="The remaining node positions will close the gap." /></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="archiving" @click="archiveOpen = false" /><UButton color="error" :label="archiving ? 'Archiving…' : 'Archive node'" :loading="archiving" :disabled="archiving" class="min-h-12" @click="confirmArchive" /></div></template></UModal>
    <UModal v-model:open="promoteOpen" title="Make gateway"><template #body><UAlert color="warning" variant="subtle" icon="i-lucide-router" title="Change the gateway?" description="Node 1 sends data to the cloud." /></template><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control min-h-12" :disabled="reordering" @click="promoteOpen = false" /><UButton color="warning" label="Make gateway" class="min-h-12" :loading="reordering" :disabled="reordering" @click="confirmPromotion" /></div></template></UModal>
  </div>
</template>
