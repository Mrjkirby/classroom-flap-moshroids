import { drawWrapped, random, TAU, wrapPosition } from './physics.js';
const SIZES={large:{radius:30,points:50,next:'medium'},medium:{radius:18,points:100,next:'small'},small:{radius:10,points:150,next:null}};
export class Asteroid {
  constructor(x,y,size='large',velocityX=random(-1.2,1.2),velocityY=random(-1.2,1.2)) { const config=SIZES[size]; this.x=x; this.y=y; this.size=size; this.radius=config.radius; this.points=config.points; this.velocityX=velocityX; this.velocityY=velocityY; this.rotation=random(-1,1); this.angle=random(0,TAU); this.vertices=Array.from({length:10},(_,index)=>({angle:index/10*TAU,radius:this.radius*random(.72,1.18)})); }
  update(dt,width,height) { const frameScale=dt*60; this.x+=this.velocityX*frameScale; this.y+=this.velocityY*frameScale; this.angle+=this.rotation*frameScale; wrapPosition(this,width,height); }
  split() { if (!SIZES[this.size].next) return []; return [0,1].map((index)=>{ const direction=index?1:-1; const impulse=random(.55,1.2); return new Asteroid(this.x,this.y,SIZES[this.size].next,this.velocityX+Math.cos(this.angle+direction*1.1)*impulse,this.velocityY+Math.sin(this.angle+direction*1.1)*impulse); }); }
  draw(ctx,width,height) { drawWrapped(ctx,this,width,height,(drawCtx)=>{ drawCtx.rotate(this.angle); drawCtx.strokeStyle='#d9ddd7'; drawCtx.lineWidth=1.25; drawCtx.beginPath(); this.vertices.forEach((vertex,index)=>{ const x=Math.cos(vertex.angle)*vertex.radius; const y=Math.sin(vertex.angle)*vertex.radius; if (index===0) drawCtx.moveTo(x,y); else drawCtx.lineTo(x,y); }); drawCtx.closePath(); drawCtx.stroke(); }); }
}
export const sizeConfig=SIZES;
