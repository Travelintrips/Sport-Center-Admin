import {isX904AutoSuspendExempt} from './x904NonmemberAccessPolicy';

/** Parse rollout scope fail-closed; exempt identities can never enter a PIN allowlist. */
export function resolveX904AutomaticPinScope(scope: string | undefined, rawPins: string | undefined): {allVerified:boolean;allowlistMode:boolean;pins:string[]} | null {
  const allVerified=scope==="all_verified";
  const allowlistMode=scope==="allowlist";
  const pins=(rawPins??"").split(",").map(x=>x.trim()).filter(Boolean);
  if(allVerified)return {allVerified:true,allowlistMode:false,pins:[]};
  if(!pins.length || (!allowlistMode && (scope!=="single" || pins.length!==1)) ||
    (allowlistMode && pins.length>20) || new Set(pins).size!==pins.length ||
    pins.some(pin=>!/^[0-9]{1,8}$/.test(pin) || isX904AutoSuspendExempt(pin,0)))return null;
  return {allVerified:false,allowlistMode,pins};
}

