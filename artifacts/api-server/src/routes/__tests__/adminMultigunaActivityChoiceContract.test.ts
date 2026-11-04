import { describe,expect,it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("admin Multiguna sports choice matches public booking",()=>{
  const admin=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/CheckoutForm.tsx"),"utf8");
  const publicDetail=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/FacilityDetail.tsx"),"utf8");
  const bookings=readFileSync(resolve(process.cwd(),"src/routes/bookings.ts"),"utf8");

  it("uses the same supported sports as customer booking",()=>{
    for(const value of ["futsal","basket","voli"]){
      expect(publicDetail).toContain('value: "'+value+'"');
      expect(admin).toContain('value:"'+value+'"');
    }
    expect(admin).toContain("Jenis Fasilitas / Olahraga");
    expect(admin).toContain("isMultigunaFacility &&");
    expect(admin).toContain('setSelectedActivityType("");');
  });

  it("requires sport selection for Multiguna and sends activityType to booking",()=>{
    expect(admin).toContain("(!isMultigunaFacility || multigunaActivities.some(a => a.value === selectedActivityType))");
    expect(admin).toContain("isMultigunaFacility && !multigunaActivities.some(a => a.value === selectedActivityType)");
    expect(admin).toContain("...(isMultigunaFacility ? {activityType:selectedActivityType} : {})");
    expect(admin).toContain("Jenis Fasilitas / Olahraga:");
  });

  it("persists recurring sport choice without changing physical facility identity",()=>{
    const recurring=bookings.split('router.post("/bookings/recurring",')[1]?.split('router.post("/bookings',1)[0] ?? "";
    expect(recurring).toContain("activityType: rawActivityType");
    expect(recurring).toContain('["futsal","basket","voli"].includes(');
    expect(recurring).toContain("activityType,");
    expect(recurring).toContain("facilityId: Number(facilityId)");
  });
});
