<script setup lang="ts">
// WBS 3.0 — Set Up Sites: Admin review and approval (customer submission is WBS 2.0).
import {
  parseRepairRequestDetails,
  REQUEST_TYPE_LABELS,
  type RequestAttachment,
  type ServiceRequest,
  type ServiceRequestStatus,
} from "~/types/mock";

definePageMeta({ layout: "admin", title: "Work queue" });
useSeoMeta({ title: "Work queue" });

const { data, pending, setRequestStatus, loadRequestAttachments } = useAdminStore();
const supabase = useSupabaseClient();
const toast = useAppToast();
const search = ref("");
const statusFilter = ref<"all" | ServiceRequestStatus>("all");
type RequestTypeFilter = "all" | ServiceRequest["request_type"];
const typeFilter = ref<RequestTypeFilter>("all");
type SortOrder = "latest" | "earliest";
const sortOrder = ref<SortOrder>("latest");
const selected = ref<ServiceRequest | null>(null);
const detailsOpen = ref(false);
const spamOpen = ref(false);
const attachmentsPending = ref(false);
const attachmentsError = ref("");
const inspectingId = ref<string | null>(null);
const statusUpdatingId = ref<string | null>(null);
const attachmentUrls = ref<Record<string, string>>({});
const previewAttachment = ref<RequestAttachment | null>(null);
const previewOpen = ref(false);

const statusOptions = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Completed", value: "completed" },
  { label: "Spam", value: "spam" },
];
const typeOptions = [
  { label: "All", value: "all" },
  { label: "Site installation", value: "site_installation" },
  { label: "Add unit", value: "add_unit" },
  { label: "Add nodes", value: "add_nodes" },
  { label: "Repair", value: "repair" },
];
const sortOptions = [
  { label: "Newest", value: "latest" },
  { label: "Oldest", value: "earliest" },
];
const filtered = computed(() => data.value.service_requests.filter((request) => {
  const key = `${REQUEST_TYPE_LABELS[request.request_type]} ${request.requester_name} ${request.company_name} ${request.contact_email} ${request.contact_phone} ${request.site_name} ${request.address_label} ${parseRepairRequestDetails(request.details).problem}`.toLowerCase();
  return (statusFilter.value === "all" || request.status === statusFilter.value)
    && (typeFilter.value === "all" || request.request_type === typeFilter.value)
    && key.includes(search.value.trim().toLowerCase());
}).sort((a, b) => {
  const difference = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
  return sortOrder.value === "latest" ? -difference : difference;
}));
const filtersActive = computed(() => Boolean(search.value.trim()) || statusFilter.value !== "all" || typeFilter.value !== "all" || sortOrder.value !== "latest");
const selectedSite = computed(() => data.value.sites.find((site) => site.id === selected.value?.site_id && !site.archived_at));
const previewUrl = computed(() => previewAttachment.value ? attachmentUrls.value[previewAttachment.value.id] : undefined);

function attachmentsFor(requestId: string) {
  return data.value.request_attachments.filter((attachment) => attachment.request_id === requestId);
}
function formatSubmitted(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
}
function formatBytes(value: number) {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
}
function requestSummary(request: ServiceRequest) {
  return parseRepairRequestDetails(request.details).problem || "No details";
}
function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  typeFilter.value = "all";
  sortOrder.value = "latest";
}
async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out. Retry to load the photos.`)), 12000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function loadAttachmentPreviews(requestId: string) {
  const result = await withTimeout(loadRequestAttachments(requestId), "Loading photo details");
  if (!result.ok) throw new Error(result.message);

  const attachments = attachmentsFor(requestId);
  if (!attachments.length) return;
  const { data: signed, error } = await withTimeout(
    supabase.storage.from("request-attachments")
      .createSignedUrls(attachments.map((attachment) => attachment.storage_path), 60 * 60),
    "Opening request photos",
  );
  if (error) throw new Error(error.message);
  const urls = attachments.map((attachment, index) => [attachment.id, signed?.[index]?.signedUrl ?? ""] as const);
  if (urls.some(([, url]) => !url)) throw new Error("One or more photos could not be opened.");
  attachmentUrls.value = { ...attachmentUrls.value, ...Object.fromEntries(urls) };
}
async function loadPhotos(requestId: string) {
  attachmentsPending.value = true;
  attachmentsError.value = "";
  try {
    await loadAttachmentPreviews(requestId);
  } catch (error) {
    if (selected.value?.id === requestId) {
      attachmentsError.value = error instanceof Error ? error.message : "Photos could not be loaded.";
    }
  } finally {
    if (selected.value?.id === requestId) attachmentsPending.value = false;
  }
}
async function inspect(request: ServiceRequest) {
  if (inspectingId.value || statusUpdatingId.value) return;
  inspectingId.value = request.id;
  selected.value = request;
  detailsOpen.value = true;
  attachmentsPending.value = true;
  try {
    await loadPhotos(request.id);
  } finally {
    inspectingId.value = null;
  }
}
function openPreview(attachment: RequestAttachment) {
  previewAttachment.value = attachment;
  previewOpen.value = true;
}
async function markCompleted(request: ServiceRequest) {
  if (statusUpdatingId.value) return;
  statusUpdatingId.value = request.id;
  try {
    const result = await setRequestStatus(request.id, "completed");
    if (!result.ok) {
      toast.add({ title: "Request not updated", description: result.message, color: "error" });
      return;
    }
    detailsOpen.value = false;
    toast.add({ title: "Marked complete", color: "success" });
  } finally {
    statusUpdatingId.value = null;
  }
}
function askSpam(request: ServiceRequest) {
  selected.value = request;
  spamOpen.value = true;
}
async function markSpam() {
  if (!selected.value || statusUpdatingId.value) return;
  statusUpdatingId.value = selected.value.id;
  try {
    const result = await setRequestStatus(selected.value.id, "spam");
    if (!result.ok) {
      toast.add({ title: "Request not updated", description: result.message, color: "error" });
      return;
    }
    spamOpen.value = false;
    toast.add({ title: "Marked as spam", color: "success" });
  } finally {
    statusUpdatingId.value = null;
  }
}
async function openSetup(request: ServiceRequest) {
  if (request.status !== "open") return;
  detailsOpen.value = false;
  await navigateTo(`/setup/${request.id}`);
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-header"><h1>Work queue</h1></header>
    <AdminTableShell>
      <template #toolbar>
        <AdminFilterBar :clear-visible="filtersActive" @clear="clearFilters">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search name, phone, site, or address" size="sm" class="min-w-0 flex-1 text-sm" aria-label="Search work queue" />
          <USelect v-model="typeFilter" :items="typeOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Filter request type"><template #default="{ modelValue }">Type: {{ typeOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
          <USelect v-model="statusFilter" :items="statusOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Filter requests by status"><template #default="{ modelValue }">Status: {{ statusOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
          <USelect v-model="sortOrder" :items="sortOptions" value-key="value" size="sm" class="w-40 shrink-0 text-sm" aria-label="Sort requests"><template #default="{ modelValue }">Sort: {{ sortOptions.find((option) => option.value === modelValue)?.label }}</template></USelect>
        </AdminFilterBar>
      </template>
      <AdminListSkeleton v-if="pending" :rows="6" />
      <table v-else class="admin-data-table w-full min-w-[900px] border-collapse text-left text-sm">
        <thead><tr><th>Request</th><th>Requester</th><th>Location</th><th>Summary</th><th>Status</th><th class="text-right">Action</th></tr></thead>
        <tbody>
          <tr v-for="request in filtered" :key="request.id">
            <td><p class="font-medium text-highlighted">{{ REQUEST_TYPE_LABELS[request.request_type] }}</p><p class="mt-1 text-xs text-muted">{{ formatSubmitted(request.submitted_at) }}</p></td>
            <td><p class="text-toned">{{ request.requester_name }}</p><p class="mt-1 text-xs text-muted">{{ request.company_name || "No company" }}</p></td>
            <td class="max-w-56"><p class="truncate text-toned">{{ request.site_name }}</p><p class="mt-1 truncate text-xs text-muted">{{ request.address_label }}</p></td>
            <td class="max-w-72"><p class="line-clamp-2 text-muted">{{ requestSummary(request) }}</p></td>
            <td><AdminStatusBadge kind="request" :value="request.status" /></td>
            <td class="text-right"><div class="flex justify-end gap-1"><UTooltip v-if="request.status === 'open'" text="Set up request"><UButton color="primary" variant="soft" icon="i-lucide-wrench" :aria-label="`Set up ${REQUEST_TYPE_LABELS[request.request_type]}`" size="sm" square class="admin-accent-control justify-center" @click="openSetup(request)" /></UTooltip><UTooltip text="Open request"><UButton color="neutral" variant="ghost" icon="i-lucide-eye" :aria-label="`Open ${REQUEST_TYPE_LABELS[request.request_type]}`" :loading="inspectingId === request.id" :disabled="Boolean(inspectingId || statusUpdatingId)" size="sm" square class="admin-accent-control justify-center" @click="inspect(request)" /></UTooltip></div></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="6" class="p-0"><UEmpty icon="i-lucide-inbox" title="No matching requests" class="min-h-64" /></td></tr>
        </tbody>
      </table>
      <template #footer><span>{{ filtered.length }} of {{ data.service_requests.length }}</span></template>
    </AdminTableShell>

    <UModal v-model:open="detailsOpen" :title="selected?.site_name" :description="selected ? `${REQUEST_TYPE_LABELS[selected.request_type]} · ${formatSubmitted(selected.submitted_at)}` : undefined" :ui="{ content: 'min-w-0 max-w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-3xl' }">
      <template #body>
        <AdminDetailSkeleton v-if="pending" />
        <div v-else-if="selected" class="grid gap-5">
          <div class="flex flex-wrap items-center gap-2"><AdminStatusBadge kind="request" :value="selected.status" /><UBadge v-if="selected.site_id" color="neutral" variant="outline" icon="i-lucide-map-pin-check">Linked site</UBadge></div>
          <section><h3 class="admin-section-title">Summary</h3><p class="mt-2 whitespace-pre-wrap text-sm text-toned">{{ requestSummary(selected) }}</p><p v-if="selected.target_unit_id" class="mt-2 text-xs text-muted">Target unit: {{ data.units.find((unit) => unit.id === selected?.target_unit_id)?.name ?? "Unavailable" }}</p></section>
          <section class="grid gap-3 sm:grid-cols-2" aria-label="Requester details">
            <div><span class="admin-data-label">Requester</span><span class="text-sm text-highlighted">{{ selected.requester_name }}</span></div>
            <div><span class="admin-data-label">Company</span><span class="text-sm text-highlighted">{{ selected.company_name || "Not provided" }}</span></div>
            <div><span class="admin-data-label">Email</span><span class="break-all text-sm text-highlighted">{{ selected.contact_email }}</span></div>
            <div><span class="admin-data-label">Phone</span><span class="text-sm text-highlighted">{{ selected.contact_phone }}</span></div>
          </section>
          <section><h3 class="admin-section-title">Location</h3><div class="mt-2"><LocationMap :latitude="selected.latitude" :longitude="selected.longitude" :label="selected.address_label || selected.site_name" /></div></section>
          <section>
            <div class="flex items-center justify-between gap-3"><h3 class="admin-section-title">Photos</h3><span v-if="!attachmentsPending" class="text-xs text-muted">{{ attachmentsFor(selected.id).length }}/5</span></div>
            <USkeleton v-if="attachmentsPending" class="mt-2 h-28 w-full rounded-lg" />
            <div v-else-if="attachmentsError" class="mt-2 flex min-h-28 items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-3">
              <p class="min-w-0 text-sm text-muted">{{ attachmentsError }}</p>
              <UButton size="sm" color="neutral" variant="outline" label="Retry" :loading="attachmentsPending" :disabled="attachmentsPending" class="admin-accent-control shrink-0" @click="loadPhotos(selected.id)" />
            </div>
            <div v-else-if="attachmentsFor(selected.id).length" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button v-for="attachment in attachmentsFor(selected.id)" :key="attachment.id" type="button" class="group overflow-hidden rounded-lg border border-default bg-default text-left hover:border-primary" @click="openPreview(attachment)">
                <img v-if="attachmentUrls[attachment.id]" :src="attachmentUrls[attachment.id]" :alt="attachment.file_name" class="h-28 w-full object-cover" />
                <div v-else class="grid h-28 place-items-center"><UIcon name="i-lucide-image" class="size-6 text-muted" /></div>
                <div class="border-t border-default px-2 py-1.5"><p class="truncate text-xs font-medium text-highlighted">{{ attachment.file_name }}</p><p class="text-[11px] text-muted">{{ formatBytes(attachment.size_bytes) }}</p></div>
              </button>
            </div>
            <div v-else class="mt-2 rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted">No photos</div>
          </section>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div class="flex flex-wrap gap-2"><UButton v-if="selected && selected.status !== 'spam'" color="error" variant="ghost" icon="i-lucide-shield-alert" label="Spam" :disabled="Boolean(statusUpdatingId)" @click="askSpam(selected)" /><UButton v-if="selected && selected.status === 'open'" color="neutral" variant="outline" icon="i-lucide-circle-check" :label="statusUpdatingId === selected.id ? 'Updating…' : 'Complete'" :loading="statusUpdatingId === selected.id" :disabled="Boolean(statusUpdatingId)" class="admin-accent-control" @click="markCompleted(selected)" /></div>
          <div class="flex flex-wrap justify-end gap-2"><UButton color="neutral" variant="ghost" label="Close" class="admin-accent-control" @click="detailsOpen = false" /><UButton v-if="selected && selected.status === 'open'" icon="i-lucide-wrench" label="Setup" @click="openSetup(selected)" /><UButton v-if="selectedSite" :to="`/sites/${selectedSite.slug}`" icon="i-lucide-arrow-up-right" label="View" @click="detailsOpen = false" /></div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="previewOpen" :title="previewAttachment?.file_name" :description="previewAttachment ? formatBytes(previewAttachment.size_bytes) : undefined" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body><img v-if="previewUrl" :src="previewUrl" :alt="previewAttachment?.file_name" class="max-h-[70vh] w-full rounded-lg bg-default object-contain" /><p v-else class="py-12 text-center text-sm text-muted">Preview unavailable</p></template>
    </UModal>
    <UModal v-model:open="spamOpen" title="Mark as spam" :description="selected?.site_name">
      <template #body><UAlert color="error" variant="subtle" icon="i-lucide-shield-alert" title="Mark this request as spam?" description="This cannot be undone here." /></template>
      <template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline" label="Cancel" class="admin-accent-control" @click="spamOpen = false" /><UButton color="error" :label="statusUpdatingId ? 'Updating…' : 'Spam'" :loading="Boolean(statusUpdatingId)" :disabled="Boolean(statusUpdatingId)" @click="markSpam" /></div></template>
    </UModal>
  </div>
</template>
