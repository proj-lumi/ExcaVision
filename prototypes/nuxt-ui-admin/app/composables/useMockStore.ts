import seed from '~/data/mock.json'
import type { AdminMockData, RequestStatus, UnitStage } from '~/types/mock'

export function useMockStore() {
  const data = useState<AdminMockData>('excavision-admin-mock-data', () => JSON.parse(JSON.stringify(seed)) as AdminMockData)

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

  return { data, setRequestStatus, advanceInstallation, assignNextNode }
}
