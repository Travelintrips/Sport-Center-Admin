import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym no-login ordinary PIN field and server-side match", () => {
  const form = readFileSync(join(process.cwd(), "../sport-center/src/pages/wa/BookingForm.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");
  const statusPage = readFileSync(join(process.cwd(), "../sport-center/src/pages/wa/BookingStatus.tsx"), "utf8");

  test("no-login guest sees green registered name without ever entering a PIN", () => {
    expect(form).toContain('guestIdentityRoute === "registered" || guestIdentityRoute === "expired_member"');
    expect(form).toContain('font-bold text-green-700 border-green-300');
    expect(form).toContain('body:JSON.stringify({customerName:name})');
    expect(form).not.toContain('id="guest-x904-pin"');
    expect(form).not.toContain('requestedX904Pin: guestPin.trim()');
    expect(form).not.toContain('Cocokkan PIN');
  });

  test("backend resolves unique approved name and holds access for staff", () => {
    const start = api.indexOf('const publicGymGuest = req.body.publicGymGuest === true');
    const end = api.indexOf('const customer = publicGymGuest ? null : await ensureCustomer',start);
    const scope = api.slice(start,end);
    expect(scope).toContain('resolveGymGuestName(bookingCustomerName)');
    expect(scope).toContain('guestNameRoute?.route === "registered"');
    expect(scope).toContain('guestNameRoute.userPin');
    expect(scope).toContain('guestNameRoute.deviceUid');
    expect(scope).toContain('guestSubmittedPin && guestNameRoute?.route === "registered"');
    expect(scope).toContain('guestSubmittedPin !== guestNameRoute.userPin');
    expect(api).toContain('X904_NONMEMBER_PIN_BUSY');
    expect(scope).toContain('x904_verified_nonmember_identities');
    expect(api).toContain('publicGymGuest ? "review_required" : "verified"');
    expect(api).toContain('publicGymGuest ? "review_required" : "pending"');
    expect(api).toContain('x904Identity: !publicGymGuest && verifiedX904Identity');
  });

  test("booking WhatsApp defaults to +62 but supports optional international dial code", () => {
    expect(form).toContain('const [whatsappCountryCode, setWhatsappCountryCode] = useState(initialCountryCode)');
    expect(form).toContain('if (!value.trim() || digits.startsWith("0")) return "62"');
    expect(form).toContain('Pilih kode negara WhatsApp');
    expect(form).toContain('WHATSAPP_COUNTRIES.map');
    expect(form).toContain('code: "65"');
    expect(form).toContain('code: "60"');
    expect(form).toContain('value={localWhatsappDigits(form.customerPhone, whatsappCountryCode)}');
    expect(form).toContain('normalizedWhatsappNumber(e.target.value, whatsappCountryCode)');
    expect(form).toContain('customerPhone: normalizedWhatsappNumber(phoneFromWA, initialCountryCode)');
    expect(form).toContain('customerPhone: form.customerPhone,');
    expect(form).toContain('validWhatsappNumber(form.customerPhone.trim())');
    expect(form).toContain('/^[1-9][0-9]{7,14}$/.test(value)');
    expect(api).toContain('!/^[1-9][0-9]{7,14}$/.test(guestPhone)');
    expect(api).not.toContain('!/^628[0-9]{7,13}$/.test(guestPhone)');
  });

  test("public booking success separates booking, payment review and X904 access", () => {
    expect(form).toContain("Booking Berhasil Dibuat!");
    expect(form).toContain("Salin nomor booking");
    expect(form).toContain("Status Booking Gym");
    expect(form).toContain("Berhasil Dibuat");
    expect(form).toContain("Menunggu Verifikasi Admin");
    // OCR preview and booking creation alone are not proof receipt.
    // Only a successfully persisted waiting_confirmation response opens admin review.
    expect(form).toContain('data?.success !== true');
    expect(form).toContain('"waiting_confirmation", "confirmed"');
    expect(form).toContain('proofUploadState === "received" ? "Menunggu Verifikasi Admin"');
    expect(form).toContain('proofUploadState === "failed" ? "Bukti Belum Tersimpan"');
    expect(form).toContain('void uploadProofForBooking(result)');
    expect(form).toContain("Booking tetap tercatat; coba upload ulang tanpa membuat booking baru.");
    expect(form).not.toContain("setProofConfirmed(confirmed)");
    expect(form).toContain("Belum Aktif");
    expect(form).toContain("aktivasi mesin serta read-back berhasil");
    expect(form).toContain("Cek Status Booking");
    expect(form).not.toContain("Booking Dikonfirmasi!");
    expect(form).not.toContain("Bukti pembayaran cocok dan booking otomatis dikonfirmasi.");
  });

  test("public Gym booking and proof commit together with staff-only review", () => {
    // Verify the only public Gym submit now sends a single multipart request,
    // not an acknowledged booking followed by a best-effort receipt POST.
    expect(form).toContain('const requestOptions: RequestInit = publicGymGuest');
    expect(form).toContain('fd.append("proof", proofFile)');
    expect(form).toContain('bookingResult.proofStatus !== "waiting_confirmation"');
    expect(api).toContain('router.post("/wa/booking", uploadProof.single("proof")');
    expect(api).toContain('req.body.publicGymGuest === "true"');
    expect(api).toContain("Booking belum dibuat");
    expect(api).toContain('const url = await uploadProofWithFallback(req.file.buffer');
    expect(api).toContain('await tx.insert(paymentsTable).values({');
    expect(api).toContain('status: "pending",');
    expect(api).toContain('status: "waiting_confirmation", updatedAt: new Date()');
    expect(api).toContain('proofStatus: publicGymGuest && publicProof ? "waiting_confirmation" : null');
    expect(api).toContain('access_state,');
    expect(form).not.toContain('setProofUploadState(proofFile && form.paymentMethod ? "uploading" : "idle");\n      setResult(bookingResult);\n      if (proofFile');
  });

  test("Gym booking status is gated by payment, entitlement and X904 read-back", () => {
    expect(api).toContain('c.payload->>\'accessId\' = a.access_id::text');
    expect(api).toContain('access.command_result?.readBackConfirmed === true');
    expect(api).toContain('Number(access.command_result?.afterGroup) === 1');
    expect(api).toContain('access.access_state === "active"');
    expect(api).toContain('access.verification_state === "verified"');
    expect(api).toContain('accessNotExpired && latestActivationVerified');
    expect(api).toContain('payment?.status === "confirmed"');
    expect(api).toContain('gymAccessStatus: booking.source === "gym_public_guest"');
    expect(statusPage).toContain('Aktif — Silakan Scan');
    expect(statusPage).toContain('Perbarui Status');
    expect(statusPage).toContain('cache: "no-store"');
    expect(statusPage).toContain('booking.gymAccessStatus === "active" && paymentConfirmed');
    expect(statusPage).not.toContain('setInterval(');
  });

  test("VIS path remains separate and anonymous cannot force a PIN/UID", () => {
    expect(api).toContain('guestNameRoute?.route === "visitor_card"');
    expect(api).toContain('verifiedX904Identity?.identityType === "card"');
    expect(api).toContain('publicGymGuest ? null : await ensureCustomer');
    expect(form).not.toContain('guestPinMatch');
    expect(form).not.toContain('guestPinChecking');
  });
  test("fully expired mapped member is eligible for daily booking but never gets former PIN access", () => {
    const routing = readFileSync(join(process.cwd(), "src/services/x904GymGuestNameRouting.ts"), "utf8");
    expect(routing).toContain('membership_status) === "expired"');
    expect(routing).toContain("m.status::text='active'");
    expect(routing).toContain('route: "recognized_review"');
    expect(routing).toContain('route: "expired_member", userPin: null, deviceUid: null');
    expect(api).toContain('guestNameRoute?.route === "expired_member"');
    expect(api).toContain("PIN membership lama tidak diberikan hak akses");
    expect(form).toContain('guestIdentityRoute === "expired_member"');
    expect(form).toContain("tiket harian boleh dipesan");
  });

});
