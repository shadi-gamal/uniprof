import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { type TableUserConfig, table } from 'table';

export function printHeader(text: string): void {
  console.log();
  console.log(chalk.bold.cyan('═'.repeat(60)));
  console.log(chalk.bold.cyan(`  ${text}`));
  console.log(chalk.bold.cyan('═'.repeat(60)));
  console.log();
}

export function printSection(title: string): void {
  console.log();
  console.log(chalk.bold.white(`▶ ${title}`));
  console.log(chalk.gray('─'.repeat(50)));
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✓'), chalk.white(message));
}

export function printError(message: string): void {
  console.error(chalk.red('✗'), chalk.red(message));
}

export function printWarning(message: string): void {
  console.error(chalk.yellow('⚠'), chalk.yellow(message));
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ'), chalk.white(message));
}

export function printStep(message: string): void {
  // Only color the arrow; allow caller to color message segments.
  console.log(chalk.blue('→'), message);
}

export function printList(items: string[]): void {
  for (const item of items) {
    console.log(chalk.gray('  •'), chalk.white(item));
  }
}

export function printCommand(command: string): void {
  console.log(chalk.gray('  $'), chalk.cyan(command));
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  });
}

// Basic ANSI escape sequence remover
export function stripAnsi(input: string): string {
  // State-machine based ANSI/VT escape stripper to avoid control chars in regex.
  // Handles CSI (ESC '[' ... final @-~), OSC (ESC ']' ... BEL or ESC '\\'),
  // and simple single-char escapes (ESC followed by @-Z, \\, ^, _).
  const ESC = 27;
  const BEL = 7;
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code !== ESC) {
      out += input[i];
      continue;
    }
    // We encountered ESC; inspect the next character
    const next = input[i + 1];
    if (next === '[') {
      // CSI: skip until final byte in range @-~
      i += 2; // skip ESC and '['
      while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch >= 0x40 && ch <= 0x7e) break; // final byte
        i++;
      }
      // Loop increment will move past final byte
      continue;
    }
    if (next === ']') {
      // OSC: ESC ] ... (BEL | ESC \\)
      i += 2;
      while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === BEL) break;
        if (ch === ESC && input[i + 1] === '\\') {
          i++; // eat the '\\'
          break;
        }
        i++;
      }
      continue;
    }
    // Other 2-byte escape sequences: consume ESC and next
    i += 1;
  }
  return out;
}

// Approximate string width by counting visible characters (ANSI-aware)
export function stringWidth(input: string): number {
  return stripAnsi(input).length;
}

// Pad string to visual width with spaces (ANSI-aware)
export function padToWidth(input: string, width: number): string {
  const visible = stringWidth(input);
  if (visible >= width) return input;
  return input + ' '.repeat(width - visible);
}

export function formatTable(headers: string[], rows: any[][]): string {
  const config: TableUserConfig = {
    border: {
      topBody: chalk.gray('─'),
      topJoin: chalk.gray('┬'),
      topLeft: chalk.gray('┌'),
      topRight: chalk.gray('┐'),
      bottomBody: chalk.gray('─'),
      bottomJoin: chalk.gray('┴'),
      bottomLeft: chalk.gray('└'),
      bottomRight: chalk.gray('┘'),
      bodyLeft: chalk.gray('│'),
      bodyRight: chalk.gray('│'),
      bodyJoin: chalk.gray('│'),
      joinBody: chalk.gray('─'),
      joinLeft: chalk.gray('├'),
      joinRight: chalk.gray('┤'),
      joinJoin: chalk.gray('┼'),
    },
  };

  // Format headers with bold white text
  const formattedHeaders = headers.map((h) => chalk.bold.white(h));

  return table([formattedHeaders, ...rows], config);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
}
