export function learnerStatusLabel(status: string) {
  if (status.replace(/[\s_-]+/g, '').toLowerCase() === 'readytoenrol') return 'Ready to enrol';
  return status === 'all' ? 'All statuses' : status === 'unknown' ? 'Unspecified status'
    : status.split(' ').map(word => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}
