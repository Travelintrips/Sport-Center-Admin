import { jest, describe, it, expect } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
jest.unstable_mockModule('../../lib/auth.js', () => ({
  adminMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    const role=req.headers['x-test-role'];
    if (role) (req as any).user={role,userId:123};
    next();
  },
}));
const { default: express } = await import('express');
const { default: router } = await import('../gymX904Integration.js');
const { default: supertest } = await import('supertest');
const app=express();app.use(express.json());app.use(router);
const request=supertest(app);
const url='/admin/gym-x904/vis006-nonfinancial-test';
describe('VIS006 authenticated nonfinancial endpoint (isolated, no device commands)',()=>{
  it('rejects unauthenticated caller',async()=>{
    const res=await request.post(url).send({});expect(res.status).toBe(403);
  });
  it('rejects non-owner admin',async()=>{
    const res=await request.post(url).set('x-test-role','admin').send({});expect(res.status).toBe(403);
  });
  it('rejects invalid PIN and financial fields before touching database',async()=>{
    const names=['GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED','GYM_X904_USER_WRITE_ENABLED','GYM_X904_MANUAL_ACCESS_ENABLED','GYM_X904_NONMEMBER_ONLY_PIN'];
    const previous=names.map(n=>process.env[n]);
    names.forEach((n,i)=>process.env[n]=i===3?'15':'true');
    try {
      for (const payload of [
        {testReference:'1adbaab4-9c23-4a1b-aab2-123456789abc',commandType:'SUSPEND_USER',confirmPin:'200',simulationAccepted:true},
        {testReference:'1adbaab4-9c23-4a1b-aab2-123456789abc',commandType:'SUSPEND_USER',confirmPin:'15',simulationAccepted:true,amount:1},
        {testReference:'1adbaab4-9c23-4a1b-aab2-123456789abc',commandType:'SUSPEND_USER',confirmPin:'15',simulationAccepted:false},
      ]) {
        const res=await request.post(url).set('x-test-role','owner').send(payload);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_NONFINANCIAL_TEST_APPROVAL');
      }
    } finally {names.forEach((n,i)=>previous[i]===undefined?delete process.env[n]:process.env[n]=previous[i]);}
  });
  it('fails closed with rollout flag off for owner',async()=>{
    const old=process.env.GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED;
    delete process.env.GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED;
    try {const res=await request.post(url).set('x-test-role','owner').send({});expect(res.status).toBe(503);expect(res.body.error).toBe('NONFINANCIAL_TEST_DISABLED');}
    finally {if(old===undefined)delete process.env.GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED;else process.env.GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED=old;}
  });
});
