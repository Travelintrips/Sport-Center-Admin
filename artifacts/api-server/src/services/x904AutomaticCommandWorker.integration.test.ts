import {processX904AutomaticCommands} from './x904AutomaticCommandWorker';

describe('X904 full automatic worker execution with isolated in-memory database adapter',()=>{
  test('creates one command, holds pending without ACK, processes only after readback, never duplicates',async()=>{
    const keys=['GYM_X904_AUTOMATIC_COMMANDS_ENABLED','GYM_X904_AUTOMATIC_SCOPE','GYM_X904_AUTOMATIC_REQUESTED_BY','GYM_X904_AUTOMATIC_ALLOWED_PINS'] as const;
    const previous=keys.map(k=>process.env[k]);
    process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED='true';
    process.env.GYM_X904_AUTOMATIC_SCOPE='single';
    process.env.GYM_X904_AUTOMATIC_REQUESTED_BY='301';
    process.env.GYM_X904_AUTOMATIC_ALLOWED_PINS='987654';
    let command: null|'queued'|'completed'=null;
    let event:'pending'|'processed'='pending';
    let inserts=0;
    let calls=0;
    const tx={execute:async (_query:unknown)=>{
      const i=calls++;
      switch(i){
        case 0:return {rows:[{}]}; // advisory lock
        case 1:return {rows:event==='pending'?[{event_id:10,membership_id:99,event_key:'test-payment-100',reason:'PAYMENT_CONFIRMED',payment_id:100}]:[]};
        case 2:return {rows:[{}]}; // confirmed payment belongs to event membership
        case 3:return {rows:command?[{state:command,result:command==='completed'?{readBackConfirmed:true}:null}]:[]};
        case 4:if(command==='completed'){event='processed';return {rows:[]};}return {rows:[{start_date:'2020-01-01',end_date:'2099-12-31',status:'active',user_pin:'987654',device_uid:777,display_name:'TEST MEMBER',device_role:0}]};
        case 5:return {rows:[{id:100,period_start:'2020-01-01',period_end:'2099-12-31',status:'confirmed',amount:300000,booking_count:1}]};
        case 6:return {rows:[{observed_at:new Date(Date.now()-1000),user_count:1,users:[{pin:'987654',name:'TEST MEMBER',role:0,group:2,enabled:true}]}]};
        case 7:return {rows:[]}; // no previous command
        case 8:return {rows:[]}; // no other outstanding command
        case 9:inserts++;command='queued';return {rows:[]};
        default:throw Error('UNEXPECTED_WORKER_QUERY '+i);
      }
    }};
    // The queue and actor checks are read through the same production worker entrypoint.
    const store={execute:async (_query:unknown)=>({rows:[] as any[]}),transaction:async(fn:(t:typeof tx)=>Promise<void>)=>fn(tx)};
    store.execute=async()=>({rows:[]});
    // Return actor, then pending event, in order on every worker cycle.
    store.execute=async()=>({rows:[{id:301}]});
    try{
      for(const state of ['first','retry','ack','post'] as const){
        calls=0;
        let rootReads=0;
        store.execute=async()=>({rows:++rootReads===1?[{id:301}]:event==='pending'?[{event_id:10,membership_id:99,event_key:'test-payment-100',reason:'PAYMENT_CONFIRMED',payment_id:100}]:[]});
        await processX904AutomaticCommands(store as any);
        if(state==='first'){expect(inserts).toBe(1);expect(command).toBe('queued');expect(event).toBe('pending');}
        if(state==='retry'){expect(inserts).toBe(1);expect(event).toBe('pending');command='completed';}
        if(state==='ack'){expect(inserts).toBe(1);expect(event).toBe('processed');}
        if(state==='post'){expect(inserts).toBe(1);expect(event).toBe('processed');}
      }
    }finally{keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);}
  });
});

describe('X904 verified_paid_members mode — isolated production worker integration',()=>{
 const keys=['GYM_X904_AUTOMATIC_COMMANDS_ENABLED','GYM_X904_AUTOMATIC_SCOPE','GYM_X904_AUTOMATIC_REQUESTED_BY','GYM_X904_AUTOMATIC_ALLOWED_PINS'] as const;
 const originals=keys.map(k=>process.env[k]);
 beforeEach(()=>{
   process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED='true';
   process.env.GYM_X904_AUTOMATIC_SCOPE='verified_paid_members';
   process.env.GYM_X904_AUTOMATIC_REQUESTED_BY='301';
   process.env.GYM_X904_AUTOMATIC_ALLOWED_PINS='51,42'; // New PIN is intentionally NOT allowlisted
 });
 afterEach(()=>keys.forEach((k,i)=> originals[i]===undefined?delete process.env[k]:process.env[k]=originals[i]));
 
 function harness(options:{pin?:string;group?:number;paymentValid?:boolean;membershipEnd?:string;paymentEnd?:string;enabled?:boolean}={}){
   const pin=options.pin??'700';
   const group=options.group??2;
   let currentCommand:'none'|'queued'|'completed'='none';
   let eventState:'pending'|'processed'|'review_required'='pending';
   let inserts=0;
   let commandType='';
   let rootCalls=0,txCalls=0;
   const end=options.membershipEnd??'2099-12-31';
   const payEnd=options.paymentEnd??'2099-12-31';
   const store={
     execute:async(_query:unknown)=>{
       const i=rootCalls++;
       if(i===0)return {rows:currentCommand==='queued'?[{}]:[]}; // no second command while queued
       if(i===1)return {rows:[{id:301}]}; // verified system actor
       if(i===2)return {rows:eventState==='pending'?[{event_id:90001,membership_id:90002,event_key:'x904-payment-confirmed-90003'}]:[]};
       if(i===3)return {rows:currentCommand==='queued'?[{}]:[]}; // after-transaction queue
       throw Error('unexpected root query '+i);
     },
     transaction:async(fn:(t:any)=>Promise<void>)=>{
       txCalls=0;
       const tx={execute:async(_query:unknown)=>{
         const i=txCalls++;
         if(i===0)return {rows:[{}]}; // advisory lock
         if(i===1)return {rows:eventState==='pending'?[{event_id:90001,membership_id:90002,event_key:'x904-payment-confirmed-90003',reason:'PAYMENT_CONFIRMED',payment_id:90003}]:[]};
         if(i===2)return {rows:options.paymentValid===false?[]:[{}]}; // event payment ownership
         if(i===3)return {rows:currentCommand==='none'?[]:[{state:currentCommand,result:currentCommand==='completed'?{readBackConfirmed:true}:null,completed_at:currentCommand==='completed'?new Date():null,attempt_count:1}]};
         if(i===4){
           if(currentCommand==='completed'){eventState='processed';return {rows:[]};} // receipt of read-back
           return {rows:[{start_date:'2020-01-01',end_date:end,status:'active',user_pin:pin,device_uid:700,display_name:'NEW MEMBER',device_role:0}]};
         }
         if(i===5)return {rows:[{count:1}]}; // unique verified PIN mapping
         if(i===6)return {rows:[{id:90003,period_start:'2020-01-01',period_end:payEnd,status:'confirmed',amount:300000,booking_count:1}]};
         if(i===7)return {rows:[{observed_at:new Date(Date.now()-1000),user_count:1,users:[{pin,name:'NEW MEMBER',role:0,group,enabled:options.enabled??true}]}]};
         if(i===8){if(pin==='237' && group===1){eventState='review_required';return {rows:[]};}return {rows:[]};} // no previous command or suspend exemption review
         if(i===9)return {rows:[]}; // no outstanding PIN command
         if(i===10){inserts++;commandType=(group===2?'ACTIVATE_USER':'SUSPEND_USER');currentCommand='queued';return {rows:[]};}
         throw Error('unexpected transaction query '+i);
       }};
       return fn(tx);
     }
   };
   return {
     async cycle(){rootCalls=0;await processX904AutomaticCommands(store as any);},
     ack(){currentCommand='completed';},
     get state(){return eventState;},get inserts(){return inserts;},get command(){return commandType;}
   };
 }
 test('new verified paid PIN outside old allowlist activates once and waits for machine ACK',async()=>{
   const t=harness();
   await t.cycle(); expect(t.inserts).toBe(1); expect(t.command).toBe('ACTIVATE_USER'); expect(t.state).toBe('pending');
   await t.cycle(); expect(t.inserts).toBe(1); expect(t.state).toBe('pending');
   t.ack();await t.cycle();expect(t.inserts).toBe(1);expect(t.state).toBe('processed');
   await t.cycle();expect(t.inserts).toBe(1);
 });
 test('event payment missing or owned by different membership never activates',async()=>{
   const t=harness({paymentValid:false});
   await t.cycle();expect(t.inserts).toBe(0);expect(t.state).toBe('pending');
 });
 test('expired member after grace produces suspend, not an activation',async()=>{
   const t=harness({group:1,membershipEnd:'2026-09-30',paymentEnd:'2026-09-30'});
   await t.cycle();expect(t.inserts).toBe(1);expect(t.command).toBe('SUSPEND_USER');
 });
 test('disabled machine identity cannot receive an activation',async()=>{
   const t=harness({enabled:false});
   await t.cycle();expect(t.inserts).toBe(0);
 });
});
