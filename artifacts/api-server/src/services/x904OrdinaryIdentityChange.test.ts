import { classifyX904OrdinaryIdentityChange as classify, findX904OrdinaryIdentityReplacements as find } from "./x904OrdinaryIdentityChange";
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

test("replacement between intermediate snapshots is audited",()=>{
  expect(find([
    [{pin:"16",name:"ANNISA DWI",role:0,enabled:true}],
    [{pin:"16",name:"ANNISA DWI",role:0,enabled:true},{pin:"800",name:"OLD",role:0,enabled:true}],
    [{pin:"16",name:"ANNISA DWI",role:0,enabled:true},{pin:"800",name:"NEW",role:0,enabled:true}],
  ])).toEqual(["800"]);
});
test("unchanged identity and protected PINs do not raise review",()=>{
  expect(find([[old,{...old,pin:"12"}], [{...old,name:" old person "},{...old,pin:"12",name:"CHANGED"}]])).toEqual([]);
});
