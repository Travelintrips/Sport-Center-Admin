import { jest, describe, it, expect } from '@jest/globals';
import crypto from 'node:crypto';
const mockLimit=jest.fn<() => Promise<Array<{role:string;status:string}>>>();
const mockWhere=jest.fn(() => ({limit:mockLimit}));
const mockFrom=jest.fn(() => ({where:mockWhere}));
const mockSelect=jest.fn(() => ({from:mockFrom}));
jest.unstable_mockModule('@workspace/db',()=>({db:{select:mockSelect},usersTable:{role:'role',accountStatus:'account_status',id:'id'}}));
const {default:express}=await import('express');
const {adminMiddleware}=await import('../../lib/auth.js');
const {default:supertest}=await import('supertest');
const app=express();app.use('/test',adminMiddleware,(req,res)=>res.json({role:(req as any).user.role}));
const request=supertest(app);
const token=(role:string)=>{const payload=Buffer.from(JSON.stringify({userId:123,role,tenantId:null,exp:Date.now()+60000})).toString('base64');const sig=crypto.createHmac('sha256',process.env.SESSION_SECRET!).update(Buffer.from(payload,'base64').toString()).digest('hex');return payload+'.'+sig;};
describe('real adminMiddleware token and account role checks',()=>{
  it('rejects missing bearer',async()=>{expect((await request.get('/test')).status).toBe(401)});
  it('rejects invalid bearer',async()=>{expect((await request.get('/test').set('Authorization','Bearer invalid')).status).toBe(401)});
  it('rejects stale admin token after account demotion',async()=>{mockLimit.mockResolvedValueOnce([{role:'customer',status:'active'}]);expect((await request.get('/test').set('Authorization','Bearer '+token('owner'))).status).toBe(401)});
  it('accepts current owner role',async()=>{mockLimit.mockResolvedValueOnce([{role:'owner',status:'active'}]);const r=await request.get('/test').set('Authorization','Bearer '+token('owner'));expect(r.status).toBe(200);expect(r.body.role).toBe('owner')});
});
