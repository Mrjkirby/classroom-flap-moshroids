export class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
  update(ships, viewportWidth, viewportHeight, worldWidth, worldHeight) {
    this.x = worldWidth * 0.5;
    this.y = worldHeight * 0.5;
    this.zoom = Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
  }
}
