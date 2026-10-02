# Pemulihan kata sandi Sport Center

Halaman `/admin/login` menyediakan tombol **Lupa kata sandi?**. Pengguna memasukkan email akun yang sudah terdaftar di `sport_center.users`, lalu memilih tautan email atau kode WhatsApp. Halaman login pelanggan menggunakan dialog yang sama dan tetap memilih WhatsApp secara default.

## Konfigurasi pengiriman

Kredensial SMTP dimuat dari bundle GCP Secret Manager yang sama dengan konfigurasi aplikasi. Loader menerima format flat maupun bagian `prod`/`dev`. Gunakan:

- `SMTP_FROM`: alamat email pengirim.
- `SMTP_PASS` atau `SMTP_PASSWORD`: kata sandi SMTP; untuk Gmail gunakan App Password.
- `SMTP_USER`: opsional, menggunakan `SMTP_FROM` jika tidak diisi.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`: opsional untuk penyedia SMTP lain. Port 465 menggunakan TLS langsung; port 587 menggunakan STARTTLS. Tanpa host, transport mengikuti konfigurasi Gmail yang sudah dipakai aplikasi.

Gunakan `*_DEV` untuk mengganti nilai flat pada lingkungan pengujian. Tidak perlu menyalin kredensial SMTP ke Hostinger. Pastikan `SESSION_SECRET` tetap stabil antarrestart dan semua instance, serta URL aplikasi kanonis dari `getBaseUrl()` menggunakan HTTPS pada produksi.

Email tujuan harus benar-benar dapat diakses oleh pemilik akun. Alamat contoh seperti `admin@sportcenter.com` pada seed tidak otomatis menjadi kotak email yang dapat menerima pesan. Reset hanya mengubah kata sandi akun yang sudah ada.

Pengiriman WhatsApp menggunakan konfigurasi customer Fonnte dan kebijakan pengiriman aplikasi yang sudah ada. Kode hanya dikirim ke nomor yang tersimpan pada akun, bukan nomor yang dimasukkan saat reset.

## Perilaku API dan keamanan

- `POST /api/auth/forgot-password`: `{ email, channel: "email" | "whatsapp", source?: "admin" }`. Jika `channel` tidak diisi, gunakan WhatsApp agar pemanggil lama tetap kompatibel.
- `POST /api/auth/reset-password`: `{ token, newPassword }` untuk tautan email, atau `{ email, otp, newPassword }` untuk kode WhatsApp.
- Tautan email berlaku 15 menit, ditandatangani dengan kunci khusus pemulihan, dan terikat pada ID, email, serta hash kata sandi saat permintaan dibuat. Token berada pada fragment URL dan dihapus dari riwayat browser setelah dibaca.
- Pembaruan hash menggunakan kondisi atomik pada hash lama. Dua permintaan bersamaan hanya dapat menghasilkan satu perubahan; semua tautan sebelumnya ditolak setelah kata sandi berubah. Tidak diperlukan migrasi database.
- Kata sandi baru minimal 8 karakter dan maksimal 72 byte UTF-8. Kata sandi disimpan dengan bcrypt yang sudah digunakan login aplikasi, tanpa mengubah role pengguna.
- Kode WhatsApp berlaku 5 menit, disimpan sebagai HMAC, dibatasi 5 percobaan salah, dan hanya tersedia pada proses yang menerima permintaan. Setelah restart atau perpindahan instance, pengguna perlu meminta kode baru. Tautan email tetap bekerja setelah restart dengan `SESSION_SECRET` yang sama.
- Permintaan reset dibatasi 3 per email dan 30 per IP per 15 menit pada tiap proses. Konfirmasi juga memiliki pembatasan IP; pembatasan lintas instance memerlukan layanan bersama.
- Respons email menggunakan pesan umum untuk akun dikenal, tidak dikenal, dan tidak aktif. Kegagalan transport email dicatat tanpa token atau kredensial. Respons diterima bukan bukti email sudah tiba di kotak masuk.
- Halaman tautan reset menghapus sesi browser lokal setelah berhasil dan meminta login kembali. Sesi yang sudah aktif pada perangkat lain mengikuti masa berlaku autentikasi aplikasi yang sudah ada.

## Validasi dan penerapan

Typecheck workspace, build produksi, dan 33 tes autentikasi/pemulihan lulus. Dua tes integrasi WhatsApp lama pada suite penuh memerlukan database DEV yang belum tersedia di lingkungan lokal.

Validasi tambahan menjalankan route autentikasi dan pemulihan yang sebenarnya pada PostgreSQL terisolasi melalui PGlite: dua reset bersamaan menghasilkan satu keberhasilan dan satu penolakan, password lama ditolak saat login, password baru diterima, tautan yang sudah dipakai ditolak, dan role admin tetap sama.

Uji browser Chromium pada build produksi memverifikasi dialog admin, konfirmasi kata sandi, penghapusan token dari URL, perubahan kata sandi sampai login berhasil, penolakan tautan yang digunakan ulang, pesan untuk tautan kosong, tampilan HP 390×844, dan pilihan WhatsApp bawaan pada login pelanggan. Tidak ditemukan error JavaScript halaman.

Sebelum penerapan produksi, merge perubahan, redeploy aplikasi, dan verifikasi satu pengiriman email ke akun uji dengan mailbox yang dapat diakses. Pengujian lokal menggunakan transport email simulasi; pengiriman SMTP produksi perlu diverifikasi dengan konfigurasi yang sesungguhnya.
