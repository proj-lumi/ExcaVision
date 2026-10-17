<script setup lang="ts">
// WBS 2.0 — Manage Requests: customer requests for more nodes or another unit.
import type { CoverageKind, RequestedUnitSpec } from '~/types/mock'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  unitId?: string
  nodesOnly?: boolean
}>(), {
  unitId: '',
  nodesOnly: false
})
const isOpen = defineModel<boolean>('open', { default: false })

const { data, submitCustomerRequest } = useCustomerStore()
const coverageSubmitted = ref(false)
const submitting = ref(false)
const selectedUnitId = ref(props.unitId)
const nodeCount = ref(1)
const requestedUnits = ref<RequestedUnitSpec[]>([{ name: '', nodes: 3 }])
const detail = ref('')
const attachmentFiles = ref<File[]>([])
const requestType = computed<CoverageKind>(() => props.nodesOnly ? 'add_nodes' : 'add_unit')
const unitItems = computed(() => (data.value?.units ?? []).map(unit => ({ label: unit.name, value: unit.id })))
const selectedUnit = computed(() => data.value?.units.find(unit => unit.id === selectedUnitId.value))
const siteName = computed(() => data.value?.site.name ?? 'Current site')
const canSubmit = computed(() => {
  if (props.nodesOnly) return Boolean(selectedUnitId.value) && nodeCount.value >= 1 && nodeCount.value <= 20
  return requestedUnits.value.length >= 1 && requestedUnits.value.length <= 20 && requestedUnits.value.every(unit => unit.name.trim().length >= 1 && unit.name.trim().length <= 120 && unit.nodes >= 1 && unit.nodes <= 16)
})

watch(unitItems, items => {
  if (!selectedUnitId.value && items[0]) selectedUnitId.value = String(items[0].value)
}, { immediate: true })

watch(() => props.unitId, value => {
  if (value) selectedUnitId.value = value
})

watch(isOpen, open => {
  if (!open) return
  coverageSubmitted.value = false
  nodeCount.value = 1
  requestedUnits.value = [{ name: '', nodes: 3 }]
  detail.value = ''
  attachmentFiles.value = []
  if (props.unitId) selectedUnitId.value = props.unitId
})

async function submit() {
  if (submitting.value || !canSubmit.value) return

  const requestDetail = props.nodesOnly
    ? `Add ${nodeCount.value} ${nodeCount.value === 1 ? 'node' : 'nodes'}. ${detail.value.trim()}`
    : `Add ${requestedUnits.value.length} monitoring ${requestedUnits.value.length === 1 ? 'unit' : 'units'}. ${detail.value.trim()}`
  submitting.value = true
  try {
    const id = await submitCustomerRequest(
      requestType.value,
      requestDetail,
      attachmentFiles.value,
      props.nodesOnly ? selectedUnitId.value : undefined,
      props.nodesOnly ? nodeCount.value : requestedUnits.value.length,
      props.nodesOnly ? undefined : requestedUnits.value,
    )
    if (!id) return
    coverageSubmitted.value = true
    detail.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="props.nodesOnly ? 'Add nodes' : 'Add unit'">
    <template #body>
      <div v-if="coverageSubmitted" class="grid gap-4">
        <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" title="Request sent" description="Your request has been sent to the site team." />
        <UButton block size="sm" label="Done" @click="isOpen = false" />
      </div>
      <div v-else class="grid gap-5">
        <div v-if="!props.nodesOnly" class="grid gap-3">
          <UFormField label="Site" class="w-full">
            <div class="flex min-h-10 items-center gap-2 rounded-md border border-default bg-elevated px-3 text-sm text-highlighted" aria-readonly="true">
              <UIcon name="i-lucide-lock-keyhole" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{{ siteName }}</span>
            </div>
          </UFormField>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium text-highlighted">Requested units</span>
            <UButton v-if="requestedUnits.length < 20" color="neutral" variant="ghost" size="xs" icon="i-lucide-plus" label="Add unit" @click="requestedUnits.push({ name: '', nodes: 3 })" />
          </div>
          <div class="grid gap-2">
            <div v-for="(unit, index) in requestedUnits" :key="index" class="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-end gap-2">
              <UFormField :label="`Unit ${index + 1} name`" required class="min-w-0">
                <UInput v-model="unit.name" placeholder="Enter unit name" maxlength="120" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="Nodes" required class="min-w-0">
                <UInput v-model.number="unit.nodes" type="number" min="1" max="16" size="sm" class="w-full" />
              </UFormField>
              <UButton v-if="requestedUnits.length > 1" color="neutral" variant="ghost" size="sm" icon="i-lucide-x" aria-label="Remove unit" class="mb-0.5" @click="requestedUnits.splice(index, 1)" />
            </div>
          </div>
        </div>

        <div v-if="props.nodesOnly" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Unit" class="w-full">
            <div class="flex min-h-10 items-center gap-2 border-s-2 border-primary/60 bg-primary/5 px-3 text-sm text-highlighted" aria-readonly="true">
              <UIcon name="i-lucide-lock-keyhole" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{{ selectedUnit?.name ?? 'Current unit' }}</span>
            </div>
          </UFormField>
          <UFormField label="Nodes" required class="w-full">
            <UInput v-model.number="nodeCount" type="number" min="1" max="20" size="sm" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Request details (Optional)">
          <UTextarea v-model="detail" :rows="4" :maxlength="1000" placeholder="Add helpful details for this request" size="sm" :ui="{ base: 'resize-none' }" class="w-full" />
        </UFormField>
        <RequestAttachments v-model="attachmentFiles" />
      </div>
    </template>
    <template v-if="!coverageSubmitted" #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" size="sm" label="Cancel" :disabled="submitting" @click="isOpen = false" />
        <UButton size="sm" :label="submitting ? 'Sending…' : 'Send'" :loading="submitting" :disabled="!canSubmit || submitting" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
