import {readFileSync} from "node:fs";
import {join} from "node:path";

const worker=readFileSync(join(process.cwd(),"src/services/x904NonmemberDailyAccessWorker.ts"),"utf8");
const router=readFileSync(join(process.cwd(),"src/routes/gymX904Integration.ts"),"utf8");
const ui=readFileSync(join(process.cwd(),"../sport-center/src/pages/admin/GymX904.tsx"),"utf8");

describe("Gym VIS worker release readiness is not inferred from passing unit tests",()=>{
  test("worker must report independent config, scope and observed runtime ticks",()=>{
    expect(worker).toContain('NONMEMBER_WORKER_DISABLED');
    expect(worker).toContain('MANUAL_ACCESS_GATE_DISABLED');
    expect(worker).toContain('X904_USER_WRITE_GATE_DISABLED');
    expect(worker).toContain('VIS002_EXCLUDED_BY_TEST_PIN_SCOPE');
    expect(worker).toContain('WORKER_NOT_STARTED');
    expect(worker).toContain('WORKER_TICK_STALE');
    expect(worker).toContain('WORKER_LAST_CYCLE_FAILED');
    expect(worker).toContain('lastSuccessfulCycleAt');
    expect(worker).toContain('readyForVis002Processing: reasons.length === 0');
    expect(worker).toContain('setInterval(() => void tick(false), 15_000)');
    expect(worker).toContain('setInterval(() => void tick(true), 60_000)');
    expect(worker).toContain('await processPaidVisRecoveryCycle(');
    expect(worker).toContain("if(pending.rows.length) await processX904NonmemberDailyAccess()");
    expect(worker).toContain("b.booking_date=(now() AT TIME ZONE 'Asia/Jakarta')::date::text");
    expect(worker).toContain('await processX904NonmemberDailyAccess();');
  });
  test("only authenticated Owner/Super Admin sees worker readiness, never secrets",()=>{
    expect(router).toContain('router.get("/admin/gym-x904/user-command/capabilities",adminMiddleware');
    expect(router).toContain('const nonmemberWorkerReadiness=allowed?getX904NonmemberWorkerReadiness():null;');
    expect(router).toContain("COLLECTED_PAID_VIS_STALLED_WITHOUT_ACTIVATE_COMMAND");
    expect(router).toContain("X904_GROUP1_ACK_VERIFIED_BUT_GRANT_STILL_PENDING");
    expect(router).toContain("s.observed_at>c.completed_at");
    expect(router).toContain("r.state=\'collected\'");
    expect(router).toContain("c.payload->>\'accessId\'=a.access_id::text");
    expect(router).toContain("r.collected_at <= now()-interval '90 seconds'");
    expect(worker).not.toContain("console.log(process.env");
  });
  test("dashboard never asserts auto suspend disabled without looking at runtime",()=>{
    expect(ui).toContain("userCommandCapabilities?.nonmemberWorkerReadiness");
    expect(ui).toContain("Worker belum siap memproses VIS002");
    expect(ui).toContain("bukan bukti pintu terbuka");
    expect(ui).toContain("refetchInterval:15000");
    expect(ui).not.toContain("Suspend otomatis belum diaktifkan.");
  });
});
