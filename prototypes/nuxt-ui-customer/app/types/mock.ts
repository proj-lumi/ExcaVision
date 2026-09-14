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

export interface CustomerMockData {
  customerUnits: CustomerUnit[]
  customerAlerts: CustomerAlert[]
  customerRequests: CustomerServiceRequest[]
}
