import { jest } from '@jest/globals';
jest.unstable_mockModule('@workspace/db', () => ({db:{execute:jest.fn(),transaction:jest.fn()}}));
const {processX904NewOrdinaryUserDefaultSuspend} = await import('./x904NewOrdinaryUserDefaultSuspend.js');

test('audit-only detects intermediate rename with all physical write flags off', async () => {
  const saved = {
    audit:process.env.GYM_X904_NEW_USER_IDENTITY_AUDIT_ENABLED,
    suspend:process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED,
    nonmember:process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED,
    manual:process.env.GYM_X904_MANUAL_ACCESS_ENABLED,
    write:process.env.GYM_X904_USER_WRITE_ENABLED,
    baseline:process.env.GYM_X904_NEW_USER_BASELINE_AT,
  };
  process.env.GYM_X904_NEW_USER_IDENTITY_AUDIT_ENABLED='true';
  process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED='false';
  process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED='false';
  process.env.GYM_X904_MANUAL_ACCESS_ENABLED='false';
  process.env.GYM_X904_USER_WRITE_ENABLED='false';
  process.env.GYM_X904_NEW_USER_BASELINE_AT='2026-11-11T12:00:00Z';
  const observations = [
    [{pin:'16',name:'ANNISA DWI',role:0,group:1,enabled:true}],
    [{pin:'16',name:'ANNISA DWI',role:0,group:1,enabled:true},{pin:'800',name:'FIRST USER',role:0,group:1,enabled:true}],
    [{pin:'16',name:'ANNISA DWI',role:0,group:1,enabled:true},{pin:'800',name:'SECOND USER',role:0,group:1,enabled:true}],
  ];
  const store = {
    execute:jest.fn(async () => ({rows:observations.map((users,index)=>({snapshot_id:index+1,observed_at:new Date(Date.parse('2026-11-11T12:01:00Z')+index*60000),user_count:users.length,users})).reverse()})),
    transaction:jest.fn(async () => {throw new Error('audit attempted a write');}),
  };
  const warning = jest.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date('2026-11-11T12:04:00Z'));
    expect(store.execute).toHaveBeenCalledTimes(1);
    expect(store.transaction).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('[x904-new-user-default-suspend] identity-replacement-review',expect.stringContaining('"800"'));
  } finally {
    warning.mockRestore();
    for (const [key,env] of Object.entries({
      GYM_X904_NEW_USER_IDENTITY_AUDIT_ENABLED:saved.audit,
      GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED:saved.suspend,
      GYM_X904_NONMEMBER_ACCESS_ENABLED:saved.nonmember,
      GYM_X904_MANUAL_ACCESS_ENABLED:saved.manual,
      GYM_X904_USER_WRITE_ENABLED:saved.write,
      GYM_X904_NEW_USER_BASELINE_AT:saved.baseline,
    })) if(env===undefined) delete process.env[key]; else process.env[key]=env;
  }
});
