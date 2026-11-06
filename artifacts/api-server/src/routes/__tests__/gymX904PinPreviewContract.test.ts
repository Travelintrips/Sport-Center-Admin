import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route=readFileSync(resolve(process.cwd(),"src/routes/memberships.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/CheckoutForm.tsx"),"utf8");
describe("read-only X904 new PIN preview and legacy booking preservation",()=>{
 const preview=route.split('router.get("/memberships/admin-x904-pin-preview"')[1]
   ?.split('router.post("/memberships/admin-x904-create-user"')[0]??"";
 it("uses GET, authenticated read-only inventory, and contains no writes",()=>{
   expect(preview).toContain('adminMiddleware');
   expect(preview).toContain("gym_x904_lan_users");
   expect(preview).toContain("gym_x904_member_mapping");
   expect(preview).toContain("x904_user_commands");
   expect(preview).toContain("chooseThreeDigitX904Pin");
   expect(preview).toContain("previewOnly:true");
   expect(preview).toContain("reserved:false");
   expect(preview).toContain("canCreateOnDevice:false");
   expect(preview).toContain("last_complete_at>=now()-interval '15 minutes'");
   expect(preview).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(INTO|sport_center)/i);
   expect(preview).not.toContain("CREATE_USER',");
 });
 it("preview UI is visible without pilot, but POST only allowed with pilot flag",()=>{
   expect(ui).toContain('<Label>Buat user X904 *</Label>');
   expect(ui).toContain('VITE_GYM_X904_NEW_USER_PILOT !== "true"');
   expect(ui).toContain("previewNewX904Pin()");
   expect(ui).toContain('Pratinjau Generate PIN 3 Digit');
   expect(ui).toContain('Periksa Ketersediaan PIN');
   expect(ui).toContain("Gunakan user X904 yang sudah ada (alur lama tetap tersedia)");
   expect(ui).toContain('open={import.meta.env.VITE_GYM_X904_NEW_USER_PILOT !== "true"}');
 });
 it("does not present a preview as allocated or paid",()=>{
   expect(ui).toContain("belum dialokasikan");
   expect(ui).toContain("belum dipesan atau dibuat");
   expect(route).toContain("PIN sudah ada, ganti dengan yang baru atau Generate PIN.");
 });
});
