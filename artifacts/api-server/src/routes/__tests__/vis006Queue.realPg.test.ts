import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Request, Response, NextFunction } from 'express';
const url=process.env.X904_VIS006_ISOLATED_PG_URL;
if(!url?.includes('127.0.0.1:55436/vis006_test'))throw Error('ISOLATED_VIS006_DB_REQUIRED');
const pool=new pg.Pool({connectionString:url});
const db=drizzle(pool);
jest.unstable_mockModule('@workspace/db',()=>({db}));
jest.unstable_mockModule('../../lib/auth.js',()=>({adminMiddleware:(req:Request,_res:Response,next:NextFunction)=>{(req as any).user={role:'owner',userId:123};next();}}));
const {default:express}=await import('express');
const {default:router}=await import('../gymX904Integration.js');
const {default:supertest}=await import('supertest');
const app=express();app.use(express.json());app.use(router);
const request=supertest(app);const route='/admin/gym-x904/vis006-nonfinancial-test';
const envs=['GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED','GYM_X904_USER_WRITE_ENABLED','GYM_X904_MANUAL_ACCESS_ENABLED','GYM_X904_NONMEMBER_ONLY_PIN'];
const old=envs.map(k=>process.env[k]);
const reference='5c12a84b-41a2-41d4-ae20-47f2c47a9011';
const call=(commandType:string,ref=reference)=>request.post(route).send({testReference:ref,commandType,confirmPin:'15',simulationAccepted:true});
const sql=(s:string)=>pool.query(s);
beforeAll(async()=>{
 await sql(`CREATE SCHEMA IF NOT EXISTS sport_center;
 CREATE TABLE IF NOT EXISTS sport_center.x904_user_commands(command_id serial primary key,device_serial text,command_type text,user_pin text,payload jsonb,requested_by int,idempotency_key text unique,state text default 'queued',created_at timestamptz default now(),completed_at timestamptz,result jsonb);
 CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_users(device_serial text,user_pin text,device_uid int,display_name text,device_role int);
 CREATE TABLE IF NOT EXISTS sport_center.gym_x904_access_snapshots(snapshot_id serial primary key,device_serial text,observed_at timestamptz,user_count int,users jsonb);
 TRUNCATE sport_center.x904_user_commands,sport_center.gym_x904_lan_users,sport_center.gym_x904_access_snapshots RESTART IDENTITY;
 INSERT INTO sport_center.gym_x904_lan_users VALUES ('TDBD234200545','15',15,'VIS 006',0);
 INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',now(),1,'[{"pin":"15","name":"VIS 006","role":0,"group":1,"enabled":true}]'::jsonb)`);
 envs.forEach((k,i)=>process.env[k]=i===3?'15':'true');
});
afterAll(async()=>{envs.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);await pool.end();});
describe('VIS006 queue real isolated PostgreSQL',()=>{
 it('queues only one suspend and idempotent retry',async()=>{
  const first=await call('SUSPEND_USER');expect(first.status).toBe(202);expect(first.body.state).toBe('queued');
  const again=await call('SUSPEND_USER');expect(again.status).toBe(200);expect(again.body.state).toBe('duplicate');
  const count=await sql("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE user_pin='15'");expect(count.rows[0].n).toBe(1);
 });
 it('blocks activation while suspend is queued',async()=>{
  const r=await call('ACTIVATE_USER');expect(r.status).toBe(409);expect(r.body.error).toBe('VIS006_COMMAND_IN_PROGRESS');
 });
 it('blocks activation before verified readback and fresh group2 snapshot',async()=>{
  await sql("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=now(),result='{\"readBackConfirmed\":false}'::jsonb");
  const r=await call('ACTIVATE_USER');expect(r.status).toBe(409);
 });
 it('allows recovery activation after verified readback and fresh group2 snapshot',async()=>{
  await sql("UPDATE sport_center.x904_user_commands SET result='{\"readBackConfirmed\":true}'::jsonb,completed_at=now()-interval '2 seconds'");
  await sql(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',now(),1,'[{"pin":"15","name":"VIS 006","role":0,"group":2,"enabled":true}]'::jsonb)`);
  const r=await call('ACTIVATE_USER');expect(r.status).toBe(202);expect(r.body.state).toBe('queued');
  const count=await sql("SELECT count(*)::int n FROM sport_center.x904_user_commands");expect(count.rows[0].n).toBe(2);
 });
});
