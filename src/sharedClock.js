// The offset is supplied by Firebase's .info/serverTimeOffset listener.
// Until it arrives, the local wall clock keeps the game usable.
let serverOffsetMs = 0;

export const sharedClock = {
  now() {
    return Date.now() + serverOffsetMs;
  },

  setOffset(offsetMs) {
    if (Number.isFinite(offsetMs)) serverOffsetMs = offsetMs;
  }
};
