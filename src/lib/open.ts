import { spawn } from 'node:child_process';

// Command and arguments that open a file in the system viewer.
interface Opener {
  command: string;
  args: string[];
}

/** Platform command that opens the file, or null when auto-open is disabled or no viewer is available. */
export function opener(path: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Opener | null {
  // Never pop up a viewer when disabled explicitly, in CI or under tests.
  if (env['WIKIPEDIA_TRENDS_OPEN'] === '0' || env['CI'] || env['VITEST']) {
    return null;
  }

  if (platform === 'darwin') {
    return { command: 'open', args: [path] };
  }

  if (platform === 'win32') {
    // The empty argument is the window title; without it `start` would take a quoted path as the title.
    return { command: 'cmd', args: ['/c', 'start', '', path] };
  }

  // xdg-open needs a graphical session; headless Linux gets no viewer.
  if (env['DISPLAY'] || env['WAYLAND_DISPLAY']) {
    return { command: 'xdg-open', args: [path] };
  }

  return null;
}

/** Opens the file in the system viewer without waiting; returns whether a viewer was launched. */
export function openFile(path: string): boolean {
  const target = opener(path, process.platform, process.env);

  if (!target) {
    return false;
  }

  try {
    // Detached and unref'd so the CLI can exit while the viewer stays open; a failed launch is ignored.
    const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();

    return true;
  } catch {
    return false;
  }
}
