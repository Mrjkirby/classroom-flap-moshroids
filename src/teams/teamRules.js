export function normalizeTeam(value) {
  return value === 'blue' || value === 'red' ? value : 'neutral';
}

export function canTeamBulletDamage(bullet, ship) {
  const attacking = normalizeTeam(bullet.teamAtFire);
  return attacking === 'neutral' || attacking !== normalizeTeam(ship.team);
}
