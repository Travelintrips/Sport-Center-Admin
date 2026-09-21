"use strict";

console.log("[hostinger] root launcher starting");

import("./dist/index.js").catch((error) => {
  console.error("[hostinger] root launcher failed", error);
  process.exit(1);
});
