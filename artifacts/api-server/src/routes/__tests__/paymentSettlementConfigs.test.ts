import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Config = {
  id: number;
  companyId: number;
  providerCode: string;
  bankAccountId: string;
  settlementDelayBusinessDays: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

type AuditRow = {
  action: string;
  entity: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
};

type DatabaseState = {
  configs: Config[];
  audits: AuditRow[];
  nextConfigId: number;
  failAuditWrites: boolean;
};

const COMPANY_ID = 701;
const ACCOUNT_A = "MANDIRI-CST-A";
const ACCOUNT_B = "MANDIRI-CST-B";
const PROVIDER = "mandiri_direct";

const state: DatabaseState = {
  configs: [],
  audits: [],
  nextConfigId: 1,
  failAuditWrites: false,
};

const mockExecute = jest.fn<(query: unknown) => Promise<any>>();
const mockLogAudit = jest.fn();

function cloneState(value: DatabaseState): DatabaseState {
  return {
    configs: value.configs.map((config) => ({ ...config })),
    audits: value.audits.map((audit) => ({ ...audit })),
    nextConfigId: value.nextConfigId,
    failAuditWrites: value.failAuditWrites,
  };
}

function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  return { text: strings.join("?"), values };
}

class AsyncLock {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.locked = true;
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}

const companyLocks = new Map<string, AsyncLock>();

function getCompanyLock(): AsyncLock {
  const key = `${COMPANY_ID}:${PROVIDER}`;
  let lock = companyLocks.get(key);
  if (!lock) {
    lock = new AsyncLock();
    companyLocks.set(key, lock);
  }
  return lock;
}

function isOverlapping(config: Config, effectiveFrom: string, effectiveUntil: string | null): boolean {
  return (
    config.companyId === COMPANY_ID &&
    config.providerCode === PROVIDER &&
    config.isActive &&
    config.effectiveFrom <= (effectiveUntil ?? "9999-12-31") &&
    (config.effectiveUntil == null || config.effectiveUntil >= effectiveFrom)
  );
}

function makeTransaction() {
  let releaseLock: (() => void) | null = null;

  const tx = {
    execute: jest.fn(async (query: { text?: string; values?: unknown[] }) => {
      if (query.text?.includes("pg_advisory_xact_lock")) {
        releaseLock = await getCompanyLock().acquire();
        return { rows: [] };
      }
      if (query.text?.includes("FROM sport_center.payment_settlement_configs")) {
        const values = query.values ?? [];
        const effectiveUntil = values[2] == null ? null : String(values[2]);
        const effectiveFrom = String(values[3]);
        return {
          rows: state.configs
            .filter((config) => isOverlapping(config, effectiveFrom, effectiveUntil))
            .map((config) => ({
              id: config.id,
              company_id: config.companyId,
              provider_code: config.providerCode,
              bank_account_id: config.bankAccountId,
              settlement_delay_business_days: config.settlementDelayBusinessDays,
              effective_from: config.effectiveFrom,
              effective_until: config.effectiveUntil,
              is_active: config.isActive,
              source: config.source,
              created_at: config.createdAt,
              updated_at: config.updatedAt,
            })),
        };
      }
      return { rows: [] };
    }),
    update: jest.fn(() => ({
      set: (values: Partial<Config>) => ({
        where: (condition: { value?: unknown }) => ({
          returning: async () => {
            const id = Number(condition.value);
            const config = state.configs.find((item) => item.id === id);
            if (!config) return [];
            Object.assign(config, values);
            return [config];
          },
        }),
      }),
    })),
    insert: jest.fn((table: unknown) => ({
      values: (values: any) => {
        if (state.failAuditWrites && table === auditLogsTable) {
          throw new Error("audit storage unavailable");
        }
        let result: any;
        if (table === paymentSettlementConfigsTable) {
          const config: Config = {
            id: state.nextConfigId++,
            companyId: values.companyId,
            providerCode: values.providerCode,
            bankAccountId: values.bankAccountId,
            settlementDelayBusinessDays: values.settlementDelayBusinessDays,
            effectiveFrom: values.effectiveFrom,
            effectiveUntil: values.effectiveUntil ?? null,
            isActive: values.isActive,
            source: values.source,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.configs.push(config);
          result = undefined;
          const operation = Promise.resolve(result) as Promise<void> & {
            returning: () => Promise<Config[]>;
          };
          operation.returning = async () => [config];
          return operation;
        }
        state.audits.push(values);
        return Promise.resolve(result);
      },
    })),
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [state.configs[0]],
          for: () => ({
            limit: async () => [state.configs[0]],
          }),
        }),
      }),
    })),
  };

  return { tx, release: () => releaseLock?.() };
}

const db = {
  execute: mockExecute,
  transaction: jest.fn(async (callback: (tx: ReturnType<typeof makeTransaction>["tx"]) => Promise<unknown>) => {
    const snapshot = cloneState(state);
    const transaction = makeTransaction();
    try {
      const result = await callback(transaction.tx);
      transaction.release();
      return result;
    } catch (error) {
      Object.assign(state, snapshot);
      transaction.release();
      throw error;
    }
  }),
};

const paymentSettlementConfigsTable = {
  id: "id",
};
const auditLogsTable = {
  id: "id",
};

jest.unstable_mockModule("@workspace/db", () => ({
  db,
  auditLogsTable,
  paymentSettlementConfigsTable,
}));

jest.unstable_mockModule("drizzle-orm", () => ({
  asc: (value: unknown) => value,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: sqlTag,
}));

jest.unstable_mockModule("../../lib/auth.js", () => ({
  adminMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 99, name: "Settlement Tester", role: "admin" };
    req.log = { error: jest.fn() };
    next();
  },
}));

jest.unstable_mockModule("../../lib/auditLog.js", () => ({
  getClientInfo: () => ({ ipAddress: "127.0.0.1", userAgent: "settlement-test" }),
  getUserFromReq: () => ({ userId: 99, userName: "Settlement Tester", userRole: "admin" }),
  logAudit: mockLogAudit,
}));

const { default: express } = await import("express");
const { default: supertest } = await import("supertest");
const { default: settlementRouter } = await import("../paymentSettlementConfigs.js");

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.log ??= { error: jest.fn() };
  next();
});
app.use(settlementRouter);
const request = supertest(app);

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function seedConfig(overrides: Partial<Config> = {}): Config {
  const config: Config = {
    id: state.nextConfigId++,
    companyId: COMPANY_ID,
    providerCode: PROVIDER,
    bankAccountId: ACCOUNT_A,
    settlementDelayBusinessDays: 1,
    effectiveFrom: isoDate(1),
    effectiveUntil: null,
    isActive: true,
    source: "OWNER_APPROVED",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  state.configs.push(config);
  return config;
}

function resetState(): void {
  state.configs = [];
  state.audits = [];
  state.nextConfigId = 1;
  state.failAuditWrites = false;
  mockExecute.mockReset();
  mockLogAudit.mockReset();
  db.transaction.mockClear();
  mockExecute.mockResolvedValue({ rows: [{ id: 1 }] });
}

function createRule(effectiveFrom: string, extra: Record<string, unknown> = {}) {
  return request.post("/admin/payment-settlement-configs/rules").send({
    companyId: COMPANY_ID,
    bankAccountId: ACCOUNT_A,
    effectiveFrom,
    settlementDelayBusinessDays: 1,
    ...extra,
  });
}

beforeEach(resetState);

describe("payment settlement rule periods", () => {
  it("allows adjacent periods and preserves both active rules without overlap", async () => {
    const firstStart = isoDate(10);
    const first = seedConfig({ effectiveFrom: firstStart, effectiveUntil: isoDate(19) });

    const response = await createRule(isoDate(20), { effectiveUntil: isoDate(29) });

    expect(response.status).toBe(201);
    expect(state.configs).toHaveLength(2);
    expect(state.configs.find((config) => config.id === first.id)?.effectiveUntil).toBe(isoDate(19));
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].action).toBe("PAYMENT_SETTLEMENT_RULE_CREATED");
  });

  it("requires explicit closure when an overlapping rule changes account or delay", async () => {
    const existing = seedConfig({ effectiveFrom: isoDate(1), bankAccountId: ACCOUNT_A, settlementDelayBusinessDays: 1 });

    const rejected = await createRule(isoDate(5), {
      bankAccountId: ACCOUNT_B,
      settlementDelayBusinessDays: 3,
      effectiveUntil: isoDate(8),
    });

    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: "SETTLEMENT_RULE_OVERLAP",
      requiresExplicitClose: true,
      overlaps: [{ id: existing.id, bankAccountId: ACCOUNT_A, settlementDelayBusinessDays: 1 }],
    });
    expect(state.configs).toHaveLength(1);

    const replaced = await createRule(isoDate(5), {
      bankAccountId: ACCOUNT_B,
      settlementDelayBusinessDays: 3,
      effectiveUntil: isoDate(8),
      closeRuleIds: [existing.id],
    });

    expect(replaced.status).toBe(201);
    expect(state.configs.find((config) => config.id === existing.id)?.effectiveUntil).toBe(isoDate(4));
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "PAYMENT_SETTLEMENT_RULE_CLOSED",
      "PAYMENT_SETTLEMENT_RULE_CREATED",
    ]);
  });

  it("rejects a replacement that would close an effective period retroactively", async () => {
    const existing = seedConfig({ effectiveFrom: isoDate(-10), effectiveUntil: null });

    const response = await createRule(isoDate(-1), { closeRuleIds: [existing.id] });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SETTLEMENT_RULE_RETROACTIVE_REPLACEMENT_BLOCKED");
    expect(state.configs).toEqual([expect.objectContaining({ id: existing.id, effectiveUntil: null })]);
  });

  it("rejects deactivation of a rule that is already effective", async () => {
    const existing = seedConfig({ effectiveFrom: isoDate(-1) });

    const response = await request
      .patch(`/admin/payment-settlement-configs/rules/${existing.id}`)
      .send({ action: "deactivate" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SETTLEMENT_RULE_HISTORICAL_DEACTIVATION_BLOCKED");
    expect(state.configs[0]).toMatchObject({ id: existing.id, isActive: true });
  });

  it("rejects manual closure in the past for an effective rule", async () => {
    const existing = seedConfig({ effectiveFrom: isoDate(-10) });

    const response = await request
      .patch(`/admin/payment-settlement-configs/rules/${existing.id}`)
      .send({ action: "close", effectiveUntil: isoDate(-1) });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SETTLEMENT_RULE_RETROACTIVE_CLOSE_BLOCKED");
    expect(state.configs[0]).toMatchObject({ id: existing.id, effectiveUntil: null });
  });

  it("rolls back period changes when audit storage fails", async () => {
    const existing = seedConfig({ effectiveFrom: isoDate(1), effectiveUntil: null });
    state.failAuditWrites = true;

    const response = await createRule(isoDate(5), { closeRuleIds: [existing.id] });

    expect(response.status).toBe(400);
    expect(state.configs).toHaveLength(1);
    expect(state.configs[0]).toMatchObject({ id: existing.id, effectiveUntil: null });
    expect(state.audits).toHaveLength(0);
  });

  it("serializes parallel writes so only one rule can claim the same effective date", async () => {
    const first = createRule(isoDate(15), { effectiveUntil: isoDate(20) });
    const second = createRule(isoDate(15), { effectiveUntil: isoDate(20) });
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(state.configs.filter((config) => config.effectiveFrom === isoDate(15) && config.isActive)).toHaveLength(1);
    expect(state.configs).toHaveLength(1);
  });
});