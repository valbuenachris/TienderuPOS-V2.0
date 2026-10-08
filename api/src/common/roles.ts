export function isAdminRole(groupName: string | null | undefined): boolean {
  const group = groupName?.toLowerCase();
  return group === 'admin' || group === 'super_admin';
}
