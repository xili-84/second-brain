// Runs the Android Gradle wrapper on Windows, macOS and Linux: node scripts/gradlew.mjs <tasks...>
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const androidDir = resolve(import.meta.dirname, '..', 'android');
const isWindows = process.platform === 'win32';
const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
const result = spawnSync(wrapper, process.argv.slice(2), {
  cwd: androidDir,
  shell: isWindows,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
