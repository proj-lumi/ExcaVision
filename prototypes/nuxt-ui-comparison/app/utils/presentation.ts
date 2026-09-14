export function statusColor(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'error' {
  if (['Active', 'Deployed', 'completed', 'Complete', 'Invited'].includes(status)) return 'success'
  if (['intake', 'Planning', 'Received', 'Available'].includes(status)) return 'neutral'
  if (['Needs inspection', 'Threshold Warning', 'Offline'].includes(status)) return 'error'
  if (['Field ready', 'Commissioning', 'Early Advisory', 'Under review', 'Scheduled', 'in_progress'].includes(status)) return 'warning'
  return 'primary'
}

export function requestStatusLabel(status: string) {
  return ({ intake: 'Intake review', approved: 'Approved', in_progress: 'In progress', completed: 'Completed' } as Record<string, string>)[status] ?? status
}
