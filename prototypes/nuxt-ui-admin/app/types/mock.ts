export type RequestStatus = 'intake' | 'approved' | 'in_progress' | 'completed'
export type RequestType = 'Installation' | 'Repair' | 'More coverage'
export type UnitStage = 'Planning' | 'Field ready' | 'Commissioning' | 'Active'

export interface ServiceRequest {
  id: string
  type: RequestType
  customer: string
  company: string
  email: string
  site: string
  submitted: string
  status: RequestStatus
  summary: string
}

export interface Site {
  id: string
  name: string
  customer: string
  location: string
  activeUnits: number
  customerAccess: 'Invited' | 'Active' | 'Not invited'
}

export interface Installation {
  id: string
  name: string
  site: string
  stage: UnitStage
  plannedNodes: number
  assignedNodes: number
  gatewayReady: boolean
}

export interface InventoryNode {
  id: string
  serial: string
  mac: string
  state: 'Available' | 'Assigned' | 'Deployed' | 'Needs inspection'
  assignment: string | null
}

export interface AdminMockData {
  requests: ServiceRequest[]
  sites: Site[]
  installations: Installation[]
  inventory: InventoryNode[]
}
