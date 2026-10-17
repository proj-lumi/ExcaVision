<script setup lang="ts">
// WBS 3.0 — Set Up Sites
import type { RepairHealthStatus, RepairReadingStatus, RepairUnitReport, RequestedUnitSpec, ServiceRequest } from "~/types/mock";
import { getRequestedCount, parseRepairRequestDetails, REQUEST_TYPE_LABELS } from "~/types/mock";

definePageMeta({ layout: "admin", title: "Setup" });
useSeoMeta({ title: "Setup" });

const route = useRoute();
const { data, pending, approveRequestResources, setRequestStatus, setRequestSetupStep, loadRequestAttachments } = useAdminStore();
const toast = useAppToast();
const request = computed(() => data.value.service_requests.find((item) => item.id === String(route.params.id)));
const site = computed(() => data.value.sites.find((item) => item.id === request.value?.site_id && !item.archived_at));
const units = computed(() => data.value.units.filter((item) => item.site_id === site.value?.id && !item.archived_at));
const selectedUnit = computed(() => data.value.units.find((item) => item.id === selectedUnitId.value && !item.archived_at));
const requestDetails = computed(() => request.value ? parseRepairRequestDetails(request.value.details) : { problem: "", snapshot: null });
const requestedCount = computed(() => request.value ? getRequestedCount(request.value) : null);
const requestedUnitSpecs = computed<RequestedUnitSpec[]>(() => {
  if (!request.value || !['add_unit', 'site_installation'].includes(request.value.request_type)) return [];
  if (request.value.requested_units?.length) return request.value.requested_units;
  const count = request.value.requested_count ?? 0;
  const nodes = request.value.requested_nodes_per_unit ?? 0;
  return count > 0 && nodes > 0 ? Array.from({ length: count }, (_, index) => ({ name: `Unit ${index + 1}`, nodes })) : [];
});
const requestedUnitCount = computed(() => isAddUnit.value || isInstallation.value ? requestedUnitSpecs.value.length || requestedCount.value : null);
const requestedNodeCount = computed(() => isAddNodes.value ? requestedCount.value : null);
const repairReport = computed<RepairUnitReport | null>(() => {
  if (request.value?.request_type !== "repair") return null;
  const stored = request.value.repair_report;
  if (stored?.version === 2) return stored;
  const legacy = requestDetails.value.snapshot;
  if (!legacy) return null;
  return {
    version: 2,
    captured_at: legacy.captured_at,
    unit: legacy.unit,
    nodes: [{ ...legacy.node, sensors: legacy.sensors }],
  };
});
const repairUnit = computed(() => {
  const unitId = repairReport.value?.unit.id ?? request.value?.target_unit_id;
  return unitId ? data.value.units.find((item) => item.id === unitId && !item.archived_at) : undefined;
});

const currentStep = ref(0);
const selectedUnitId = ref("");
const setupPacketOpen = ref(false);
const repairSetupPacketOpen = ref(false);
const inviteOpen = ref(false);
const saving = ref(false);
const attachmentsPending = ref(false);

const steps = computed(() => {
  const type = request.value?.request_type;
  if (type === "repair") return ["Request", "Report"];
  if (type === "add_nodes") return ["Request", "Nodes", "Finish"];
  if (type === "add_unit") return ["Request", "Units", "Finish"];
  return ["Request", "Units", "Finish"];
});
const isInstallation = computed(() => request.value?.request_type === "site_installation");
const isRepair = computed(() => request.value?.request_type === "repair");
const isAddUnit = computed(() => request.value?.request_type === "add_unit");
const isAddNodes = computed(() => request.value?.request_type === "add_nodes");
const activeSite = computed(() => site.value ?? (request.value?.site_id ? data.value.sites.find((item) => item.id === request.value?.site_id && !item.archived_at) : undefined));
function legacyTargetUnitName(value: ServiceRequest) {
  return value.request_type === "add_nodes" ? value.details.match(/^(.+?):\s*Add\s+\d+\s+nodes?\./i)?.[1]?.trim() ?? "" : "";
}
const requestTargetUnit = computed(() => {
  if (!request.value) return undefined;
  const targetId = request.value.target_unit_id;
  if (targetId) return units.value.find((item) => item.id === targetId && !item.archived_at);
  const targetName = legacyTargetUnitName(request.value).toLowerCase();
  return targetName ? units.value.find((item) => item.name.toLowerCase() === targetName && !item.archived_at) : undefined;
});
const workflowUnits = computed(() => {
  if ((isAddUnit.value || isInstallation.value) && request.value) {
    return units.value
      .filter((item) => item.source_request_id === request.value?.id)
      .sort((a, b) => (a.source_request_unit_index ?? 999) - (b.source_request_unit_index ?? 999));
  }
  if (isAddNodes.value && requestTargetUnit.value) return [requestTargetUnit.value];
  return units.value;
});
const activeUnitId = computed(() => selectedUnitId.value || (workflowUnits.value.length === 1 ? workflowUnits.value[0]?.id : ""));
const canSetup = computed(() => request.value?.status === "open");
const canInviteCustomer = computed(() => isInstallation.value
  && canSetup.value
  && currentStep.value === 2
  && activeSite.value?.invitation_status === "not_invited");

function assignedNodeCount(unitId: string) {
  return data.value.nodes.filter((node) => node.unit_id === unitId && node.status === "assigned").length;
}
function hasAssignedNodes(unitId: string) {
  return assignedNodeCount(unitId) > 0;
}
function requestedUnitSpec(unit: { source_request_unit_index: number | null }) {
  if (!isAddUnit.value && !isInstallation.value) return undefined;
  if (unit.source_request_unit_index !== null) return requestedUnitSpecs.value[unit.source_request_unit_index];
  const legacyNodes = request.value?.requested_nodes_per_unit;
  return legacyNodes ? { name: "", nodes: legacyNodes } : undefined;
}
function remainingNodesForUnit(unitId: string) {
  const unit = workflowUnits.value.find((item) => item.id === unitId);
  const spec = unit ? requestedUnitSpec(unit) : undefined;
  if (!spec) return undefined;
  return Math.max(0, spec.nodes - assignedNodeCount(unitId));
}
function isUnitConfigured(unitId: string) {
  const remaining = remainingNodesForUnit(unitId);
  return remaining === undefined ? hasAssignedNodes(unitId) : remaining === 0;
}
const requestedUnitEntries = computed(() => {
  const hasIndexedUnits = workflowUnits.value.some((item) => item.source_request_unit_index !== null);
  return requestedUnitSpecs.value.map((spec, index) => ({
    index,
    spec,
    unit: workflowUnits.value.find((item) => item.source_request_unit_index === index) ?? (!hasIndexedUnits ? workflowUnits.value[index] : undefined),
  }));
});
const allRequestedUnitsCreated = computed(() => requestedUnitEntries.value.length > 0 && requestedUnitEntries.value.every((entry) => Boolean(entry.unit)));
const allUnitsConfigured = computed(() => allRequestedUnitsCreated.value && requestedUnitEntries.value.every((entry) => entry.unit && isUnitConfigured(entry.unit.id)));
const addedNodeCount = computed(() => request.value
  ? data.value.nodes.filter((node) => node.source_request_id === request.value?.id && node.status === "assigned").length
  : 0);
const addNodesConfigured = computed(() => requestedNodeCount.value !== null && addedNodeCount.value === requestedNodeCount.value);
const maxReachableStep = computed(() => {
  if (isRepair.value) return 1;
  if (isAddNodes.value) return addNodesConfigured.value ? 2 : 1;
  if (isAddUnit.value) {
    if (!allRequestedUnitsCreated.value) return 0;
    return allUnitsConfigured.value ? 2 : 1;
  }
  if (!activeSite.value || !allRequestedUnitsCreated.value) return 0;
  return allUnitsConfigured.value ? 2 : 1;
});

function inferredResumeStep(value: ServiceRequest) {
  return Math.max(0, Math.min(value.setup_step, maxReachableStep.value));
}

async function goToStep(step: number) {
  const nextStep = Math.max(0, Math.min(step, maxReachableStep.value));
  currentStep.value = nextStep;
  if (!request.value || request.value.setup_step === nextStep) return;
  const result = await setRequestSetupStep(request.value.id, nextStep);
  if (!result.ok) toast.add({ title: "Progress not saved", description: result.message, color: "error" });
}

watch(request, (value) => {
  if (!value) return;
  if (value.request_type === "add_nodes") selectedUnitId.value = requestTargetUnit.value?.id ?? "";
  if (value.request_type === "add_unit" && workflowUnits.value.length === 1) selectedUnitId.value = workflowUnits.value[0]?.id ?? "";
  const resumeStep = inferredResumeStep(value);
  currentStep.value = resumeStep;
  if (value.setup_step !== resumeStep) void goToStep(resumeStep);
}, { immediate: true });
watch([units, workflowUnits], ([, scopedUnits]) => {
  if (!selectedUnitId.value && scopedUnits.length === 1) selectedUnitId.value = scopedUnits[0]?.id ?? "";
}, { immediate: true });

async function next() {
  await goToStep(currentStep.value + 1);
}
async function back() {
  await goToStep(currentStep.value - 1);
}
async function approveCreation() {
  if (!request.value || saving.value || (!isInstallation.value && !isAddUnit.value)) return;
  saving.value = true;
  try {
    const result = await approveRequestResources(request.value.id);
    if (!result.ok) {
      toast.add({ title: "Approval failed", description: result.message, color: "error" });
      return;
    }
    toast.add({ title: "Creation approved", color: "success" });
    await goToStep(1);
  } finally {
    saving.value = false;
  }
}
function openRequestedUnit(entry: { unit?: { id: string } }) {
  if (!entry.unit) {
    toast.add({ title: "Unit unavailable", color: "error" });
    return;
  }
  selectedUnitId.value = entry.unit.id;
  setupPacketOpen.value = true;
}
function openNodesSetup() {
  if (!activeUnitId.value) {
    toast.add({ title: "Choose a unit first", description: "Select the unit that will receive these nodes.", color: "warning" });
    return;
  }
  selectedUnitId.value = activeUnitId.value;
  setupPacketOpen.value = true;
}
async function finishRepair() {
  if (!request.value || saving.value) return;
  saving.value = true;
  try {
    const result = await setRequestStatus(request.value.id, "completed");
    if (!result.ok) toast.add({ title: "Repair not closed", description: result.message, color: "error" });
    else {
      toast.add({ title: "Repair complete", color: "success" });
      await navigateTo("/requests", { replace: true });
    }
  } finally {
    saving.value = false;
  }
}
async function loadAttachments() {
  if (!request.value || attachmentsPending.value) return;
  attachmentsPending.value = true;
  try {
    const result = await loadRequestAttachments(request.value.id);
    if (!result.ok) toast.add({ title: "Readings unavailable", description: result.message, color: "error" });
  } finally {
    attachmentsPending.value = false;
  }
}
async function finishSetup() {
  if (!request.value || saving.value || !canSetup.value) return;
  if (isInstallation.value && activeSite.value?.invitation_status === "not_invited") {
    inviteOpen.value = true;
    return;
  }
  saving.value = true;
  try {
    const result = await setRequestStatus(request.value.id, "completed");
    if (!result.ok) {
      toast.add({ title: isInstallation.value && activeSite.value?.invitation_status !== "not_invited" ? "Invite sent; installation not complete" : isInstallation.value ? "Installation not complete" : "Setup not complete", description: result.message, color: "error" });
      return;
    }
    toast.add({ title: isInstallation.value ? "Installation complete" : "Setup complete", color: "success" });
    await navigateTo("/requests", { replace: true });
  } finally {
    saving.value = false;
  }
}
async function onInvitationSent() {
  if (isInstallation.value) await finishSetup();
}
async function startSetup() {
  if (!canSetup.value) return;
  if (isInstallation.value || isAddUnit.value) {
    await approveCreation();
    return;
  }
  if (isRepair.value) void loadAttachments();
  await goToStep(1);
}
function reportReadingColor(status: RepairReadingStatus) {
  return ({ Normal: "success", Warning: "warning", Critical: "error", "No data": "neutral" } as const)[status];
}
function reportReadingIcon(status: RepairReadingStatus) {
  return ({ Normal: "i-lucide-gauge", Warning: "i-lucide-triangle-alert", Critical: "i-lucide-octagon-alert", "No data": "i-lucide-database-zap" } as const)[status];
}
function reportHealthColor(status: RepairHealthStatus) {
  return ({ Healthy: "success", Attention: "warning" } as const)[status];
}
function reportHealthIcon(status: RepairHealthStatus) {
  return ({ Healthy: "i-lucide-heart-pulse", Attention: "i-lucide-heart-crack" } as const)[status];
}

function openRepairSetup() {
  if (!repairUnit.value) return;
  repairSetupPacketOpen.value = true;
}

async function onRepairPacketSaved() {
  repairSetupPacketOpen.value = false;
  await finishRepair();
}

async function onPacketSaved() {
  setupPacketOpen.value = false;
  if (isInstallation.value || isAddUnit.value) {
    selectedUnitId.value = "";
    return;
  }
  await next();
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header">
      <div>
        <h1>{{ request ? REQUEST_TYPE_LABELS[request.request_type] : "Request setup" }}</h1>
        <p v-if="request" class="mt-1 text-sm text-muted">{{ request.site_name }} · {{ request.requester_name }}</p>
      </div>
      <UButton to="/requests" color="neutral" variant="outline" icon="i-lucide-arrow-left" label="Back" class="admin-accent-control" />
    </header>

    <AdminDetailSkeleton v-if="pending" />
    <UEmpty v-else-if="!request" icon="i-lucide-inbox" title="Request not found" class="min-h-64" />
    <template v-else>
      <UCard v-if="!canSetup">
        <template #header><h2 class="font-semibold text-highlighted">Request closed</h2></template>
        <template #footer><div class="flex justify-end gap-2"><UButton to="/requests" color="neutral" variant="outline" icon="i-lucide-arrow-left" label="Back" class="admin-accent-control" /><UButton v-if="canInviteCustomer" icon="i-lucide-send" label="Invite customer" @click="inviteOpen = true" /></div></template>
      </UCard>
      <template v-else>
      <div class="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,.32fr)]">
        <div class="grid min-w-0 gap-3">
          <UCard class="h-fit">
            <div class="flex flex-wrap items-center gap-1.5" aria-label="Setup progress">
              <template v-for="(step, index) in steps" :key="step">
                <button type="button" class="rounded-md px-1.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50" :class="index === currentStep ? 'bg-primary/10 font-semibold text-primary' : index <= maxReachableStep ? 'text-toned hover:bg-elevated' : 'text-muted'" :disabled="index > maxReachableStep" @click="goToStep(index)">{{ index + 1 }}. {{ step }}</button>
                <UIcon v-if="index < steps.length - 1" name="i-lucide-chevron-right" class="size-3.5 text-muted" />
              </template>
            </div>
          </UCard>

      <UCard v-if="currentStep === 0">
        <template #header><h2 class="font-semibold text-highlighted">Request</h2></template>
        <div class="grid gap-4 text-sm sm:grid-cols-2">
          <div><span class="admin-data-label">Requester</span><span class="text-highlighted">{{ request.requester_name }}</span></div>
          <div><span class="admin-data-label">Company</span><span class="text-highlighted">{{ request.company_name || "Not provided" }}</span></div>
          <div class="sm:col-span-2"><span class="admin-data-label">Details</span><span class="whitespace-pre-wrap text-toned">{{ requestDetails.problem || "No details provided." }}</span></div>
          <div v-if="requestTargetUnit" class="sm:col-span-2"><span class="admin-data-label">Target unit</span><span class="text-highlighted">{{ requestTargetUnit.name }}</span></div>
          <div v-if="requestedCount && !isAddUnit && !isInstallation" class="sm:col-span-2"><span class="admin-data-label">Requested</span><span class="text-highlighted">{{ requestedCount }} {{ requestedCount === 1 ? "node" : "nodes" }}</span></div>
          <div class="sm:col-span-2"><span class="admin-data-label">Location</span><span class="text-toned">{{ request.address_label }}</span></div>
          <div v-if="isInstallation || isAddUnit" class="sm:col-span-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <span class="admin-data-label">Approval creates</span>
            <div class="grid gap-2 text-highlighted">
              <div v-if="isInstallation" class="flex gap-2"><UIcon name="i-lucide-map-pin" class="mt-0.5 size-4 shrink-0 text-primary" /><span>Site: {{ request.site_name }}</span></div>
              <div v-for="(item, index) in requestedUnitSpecs" :key="`${item.name}-${index}`" class="flex gap-2"><UIcon name="i-lucide-layers-3" class="mt-0.5 size-4 shrink-0 text-primary" /><span>{{ item.name }} · {{ item.nodes }} {{ item.nodes === 1 ? "node" : "nodes" }}</span></div>
            </div>
          </div>
        </div>
        <template #footer><div class="flex justify-end"><UButton :label="isInstallation || isAddUnit ? (saving ? 'Creating…' : 'Approve and create') : 'Start'" :icon="isInstallation || isAddUnit ? 'i-lucide-circle-check' : 'i-lucide-arrow-right'" :loading="saving" :disabled="saving" @click="startSetup" /></div></template>
      </UCard>

      <UCard v-else-if="isRepair && currentStep === 1">
        <template #header>
          <div class="flex items-center justify-between gap-3"><h2 class="font-semibold text-highlighted">Repair report</h2><span v-if="repairReport" class="text-xs text-muted">Captured {{ new Date(repairReport.captured_at).toLocaleString('en-PH') }}</span></div>
        </template>
        <div v-if="repairReport" class="grid gap-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="grid gap-1"><span class="text-xs text-muted">Unit</span><strong class="text-highlighted">{{ repairReport.unit.name }}</strong></div>
            <div class="grid gap-1"><span class="text-xs text-muted">Reading</span><UBadge :color="reportReadingColor(repairReport.unit.reading_status)" :icon="reportReadingIcon(repairReport.unit.reading_status)" variant="subtle" class="w-fit gap-1.5">{{ repairReport.unit.reading_status }}</UBadge></div>
            <div class="grid gap-1"><span class="text-xs text-muted">Health</span><UBadge :color="reportHealthColor(repairReport.unit.health_status)" :icon="reportHealthIcon(repairReport.unit.health_status)" variant="subtle" class="w-fit gap-1.5">{{ repairReport.unit.health_status }}</UBadge></div>
          </div>
          <div class="grid gap-2">
            <div v-for="node in repairReport.nodes" :key="node.id" class="grid gap-2 rounded-md border border-default bg-default p-3">
              <div class="flex items-center justify-between gap-3"><div class="min-w-0"><strong class="block truncate text-sm text-highlighted">{{ node.name }}</strong><span class="text-xs text-muted">{{ node.role }} · Node {{ node.position ?? '—' }}</span></div><UBadge :color="reportHealthColor(node.health_status)" :icon="reportHealthIcon(node.health_status)" variant="subtle" size="sm" class="gap-1.5">{{ node.health_status }}</UBadge></div>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div v-for="sensor in node.sensors" :key="sensor.id" class="grid gap-1 rounded border border-default p-2">
                  <div class="flex items-center justify-between gap-2"><span class="text-xs text-muted">Sensor {{ sensor.position }}</span><strong class="font-mono text-sm text-highlighted">{{ sensor.value_deg === null ? '—' : `${sensor.value_deg.toFixed(2)}°` }}</strong></div>
                  <UBadge :color="reportReadingColor(sensor.status)" :icon="reportReadingIcon(sensor.status)" variant="subtle" size="sm" class="w-fit gap-1.5">{{ sensor.status }}</UBadge>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="rounded-md border border-default bg-default p-4 text-sm text-toned">No captured unit report was included.</div>
        <p class="whitespace-pre-wrap text-sm text-toned">{{ requestDetails.problem || "No repair details were included." }}</p>
        <span v-if="attachmentsPending" class="flex items-center gap-2 text-sm text-muted" aria-live="polite"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />Loading photos…</span>
        <template #footer><div class="flex flex-wrap justify-between gap-2"><UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Back" @click="back" /><div class="flex flex-wrap justify-end gap-2"><UButton v-if="repairUnit" :to="`/units/${repairUnit.slug}`" color="neutral" variant="outline" icon="i-lucide-external-link" label="View unit" /><UButton label="Paste repair code" icon="i-lucide-clipboard-paste" :disabled="saving || !repairUnit" @click="openRepairSetup" /></div></div></template>
      </UCard>

      <UCard v-else-if="(isInstallation || isAddUnit) && currentStep === 1">
        <template #header><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-semibold text-highlighted">Monitoring units</h2><span class="text-xs text-muted">{{ requestedUnitEntries.filter((entry) => entry.unit && isUnitConfigured(entry.unit.id)).length }}/{{ requestedUnitEntries.length }} ready</span></div></template>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="entry in requestedUnitEntries"
            :key="entry.index"
            type="button"
            class="group grid min-h-28 gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-wait disabled:opacity-60"
            :class="entry.unit && isUnitConfigured(entry.unit.id) ? 'border-success/40 bg-success/5 hover:border-success' : 'border-dashed border-default bg-default hover:border-primary hover:bg-primary/5'"
            :disabled="saving || !entry.unit"
            @click="openRequestedUnit(entry)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0"><span class="block truncate font-medium text-highlighted">{{ entry.spec.name }}</span><span class="text-xs text-muted">{{ entry.unit ? assignedNodeCount(entry.unit.id) : 0 }}/{{ entry.spec.nodes }} nodes</span></div>
              <UBadge v-if="entry.unit && isUnitConfigured(entry.unit.id)" color="success" variant="soft" icon="i-lucide-circle-check">Ready</UBadge>
              <UBadge v-else color="warning" variant="soft">Not set up</UBadge>
            </div>
            <div class="flex items-center gap-2 text-sm font-medium" :class="entry.unit && isUnitConfigured(entry.unit.id) ? 'text-toned group-hover:text-primary' : 'text-primary'">
              <UIcon name="i-lucide-clipboard-paste" class="size-4" />
              <span>{{ entry.unit && isUnitConfigured(entry.unit.id) ? "Edit setup" : "Paste code" }}</span>
            </div>
          </button>
        </div>
        <template #footer><div class="flex justify-between"><UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Back" @click="back" /><UButton label="Continue" icon="i-lucide-arrow-right" :disabled="!allUnitsConfigured" @click="next" /></div></template>
      </UCard>

      <UCard v-else-if="isAddNodes && currentStep === 1">
        <template #header><div class="flex items-center justify-between gap-3"><h2 class="font-semibold text-highlighted">Add nodes</h2><UBadge :color="addNodesConfigured ? 'success' : 'warning'" variant="soft" :icon="addNodesConfigured ? 'i-lucide-circle-check' : undefined">{{ addNodesConfigured ? "Ready" : "Needs code" }}</UBadge></div></template>
        <button type="button" class="flex w-full items-center justify-between gap-3 rounded-md border border-dashed border-primary/50 bg-primary/5 p-3 text-left hover:border-primary" :disabled="!activeUnitId" @click="openNodesSetup">
          <div class="min-w-0"><span class="block truncate font-medium text-highlighted">{{ selectedUnit?.name ?? "Target unit unavailable" }}</span><span class="text-xs text-muted">Exactly {{ requestedNodeCount }} new {{ requestedNodeCount === 1 ? "node" : "nodes" }}</span></div>
          <span class="flex shrink-0 items-center gap-2 text-sm font-medium text-primary"><UIcon name="i-lucide-clipboard-paste" class="size-4" />Paste code</span>
        </button>
        <template #footer><div class="flex justify-between"><UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Back" @click="back" /><UButton label="Continue" icon="i-lucide-arrow-right" :disabled="!addNodesConfigured" @click="next" /></div></template>
      </UCard>

      <UCard v-else>
        <template #header><h2 class="font-semibold text-highlighted">Finish</h2></template>
        <p class="text-sm text-toned">{{ isInstallation ? activeSite?.invitation_status === "not_invited" ? "Invite the customer to complete this installation." : "The customer has been invited." : "Everything is ready." }}</p>
        <template #footer><div class="flex justify-between gap-2"><UButton color="neutral" variant="ghost" label="Back" @click="back" /><UButton :label="canInviteCustomer ? 'Invite customer' : isInstallation ? 'Complete installation' : 'Complete'" :icon="canInviteCustomer ? 'i-lucide-send' : 'i-lucide-circle-check'" :loading="saving" :disabled="saving" @click="finishSetup" /></div></template>
      </UCard>
        </div>
        <UCard class="h-fit lg:sticky lg:top-4"><div class="grid gap-2 text-sm"><span class="text-xs text-muted">Request status</span><AdminStatusBadge kind="request" :value="request.status" /><span class="mt-2 text-xs text-muted">Contact</span><span class="text-highlighted break-words">{{ request.contact_email }}</span><span class="text-toned">{{ request.contact_phone }}</span></div></UCard>
      </div>
      </template>
    </template>

    <SetupPacketModal v-if="selectedUnit" v-model:open="setupPacketOpen" :unit-id="selectedUnit.id" :edit-mode="isAddUnit || isInstallation" :expected-node-count="isAddUnit || isInstallation ? requestedUnitSpec(selectedUnit)?.nodes : undefined" :expected-new-node-count="isAddNodes ? requestedNodeCount ?? undefined : undefined" :request-id="isAddNodes ? request?.id : undefined" :add-unit-request-id="isAddUnit || isInstallation ? request?.id : undefined" @saved="onPacketSaved" />
    <SetupPacketModal v-if="repairUnit" v-model:open="repairSetupPacketOpen" :unit-id="repairUnit.id" repair-mode @saved="onRepairPacketSaved" />
    <InviteUserModal v-if="activeSite" v-model:open="inviteOpen" :site="activeSite" :success-toast="!isInstallation" @sent="onInvitationSent" />
  </div>
</template>
