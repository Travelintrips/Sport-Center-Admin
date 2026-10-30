import {createHash} from "node:crypto";
import type {GymEntitlement} from "./gymMembershipEntitlement";

/** Stable payment-event identity; the transactional INSERT has a unique event_key. */
export function x904PaymentConfirmedEventKey(paymentId:number):string {
  if(!Number.isSafeInteger(paymentId)||paymentId<=0)throw new Error('INVALID_PAYMENT_ID');
  return 'x904-payment-confirmed-'+paymentId;
}

/** Pure machine-command policy. It never writes to the database or device. */
export function chooseX904AutomaticCommand(entitlement: GymEntitlement, group: number): "ACTIVATE_USER"|"SUSPEND_USER"|null {
  if(entitlement==="active" && group===2)return "ACTIVATE_USER";
  if(entitlement==="suspended" && group===1)return "SUSPEND_USER";
  return null;
}
export function x904MachineCommandResult(state: string, readBackConfirmed: boolean): "processed"|"review_required"|"pending" {
  if(state==="completed" && readBackConfirmed)return "processed";
  if(state==="failed")return "review_required";
  return "pending";
}
export function x904AutomaticCommandKey(eventKey:string,command:"ACTIVATE_USER"|"SUSPEND_USER",pin:string):string {
  return "x904auto_"+createHash("sha256").update(eventKey+":"+command+":"+pin).digest("hex").slice(0,44);
}
