import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const form=readFileSync(new URL("../artifacts/sport-center/src/pages/wa/BookingForm.tsx",import.meta.url),"utf8");
const chooser=readFileSync(new URL("../artifacts/sport-center/src/pages/GymNonmemberEntry.tsx",import.meta.url),"utf8");

test("all facility chooser options lead to shared responsive checkout",()=>{
 assert.match(chooser,/const path = "\/wa\/booking\/"/);
 assert.match(chooser,/isGym\(facility\) \? path \+ "\?nonmember=1&self=1" : path/);
 assert.match(form,/max-w-6xl/);
 assert.match(form,/lg:grid-cols-\[minmax\(0,1\.2fr\)_410px\]/);
 assert.match(form,/src=\{buildingImg\}/);
 assert.match(form,/Ringkasan dan pembayaran booking/);
 assert.match(form,/Konfirmasi & Buat Booking/);
});
test("existing pricing, availability, proof, WA and X904 logic remains",()=>{
 assert.match(form,/fetch\(\`\/api\/wa\/facility\/\$\{params\.facilityId\}\`/);
 assert.match(form,/fetch\(\`\/api\/availability\?\$\{query\.toString\(\)\}\`/);
 assert.match(form,/fetch\("\/api\/wa\/booking"/);
 assert.match(form,/uploadProofForBooking\(bookingResult\)/);
 assert.match(form,/paymentSettings\.qrisImageUrl/);
 assert.match(form,/paymentSettings\.bankAccount/);
 assert.match(form,/const publicGymGuest = dedicatedNonmember && searchParams\.get\("self"\) === "1"/);
 assert.match(form,/dedicatedNonmember && !publicGymGuest && !x904VerifiedName/);
 assert.match(form,/if \(dedicatedNonmember && !publicGymGuest && \(!x904VerifiedName \|\| x904Verifying\)\)/);
 assert.match(form,/x904IdentityValue\.trim\(\)/);
});
test("success page retains proof and status links, without inventing payment confirmations",()=>{
 assert.match(form,/href=\{result\.uploadProofUrl\}/);
 assert.match(form,/href=\{result\.statusUrl\}/);
 assert.match(form,/Booking Berhasil Dibuat!/);
 assert.match(form,/Menunggu Verifikasi Admin/);
 assert.match(form,/Akses X904/);
 assert.match(form,/Belum Aktif/);
 assert.doesNotMatch(form,/proofConfirmed \? "Booking Dikonfirmasi!"/);
 assert.match(form,/Booking dan pembayaran mandiri tidak otomatis membuka pintu/);
});
