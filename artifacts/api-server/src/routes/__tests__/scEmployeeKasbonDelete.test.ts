import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

const existing = { id: 1, employeeId: "SC003", kasbonDate: "2026-11-05", amount: "1000000.00", notes: "Kasbon Robby", proofUrl: null };
let record: typeof existing | null = existing;
let failAudit = false;
let persistedAudit: unknown[] = [];
const employeeColumn = Symbol("employee");
const idColumn = Symbol("id");
const table = { employeeId: employeeColumn, id: idColumn };
const auditTable = Symbol("audit-table");

const tx = {
 select: () => ({ from: () => ({ where: () => ({limit: async () => record ? [record] : []}) }) }),
 delete: () => ({ where: () => ({returning: async () => {
  const deleted = record;
  record = null;
  return deleted ? [deleted] : [];
 }}) }),
 insert: () => ({ values: async (value: unknown) => {
  if (failAudit) throw new Error("audit failed");
  persistedAudit.push(value);
 } }),
};

const mockDb = {
 transaction: async (fn: (dbTransaction: any) => Promise<any>) => {
   const before = record;
   const auditBefore = persistedAudit.length;
   try { return await fn(tx); }
   catch (error) { record = before; persistedAudit.length = auditBefore; throw error; }
 }
};

jest.unstable_mockModule("@workspace/db", () => ({
 db: mockDb, scEmployeesTable: {employeeId: Symbol("id")}, scEmployeeKasbonTable: table,
 auditLogsTable: auditTable
}));
jest.unstable_mockModule("../../lib/auth.js", () => ({
 adminMiddleware: (req: Request,res: Response,next: NextFunction) => {
  if (req.headers.authorization !== "Bearer admin-test") {res.status(401).json({error:"Unauthorized"});return;}
  (req as any).user={userId: null, role:"admin",name:"Test Admin"};
  next();
 }
}));
jest.unstable_mockModule("../../lib/auditLog.js", () => ({
 logAudit: async () => {}, getUserFromReq: () => ({ userId: null, userName: "Test Admin", userRole: "admin" }),
 getClientInfo: () => ({ ipAddress:"127.0.0.1", userAgent:"test" })
}));
const {default: express} = await import("express");
const {default: supertest} = await import("supertest");
const {default: router} = await import("../scEmployeeKasbon.js");
const app = express(); app.use(express.json()); app.use(router);
const endpoint = "/admin/sc-employees/SC003/kasbon/1";

beforeEach(() => {record = {...existing}; failAudit = false; persistedAudit = [];});
describe("SC employee kasbon safe delete route", () => {
 it("rejects unauthenticated DELETE without changing record", async () => {
  const res = await supertest(app).delete(endpoint);
  expect(res.status).toBe(401);
  expect(record).not.toBeNull();
 });
 it("rejects invalid IDs without changing record", async () => {
  for (const url of ["/admin/sc-employees/SC003/kasbon/0", "/admin/sc-employees/SC003/kasbon/1e0", "/admin/sc-employees/BAD/kasbon/1"]) {
   const res = await supertest(app).delete(url).set("Authorization","Bearer admin-test");
   expect(res.status).toBe(400);
  }
  expect(record).not.toBeNull();
 });
 it("deletes existing employee record and logs before state", async () => {
  const res = await supertest(app).delete(endpoint).set("Authorization","Bearer admin-test");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({deleted:true,id:1,employeeId:"SC003"});
  expect(record).toBeNull();
  expect(persistedAudit).toHaveLength(1);
  expect(persistedAudit[0]).toMatchObject({ action:"SC_KASBON_DELETED", entityId:1, before:existing });
 });
 it("returns 404 on repeated delete", async () => {
  await supertest(app).delete(endpoint).set("Authorization","Bearer admin-test");
  const res = await supertest(app).delete(endpoint).set("Authorization","Bearer admin-test");
  expect(res.status).toBe(404);
  expect(persistedAudit).toHaveLength(1);
 });
 it("rolls back delete if audit insertion fails", async () => {
  failAudit = true;
  const res = await supertest(app).delete(endpoint).set("Authorization","Bearer admin-test");
  expect(res.status).toBe(500);
  expect(record).not.toBeNull();
  expect(persistedAudit).toHaveLength(0);
 });
});
