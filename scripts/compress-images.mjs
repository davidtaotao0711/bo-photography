import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const originalsDir = path.join(rootDir, "import", "originals");
const compressedDir = path.join(rootDir, "import", "compressed");

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const oneMegabyte = 1024 * 1024;
const targetLongEdge = 2400;
const qualitySteps = [85, 80, 75, 70, 68];

await fs.mkdir(originalsDir, { recursive: true });
await fs.mkdir(compressedDir, { recursive: true });

const entries = await fs.readdir(originalsDir, { withFileTypes: true });
const imageFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => supportedExtensions.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

if (imageFiles.length === 0) {
  console.log("No images found in import/originals.");
  console.log("Put JPG, PNG, or WebP files there, then run npm run compress:images again.");
  process.exit(0);
}

let copied = 0;
let compressed = 0;

for (const fileName of imageFiles) {
  const inputPath = path.join(originalsDir, fileName);
  const parsed = path.parse(fileName);
  const outputName = `${parsed.name}.jpg`;
  const outputPath = path.join(compressedDir, outputName);
  const stat = await fs.stat(inputPath);

  if (stat.size <= oneMegabyte && [".jpg", ".jpeg"].includes(parsed.ext.toLowerCase())) {
    await fs.copyFile(inputPath, outputPath);
    copied += 1;
    console.log(`Copied ${fileName} -> ${outputName} (${formatBytes(stat.size)})`);
    continue;
  }

  let bestBuffer = null;
  let bestQuality = qualitySteps[qualitySteps.length - 1];

  for (const quality of qualitySteps) {
    const buffer = await sharp(inputPath)
      .rotate()
      .resize({
        width: targetLongEdge,
        height: targetLongEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toColorspace("srgb")
      .jpeg({
        quality,
        mozjpeg: true,
      })
      .toBuffer();

    bestBuffer = buffer;
    bestQuality = quality;

    if (buffer.byteLength <= oneMegabyte) {
      break;
    }
  }

  await fs.writeFile(outputPath, bestBuffer);
  compressed += 1;

  const note = bestBuffer.byteLength > oneMegabyte ? "still above 1MB, kept best reasonable quality" : "ok";
  console.log(
    `Compressed ${fileName} -> ${outputName} (${formatBytes(stat.size)} -> ${formatBytes(
      bestBuffer.byteLength,
    )}, q${bestQuality}, ${note})`,
  );
}

console.log("");
console.log(`Done. ${copied} copied, ${compressed} compressed.`);
console.log(`Output folder: ${path.relative(rootDir, compressedDir).replaceAll("\\", "/")}`);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < oneMegabyte) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / oneMegabyte).toFixed(2)} MB`;
}
