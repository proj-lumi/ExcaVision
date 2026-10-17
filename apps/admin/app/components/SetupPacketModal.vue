<script setup lang="ts">
import type { Node } from "~/types/mock";

const props = withDefaults(defineProps<{ unitId: string; repairMode?: boolean; editMode?: boolean; expectedNodeCount?: number; expectedNewNodeCount?: number; requestId?: string; addUnitRequestId?: string }>(), { repairMode: false, editMode: false, expectedNodeCount: undefined, expectedNewNodeCount: undefined, requestId: undefined, addUnitRequestId: undefined });
const isOpen = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();
const { data, registerNode, assignNode, assignNodeForRequest, assignNodeForAddUnitRequest, reorderUnitNode, archiveNode } = useAdminStore();
const toast = useAppToast();

const packet = ref<{ gatewayMac: string; nodeMacs: string[] } | null>(null);
const setupCode = ref("");
const error = ref("");
const saving = ref(false);
const imported = ref(false);
const parsing = ref(false);
let parseTimer: ReturnType<typeof setTimeout> | undefined;

const unit = computed(() => data.value.units.find((item) => item.id === props.unitId && !item.archived_at));
const orderedMacs = computed(() => packet.value ? [packet.value.gatewayMac, ...packet.value.nodeMacs.filter((mac) => mac !== packet.value?.gatewayMac)] : []);
const replacedNodes = computed(() => props.repairMode || props.editMode
  ? data.value.nodes.filter((node) => node.unit_id === props.unitId && node.status === "assigned" && !orderedMacs.value.includes(node.mac_address.toUpperCase()))
  : []);
const newNodesInPacket = computed(() => orderedMacs.value.filter((mac) => {
  const node = existingNode(mac);
  return !(node?.status === "assigned" && node.unit_id === props.unitId);
}).length);

watch(isOpen, (open) => {
  if (!open) return;
  packet.value = null;
  setupCode.value = "";
  error.value = "";
  saving.value = false;
  parsing.value = false;
  imported.value = false;
});

onBeforeUnmount(() => {
  if (parseTimer) clearTimeout(parseTimer);
});

function normalizeMac(value: unknown) {
  const mac = String(value ?? "").trim().toUpperCase();
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : "";
}

function packetNodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeMac(typeof item === "string" ? item : (item as { mac?: unknown })?.mac)).filter(Boolean);
}

function parseSetupCode(value: string) {
  const code = value.trim();
  if (code.startsWith("EV1|")) {
    const parts = Object.fromEntries(code.split("|").slice(1).map((part) => {
      const separator = part.indexOf(":");
      return separator >= 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
    }));
    const gatewayMac = normalizeMac(parts.G);
    const nodeMacs = String(parts.N ?? "").split(",").map(normalizeMac).filter(Boolean);
    return { gatewayMac, nodeMacs };
  }
  const parsed = JSON.parse(code) as { gateway_mac?: unknown; node_macs?: unknown; nodes?: unknown };
  return { gatewayMac: normalizeMac(parsed.gateway_mac), nodeMacs: packetNodes(parsed.node_macs ?? parsed.nodes) };
}

function readSetupCode() {
  packet.value = null;
  error.value = "";
  if (!setupCode.value.trim()) return;
  try {
    const { gatewayMac, nodeMacs } = parseSetupCode(setupCode.value);
    const all = [gatewayMac, ...nodeMacs].filter(Boolean);
    if (!gatewayMac || all.length < 1 || new Set(all).size !== all.length || all.length > 16) {
      error.value = "Enter one Gateway MAC and up to 15 unique sensor-node MACs.";
      return;
    }
    if (props.expectedNodeCount !== undefined && all.length !== props.expectedNodeCount) {
      error.value = `This unit requires exactly ${props.expectedNodeCount} node${props.expectedNodeCount === 1 ? "" : "s"}. The code contains ${all.length}.`;
      return;
    }
    packet.value = { gatewayMac, nodeMacs };
    const newNodeCount = all.filter((mac) => {
      const node = existingNode(mac);
      return !(node?.status === "assigned" && node.unit_id === props.unitId);
    }).length;
    if (props.expectedNewNodeCount !== undefined && newNodeCount !== props.expectedNewNodeCount) {
      packet.value = null;
      error.value = `This request requires exactly ${props.expectedNewNodeCount} new node${props.expectedNewNodeCount === 1 ? "" : "s"}. The code adds ${newNodeCount}.`;
    }
  } catch {
    error.value = "Paste a valid ExcaVision Setup Code.";
  }
}

function scheduleReadSetupCode() {
  if (parseTimer) clearTimeout(parseTimer);
  packet.value = null;
  error.value = "";
  parsing.value = Boolean(setupCode.value.trim());
  parseTimer = setTimeout(() => {
    readSetupCode();
    parsing.value = false;
  }, 250);
}

function existingNode(mac: string) {
  return data.value.nodes.find((node) => node.mac_address.toUpperCase() === mac);
}

async function importPacket() {
  if (!packet.value || saving.value) return;
  if (props.expectedNodeCount !== undefined && orderedMacs.value.length !== props.expectedNodeCount) {
    error.value = `This unit requires exactly ${props.expectedNodeCount} node${props.expectedNodeCount === 1 ? "" : "s"}.`;
    return;
  }
  if (props.expectedNewNodeCount !== undefined && newNodesInPacket.value !== props.expectedNewNodeCount) {
    error.value = `This request requires exactly ${props.expectedNewNodeCount} new node${props.expectedNewNodeCount === 1 ? "" : "s"}.`;
    return;
  }
  if ((props.expectedNodeCount !== undefined || props.expectedNewNodeCount !== undefined) && !props.requestId && !props.addUnitRequestId) {
    error.value = "This request is missing its assignment lock.";
    return;
  }
  const existing = orderedMacs.value.map(existingNode).filter((node): node is Node => Boolean(node));
  const conflict = existing.find((node) => node.status === "assigned" && node.unit_id !== props.unitId);
  if (conflict) {
    error.value = `${conflict.mac_address} is already assigned to another unit.`;
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    if (props.repairMode || props.editMode) {
      for (const node of replacedNodes.value) {
        const archived = await archiveNode(node.id);
        if (!archived.ok) {
          error.value = `Could not replace ${node.mac_address}: ${archived.message}`;
          return;
        }
      }
    }
    for (const mac of orderedMacs.value) {
      let node = existingNode(mac);
      if (!node) {
        const registered = await registerNode(mac);
        if (!registered.ok || !registered.value) {
          error.value = registered.ok ? `Could not register ${mac}.` : registered.message;
          return;
        }
        node = registered.value.node;
      }
      if (node.status === "assigned" && node.unit_id === props.unitId) continue;
      const assigned = props.requestId
        ? await assignNodeForRequest(node.id, props.requestId)
        : props.addUnitRequestId
          ? await assignNodeForAddUnitRequest(node.id, props.addUnitRequestId, props.unitId)
          : await assignNode(node.id, props.unitId);
      if (!assigned.ok) {
        error.value = `Registered ${mac}, but could not assign it: ${assigned.message}`;
        return;
      }
    }
    for (const [index, mac] of orderedMacs.value.entries()) {
      const node = existingNode(mac);
      if (!node) {
        error.value = `Nodes were added, but ${mac} could not be found for ordering.`;
        return;
      }
      const reordered = await reorderUnitNode(node.id, index + 1);
      if (!reordered.ok) {
        error.value = `Nodes were added, but could not set ${mac} to Node ${index + 1}: ${reordered.message}`;
        return;
      }
    }
    imported.value = true;
    toast.add({ title: "Setup Code imported", description: `${orderedMacs.value.length} node${orderedMacs.value.length === 1 ? "" : "s"} added.`, color: "success" });
  } finally {
    saving.value = false;
  }
}

function closeModal() {
  isOpen.value = false;
  if (imported.value) emit("saved");
}

</script>

<template>
  <UModal v-model:open="isOpen" :title="props.repairMode ? 'Paste repair code' : props.editMode ? 'Unit setup' : 'Paste code'">
    <template #body>
      <div class="grid gap-4">
        <div class="flex items-center gap-2 rounded-md border border-dashed border-primary/50 bg-primary/5 px-3 py-2 text-sm font-medium text-primary">
          <UIcon name="i-lucide-clipboard-paste" class="size-4 shrink-0" />
          <span>Paste Setup Code</span>
        </div>
        <UFormField label="Setup Code" required :error="error || undefined">
          <template #hint>
            <span v-if="parsing" class="inline-flex items-center gap-1.5 text-primary" aria-live="polite"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />Reading code…</span>
            <span v-else-if="props.expectedNodeCount !== undefined">Exactly {{ props.expectedNodeCount }} total nodes required</span>
            <span v-else-if="props.expectedNewNodeCount !== undefined">Exactly {{ props.expectedNewNodeCount }} new nodes required</span>
          </template>
          <UTextarea v-model="setupCode" :rows="4" autoresize placeholder="EV1|G:30:76:F5:...|N:30:76:F5:...,30:76:F5:..." class="w-full font-mono text-xs" :aria-busy="parsing" @input="scheduleReadSetupCode" />
        </UFormField>
        <div v-if="packet" class="grid gap-2 rounded-md border border-default bg-default p-3 text-sm">
          <div><span class="text-muted">Gateway</span><code class="ml-2 font-mono text-xs text-highlighted">{{ packet.gatewayMac }}</code></div>
          <div><span class="text-muted">New nodes in packet</span><span class="ml-2 text-highlighted">{{ newNodesInPacket }}</span><span v-if="props.expectedNewNodeCount !== undefined" class="ml-2 text-xs text-muted">/ {{ props.expectedNewNodeCount }} required</span></div>
          <p v-if="(props.repairMode || props.editMode) && replacedNodes.length" class="mt-1 text-xs text-warning">{{ replacedNodes.length }} node{{ replacedNodes.length === 1 ? '' : 's' }} replaced</p>
        </div>
        <UAlert v-if="imported" color="success" variant="subtle" icon="i-lucide-circle-check" title="Registered" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :label="imported ? 'Close' : 'Cancel'" class="admin-accent-control min-h-12" :disabled="saving" @click="closeModal" />
        <UButton v-if="!imported" :label="saving ? (props.repairMode ? 'Applying…' : 'Saving…') : (props.repairMode ? 'Apply repair' : props.editMode ? 'Save setup' : 'Add nodes')" :loading="saving" :disabled="!packet || parsing || saving" class="min-h-12" @click="importPacket" />
      </div>
    </template>
  </UModal>
</template>
