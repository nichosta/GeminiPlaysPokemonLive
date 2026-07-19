import { getStaticMap } from "./skills/staticMap.js";
import { planCrossMapRoute } from "./skills/crossMapRouter.js";
const g=3,n=20; const map=getStaticMap(g,n);
const {width,grid}=map; const beh=grid.behaviorIds;
const grass=new Set(); for(let i=0;i<beh.length;i++) if(beh[i]===2) grass.add(i);
const plan = planCrossMapRoute({group:3,num:20,x:5,y:63},{group:3,num:2,x:24,y:20});
const leg=plan.legs[0];
// replay to get tiles
let x=5,y=63; const tiles=[[x,y]]; const DIRS={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
let grassHits=0;
for(const d of leg.directions){ const [dx,dy]=DIRS[d]; x+=dx; y+=dy; tiles.push([x,y]); if(grass.has(y*width+x)) grassHits++; }
console.log("first leg path tiles:", tiles.map(t=>t.join(',')).join(' '));
console.log("grass tiles crossed:", grassHits);
console.log("crossing:", leg.crossing);
