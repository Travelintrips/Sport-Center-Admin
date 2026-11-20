# Sport Center — sertifikasi instalasi terkelola per pelanggan (Issue #850)

## Keputusan arsitektur tanpa membangun ulang
**Mode A — dedicated managed deployment (pilihan implementasi awal):** satu pelanggan/operasional Sport Center = satu deployment aplikasi, satu proyek Supabase/database, satu ruang storage, satu domain, kredensial WA/merchant yang dikelola per pelanggan, dan serial/perangkat akses yang dikonfigurasi untuk lokasi itu. Mekanisme booking, invoice, QRIS, approval, PIN/VIS, suspend, dan jurnal yang sudah PASS tetap dipakai. Tidak ada data pelanggan B yang berada dalam database pelanggan A.

**Mode B — shared multi-operator SaaS:** **NO_GO** sampai seluruh tabel dan API memiliki `operator_id`/scope yang diverifikasi, termasuk booking/payment, membership, reporting, device, storage, privileged SQL, admin, webhook, approval, worker, dan jurnal. Kolom `tenant_id` pada `tenant_bookings` **bukan** model operator; `company_id` pada pembayaran **bukan** identitas operator.

## Peralatan QA yang sudah dibuat
- `scripts/certification/issue850-operator-device-fixture.sql`: fixture dua operator dan dua perangkat sintetis.
- `scripts/certification/run-issue850-isolated.sh`: container PostgreSQL sementara dengan **network none**, uji RLS negatif, FK lintas operator, ACK perangkat, replay dan pemulihan melalui pg_dump/pg_restore; tidak memakai Supabase nyata.
- `scripts/certification/managed-install-preflight.mjs`: validasi awal deployment baru; melarang penggunaan proyek dan serial CST, protokol tidak aman, secret tidak tersedia, konfigurasi DB/Storage tidak cocok. Tidak mencetak nilai secret.
- `scripts/certification/issue850-source-preflight.mjs`: sumber kebenaran blocker untuk shared SaaS; keluaran NO_GO bila operator scope belum terikat ke data dan backend.

## Tahap yang wajib dilalui untuk setiap pelanggan baru
1. **Isolasi infrastruktur**: buat proyek DB, storage, domain, layanan dan secret pelanggan sendiri. Gunakan sandbox pembayaran dan WA di DEV. Jalankan managed-install-preflight menggunakan nilai nyata yang tersimpan di secret store (jangan commit atau tampilkan nilai secret).
2. **Database dan storage**: migrasikan schema dari release yang sudah PASS, tanpa DROP/TRUNCATE data. Verifikasi GRANT/RLS, tabel transaksi utama, bucket payment proofs, dan larangan akses dengan token anonim/klien lain. Customer A dan B wajib tidak dapat bertukar data, termasuk via signed link, webhook, dashboard, export, dan service API.
3. **Perangkat dan PIN**: konfigurasi serial/IP/ingress yang unik; jalankan simulasi dua perangkat dengan snapshot, ACTIVATE_USER, ACK Grup 1, penolakan cross-device, suspend Grup 2, retry bounded, deduplikasi dan audit. Barulah uji di alat pelanggan dalam sesi uji yang disetujui; perangkat CST PROD tidak dipakai.
4. **E2E transaksi**: booking admin dan mandiri, pembayaran QRIS/sandbox, persetujuan admin, penerbitan invoice, akses Gym fleksibel vs slot lapangan eksklusif, suspend, laporan, dan replay. Tidak membuat jurnal duplikat.
5. **Pemulihan nyata**: backup **non-PROD atau snapshot sanitasi** untuk database dan storage, restore ke lingkungan terisolasi, verifikasi FK/count/hash, bukti bayar, grant, status dan invoice; ukur RPO/RTO; buktikan worker, WA dan payment sender tidak otomatis aktif setelah restore.
6. **Operasional**: persetujuan owner/super admin, akses minim, audit log, alert, rollback dan tanggung jawab support. Deploy satu pelanggan hanya setelah semua kriteria PASS.

## Pagar keputusan
**QA fixture PASS** bukan **site deployment PASS**. **CI PASS** bukan **Hostinger production deployed**. **Health 200** bukan **payment/device E2E PASS**. Jangan mengaktifkan worker produksi atau memigrasikan ulang fitur yang sudah PASS hanya untuk menutup checklist.

Satu pelanggan dapat dinyatakan **GO sebagai instalasi terkelola** setelah seluruh hasil nyata untuk pelanggan/lokasi itu lolos. Tidak ada klaim instalasi masal siap pakai sampai setidaknya satu instalasi lain telah melewati E2E lengkap, isolasi dan restore. Status shared multi-operator SaaS tetap NO_GO.
