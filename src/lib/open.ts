import { spawn } from 'node:child_process';

export interface Opener {
  command: string;
  args: string[];
}

export function opener(path: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Opener | null {
  if (env['WIKIPEDIA_TRENDS_OPEN'] === '0' || env['CI'] || env['VITEST']) {
    return null;
  }

  if (platform === 'darwin') {
    return { command: 'open', args: [path] };
  }

  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', path] };
  }

  if (env['DISPLAY'] || env['WAYLAND_DISPLAY']) {
    return { command: 'xdg-open', args: [path] };
  }

  return null;
}

export function openFile(path: string): boolean {
  const target = opener(path, process.platform, process.env);

  if (!target) {
    return false;
  }

  try {
    const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();

    return true;
  } catch {
    return false;
  }
}
