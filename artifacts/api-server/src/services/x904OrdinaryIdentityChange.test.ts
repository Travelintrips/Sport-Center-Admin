import { classifyX904OrdinaryIdentityChange as classify } from "./x904OrdinaryIdentityChange";
const old={pin:"600",name:"OLD PERSON",role:0,group:1,enabled:true};
test("same PIN different name needs review, never inherits identity",()=>{
 expect(classify(old,{...old,name:"NEW PERSON"})).toBe("replacement_review");
 expect(classify(old,{...old,name:" old  person "})).toBe("unchanged");
});
test("new role-0 detected, privileged and exempt excluded",()=>{
 expect(classify(null,old)).toBe("new");
 expect(classify(null,{...old,role:14})).toBe("excluded");
 expect(classify(null,{...old,pin:"237"})).toBe("excluded");
 expect(classify({...old,role:14},old)).toBe("excluded");
});
