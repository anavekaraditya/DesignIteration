const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const htmlPath = resolve(__dirname, "../dist/index.html");
const html = readFileSync(htmlPath, "utf8")
  .replace(/<script type="module" crossorigin>/g, "<script>")
  .replace(/<script type="module">/g, "<script>");

writeFileSync(htmlPath, html);
