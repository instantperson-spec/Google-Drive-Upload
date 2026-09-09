#!/usr/bin/env node
/**
 * Parse DriveBuddy PDF report → JSON inventory (relative paths + sizes).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_PATH =
  process.argv[2] ||
  '/Users/jaceksowa/.cursor/projects/Volumes-ENV-Google-Drive/attachments/373c9e6e-a105-47de-972f-bcc95e6c0c83/T7_Drive_02__2TB__Contents.pdf';
const OUT_PATH = path.join(__dirname, 'data', 'woodweb-expected.json');

function parseSize(raw) {
  const s = String(raw).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*(tb|gb|mb|kb|bytes?|b)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'b';
  // DriveBuddy reports use decimal (SI) units, not binary.
  const mult = {
    tb: 1000 ** 4,
    gb: 1000 ** 3,
    mb: 1000 ** 2,
    kb: 1000,
    byte: 1,
    bytes: 1,
    b: 1,
  }[unit.replace(/s$/, '')] ?? 1;
  return Math.round(n * mult);
}

function formatBytes(n) {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Resolve folder marker into stack state. */
function applyFolder(name, ctx) {
  const MASTER = 'Woodweb (Master)';

  if (name === MASTER) {
    ctx.stack = [MASTER];
    ctx.currentDay = null;
    ctx.inProject = false;
    ctx.cameraFolder = null;
    return;
  }

  if (/^Day [123]$/.test(name)) {
    ctx.stack = [MASTER, name];
    ctx.currentDay = name;
    ctx.inProject = false;
    ctx.cameraFolder = null;
    return;
  }

  if (['Stills', 'LUT', 'Exports', 'Graphics'].includes(name)) {
    ctx.stack = [MASTER, name];
    ctx.inProject = false;
    ctx.cameraFolder = null;
    return;
  }

  if (name === 'Project') {
    ctx.stack = [MASTER, 'Project'];
    ctx.inProject = true;
    ctx.cameraFolder = null;
    return;
  }

  if (ctx.inProject) {
    if (name === 'Adobe Premiere Pro Video Previews') {
      ctx.stack = [MASTER, 'Project', 'Adobe Premiere Pro Video Previews'];
      ctx.inPrv = false;
      return;
    }
    if (name === 'Woodweb.PRV') {
      ctx.stack = [MASTER, 'Project', 'Adobe Premiere Pro Video Previews', 'Woodweb.PRV'];
      ctx.inPrv = true;
      return;
    }
    if (name === 'Adobe Premiere Pro Auto-Save') {
      ctx.stack = [MASTER, 'Project', 'Adobe Premiere Pro Auto-Save'];
      ctx.inPrv = false;
      return;
    }
    if (name === 'RecoveryProjects') {
      ctx.stack = [MASTER, 'Project', 'Adobe Premiere Pro Auto-Save', 'RecoveryProjects'];
      return;
    }
    ctx.stack = [MASTER, 'Project', name];
    ctx.inPrv = false;
    return;
  }

  if (name === 'Footage' && ctx.currentDay) {
    ctx.stack = [MASTER, ctx.currentDay, 'Footage'];
    ctx.cameraFolder = null;
    return;
  }

  if (name === '060826') {
    ctx.stack = [MASTER, 'Day 2', '060826'];
    return;
  }

  if (name === 'Sound') {
    ctx.stack = [MASTER, 'Day 1', 'Sound'];
    return;
  }

  if (name === '050826') {
    ctx.stack = [MASTER, 'Day 1', 'Sound', '050826'];
    return;
  }

  if (name === 'DJI') {
    ctx.stack = [MASTER, 'Day 1', 'Footage', 'DJI'];
    ctx.cameraFolder = null;
    return;
  }

  if (/^A00[56]_21DC5[34]$/.test(name)) {
    ctx.stack = [MASTER, 'Day 1', 'Footage', 'DJI', name];
    ctx.cameraFolder = name;
    ctx.inXmp = false;
    return;
  }

  if (name === 'XMP Data' && ctx.cameraFolder) {
    ctx.stack = [MASTER, 'Day 1', 'Footage', 'DJI', ctx.cameraFolder, 'XMP Data'];
    ctx.inXmp = true;
    return;
  }

  if (name === 'Mavic4Pro') {
    ctx.stack = [MASTER, 'Day 3', 'Mavic4Pro'];
    return;
  }

  if (name === 'A7SIII') {
    ctx.stack = [MASTER, 'Day 3', 'A7SIII'];
    return;
  }

  // Fallback: append under current stack parent
  if (ctx.stack.length) {
    ctx.stack = [...ctx.stack.slice(0, -1), name];
  }
}

function parseInventoryText(text) {
  const entries = [];
  const rootFiles = [];
  const ctx = {
    stack: [],
    currentDay: null,
    inProject: false,
    cameraFolder: null,
    inXmp: false,
    inPrv: false,
  };
  let seenMaster = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\t+/g, '\t').trim();
    if (!line || line.startsWith('Generated ') || line.includes('Drive Contents Report')) continue;
    if (line.startsWith('D R I V E') || line === 'Cover' || line.startsWith('--')) continue;
    if (line.startsWith('Summary') || line.startsWith('F O L D E R S')) continue;
    if (line.startsWith('T7 Drive') || line.startsWith('Contents') || line.startsWith('PAT H')) continue;
    if (/^\d+\.\d+ TB used/.test(line)) continue;

    if (/^Woodweb \(Master\)\s+[\d.]+\s*(TB|GB|MB)/i.test(line)) {
      seenMaster = true;
      applyFolder('Woodweb (Master)', ctx);
      continue;
    }

    if (line.startsWith('‣')) {
      const folderMatch = line.match(/^‣\s+(.+?)\s+([\d.]+\s*(?:TB|GB|MB|KB|bytes?))\s*$/i);
      if (folderMatch && seenMaster) {
        applyFolder(folderMatch[1].trim(), ctx);
      }
      continue;
    }

    const fileMatch = line.match(/^·\s+(.+?)\s+([\d.]+\s*(?:TB|GB|MB|KB|bytes?))\s*$/i);
    if (fileMatch) {
      const fileName = fileMatch[1].trim();
      const size = parseSize(fileMatch[2]);
      if (!size) continue;

      if (!seenMaster) {
        rootFiles.push({ relativePath: fileName, size, sizeLabel: fileMatch[2].trim() });
        continue;
      }

      // XMP block sits mid-roll in PDF; non-.xmp files belong in camera folder, not XMP Data.
      let stack = ctx.stack;
      if (ctx.inXmp && !/\.xmp$/i.test(fileName) && ctx.cameraFolder) {
        stack = ['Woodweb (Master)', 'Day 1', 'Footage', 'DJI', ctx.cameraFolder];
        ctx.inXmp = false;
      }

      const relativePath = stack.length ? `${stack.join('/')}/${fileName}` : fileName;
      entries.push({ relativePath, size, sizeLabel: fileMatch[2].trim(), basename: fileName });
    }
  }

  return { entries, rootFiles };
}

async function main() {
  const buf = fs.readFileSync(PDF_PATH);
  const parser = new PDFParse({ data: buf });
  const data = await parser.getText();
  await parser.destroy();
  const { entries, rootFiles } = parseInventoryText(data.text);

  const totalExpected = entries.reduce((s, e) => s + e.size, 0) + rootFiles.reduce((s, e) => s + e.size, 0);
  const out = {
    source: path.basename(PDF_PATH),
    generatedAt: new Date().toISOString(),
    stats: {
      filesInMaster: entries.length,
      rootFiles: rootFiles.length,
      totalFiles: entries.length + rootFiles.length,
      totalBytes: totalExpected,
      totalLabel: formatBytes(totalExpected),
    },
    rootFiles,
    entries,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Parsed ${out.stats.totalFiles} files (${out.stats.totalLabel})`);
  console.log(`  In Woodweb (Master): ${out.stats.filesInMaster}`);
  console.log(`  At disk root: ${out.stats.rootFiles}`);
  console.log(`Written: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
