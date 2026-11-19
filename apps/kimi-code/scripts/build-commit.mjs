import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const gitDir = fileURLToPath(new URL('../../../.git', import.meta.url));

export async function resolveBuildCommit() {
  const suppliedCommit = process.env['KIMI_CODE_COMMIT'];
  if (suppliedCommit) return suppliedCommit;

  try {
    const { stdout } = await execFileAsync('git', ['--git-dir', gitDir, 'rev-parse', '--verify', 'HEAD']);
    return stdout.trim();
  } catch {
    return '';
  }
}
