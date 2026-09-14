export function statusColor(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'error' {
  if (['Active', 'Complete'].includes(status)) return 'success'
  if (['Threshold Warning', 'Offline'].includes(status)) return 'error'
  if (['Early Advisory', 'Under review', 'Scheduled'].includes(status)) return 'warning'
  if (['Received'].includes(status)) return 'neutral'
  return 'primary'
}
