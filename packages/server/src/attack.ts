export function selectTarget(attackerId: string, aliveIds: string[]): string | null {
  const targets = aliveIds.filter(id => id !== attackerId);
  if (targets.length === 0) return null;
  return targets[Math.floor(Math.random() * targets.length)];
}
