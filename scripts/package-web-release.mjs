/* global Buffer, process */
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const distDirectory = join(root, 'dist');
const releaseDirectory = join(root, 'release');
const artifactDirectory = join(releaseDirectory, 'artifacts');
const stagingDirectory = join(releaseDirectory, '.staging', 'web');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(await readFile(join(releaseDirectory, 'web-release.json'), 'utf8'));
const artifactName = `${config.artifactBaseName}-v${packageJson.version}`;
const archivePath = join(artifactDirectory, `${artifactName}.zip`);
const manifestPath = join(artifactDirectory, `${artifactName}.manifest.json`);
const checksumPath = `${archivePath}.sha256`;
const sourceDateEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? '0', 10);

if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
  throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer');
}

await requirePath(distDirectory, 'Run the Vite build before packaging.');
for (const requiredPath of config.requiredPaths) {
  await requirePath(join(distDirectory, requiredPath), `Vite output is missing ${requiredPath}.`);
}

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(dirname(stagingDirectory), { recursive: true });
await cp(distDirectory, stagingDirectory, { recursive: true });
await mkdir(artifactDirectory, { recursive: true });

const stagedFiles = await listFiles(stagingDirectory);
const manifest = {
  schemaVersion: 1,
  name: packageJson.name,
  version: packageJson.version,
  artifact: `${artifactName}.zip`,
  artifactType: 'static-web-archive',
  entryPoint: config.entryPoint,
  runtime: config.runtime,
  sourceDateEpoch,
  files: await Promise.all(stagedFiles.map(async (file) => ({
    path: archivePathFor(file, stagingDirectory),
    bytes: (await stat(file)).size,
    sha256: sha256(await readFile(file)),
  }))),
};

const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(join(stagingDirectory, 'release-manifest.json'), manifestJson);
await writeFile(manifestPath, manifestJson);

const archiveFiles = await listFiles(stagingDirectory);
const archive = await createZip(archiveFiles, stagingDirectory, sourceDateEpoch);
await writeFile(archivePath, archive);
await writeFile(checksumPath, `${sha256(archive)}  ${artifactName}.zip\n`);
await rm(stagingDirectory, { recursive: true, force: true });

process.stdout.write(`Created ${relative(root, archivePath)} (${archive.length} bytes)\n`);
process.stdout.write(`Manifest ${relative(root, manifestPath)}\n`);
process.stdout.write(`Checksum ${relative(root, checksumPath)}\n`);

async function requirePath(path, message) {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function archivePathFor(file, baseDirectory) {
  return relative(baseDirectory, file).split(sep).join('/');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function createZip(files, baseDirectory, epochSeconds) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  const { date, time } = dosDateTime(epochSeconds);

  for (const file of files) {
    const name = Buffer.from(archivePathFor(file, baseDirectory), 'utf8');
    const content = await readFile(file);
    const compressed = deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localRecords.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function dosDateTime(epochSeconds) {
  const date = new Date(Math.max(epochSeconds, 315532800) * 1000);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function crc32(content) {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
