import { teamAtBase } from './teamBases.js';

export function createTeamDirector({ enabled, isJoined, publishChange,
  getWorldWidth, getWorldHeight }) {
  let pending = false;
  let nextAttempt = 0;

  function reset(ship) {
    if (!enabled) return;
    ship.team = 'neutral';
    if (isJoined()) publishChange('neutral', ship)
      .catch(error => console.error('Team reset failed:', error));
  }

  function update(ship) {
    if (!enabled || !isJoined() || !ship.visible || pending ||
      performance.now() < nextAttempt) return;
    const team = teamAtBase(ship.x, ship.y, ship.radius,
      getWorldWidth(), getWorldHeight());
    if (!team || team === ship.team) return;
    const previous = ship.team;
    ship.team = team;
    pending = true;
    publishChange(team, ship).then(saved => {
      if (!saved && ship.team === team) ship.team = previous;
    }).catch(error => {
      if (ship.team === team) ship.team = previous;
      nextAttempt = performance.now() + 1000;
      console.error('Team change failed:', error);
    }).finally(() => { pending = false; });
  }

  return { reset, update };
}
