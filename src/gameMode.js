export function modeForPath(pathname) {
  return /\/1vw\/(?:index\.html)?$/.test(pathname) ? '1vw' : 'classic';
}

export const GAME_MODE = modeForPath(globalThis.location?.pathname || '/');
export const IS_ONE_VS_WORLD = GAME_MODE === '1vw';
export const ROOM_ID = IS_ONE_VS_WORLD ? 'classroom-1vw' : 'classroom';
export const ROOM_PATH = `moshroids/rooms/${ROOM_ID}`;
