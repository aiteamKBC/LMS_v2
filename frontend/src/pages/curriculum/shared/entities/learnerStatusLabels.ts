export function learnerStatusLabel(status: string) {
  return status === 'all' ? 'All statuses' : status === 'unknown' ? 'Unspecified status'
    : status.split(' ').map(word => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}
