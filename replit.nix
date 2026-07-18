{pkgs}: {
  deps = [
    pkgs.glib
    pkgs.alsa-lib
    pkgs.cairo
    pkgs.pango
    pkgs.libxkbcommon
    pkgs.mesa
    pkgs.xorg.libXfixes
    pkgs.xorg.libXrandr
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.expat
    pkgs.libdrm
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.nspr
    pkgs.nss
  ];
}
