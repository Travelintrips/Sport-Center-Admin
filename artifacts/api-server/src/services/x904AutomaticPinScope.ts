import {isX904AutoSuspendExempt} from './x904NonmemberAccessPolicy';

/** Parse rollout scope fail-closed; exempt identities can never enter a PIN allowlist. */
export function resolveX904AutomaticPinScope(scope: string | undefined, rawPins: string | undefined): {allVerified:boolean;allowlistMode:boolean;pins:string[]} | null {
  const allVerified=scope==="all_verified";
  const allowlistMode=scope==="allowlist";
  if(allVerified)return {allVerified:true,allowlistMode:false,pins:[]};
  if(scope!=="single" && !allowlistMode)return null;
  if(typeof rawPins!=="string" || rawPins.trim()==="")return null;
  const tokens=rawPins.split(",");
  // Empty entries (including leading, trailing, or repeated commas) are config errors.
  if(tokens.some(token=>token.trim()===""))return null;
  const pins=tokens.map(x=>x.trim());
  if((!allowlistMode && pins.length!==1) || (allowlistMode && pins.length>20) ||
    new Set(pins).size!==pins.length ||
    pins.some(pin=>!/^[0-9]{1,8}$/.test(pin) || isX904AutoSuspendExempt(pin,0)))return null;
  return {allVerified:false,allowlistMode,pins};
}
