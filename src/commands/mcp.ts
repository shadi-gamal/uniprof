import chalk from 'chalk';
import { installToClient } from '../mcp/install.js';
import { startMcpServer } from '../mcp/server.js';
import { printError, printInfo, printSection } from '../utils/output-formatter.js';

export async function mcpCommand(subcommand?: string, client?: string): Promise<void> {
  if (!subcommand) {
    showMcpHelp();
    return;
  }

  if (subcommand === 'run') {
    await startMcpServer();
  } else if (subcommand === 'install') {
    if (!client) {
      printError('Client name is required for install command');
      printInfo('Supported clients: amp, claudecode, codex, cursor, gemini, vscode, zed');
      process.exit(1);
    }

    const supportedClients = ['amp', 'claudecode', 'codex', 'cursor', 'gemini', 'vscode', 'zed'];
    if (!supportedClients.includes(client)) {
      printError(`Unsupported client: ${client}`);
      printInfo(`Supported clients: ${supportedClients.join(', ')}`);
      process.exit(1);
    }

    await installToClient(client);
  } else {
    printError(`Unknown subcommand: ${subcommand}`);
    showMcpHelp();
    process.exit(1);
  }
}

function showMcpHelp(): void {
  console.log(chalk.bold('uniprof mcp - Model Context Protocol (MCP) server for uniprof'));
  console.log();

  printSection('Subcommands');
  console.log(`  ${chalk.cyan('run')}         Start the MCP server`);
  console.log(`  ${chalk.cyan('install')}     Install the MCP server into a supported client`);
  console.log();

  printSection('Usage');
  console.log(`  ${chalk.cyan('uniprof mcp run')}`);
  console.log('    Start the MCP server for use with MCP-compatible clients');
  console.log();
  console.log(`  ${chalk.cyan('uniprof mcp install <client>')}`);
  console.log('    Install the MCP server into a specific client');
  console.log('    Supported clients: amp, claudecode, codex, cursor, gemini, vscode, zed');
  console.log();

  printSection('Examples');
  console.log(`  ${chalk.gray('# Start the MCP server')}`);
  console.log(`  ${chalk.cyan('uniprof mcp run')}`);
  console.log();
  console.log(`  ${chalk.gray('# Install into Claude Code')}`);
  console.log(`  ${chalk.cyan('uniprof mcp install claudecode')}`);
  console.log();
  console.log(`  ${chalk.gray('# Install into VS Code')}`);
  console.log(`  ${chalk.cyan('uniprof mcp install vscode')}`);
  console.log();

  printSection('More Information');
  console.log('For detailed documentation on the MCP server and its tools, see:');
  console.log(chalk.cyan('  https://github.com/indragiek/uniprof/blob/main/docs/mcp.md'));
}
