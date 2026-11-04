import express from "express";
import multer from "multer";
import { createServer } from "node:http";
import { getProdPool, bizportalSyncConfigured } from "../lib/bizportalSync";
if (process.env.NODE_ENV !== "development") throw Error("DEV_ONLY");
if (getProdPool() !== null || bizportalSyncConfigured) throw Error("DEV_EXTERNAL_SYNC_NOT_ISOLATED");
console.log("X904_BIZPORTAL_DEV_ISOLATION_PASS");
const app = express();
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024},fileFilter:(_req,file,cb)=>cb(null,file.mimetype.startsWith("image/"))});
app.post("/multipart-test",upload.single("proof"),(req,res)=>{
 const file=req.file;
 if(!file || !["image/png","image/jpeg","image/webp","image/heic","image/heif"].includes(file.mimetype.toLowerCase())) {res.status(400).json({error:"proof_required"});return;}
 if(!req.body.name || !req.body.x904Pin) {res.status(400).json({error:"missing_fields"});return;}
 res.status(200).json({accepted:true,bytes:file.size,name:req.body.name,pin:req.body.x904Pin});
});
const server=createServer(app);
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
try{
 const address=server.address();
 if(!address || typeof address==="string") throw Error("HTTP_BIND_FAILED");
 const url=`http://127.0.0.1:${address.port}/multipart-test`;
 const send=async(type:string,withFile=true)=>{
  const form=new FormData();
  form.set("name","X904 TEST");form.set("x904Pin","99999999");
  if(withFile) form.set("proof",new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type}),"proof.png");
  return fetch(url,{method:"POST",body:form});
 };
 const good=await send("image/png");
 if(good.status!==200 || !(await good.json() as {accepted?:boolean}).accepted)throw Error("MULTIPART_IMAGE_REJECTED");
 const bad=await send("text/plain");
 if(bad.status!==400)throw Error("MULTIPART_TEXT_ACCEPTED");
 const missing=await send("image/png",false);
 if(missing.status!==400)throw Error("MULTIPART_MISSING_ACCEPTED");
 console.log("X904_MULTIPART_MIDDLEWARE_HTTP_PASS",JSON.stringify({valid:200,invalidType:400,missingProof:400}));
}finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
