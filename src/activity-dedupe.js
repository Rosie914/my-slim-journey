// Non-destructive, conservative workout deduplication.
// Apple Move/active energy includes workout energy: these must never be added together.
const SUMMARY = 'Apple 健康每日摘要';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' });
export const taipeiDay = value => dateFmt.format(new Date(value));
export const shiftDate = (day, offset) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
const asNumber = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0,Number(v));
const energy = row => asNumber(row.calories_burned);
const isApple = row => /apple\s*health|apple\s*健康|健康.*(?:匯入|同步)|healthkit|健康運動/i.test(String(row.notes || ''));
const normalizeName = value => String(value||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'').replace(/健走|步行|走路/g,'快走').replace(/慢跑|跑步機跑步/g,'跑步');
const near = (v1,v2,tolerance) => v1 == null || v2 == null ? false : Math.abs(v1-v2) <= tolerance;
function sameWorkout(a,b) {
  const nameA=normalizeName(a.activity_type),nameB=normalizeName(b.activity_type);
  if(!nameA || nameA!==nameB) return false;
  const aTime=Date.parse(a.logged_at),bTime=Date.parse(b.logged_at);
  if(!Number.isFinite(aTime)||!Number.isFinite(bTime)||Math.abs(aTime-bTime)>35*60000)return false;
  const da=asNumber(a.duration_minutes),db=asNumber(b.duration_minutes);
  const ca=energy(a),cb=energy(b);
  // To protect separate workouts from false-positive removal, both duration and
  // energy must agree. Uncertain cases are displayed, not silently excluded.
  if(!near(da,db,Math.max(3,Math.min(8,(da||0)*.12))))return false;
  if(!near(ca,cb,Math.max(12,Math.min(35,(ca||0)*.12))))return false;
  // Matching manual-vs-Apple rows; or identical retried imports.
  return isApple(a)!==isApple(b) || (isApple(a) && isApple(b));
}
export function dedupeWorkouts(rows=[]) {
  const workouts=rows.filter(row=>row?.activity_type && row.activity_type!==SUMMARY);
  const ordered=[...workouts].sort((a,b)=>{
    const apple=Number(isApple(b))-Number(isApple(a));
    return apple || (Date.parse(a.logged_at)||0)-(Date.parse(b.logged_at)||0);
  });
  const retained=[],suppressed=[];
  for(const item of ordered){
    const match=retained.find(existing=>sameWorkout(existing,item));
    if(match) suppressed.push({entry:item,kept:match});
    else retained.push(item);
  }
  return {retained,suppressed};
}
export function summarizeDay(rows=[]) {
  const summary=rows.filter(row=>row.activity_type===SUMMARY);
  const metric = field => summary.filter(row=>asNumber(row[field])!==null)
    .sort((a,b)=>Date.parse(b.created_at||b.logged_at)-Date.parse(a.created_at||a.logged_at))[0]?.[field] ?? null;
  const {retained,suppressed}=dedupeWorkouts(rows);
  const workoutEnergy=retained.map(energy).filter(v=>v!==null);
  const steps=retained.map(row=>asNumber(row.steps)).filter(v=>v!==null);
  const activeCalories=asNumber(metric('calories_burned'));
  const dailySteps=asNumber(metric('steps'));
  return {
    workouts:retained, suppressed,
    workoutCalories:workoutEnergy.length?workoutEnergy.reduce((s,v)=>s+v,0):null,
    activeCalories,
    calories:activeCalories ?? (workoutEnergy.length?workoutEnergy.reduce((s,v)=>s+v,0):null),
    steps:dailySteps ?? (steps.length?steps.reduce((s,v)=>s+v,0):null),
    minutes:retained.reduce((sum,row)=>sum+(asNumber(row.duration_minutes)||0),0),
    source:activeCalories!==null?'health':workoutEnergy.length?'workout':null
  };
}
export function summarizeDailyMap(entries=[]) {
  const groups=new Map();
  for(const entry of entries){const date=taipeiDay(entry.logged_at);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(entry);}
  return new Map([...groups].map(([day,rows])=>[day,summarizeDay(rows)]));
}
export const __test={sameWorkout,isApple,normalizeName};
