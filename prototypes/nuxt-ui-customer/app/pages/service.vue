<script setup lang="ts">
import type { CustomerServiceRequest } from '~/types/mock'
import { statusColor } from '~/utils/presentation'

definePageMeta({ layout: 'customer' })
useSeoMeta({ title: 'Service' })

const { data, submitCustomerRequest } = useMockStore()
const type = ref<CustomerServiceRequest['type']>('Repair')
const detail = ref('')
const submitted = ref(false)
const types = [
  { label: 'Repair', value: 'Repair', description: 'Something is damaged or not reporting.' },
  { label: 'More coverage', value: 'More coverage', description: 'Monitor another area at this site.' }
]

function submit() {
  if (detail.value.trim().length < 10) return
  submitCustomerRequest(type.value, detail.value.trim())
  detail.value = ''
  submitted.value = true
}
</script>

<template>
  <div class="grid gap-4">
    <div class="page-heading"><div><p class="text-sm text-muted">Site support</p><h1 class="text-2xl font-semibold">Request service</h1></div></div>

    <UCard>
      <div class="grid gap-5">
        <UFormField label="What do you need?" required>
          <URadioGroup v-model="type" :items="types" variant="card" value-key="value" />
        </UFormField>
        <UFormField label="What should we inspect?" description="Describe the area, concern, and when it started." required>
          <UTextarea v-model="detail" :rows="5" autoresize :maxlength="1000" placeholder="Example: North wall Node 2 stopped reporting after heavy rain." />
        </UFormField>
        <UAlert v-if="submitted" color="success" variant="subtle" title="Request sent" description="ExcaVision staff can now review it in the Admin work queue." />
        <UButton block size="lg" label="Send request" :disabled="detail.trim().length < 10" @click="submit" />
      </div>
    </UCard>

    <UCard>
      <template #header><h2 class="font-semibold">Recent requests</h2></template>
      <div class="record-list">
        <div v-for="request in data.customerRequests" :key="request.id" class="record-row">
          <div class="record-main"><h3>{{ request.type }}</h3><p>{{ request.detail }}</p><p>{{ request.id }} · {{ request.submitted }}</p></div>
          <UBadge :color="statusColor(request.status)" variant="subtle">{{ request.status }}</UBadge>
        </div>
      </div>
    </UCard>
  </div>
</template>
