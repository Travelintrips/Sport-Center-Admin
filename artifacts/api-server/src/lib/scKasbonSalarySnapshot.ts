/** Immutable receipt of the kasbon records included in a verified salary Sheets write.
 * The receipt is persisted in sc.audit_logs AFTER Google Sheets read-back succeeds.
 * A new transaction never revokes proof of unchanged older transactions.
 */
export type KasbonSnapshot = {id:number;amount:string;kasbonDate:string;updatedAt:string};
export type SalarySyncReceipt = {employeeId:string;cell:string;amount:number;records:KasbonSnapshot[]};
export function snapshotKasbonRecords(records:Array<{id:number;amount:string;kasbonDate:string;updatedAt:Date}>):KasbonSnapshot[]{
 return records.map(r=>({id:r.id,amount:Number(r.amount).toFixed(2),kasbonDate:r.kasbonDate,updatedAt:r.updatedAt.toISOString()}))
  .sort((a,b)=>a.id-b.id);
}
export function getKasbonReceiptStatus(current:KasbonSnapshot[],receipt:SalarySyncReceipt|null,liveMatched:boolean){
 const seen=new Map((receipt?.records??[]).map(r=>[r.id,r]));
 const syncedIds=current.filter(r=>{
  const prior=seen.get(r.id);
  return prior?.amount===r.amount && prior.kasbonDate===r.kasbonDate && prior.updatedAt===r.updatedAt;
 }).map(r=>r.id);
 return {syncedRecordIds:syncedIds,
  // Only disable Sync when the live Sheets total matches AND every current transaction
  // has a durable post-readback receipt. Legacy totals alone aren't record evidence.
  allSynced:liveMatched && !!receipt && current.every(r=>syncedIds.includes(r.id)),
  hasReceipt:!!receipt};
}
