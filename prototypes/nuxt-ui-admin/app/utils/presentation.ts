export function statusColor(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'error' {
  if (['Active', 'Deployed', 'completed', 'Invited'].includes(status)) return 'success'
  if (['intake', 'Planning', 'Available'].includes(status)) return 'neutral'
  if (['Needs inspection'].includes(status)) return 'error'
  if (['Field ready', 'Commissioning', 'in_progress'].includes(status)) return 'warning'
  return 'primary'
}

export function requestStatusLabel(status: string) {
  return ({ intake: 'Intake review', approved: 'Approved', in_progress: 'In progress', completed: 'Completed' } as Record<string, string>)[status] ?? status
}
