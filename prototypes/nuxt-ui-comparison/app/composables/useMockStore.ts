import seed from '~/data/mock.json'
import type { CustomerServiceRequest, MockData, RequestStatus, UnitStage } from '~/types/mock'

export function useMockStore() {
  const data = useState<MockData>('excavision-mock-data', () => JSON.parse(JSON.stringify(seed)) as MockData)

  function setRequestStatus(id: string, status: RequestStatus) {
    const request = data.value.requests.find(item => item.id === id)
    if (request) request.status = status
  }

  function advanceInstallation(id: string) {
    const order: UnitStage[] = ['Planning', 'Field ready', 'Commissioning', 'Active']
    const unit = data.value.installations.find(item => item.id === id)
    if (!unit) return
    unit.stage = order[Math.min(order.indexOf(unit.stage) + 1, order.length - 1)]!
  }

  function assignNextNode(id: string) {
    const unit = data.value.installations.find(item => item.id === id)
    const node = data.value.inventory.find(item => item.state === 'Available')
    if (!unit || !node || unit.assignedNodes >= unit.plannedNodes) return
    unit.assignedNodes += 1
    node.state = 'Assigned'
    node.assignment = `${unit.name} · Position ${unit.assignedNodes}`
  }

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

  return {
    data,
    setRequestStatus,
    advanceInstallation,
    assignNextNode,
    updateThreshold,
    acknowledgeAlert,
    submitCustomerRequest
  }
}
