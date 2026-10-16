/**
 * X904 bidirectional sync safety gate.
 * Inbound attendance remains separate from LAN snapshots; outbound writes are
 * disabled until a device-command protocol is independently verified.
 */
export type X904Direction = "device_to_sc" | "sc_to_device";
export type X904SyncAction = "read_snapshot" | "preview_member_mapping" | "write_user" | "delete_user" | "set_access" | "unlock_door" | "create_booking";
export function assessX904SyncAction(input:{
  direction:X904Direction;
  action:X904SyncAction;
  membershipVerified:boolean;
  hardwareProtocolVerified:boolean;
  explicitApproval:boolean;
}):{allowed:boolean;reason:string}{
  if(input.action==="read_snapshot" && input.direction==="device_to_sc") return {allowed:true,reason:"READ_ONLY_SNAPSHOT"};
  if(input.action==="preview_member_mapping") return {allowed:true,reason:"PREVIEW_ONLY_NO_DEVICE_MUTATION"};
  if(!input.membershipVerified) return {allowed:false,reason:"MAPPING_NOT_VERIFIED"};
  if(!input.hardwareProtocolVerified) return {allowed:false,reason:"HARDWARE_PROTOCOL_NOT_VERIFIED"};
  if(!input.explicitApproval) return {allowed:false,reason:"DEVICE_WRITE_APPROVAL_REQUIRED"};
  // Fail closed even after checks: runtime actuator not implemented.
  return {allowed:false,reason:"WRITE_EXECUTOR_NOT_IMPLEMENTED"};
}
