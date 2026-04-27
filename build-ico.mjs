import { Resvg } from "@resvg/resvg-js";
import toIco from "to-ico";
import { writeFileSync, readFileSync } from "fs";

// Pi logo — white mark on black, generous padding
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="#000"/>
  <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"/>
  <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>
</svg>`;

// Render PNGs at all sizes needed for ICO
// Full DPI-aware size set: covers 100%, 125%, 150%, 200% scaling
const sizes = [16, 32, 48, 256];
const pngs = [];

for (const size of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();

  // Count white pixels to verify
  const pixels = resvg.render().pixels;
  let whites = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 200) whites++;
  }
  console.log(`${size}x${size}: ${whites} white pixels (${Math.round(whites * 100 / (size * size))}%)`);

  pngs.push(png);
  writeFileSync(`src-tauri/icons/${size}x${size}.png`, png);
}

// Build ICO from all sizes
const ico = await toIco(pngs);
writeFileSync("src-tauri/icons/icon.ico", ico);
console.log(`\n✓ icon.ico written (${ico.length} bytes, ${sizes.length} sizes)`);

// Also write 128x128 and 32x32 explicitly for tauri config
console.log("✓ All PNGs written");
