# Classroom Flap Moshroids

MOSHROIDS is a browser-based multiplayer classroom Asteroids game. Players enter a pilot name, sign in anonymously through Firebase, and share a room.

## Structure

- `index.html`, `style.css`: page and presentation.
- `src/game.js`: game setup and orchestration.
- `src/asteroid.js`, `src/asteroidDirector.js`, `src/asteroidMultiplayer.js`, `src/asteroidNetwork.js`: asteroid entity, field generation, shared destruction coordination, and Firebase transport.
- `src/sharedClock.js`, `src/worldConfig.js`: Firebase server-time offset and fixed shared arena dimensions. Asteroid positions are derived from immutable spawn state and shared time; no position frames are sent to Firebase.
- `src/asteroidDirector.js` derives normal field size as 10 × 2^MR. K destructions in the current shared epoch. The existing Firebase MR. K destruction record advances the generation once, and late joins replay those records to recover the same field. Time tiers still set replacement timing.
- `src/multiplayer.js`: Firebase authentication, player presence, and pilot login.
- `src/gunDropSystem.js`, `src/gunDropMultiplayer.js`: gun drop gameplay and networking.
- Other `src/` modules own the corresponding physics, entities, collisions, spelling, and weapons.
- `src/spellingController.js` owns the spelling challenge UI, including word-copy and answer-paste guards. The word remains visible, and answers are typed with normal keyboard or mobile input.

## Run and verify

The site uses native browser ES modules and has no package build step. From the repository root, run `python3 -m http.server 8000`, then open `http://localhost:8000/`. Enter a pilot name to test Firebase authentication and room joining. Internet access and a Firebase-authorized browser origin are needed for login.

Run `node --experimental-vm-modules tests/import-graph.mjs` to check local import paths, module syntax, exports, and circular dependencies.

Run `node --test tests/asteroid-sync.mjs` for deterministic movement, late joins, wrapping, destruction, respawn, epoch changes, and 26-client replay.

Run `node --test tests/spelling-input.mjs` for spelling copy/paste guards and the existing practice/retrieval flow.

## Deployment

GitHub Pages serves the root of the `main` branch at https://mrjkirby.github.io/classroom-flap-moshroids/. The browser loads `src/game.js` directly from `index.html`, so imported filenames must match tracked files exactly, including case. Firebase hosts anonymous authentication and the multiplayer room; its public client configuration is in `src/multiplayer.js`.
