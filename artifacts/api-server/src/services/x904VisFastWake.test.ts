import { jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { wakeX904AdminVisAfterPayment, wakeX904CollectedVisAfterHandover } from "./x904VisFastWake";

describe("VIS001–VIS006 fast wake uses verified, committed access only", () => {
  const prev=process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
  afterEach(() => {
    if (prev===undefined) delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    else process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED=prev;
  });
  test("no handover means no wake", () => {
    const wake=jest.fn((value:boolean)=>value);
    expect(wakeX904CollectedVisAfterHandover(false,wake)).toBe(false);
    expect(wake).not.toHaveBeenCalled();
  });
  test("committed handover uses the exact existing guarded X904 worker gate", () => {
    const wake=jest.fn((value:boolean)=>value);
    expect(wakeX904CollectedVisAfterHandover(true,wake)).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(true);
  });
  test("admin card wake does not read database when feature is off", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    const store={execute:jest.fn(async()=>({rows:[{exists:true}]}))};
    const wake=jest.fn((value:boolean)=>value);
    expect(await wakeX904AdminVisAfterPayment(1,2,store as any,wake)).toBe(false);
    expect(store.execute).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
  test("legacy admin VIS selector explicitly covers all six cards with confirmed payment", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED="true";
    let rendered="";
    const dialect=new PgDialect();
    const store={execute:jest.fn(async (statement:any)=>{
      rendered=dialect.sqlToQuery(statement).sql;
      return {rows:[]};
    })};
    expect(await wakeX904AdminVisAfterPayment(11,22,store as any)).toBe(false);
    for(const card of ["VIS001","VIS002","VIS003","VIS004","VIS005","VIS006"]) {
      expect(rendered).toContain("'"+card+"'");
    }
    expect(rendered).toContain("a.verification_state='verified'");
    expect(rendered).toContain("a.access_state='pending'");
    expect(rendered).toContain("p.status='confirmed'");
    expect(rendered).toContain("b.status='confirmed'");
  });
  test("invalid payment and booking IDs cannot wake a card", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED="true";
    const store={execute:jest.fn(async()=>({rows:[{exists:true}]}))};
    expect(await wakeX904AdminVisAfterPayment(-1,2,store as any)).toBe(false);
    expect(await wakeX904AdminVisAfterPayment(1,0,store as any)).toBe(false);
    expect(store.execute).not.toHaveBeenCalled();
  });
  test("verified pending card match triggers one wake, absent match triggers none", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED="true";
    const store={execute:jest.fn(async()=>({rows:[{exists:true}]}))};
    const wake=jest.fn((value:boolean)=>value);
    expect(await wakeX904AdminVisAfterPayment(100,200,store as any,wake)).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(store.execute).toHaveBeenCalledTimes(1);
    store.execute.mockImplementationOnce(async()=>({rows:[]}));
    expect(await wakeX904AdminVisAfterPayment(100,201,store as any,wake)).toBe(false);
    expect(wake).toHaveBeenCalledTimes(1);
  });
});
