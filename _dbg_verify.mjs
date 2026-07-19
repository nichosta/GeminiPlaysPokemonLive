import { planCrossMapRoute } from "./skills/crossMapRouter.js";
const from={group:3,num:20,x:5,y:63};
const to={group:3,num:2,x:24,y:20}; // Pewter City anchor
const plan = planCrossMapRoute(from,to);
console.log("plan found:", plan.found, "legs:", plan.legs?.length, "cost:", plan.totalCost);
for(const leg of (plan.legs||[])){
  const cr = leg.crossing;
  console.log(`  leg on ${leg.group}:${leg.num}  dirs=${leg.directions.length}  ${cr?('cross '+cr.kind+' -> '+cr.toGroup+':'+cr.toNum+' press '+cr.press):'FINAL'}`);
}
// first leg destination map tells us which gate: 15:0=Forest(correct) vs 15:2=EastBuilding(wrong)
const firstCross = plan.legs?.[0]?.crossing;
console.log("\nFirst crossing target:", firstCross ? firstCross.toGroup+":"+firstCross.toNum : "none",
  firstCross?.toNum===0 ? "=> Viridian Forest South Entrance (CORRECT)" : firstCross?.toNum===2 ? "=> East Building (WRONG, Cut-gated)" : "");
