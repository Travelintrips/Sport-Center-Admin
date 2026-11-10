import { jest } from '@jest/globals';

jest.unstable_mockModule('@workspace/db',()=>({db:{execute:jest.fn(),transaction:jest.fn()}}));
const { isSafeReenrollment } = await import('./x904NewOrdinaryUserDefaultSuspend.js');

describe('X904 new ordinary user safe reenrollment',()=>{
  test('accepts long-absent historical role0 PIN whose old snapshot name was blank',()=>{
    expect(isSafeReenrollment({pin:'16',name:'ANNISA DWI',oldName:'',oldRole:0,absentSnapshots:2,gapMinutes:6})).toBe(true);
  });
  test('does not treat same named historical identity as a fresh reenrollment',()=>{
    expect(isSafeReenrollment({pin:'16',name:'ANNISA DWI',oldName:'ANNISA DWI',oldRole:0,absentSnapshots:10,gapMinutes:100})).toBe(false);
  });
  test('still rejects special roles and weak absence evidence',()=>{
    expect(isSafeReenrollment({pin:'16',name:'ANNISA DWI',oldName:'',oldRole:14,absentSnapshots:10,gapMinutes:100})).toBe(false);
    expect(isSafeReenrollment({pin:'16',name:'ANNISA DWI',oldName:'',oldRole:0,absentSnapshots:1,gapMinutes:100})).toBe(false);
    expect(isSafeReenrollment({pin:'16',name:'ANNISA DWI',oldName:'',oldRole:0,absentSnapshots:10,gapMinutes:5})).toBe(false);
  });
});
