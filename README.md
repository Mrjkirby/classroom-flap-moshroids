# Classroom Flap Moshroids

MOSHROIDS is a browser-based multiplayer classroom Asteroids game. Players enter a pilot name, sign in anonymously through Firebase, and share a room.

## Structure

- `index.html`, `style.css`: page and presentation.
- `src/game.js`: game setup and orchestration.
- `src/asteroid.js`, `src/asteroidDirector.js`, `src/asteroidMultiplayer.js`, `src/asteroidNetwork.js`: asteroid entity, field generation, shared destruction coordination, and Firebase transport.
- `src/multiplayer.js`: Firebase authentication, player presence, and pilot login.
- `src/gunDropSystem.js`, `src/gunDropMultiplayer.js`: gun drop gameplay and networking.
- Other `src/` modules own the corresponding physics, entities, collisions, spelling, and weapons.

## Run and verify

The site uses native browser ES modules and has no package build step. From the repository root, run `python3 -m http.server 8000`, then open `http://localhost:8000/`. Enter a pilot name to test Firebase authentication and room joining. Internet access and a Firebase-authorized browser origin are needed for login.

Run `node --experimental-vm-modules tests/import-graph.mjs` to check local import paths, module syntax, exports, and circular dependencies.

## Deployment

GitHub Pages serves the root of the `main` branch at https://mrjkirby.github.io/classroom-flap-moshroids/. The browser loads `src/game.js` directly from `index.html`, so imported filenames must match tracked files exactly, including case. Firebase hosts anonymous authentication and the multiplayer room; its public client configuration is in `src/multiplayer.js`.
