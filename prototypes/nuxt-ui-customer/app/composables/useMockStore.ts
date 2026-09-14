import seed from '~/data/mock.json'
import type { CustomerMockData, CustomerServiceRequest } from '~/types/mock'

export function useMockStore() {
  const data = useState<CustomerMockData>('excavision-customer-mock-data', () => JSON.parse(JSON.stringify(seed)) as CustomerMockData)

  function updateThreshold(id: string, value: number) {
    const unit = data.value.customerUnits.find(item => item.id === id)
    if (unit) unit.threshold = value
  }

  function acknowledgeAlert(id: string) {
    const alert = data.value.customerAlerts.find(item => item.id === id)
    if (alert) alert.acknowledged = true
  }

  function submitCustomerRequest(type: CustomerServiceRequest['type'], detail: string) {
    data.value.customerRequests.unshift({
      id: `SR-${300 + data.value.customerRequests.length + 1}`,
      type,
      detail,
      status: 'Received',
      submitted: 'Today'
    })
  }

  return { data, updateThreshold, acknowledgeAlert, submitCustomerRequest }
}
