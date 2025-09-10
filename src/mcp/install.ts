import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { printError, printInfo, printSection, printSuccess } from '../utils/output-formatter.js';
import { spawnSync } from '../utils/spawn.js';

// Standard uniprof MCP server configuration
const UNIPROF_MCP_CONFIG = {
  command: 'npx',
  args: ['-y', 'uniprof', 'mcp', 'run'],
};

function commandExists(cmd: string): boolean {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync([whichCmd, cmd], { stdout: 'pipe', stderr: 'pipe' });
    return res.exitCode === 0 && !!res.stdout && res.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

export async function installToClient(client: string): Promise<void> {
  console.log();
  printSection(`Installing uniprof MCP server to ${client}`);

  // Placeholder implementations for each client
  switch (client) {
    case 'amp':
      await installToAmp();
      break;
    case 'claudecode':
      await installToClaudeCode();
      break;
    case 'codex':
      await installToCodex();
      break;
    case 'cursor':
      await installToCursor();
      break;
    case 'gemini':
      await installToGemini();
      break;
    case 'vscode':
      await installToVSCode();
      break;
    case 'zed':
      await installToZed();
      break;
    default:
      printError(`Unknown client: ${client}`);
      process.exit(1);
  }
}

async function installToAmp(): Promise<void> {
  // Determine configuration file path based on OS
  let configPath: string;
  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      printError('Could not find APPDATA environment variable');
      process.exit(1);
    }
    configPath = path.join(appData, 'amp', 'settings.json');
  } else {
    // macOS and Linux use the same path
    const homeDir = os.homedir();
    configPath = path.join(homeDir, '.config', 'amp', 'settings.json');
  }

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        printError(`Invalid JSON in configuration file: ${configPath}`);
        printInfo('Please check your Amp settings file for syntax errors');
        process.exit(1);
      }
      throw error;
    }
  }

  try {
    // Ensure amp.mcpServers exists
    if (!config['amp.mcpServers']) {
      config['amp.mcpServers'] = {};
    }

    // Add or replace the uniprof configuration
    config['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

    // Write the updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    printSuccess('Successfully installed uniprof MCP server to Amp');
    console.log();
    console.log('The following configuration has been added to your Amp settings:');
    console.log();
    console.log(chalk.gray('  "amp.mcpServers": {'));
    console.log(chalk.gray('    "uniprof": {'));
    console.log(chalk.gray(`      "command": "${UNIPROF_MCP_CONFIG.command}",`));
    console.log(chalk.gray(`      "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
    console.log();
    printInfo('Restart Amp to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

async function installToClaudeCode(): Promise<void> {
  try {
    // Preflight: verify the Claude Code CLI is available
    if (!commandExists('claude')) {
      printError('Claude Code CLI is not installed or not in PATH');
      printInfo('Please install Claude Code and ensure the "claude" command is available');
      console.log();
      console.log('To install Claude Code, visit: https://claude.ai/code');
      process.exit(1);
    }
    // Construct the command using UNIPROF_MCP_CONFIG
    const args = [
      'mcp',
      'add',
      'uniprof',
      '--scope',
      'user',
      '--',
      UNIPROF_MCP_CONFIG.command,
      ...UNIPROF_MCP_CONFIG.args,
    ];

    // Run the claude CLI command
    const result = spawnSync(['claude', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode === 0) {
      console.log();
      printSuccess('Successfully installed uniprof MCP server to Claude Code');
      console.log();
      console.log('The uniprof MCP server has been added to your Claude Code configuration.');
      console.log();
      printInfo('The MCP server will be available the next time you start Claude Code');
    } else {
      // Handle non-zero exit code
      const stderr = result.stderr?.toString() || '';
      const stdout = result.stdout?.toString() || '';

      if (stderr.includes('command not found') || stderr.includes('not found')) {
        printError('Claude Code CLI is not installed or not in PATH');
        printInfo('Please install Claude Code and ensure the "claude" command is available');
        console.log();
        console.log('To install Claude Code, visit: https://claude.ai/code');
      } else if (stderr || stdout) {
        printError('Failed to add uniprof MCP server to Claude Code');
        if (stderr) {
          console.log(chalk.red('Error output:'));
          console.log(stderr.trim());
        }
        if (stdout && !stderr) {
          console.log(chalk.yellow('Output:'));
          console.log(stdout.trim());
        }
      } else {
        printError(`Failed to add MCP server to Claude Code (exit code: ${result.exitCode})`);
      }

      console.log();
      printInfo('You can try manual installation instead:');
      console.log();
      showManualInstructions('Claude Code');
      process.exit(1);
    }
  } catch (error) {
    // Handle spawn errors (e.g., command not found)
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('ENOENT')) {
        printError('Claude Code CLI is not installed or not in PATH');
        printInfo('Please install Claude Code and ensure the "claude" command is available');
        console.log();
        console.log('To install Claude Code, visit: https://claude.ai/code');
      } else {
        printError(`Failed to run Claude Code CLI: ${error.message}`);
      }
    } else {
      printError('An unexpected error occurred while running the Claude Code CLI');
    }

    console.log();
    printInfo('You can try manual installation instead:');
    console.log();
    showManualInstructions('Claude Code');
    process.exit(1);
  }
}

async function installToCodex(): Promise<void> {
  // Check platform - Windows not supported
  if (process.platform === 'win32') {
    printError('Codex is not supported on Windows');
    process.exit(1);
  }

  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.codex', 'config.toml');

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let configContent = '';

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      configContent = fs.readFileSync(configPath, 'utf8');
    } catch (error) {
      printError(`Failed to read configuration file: ${configPath}`);
      if (error instanceof Error) {
        console.log(chalk.red(error.message));
      }
      process.exit(1);
    }
  }

  try {
    // Create the TOML section for uniprof
    const uniprofSection = [
      '[mcp_servers.uniprof]',
      `command = "${UNIPROF_MCP_CONFIG.command}"`,
      `args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`,
    ].join('\n');

    // Check if [mcp_servers.uniprof] section exists
    const sectionRegex = /\[mcp_servers\.uniprof\]/;
    const sectionMatch = configContent.match(sectionRegex);

    if (sectionMatch) {
      // Section exists, replace it
      const startIndex = sectionMatch.index!;

      // Find the end of this section (next section or end of file)
      const afterSection = configContent.substring(startIndex + sectionMatch[0].length);
      const nextSectionMatch = afterSection.match(/\n\[/);

      let endIndex: number;
      if (nextSectionMatch) {
        // There's another section after this one
        endIndex = startIndex + sectionMatch[0].length + nextSectionMatch.index! + 1; // +1 for the newline
      } else {
        // This is the last section
        endIndex = configContent.length;
      }

      // Extract content before and after the section
      const beforeSection = configContent.substring(0, startIndex);
      const afterSectionContent = configContent.substring(endIndex);

      // Rebuild the config with the new section
      configContent =
        beforeSection + uniprofSection + (afterSectionContent ? `\n${afterSectionContent}` : '');
    } else {
      // Section doesn't exist, append it
      if (configContent && !configContent.endsWith('\n')) {
        configContent += '\n';
      }
      if (configContent) {
        configContent += '\n'; // Add extra line before new section
      }
      configContent += uniprofSection;
    }

    // Write the updated configuration
    fs.writeFileSync(configPath, configContent);

    console.log();
    printSuccess('Successfully installed uniprof MCP server to Codex');
    console.log();
    console.log('The following configuration has been added to your Codex config:');
    console.log();
    console.log(chalk.gray('[mcp_servers.uniprof]'));
    console.log(chalk.gray(`command = "${UNIPROF_MCP_CONFIG.command}"`));
    console.log(chalk.gray(`args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`));
    console.log();
    printInfo('Restart Codex to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

async function installToCursor(): Promise<void> {
  // Determine configuration file path based on OS
  let configPath: string;
  const platform = process.platform;

  if (platform === 'win32') {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) {
      printError('Could not find USERPROFILE environment variable');
      process.exit(1);
    }
    configPath = path.join(userProfile, '.cursor', 'mcp.json');
  } else {
    // macOS and Linux use the same path
    const homeDir = os.homedir();
    configPath = path.join(homeDir, '.cursor', 'mcp.json');
  }

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        printError(`Invalid JSON in configuration file: ${configPath}`);
        printInfo('Please check your Cursor MCP configuration file for syntax errors');
        process.exit(1);
      }
      throw error;
    }
  }

  try {
    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add or replace the uniprof configuration
    // Note: Cursor requires a "type" field in addition to command and args
    config.mcpServers.uniprof = {
      command: UNIPROF_MCP_CONFIG.command,
      args: UNIPROF_MCP_CONFIG.args,
      type: 'stdio',
    };

    // Write the updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    printSuccess('Successfully installed uniprof MCP server to Cursor');
    console.log();
    console.log('The following configuration has been added to your Cursor MCP settings:');
    console.log();
    console.log(chalk.gray('  "mcpServers": {'));
    console.log(chalk.gray('    "uniprof": {'));
    console.log(chalk.gray(`      "command": "${UNIPROF_MCP_CONFIG.command}",`));
    console.log(chalk.gray(`      "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)},`));
    console.log(chalk.gray('      "type": "stdio"'));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
    console.log();
    printInfo('Restart Cursor to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

async function installToGemini(): Promise<void> {
  // Determine configuration file path based on OS
  let configPath: string;
  const platform = process.platform;

  if (platform === 'win32') {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) {
      printError('Could not find USERPROFILE environment variable');
      process.exit(1);
    }
    configPath = path.join(userProfile, '.gemini', 'settings.json');
  } else {
    // macOS and Linux use the same path
    const homeDir = os.homedir();
    configPath = path.join(homeDir, '.gemini', 'settings.json');
  }

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        printError(`Invalid JSON in configuration file: ${configPath}`);
        printInfo('Please check your Gemini settings file for syntax errors');
        process.exit(1);
      }
      throw error;
    }
  }

  try {
    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add or replace the uniprof configuration
    config.mcpServers.uniprof = {
      command: UNIPROF_MCP_CONFIG.command,
      args: UNIPROF_MCP_CONFIG.args,
    };

    // Write the updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    printSuccess('Successfully installed uniprof MCP server to Gemini');
    console.log();
    console.log('The following configuration has been added to your Gemini settings:');
    console.log();
    console.log(chalk.gray('  "mcpServers": {'));
    console.log(chalk.gray('    "uniprof": {'));
    console.log(chalk.gray(`      "command": "${UNIPROF_MCP_CONFIG.command}",`));
    console.log(chalk.gray(`      "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
    console.log();
    printInfo('Restart Gemini to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

async function installToVSCode(): Promise<void> {
  // Determine configuration file path based on OS
  let configPath: string;
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS
    const homeDir = os.homedir();
    configPath = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  } else if (platform === 'win32') {
    // Windows
    const appData = process.env.APPDATA;
    if (!appData) {
      printError('Could not find APPDATA environment variable');
      process.exit(1);
    }
    configPath = path.join(appData, 'Code', 'User', 'mcp.json');
  } else {
    // Linux
    const homeDir = os.homedir();
    configPath = path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
  }

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        printError(`Invalid JSON in configuration file: ${configPath}`);
        printInfo('Please check your VS Code MCP configuration file for syntax errors');
        process.exit(1);
      }
      throw error;
    }
  }

  try {
    // Ensure servers exists (VS Code uses "servers" not "mcpServers")
    if (!config.servers) {
      config.servers = {};
    }

    // Add or replace the uniprof configuration
    config.servers.uniprof = {
      command: UNIPROF_MCP_CONFIG.command,
      args: UNIPROF_MCP_CONFIG.args,
    };

    // Write the updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    printSuccess('Successfully installed uniprof MCP server to VS Code');
    console.log();
    console.log('The following configuration has been added to your VS Code MCP settings:');
    console.log();
    console.log(chalk.gray('  "servers": {'));
    console.log(chalk.gray('    "uniprof": {'));
    console.log(chalk.gray(`      "command": "${UNIPROF_MCP_CONFIG.command}",`));
    console.log(chalk.gray(`      "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
    console.log();
    printInfo('Restart VS Code to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

async function installToZed(): Promise<void> {
  // Check platform - Windows not supported
  if (process.platform === 'win32') {
    printError('Zed is not supported on Windows');
    process.exit(1);
  }

  // Determine configuration file path
  const homeDir = os.homedir();
  let configPath: string;

  // Check for XDG_CONFIG_HOME on Linux
  if (process.platform === 'linux' && process.env.XDG_CONFIG_HOME) {
    configPath = path.join(process.env.XDG_CONFIG_HOME, 'zed', 'settings.json');
  } else {
    // Default path for macOS and Linux
    configPath = path.join(homeDir, '.config', 'zed', 'settings.json');
  }

  // Ensure the directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  // Read existing configuration if it exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (error instanceof SyntaxError) {
        printError(`Invalid JSON in configuration file: ${configPath}`);
        printInfo('Please check your Zed settings file for syntax errors');
        process.exit(1);
      }
      throw error;
    }
  }

  try {
    // Ensure context_servers exists (Zed uses "context_servers")
    if (!config.context_servers) {
      config.context_servers = {};
    }

    // Add or replace the uniprof configuration
    // Zed requires a "source" field set to "custom"
    config.context_servers.uniprof = {
      source: 'custom',
      command: UNIPROF_MCP_CONFIG.command,
      args: UNIPROF_MCP_CONFIG.args,
      env: {},
    };

    // Write the updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log();
    printSuccess('Successfully installed uniprof MCP server to Zed');
    console.log();
    console.log('The following configuration has been added to your Zed settings:');
    console.log();
    console.log(chalk.gray('  "context_servers": {'));
    console.log(chalk.gray('    "uniprof": {'));
    console.log(chalk.gray('      "source": "custom",'));
    console.log(chalk.gray(`      "command": "${UNIPROF_MCP_CONFIG.command}",`));
    console.log(chalk.gray(`      "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)},`));
    console.log(chalk.gray('      "env": {}'));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
    console.log();
    printInfo('Restart Zed to load the uniprof MCP server');
  } catch (error) {
    if (error instanceof Error) {
      printError(`Failed to update configuration: ${error.message}`);
    } else {
      printError('An unexpected error occurred while updating the configuration');
    }
    process.exit(1);
  }
}

function showManualInstructions(_client: string): void {
  printSection('Manual Installation');
  console.log('To manually configure the uniprof MCP server:');
  console.log();
  console.log('1. Ensure uniprof is installed globally:');
  console.log(chalk.cyan('   npm install -g uniprof'));
  console.log();
  console.log('2. Add the following MCP server configuration to your client:');
  console.log(chalk.gray('   {'));
  console.log(chalk.gray('     "name": "uniprof",'));
  console.log(chalk.gray(`     "command": "${UNIPROF_MCP_CONFIG.command}",`));
  console.log(chalk.gray(`     "args": ${JSON.stringify(UNIPROF_MCP_CONFIG.args)},`));
  console.log(chalk.gray('     "transport": "stdio"'));
  console.log(chalk.gray('   }'));
  console.log();
  console.log('3. Restart your MCP client to load the server');
  console.log();
  printInfo(
    'For detailed instructions, see: https://github.com/indragiek/uniprof/blob/main/docs/mcp.md'
  );
}
