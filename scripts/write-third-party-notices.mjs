/* global process */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(import.meta.dirname, '..');
const noticeName = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function requireWithin(root, path) {
  const name = relative(root, path);
  if (isAbsolute(name) || name === '..' || name.startsWith(`..${sep}`)) {
    throw new Error('Production dependency or output path escapes the checkout.');
  }
}

/** Read actual version-matched production package notices in deterministic order. */
export async function buildThirdPartyNotices(root = repository) {
  const resolvedRoot = await realpath(root);
  const lock = JSON.parse(await readFile(join(resolvedRoot, 'package-lock.json'), 'utf8'));
  if (!lock.packages || !lock.packages['']) throw new Error('A packages-based npm lock is required.');
  for (const name of Object.keys(lock.packages[''].dependencies ?? {})) {
    if (!lock.packages[`node_modules/${name}`]) throw new Error(`Missing locked production dependency: ${name}`);
  }
  const packages = [];
  for (const [name, entry] of Object.entries(lock.packages).sort(([left], [right]) => compare(left, right))) {
    if (!name.startsWith('node_modules/') || entry.dev === true || entry.link === true) continue;
    const source = resolve(resolvedRoot, name);
    requireWithin(resolvedRoot, source);
    let directory;
    try {
      directory = await realpath(source);
    } catch (error) {
      if (entry.optional === true && error.code === 'ENOENT') continue;
      throw error;
    }
    requireWithin(join(resolvedRoot, 'node_modules'), directory);
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (metadata.version !== entry.version) throw new Error(`Installed production version differs from lock: ${name}`);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const item of entries.sort((left, right) => compare(left.name, right.name))) {
      if (!item.isFile() || !noticeName.test(item.name)) continue;
      const path = await realpath(join(directory, item.name));
      requireWithin(directory, path);
      files.push({ name: item.name, content: await readFile(path, 'utf8') });
    }
    packages.push({ name: metadata.name, version: metadata.version, path: name,
      license: metadata.license ?? 'Not declared in package metadata', files });
  }
  if (packages.length === 0) throw new Error('No installed production dependency packages found.');
  const lines = [
    'THIRD-PARTY NOTICES', '',
    'These notices preserve actual installed production dependency license/notice text.',
    'Installed versions are checked against package-lock.json. No license for Tanner\'s',
    'application source is inferred or newly granted by this file.', '',
  ];
  for (const item of packages) {
    lines.push('='.repeat(72), `Package: ${item.name}`, `Version: ${item.version}`,
      `Package-lock path: ${item.path}`, `Declared license: ${typeof item.license === 'string' ? item.license : JSON.stringify(item.license)}`, '');
    if (item.files.length === 0) lines.push('No top-level license or notice file is present in this installed package.', '');
    for (const file of item.files) {
      lines.push(`--- ${file.name} ---`, file.content.endsWith('\n') ? file.content.slice(0, -1) : file.content, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function writeThirdPartyNotices(root = repository) {
  const directory = resolve(root, 'dist');
  requireWithin(await realpath(root), directory);
  if (!(await stat(directory)).isDirectory()) throw new Error('Run the Vite build before writing notices.');
  requireWithin(await realpath(root), await realpath(directory));
  const target = join(directory, 'THIRD_PARTY_NOTICES.txt');
  const temporary = join(directory, `.third-party-${randomUUID()}.tmp`);
  const content = await buildThirdPartyNotices(root);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = await writeThirdPartyNotices();
  process.stdout.write(`Wrote ${relative(repository, target)} from locked installed production dependencies.\n`);
}
