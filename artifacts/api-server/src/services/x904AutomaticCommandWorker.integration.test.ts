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
        case 1:return {rows:event==='pending'?[{event_id:10,membership_id:99,event_key:'test-payment-100'}]:[]};
        case 2:return {rows:command?[{state:command,result:command==='completed'?{readBackConfirmed:true}:null}]:[]};
        case 3:if(command==='completed'){event='processed';return {rows:[]};}return {rows:[{start_date:'2020-01-01',end_date:'2099-12-31',status:'active',user_pin:'987654',device_uid:777,display_name:'TEST MEMBER',device_role:0}]};
        case 4:return {rows:[{id:100,period_start:'2020-01-01',period_end:'2099-12-31',status:'confirmed',amount:300000,booking_count:1}]};
        case 5:return {rows:[{observed_at:new Date(Date.now()-1000),user_count:1,users:[{pin:'987654',name:'TEST MEMBER',role:0,group:2,enabled:true}]}]};
        case 6:return {rows:[]}; // no previous command
        case 7:return {rows:[]}; // no other outstanding command
        case 8:inserts++;command='queued';return {rows:[]};
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
        store.execute=async()=>({rows:++rootReads===1?[{id:301}]:event==='pending'?[{event_id:10,membership_id:99,event_key:'test-payment-100'}]:[]});
        await processX904AutomaticCommands(store as any);
        if(state==='first'){expect(inserts).toBe(1);expect(command).toBe('queued');expect(event).toBe('pending');}
        if(state==='retry'){expect(inserts).toBe(1);expect(event).toBe('pending');command='completed';}
        if(state==='ack'){expect(inserts).toBe(1);expect(event).toBe('processed');}
        if(state==='post'){expect(inserts).toBe(1);expect(event).toBe('processed');}
      }
    }finally{keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);}
  });
});
