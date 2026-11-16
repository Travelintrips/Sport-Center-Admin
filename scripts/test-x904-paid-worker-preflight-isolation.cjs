// Isolated in-memory regression: paid booking must advance if optional legacy preflight fails.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../artifacts/api-server/src/services/x904NonmemberDailyAccessWorker.ts'),'utf8');
const result = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,'typescript syntax');
const sql=(strings,...values)=>strings.reduce((s,part,i)=>s+part+(i<values.length?values[i]:''),'');
const now = new Date('2026-11-16T11:20:00Z');
const injectFailure = process.env.X904_TEST_INJECT_FAILURE !== 'false';
let legacyInventoryFailures=0, legacyUpdateFailures=0, inserts=[];
const snapshot={observed_at:new Date(now.getTime()-30_000),user_count:1,users:[{pin:'78',name:'VIS 001',group:2,role:0,enabled:true}]};
const grant={access_id:27,booking_id:1830,user_pin:'78',device_uid:338,verified_name:'VIS 001',payment_id:900,confirmed_at:'2026-11-16T05:00:00Z',expires_at:'2026-11-16T17:00:00Z',activated_at:null,access_state:'pending',verification_state:'verified',payment_status:'confirmed',booking_date:'2026-11-16',booking_start_time:'06:00',booking_source:'admin',booking_notes:'Pemakai kartu VIS001: NAJWAN',booking_status:'confirmed',identity_type:'card',identity_label:'VIS001'};
const execute=async q=>{
  q=String(q);
  if(q.includes('SELECT id FROM sport_center.users')) return {rows:[{id:301}]};
  if(q.includes('UPDATE sport_center.x904_nonmember_daily_access a') && q.includes('review_required')) return {rows:[]};
  if(q.includes('UPDATE sport_center.x904_nonmember_daily_access a') && q.includes('gym_vis_card_reservations')) {legacyUpdateFailures++;if(injectFailure)throw Error('LEGACY_VIS_PREFLIGHT_UNAVAILABLE');return {rows:[]};}
  if(q.includes('SELECT observed_at,user_count,users')&&q.includes('ORDER BY snapshot_id DESC')) {
    if(legacyInventoryFailures++===0 && injectFailure) throw Error('LEGACY_INVENTORY_PREFLIGHT_UNAVAILABLE');
    return {rows:[snapshot]};
  }
  if(q.includes('SELECT a.access_id,a.user_pin')&&q.includes('ORDER BY a.confirmed_at LIMIT')) return {rows:[grant]};
  if(q.includes('FOR UPDATE OF a')) return {rows:[grant]};
  if(q.includes('SELECT membership_id,status')||q.includes('SELECT command_id,command_type')||q.includes('SELECT 1 FROM sport_center.x904_user_commands')||q.includes('SELECT 1 FROM sport_center.x904_nonmember_daily_access other')) return {rows:[]};
  if(q.includes('SELECT count(*)::int AS n')) return {rows:[{n:0}]};
  if(q.includes('INSERT INTO sport_center.x904_user_commands')) {inserts.push(q);return {rows:[]};}
  return {rows:[]};
};
const store={execute,transaction:async callback=>callback(store)};
const imports={
  '@workspace/db':{db:store},
  './x904GymVisitorCardReservations':{recoverUnallocatedPaidGymVis:async()=>0},
  'drizzle-orm':{sql},
  './x904NonmemberAccessPolicy':{
    isX904AutoSuspendExempt:()=>false,
    x904NonmemberOpeningHours:()=>true,
    x904NonmemberEffectiveExpiry:()=>new Date('2026-11-16T17:00:00Z'),
    x904NonmemberSameWibDate:()=>true
  },
  './x904AutomationDecision':{x904AutomaticCommandKey:()=> 'isolated-command-key'}
};
const moduleObj={exports:{}};
const context={require:id=>{if(!(id in imports))throw Error('unknown dependency '+id);return imports[id];},module:moduleObj,exports:moduleObj.exports,process:{env:{GYM_X904_NONMEMBER_ACCESS_ENABLED:'true',GYM_X904_MANUAL_ACCESS_ENABLED:'true',GYM_X904_USER_WRITE_ENABLED:'true',GYM_X904_AUTOMATIC_REQUESTED_BY:'301'}},console,Date,setInterval};
vm.runInNewContext(result.outputText,context,{filename:'x904NonmemberDailyAccessWorker.js'});
moduleObj.exports.processX904NonmemberDailyAccess(store,now).then(()=>{
 assert.equal(legacyUpdateFailures,1);
 assert.ok(legacyInventoryFailures>=1);
 assert.equal(inserts.length,1,'exactly one activation command queued');
 assert.ok(inserts[0].includes('ACTIVATE_USER'));
 console.log('PASS isolated admin VIS001 booking 1830 -> ACTIVATE_USER queued ('+(injectFailure?'legacy preflights failing':'legacy preflights healthy')+'); no DB/device touched');
}).catch(error=>{console.error(error);process.exitCode=1;});
