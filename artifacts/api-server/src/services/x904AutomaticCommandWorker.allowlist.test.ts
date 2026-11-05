import {resolveX904AutomaticPinScope} from './x904AutomaticPinScope';
import {isX904AutoSuspendExempt} from './x904NonmemberAccessPolicy';

describe('X904 bounded multi-PIN allowlist regression',()=>{
  test('accepts multiple unique numeric PINs only in explicit allowlist scope',()=>{
    expect(resolveX904AutomaticPinScope('allowlist','154,55,74')).toEqual({allVerified:false,allowlistMode:true,pins:['154','55','74']});
  });
  test.each(['237','79','12'])('rejects exempt PIN %s without opening the worker',pin=>{
    expect(resolveX904AutomaticPinScope('allowlist',`154,${pin}`)).toBeNull();
  });
  test('rejects duplicates, malformed PINs, empty values, and more than 20 PINs',()=>{
    expect(resolveX904AutomaticPinScope('allowlist','154,154')).toBeNull();
    expect(resolveX904AutomaticPinScope('allowlist','154,abc')).toBeNull();
    expect(resolveX904AutomaticPinScope('allowlist',' , ')).toBeNull();
    expect(resolveX904AutomaticPinScope('allowlist',Array.from({length:21},(_,i)=>String(100+i)).join(','))).toBeNull();
  });
  test('keeps single-PIN scope strict and refuses accidental multi-PIN rollout',()=>{
    expect(resolveX904AutomaticPinScope('single','154')).toEqual({allVerified:false,allowlistMode:false,pins:['154']});
    expect(resolveX904AutomaticPinScope('single','154,55')).toBeNull();
  });
  test('role 14 remains excluded by the device candidate guard in the worker',()=>{
    expect(resolveX904AutomaticPinScope('allowlist','154')).not.toBeNull();
    // Role 14 remains explicitly exempt at the shared policy layer.
    expect(isX904AutoSuspendExempt('154',14)).toBe(true);
  });
});
