#!/usr/bin/env node
/**
 * Studio Pull — one-shot download of a Drive session folder to an external disk.
 *
 * Usage:
 *   node studio-pull/pull.mjs --list
 *   node studio-pull/pull.mjs --folder-id=ID --dest=/Volumes/T7/MyFolder
 *   node studio-pull/pull.mjs --folder-id=ID --dest=/Volumes/T7/MyFolder --fail-fast
 */
import { createDriveClient } from './lib/auth.mjs';
import { assertSafeDest } from './lib/safety.mjs';
import { listSessionFolders, walkDriveFolder } from './lib/driveWalk.mjs';
import { downloadFiles, formatBytes } from './lib/download.mjs';

function parseArgs(argv) {
  const out = { list: false, failFast: false, folderId: null, dest: null, limit: 30 };
  for (const arg of argv) {
    if (arg === '--list') out.list = true;
    else if (arg === '--fail-fast') out.failFast = true;
    else if (arg.startsWith('--folder-id=')) out.folderId = arg.slice('--folder-id='.length);
    else if (arg.startsWith('--dest=')) out.dest = arg.slice('--dest='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length)) || 30;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Studio Pull — download a Drive upload session to an external disk.

Usage:
  npm run studio-pull -- --list
  npm run studio-pull -- --folder-id=DRIVE_FOLDER_ID --dest=/Volumes/DiskName/Folder

Options:
  --list              List recent session folders under GOOGLE_DRIVE_FOLDER_ID
  --folder-id=ID      Session folder to download (required for pull)
  --dest=PATH         Destination on external volume (required for pull)
  --fail-fast         Stop on first file error (default: continue)
  --limit=N           Sessions to show with --list (default 30)
  -h, --help          Show this help

Notes:
  - Manual start only. No background agent.
  - Refuses destinations on the system disk (must be under /Volumes/<External>/...).
  - Re-run the same command to resume: files with matching size are skipped.
`);
}

async function cmdList(drive, mainFolderId, limit) {
  const folders = await listSessionFolders(drive, mainFolderId, limit);
  if (!folders.length) {
    console.log('No session folders found.');
    return;
  }
  console.log(`Recent sessions (up to ${limit}):\n`);
  for (const f of folders) {
    const when = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : '—';
    console.log(`${f.id}`);
    console.log(`  ${f.name}`);
    console.log(`  modified: ${when}\n`);
  }
  console.log('Pull example:');
  console.log(
    `  npm run studio-pull -- --folder-id=${folders[0].id} --dest=/Volumes/YourDisk/SessionName`
  );
}

async function cmdPull(drive, folderId, destInput, failFast) {
  const { dest } = assertSafeDest(destInput);
  console.log(`Destination: ${dest}`);
  console.log(`Source folder: ${folderId}`);
  console.log('Listing files in session tree (one-shot)…');

  const files = await walkDriveFolder(drive, folderId);
  if (!files.length) {
    console.log('No downloadable files in this folder.');
    return;
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  console.log(`Found ${files.length} file(s), ${formatBytes(totalBytes)} total.\n`);

  const stats = await downloadFiles(drive, files, dest, { failFast });

  console.log('\n── Summary ──');
  console.log(`  Downloaded: ${stats.downloaded} (${formatBytes(stats.bytesDownloaded)})`);
  console.log(`  Skipped:    ${stats.skipped}`);
  console.log(`  Failed:     ${stats.failed}`);
  console.log(`  Destination: ${dest}`);

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.list && !args.folderId && !args.dest)) {
    printHelp();
    if (!args.help && !args.list) process.exitCode = args.folderId || args.dest ? 1 : 0;
    if (!args.list && (args.folderId || args.dest)) {
      console.error('\nError: both --folder-id and --dest are required for a pull.');
      process.exitCode = 1;
    }
    return;
  }

  const { drive, mainFolderId } = createDriveClient();

  if (args.list) {
    await cmdList(drive, mainFolderId, args.limit);
    return;
  }

  if (!args.folderId || !args.dest) {
    console.error('Error: both --folder-id and --dest are required.');
    printHelp();
    process.exitCode = 1;
    return;
  }

  await cmdPull(drive, args.folderId, args.dest, args.failFast);
}

main().catch((err) => {
  console.error('\n' + (err.message || err));
  process.exit(1);
});
