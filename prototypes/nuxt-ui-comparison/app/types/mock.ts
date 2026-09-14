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

export interface CustomerUnit {
  id: string
  name: string
  status: 'Active' | 'Offline'
  currentTilt: number
  threshold: number
  sensorCount: number
  updated: string
  trend: number[]
}

export interface CustomerAlert {
  id: string
  kind: 'Early Advisory' | 'Threshold Warning'
  severity: 'warning' | 'critical'
  unit: string
  detail: string
  value: number
  time: string
  acknowledged: boolean
}

export interface CustomerServiceRequest {
  id: string
  type: 'Repair' | 'More coverage'
  detail: string
  status: 'Received' | 'Under review' | 'Scheduled' | 'Complete'
  submitted: string
}

export interface MockData {
  requests: ServiceRequest[]
  sites: Site[]
  installations: Installation[]
  inventory: InventoryNode[]
  customerUnits: CustomerUnit[]
  customerAlerts: CustomerAlert[]
  customerRequests: CustomerServiceRequest[]
}
