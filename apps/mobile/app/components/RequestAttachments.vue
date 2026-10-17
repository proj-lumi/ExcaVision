<script setup lang="ts">
import { MAX_REQUEST_ATTACHMENTS, MAX_REQUEST_ATTACHMENT_BYTES, hasValidRequestAttachmentSignature, validateRequestAttachment, validateRequestAttachments } from '~/utils/request-attachments'

const files = defineModel<File[]>({ default: () => [] })
const cameraInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)
const previewOpen = ref(false)
const previewIndex = ref(0)
const previewUrls = ref<string[]>([])
const limitMessage = ref('')

const visiblePreviews = computed(() => previewUrls.value.slice(0, Math.min(files.value.length, 3)))
const activeFile = computed(() => files.value[previewIndex.value])
const activePreview = computed(() => previewUrls.value[previewIndex.value])

watch(files, (nextFiles) => {
  previewUrls.value.forEach(url => URL.revokeObjectURL(url))
  previewUrls.value = nextFiles.map(file => URL.createObjectURL(file))
  if (!nextFiles.length) previewOpen.value = false
  previewIndex.value = Math.min(previewIndex.value, Math.max(nextFiles.length - 1, 0))
}, { immediate: true })

onBeforeUnmount(() => previewUrls.value.forEach(url => URL.revokeObjectURL(url)))

async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  input.value = ''
  if (!selected.length) return

  const validationError = selected.map(validateRequestAttachment).find(Boolean)
  if (validationError) {
    limitMessage.value = validationError
    return
  }
  if (!(await Promise.all(selected.map(hasValidRequestAttachmentSignature))).every(Boolean)) {
    limitMessage.value = 'One photo is not a valid image. Try another.'
    return
  }

  const unique = selected.filter(file => !files.value.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))
  const nextFiles = [...files.value, ...unique]
  limitMessage.value = validateRequestAttachments(nextFiles)
  if (limitMessage.value) return
  files.value = nextFiles
}

function openPreview(index: number) {
  if (!files.value[index]) return
  previewIndex.value = index
  previewOpen.value = true
}

function showPrevious() {
  if (files.value.length < 2) return
  previewIndex.value = (previewIndex.value - 1 + files.value.length) % files.value.length
}

function showNext() {
  if (files.value.length < 2) return
  previewIndex.value = (previewIndex.value + 1) % files.value.length
}

function removeCurrentFile() {
  const nextFiles = files.value.filter((_, fileIndex) => fileIndex !== previewIndex.value)
  files.value = nextFiles
  limitMessage.value = ''
  if (!nextFiles.length) previewOpen.value = false
}
</script>

<template>
  <div class="grid gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm font-medium text-highlighted">Photos <span class="font-normal text-muted">(Optional)</span></span>
      <span class="text-xs text-muted">Up to {{ MAX_REQUEST_ATTACHMENTS }} · {{ MAX_REQUEST_ATTACHMENT_BYTES / 1024 / 1024 }} MB each</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-camera" label="Camera" class="hover:bg-primary/10 hover:border-primary/60 hover:text-primary" @click="cameraInput?.click()" />
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-images" label="Gallery" class="hover:bg-primary/10 hover:border-primary/60 hover:text-primary" @click="galleryInput?.click()" />
    </div>
    <input ref="cameraInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" class="sr-only" @change="addFiles" />
    <input ref="galleryInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple class="sr-only" @change="addFiles" />

    <div v-if="files.length" class="grid grid-cols-4 gap-2" aria-label="Attached photos">
      <button v-for="(url, index) in visiblePreviews" :key="`${files[index]?.name}-${index}`" type="button" class="group h-14 min-w-0 overflow-hidden rounded-md bg-default ring ring-accented hover:ring-primary/60 focus-visible:outline-2 focus-visible:outline-primary" :aria-label="`Preview ${files[index]?.name}`" @click="openPreview(index)">
        <img :src="url" alt="" class="h-full w-full object-cover transition-transform group-hover:scale-105" />
      </button>
      <button v-if="files.length > 3" type="button" class="group relative h-14 min-w-0 overflow-hidden rounded-md bg-default ring ring-accented hover:ring-primary/60 focus-visible:outline-2 focus-visible:outline-primary" :aria-label="`Preview ${files.length - 3} more photos`" @click="openPreview(3)">
        <img :src="previewUrls[3]" alt="" class="h-full w-full object-cover transition-transform group-hover:scale-105" />
        <span class="absolute inset-0 grid place-items-center bg-slate-950/65 text-sm font-semibold text-white">+{{ files.length - 3 }}</span>
      </button>
    </div>
    <p v-if="limitMessage" class="text-xs text-error" role="alert" aria-live="polite">{{ limitMessage }}</p>

    <UModal v-model:open="previewOpen" :title="activeFile?.name ?? 'Photo preview'" :description="files.length ? `${previewIndex + 1} of ${files.length}` : undefined" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div v-if="activePreview" class="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md bg-slate-950 p-2">
          <UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-left" aria-label="Previous photo" :disabled="files.length < 2" class="text-white hover:bg-white/10" @click="showPrevious" />
          <img :src="activePreview" :alt="activeFile?.name" class="max-h-[60vh] w-full object-contain" />
          <UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-right" aria-label="Next photo" :disabled="files.length < 2" class="text-white hover:bg-white/10" @click="showNext" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" label="Remove photo" @click="removeCurrentFile" />
          <UButton color="neutral" variant="outline" size="sm" label="Done" @click="previewOpen = false" />
        </div>
      </template>
    </UModal>
  </div>
</template>
