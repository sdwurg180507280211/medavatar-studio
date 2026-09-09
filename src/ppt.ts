import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readdir, rename, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

export const convertPptToPng = async (pptPath: string, outputDir: string) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'medavatar-ppt-'));
  try {
    await rm(outputDir, {recursive: true, force: true});
    await mkdir(outputDir, {recursive: true});
    const soffice = process.env.LIBREOFFICE_BIN ?? 'soffice';
    const pdftoppm = process.env.PDFTOPPM_BIN ?? 'pdftoppm';
    await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', temp, pptPath]);
    const pdf = path.join(temp, `${path.basename(pptPath, path.extname(pptPath))}.pdf`);
    const prefix = path.join(outputDir, 'slide');
    await run(pdftoppm, ['-png', '-r', '144', pdf, prefix]);
    const files = (await readdir(outputDir)).filter((name) => /^slide-\d+\.png$/i.test(name));
    files.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    const normalized: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const target = `${String(i + 1).padStart(3, '0')}.png`;
      await rename(path.join(outputDir, files[i]), path.join(outputDir, target));
      normalized.push(path.join(outputDir, target));
    }
    return normalized;
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
};
