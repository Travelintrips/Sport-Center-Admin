import { jest } from '@jest/globals';

jest.unstable_mockModule('@workspace/db',()=>({db:{execute:jest.fn(),transaction:jest.fn()}}));
const { isSafeReenrollment } = await import('./x904NewOrdinaryUserDefaultSuspend.js');

describe('X904 new ordinary role-0 safe reenrollment is generic',()=>{
  test.each([
    ['16','ANNISA DWI','',2,6],
    ['501','BUDI SANTOSO','',3,12],
    ['888','SITI RAHMA','OLD USER',4,20],
  ])('accepts safe reenrollment pin %s without per-PIN code', (pin,name,oldName,absentSnapshots,gapMinutes)=>{
    expect(isSafeReenrollment({pin,name,oldName,oldRole:0,absentSnapshots,gapMinutes})).toBe(true);
  });

  test.each([
    ['501','BUDI SANTOSO','BUDI SANTOSO',0,10,100],
    ['502','SITI RAHMA','',14,10,100],
    ['503','RUDI HARTONO','',0,1,100],
    ['504','DEWI LESTARI','',0,10,5],
    ['12','PROTECTED USER','',0,10,100],
  ])('rejects unsafe/protected case pin %s', (pin,name,oldName,oldRole,absentSnapshots,gapMinutes)=>{
    expect(isSafeReenrollment({pin,name,oldName,oldRole,absentSnapshots,gapMinutes})).toBe(false);
  });
});
