import { Bullet } from './bullet.js';
import { drawWrapped, wrapPosition } from './physics.js';

export class Ship {
  constructor(owner,x,y,controls) { this.owner=owner; this.x=x; this.y=y; this.velocityX=0; this.velocityY=0; this.angle=owner==='A'?-Math.PI/2:Math.PI/2; this.controls=controls; this.radius=15; this.cooldown=0; this.invulnerable=0; this.visible=true; this.thrusting=false; this.state='ACTIVE'; }
  update(dt,keys,width,height) {
    if (this.state !== 'ACTIVE') return null;
    const frameScale=dt*60;
    const turn=(keys.has(this.controls.left)?-1:0)+(keys.has(this.controls.right)?1:0); this.angle+=turn*(Math.PI/18)*frameScale;
    const thrust=(keys.has(this.controls.thrust)?1:0)-(keys.has(this.controls.brake)?1:0); this.thrusting=thrust!==0; this.velocityX+=Math.cos(this.angle)*thrust*.25*frameScale; this.velocityY+=Math.sin(this.angle)*thrust*.25*frameScale;
    const retention=Math.pow(.98,frameScale); this.velocityX*=retention; this.velocityY*=retention; const speed=Math.hypot(this.velocityX,this.velocityY); if (speed>8) { const factor=8/speed; this.velocityX*=factor; this.velocityY*=factor; }
    this.x+=this.velocityX*frameScale; this.y+=this.velocityY*frameScale; wrapPosition(this,width,height); this.cooldown-=dt; this.invulnerable=Math.max(0,this.invulnerable-dt);
    if (keys.has(this.controls.fire)&&this.cooldown<=0) { this.cooldown=.18; return new Bullet(this.x+Math.cos(this.angle)*16,this.y+Math.sin(this.angle)*16,this.angle,this.velocityX,this.velocityY,this.owner); } return null;
  }
  destroy() { if (this.state !== 'ACTIVE' || this.invulnerable > 0) return false; this.state='SPELLING'; this.visible=false; this.velocityX=0; this.velocityY=0; this.thrusting=false; return true; }
  respawn() { this.state='ACTIVE'; this.visible=true; this.velocityX=0; this.velocityY=0; this.cooldown=0; this.invulnerable=1.5; }
  draw(ctx,width,height) { if (!this.visible||(this.invulnerable>0&&Math.floor(this.invulnerable*10)%2===0)) return; drawWrapped(ctx,this,width,height,(drawCtx)=>{ drawCtx.rotate(this.angle); drawCtx.strokeStyle=this.owner==='A'?'#ff875f':'#72e6dd'; drawCtx.lineWidth=1.5; drawCtx.beginPath(); drawCtx.moveTo(17,0); drawCtx.lineTo(-12,-11); drawCtx.lineTo(-7,0); drawCtx.lineTo(-12,11); drawCtx.closePath(); drawCtx.stroke(); if (this.thrusting) { drawCtx.beginPath(); drawCtx.moveTo(-9,-4); drawCtx.lineTo(-18,0); drawCtx.lineTo(-9,4); drawCtx.stroke(); } drawCtx.rotate(-this.angle); drawCtx.fillStyle=drawCtx.strokeStyle; drawCtx.font='700 13px Barlow Condensed,sans-serif'; drawCtx.textAlign='center'; drawCtx.textBaseline='middle'; drawCtx.fillText(this.owner,0,0); }); }
}
