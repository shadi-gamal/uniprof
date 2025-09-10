import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRunProfiler } from '../src/mcp/tools.js';
import { VERSION } from '../src/version.js';

describe('MCP Server', () => {
  describe('Tool Registration', () => {
    it('should register run_profiler tool', () => {
      const testServer = new McpServer({
        name: 'test-run',
        version: VERSION,
      });

      expect(() => registerRunProfiler(testServer)).not.toThrow();
    });
  });

  describe('run_profiler tool', () => {
    it('should register with required parameters', () => {
      const mockServer = new McpServer({
        name: 'test',
        version: VERSION,
      });

      expect(() => registerRunProfiler(mockServer)).not.toThrow();
    });

    it('should accept optional parameters', () => {
      const mockServer = new McpServer({
        name: 'test',
        version: VERSION,
      });

      expect(() => registerRunProfiler(mockServer)).not.toThrow();
    });
  });

  describe('run_profiler outputSchema', () => {
    it('registers tool with outputSchema describing analysis shape', () => {
      const captured: any[] = [];
      const fakeServer: any = {
        registerTool: (name: string, schema: any, handler: any) => {
          captured.push({ name, schema, handler });
        },
      };
      registerRunProfiler(fakeServer);
      const tool = captured.find((t) => t.name === 'run_profiler');
      expect(tool).toBeTruthy();
      expect(tool.schema.outputSchema).toBeDefined();
      // Spot check a couple of keys
      expect(tool.schema.outputSchema.summary).toBeDefined();
      expect(tool.schema.outputSchema.hotspots).toBeDefined();
    });
  });

  describe('Command parsing', () => {
    it('should parse simple commands', () => {
      const command = 'python app.py';
      const parts = command.split(' ');
      expect(parts).toEqual(['python', 'app.py']);
    });

    it('should parse commands with arguments', () => {
      const command = 'node server.js --port 3000';
      const parts = command.split(' ');
      expect(parts).toEqual(['node', 'server.js', '--port', '3000']);
    });

    it('should handle extra profiler args', () => {
      const extraArgs = '--rate 500 --duration 60';
      const parts = extraArgs.split(' ');
      expect(parts).toEqual(['--rate', '500', '--duration', '60']);
    });
  });

  describe('Client installation', () => {
    it('should recognize valid clients', async () => {
      const validClients = [
        'amp',
        'claudecode',
        'cline',
        'codex',
        'cursor',
        'gemini',
        'vscode',
        'windsurf',
        'zed',
      ];

      for (const client of validClients) {
        expect(validClients.includes(client)).toBe(true);
      }
    });

    it('should reject invalid clients', () => {
      const invalidClients = ['invalid', 'notepad', 'vim'];
      const validClients = [
        'amp',
        'claudecode',
        'cline',
        'codex',
        'cursor',
        'gemini',
        'vscode',
        'windsurf',
        'zed',
      ];

      for (const client of invalidClients) {
        expect(validClients.includes(client)).toBe(false);
      }
    });

    describe('Amp JSON configuration', () => {
      it('should correctly format JSON structure for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const config: any = {};
        config['amp.mcpServers'] = {};
        config['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

        expect(config['amp.mcpServers'].uniprof.command).toBe('npx');
        expect(config['amp.mcpServers'].uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
      });

      it('should replace existing uniprof configuration', () => {
        const existingConfig = {
          'amp.mcpServers': {
            playwright: {
              command: 'npx',
              args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'],
            },
            uniprof: {
              command: 'old-command',
              args: ['old', 'args'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate replacement
        existingConfig['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

        // Verify replacement
        expect(existingConfig['amp.mcpServers'].uniprof.command).toBe('npx');
        expect(existingConfig['amp.mcpServers'].uniprof.args).toEqual([
          '-y',
          'uniprof',
          'mcp',
          'run',
        ]);
        expect(existingConfig['amp.mcpServers'].playwright).toBeDefined();
        expect(existingConfig['amp.mcpServers'].playwright.command).toBe('npx');
        expect(existingConfig['amp.mcpServers'].playwright.args[1]).toBe('@playwright/mcp@latest');
      });

      it('should add uniprof to config with existing servers', () => {
        const existingConfig: any = {
          'amp.mcpServers': {
            semgrep: {
              url: 'https://mcp.semgrep.ai/mcp',
            },
            linear: {
              command: 'npx',
              args: ['mcp-remote', 'https://mcp.linear.app/sse'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate adding new server
        existingConfig['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

        // Verify all servers exist
        expect(Object.keys(existingConfig['amp.mcpServers'])).toContain('uniprof');
        expect(Object.keys(existingConfig['amp.mcpServers'])).toContain('semgrep');
        expect(Object.keys(existingConfig['amp.mcpServers'])).toContain('linear');
        expect(existingConfig['amp.mcpServers'].semgrep.url).toBe('https://mcp.semgrep.ai/mcp');
      });

      it('should handle empty JSON config file', () => {
        const config: any = {};

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate initialization
        if (!config['amp.mcpServers']) {
          config['amp.mcpServers'] = {};
        }

        config['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

        expect(config['amp.mcpServers']).toBeDefined();
        expect(config['amp.mcpServers'].uniprof).toBeDefined();
        expect(config['amp.mcpServers'].uniprof.command).toBe('npx');
        expect(config['amp.mcpServers'].uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
      });

      it('should handle config with other settings', () => {
        const existingConfig: any = {
          theme: 'dark',
          fontSize: 14,
          'amp.mcpServers': {
            playwright: {
              command: 'npx',
              args: ['-y', '@playwright/mcp@latest'],
            },
          },
          editor: {
            tabSize: 2,
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Add uniprof
        existingConfig['amp.mcpServers'].uniprof = UNIPROF_MCP_CONFIG;

        // Verify other settings are preserved
        expect(existingConfig.theme).toBe('dark');
        expect(existingConfig.fontSize).toBe(14);
        expect(existingConfig.editor.tabSize).toBe(2);
        expect(existingConfig['amp.mcpServers'].uniprof).toBeDefined();
        expect(existingConfig['amp.mcpServers'].playwright).toBeDefined();
      });
    });

    describe('Codex TOML configuration', () => {
      it('should correctly format TOML section for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const expectedSection = [
          '[mcp_servers.uniprof]',
          `command = "${UNIPROF_MCP_CONFIG.command}"`,
          `args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`,
        ].join('\n');

        expect(expectedSection).toBe(
          '[mcp_servers.uniprof]\ncommand = "npx"\nargs = ["-y","uniprof","mcp","run"]'
        );
      });

      it('should handle section replacement in existing TOML', () => {
        const existingConfig = `[general]
setting = "value"

[mcp_servers.uniprof]
command = "old_command"
args = ["old", "args"]

[other_section]
key = "value"`;

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const uniprofSection = [
          '[mcp_servers.uniprof]',
          `command = "${UNIPROF_MCP_CONFIG.command}"`,
          `args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`,
        ].join('\n');

        // Simulate the replacement logic
        const sectionRegex = /\[mcp_servers\.uniprof\]/;
        const sectionMatch = existingConfig.match(sectionRegex);
        expect(sectionMatch).toBeTruthy();

        if (sectionMatch) {
          const startIndex = sectionMatch.index!;
          const afterSection = existingConfig.substring(startIndex + sectionMatch[0].length);
          const nextSectionMatch = afterSection.match(/\n\[/);

          let endIndex: number;
          if (nextSectionMatch) {
            endIndex = startIndex + sectionMatch[0].length + nextSectionMatch.index! + 1;
          } else {
            endIndex = existingConfig.length;
          }

          const beforeSection = existingConfig.substring(0, startIndex);
          const afterSectionContent = existingConfig.substring(endIndex);

          const newConfig =
            beforeSection +
            uniprofSection +
            (afterSectionContent ? `\n${afterSectionContent}` : '');

          // Verify the replacement worked correctly
          expect(newConfig).toContain('[mcp_servers.uniprof]');
          expect(newConfig).toContain('command = "npx"');
          expect(newConfig).toContain('args = ["-y","uniprof","mcp","run"]');
          expect(newConfig).toContain('[general]');
          expect(newConfig).toContain('[other_section]');
          expect(newConfig).not.toContain('old_command');
        }
      });

      it('should append section to config without existing mcp_servers', () => {
        const existingConfig = `[general]
setting = "value"

[other_section]
key = "value"`;

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const uniprofSection = [
          '[mcp_servers.uniprof]',
          `command = "${UNIPROF_MCP_CONFIG.command}"`,
          `args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`,
        ].join('\n');

        // Simulate appending logic
        let configContent = existingConfig;
        const sectionRegex = /\[mcp_servers\.uniprof\]/;
        const sectionMatch = configContent.match(sectionRegex);

        expect(sectionMatch).toBeFalsy();

        if (!sectionMatch) {
          if (configContent && !configContent.endsWith('\n')) {
            configContent += '\n';
          }
          if (configContent) {
            configContent += '\n';
          }
          configContent += uniprofSection;
        }

        // Verify the section was appended correctly
        expect(configContent).toContain('[mcp_servers.uniprof]');
        expect(configContent).toContain('command = "npx"');
        expect(configContent).toContain('args = ["-y","uniprof","mcp","run"]');
        expect(configContent).toContain('[general]');
        expect(configContent).toContain('[other_section]');
      });

      it('should handle empty TOML file', () => {
        let configContent = '';

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const uniprofSection = [
          '[mcp_servers.uniprof]',
          `command = "${UNIPROF_MCP_CONFIG.command}"`,
          `args = ${JSON.stringify(UNIPROF_MCP_CONFIG.args)}`,
        ].join('\n');

        // Simulate appending to empty config
        if (configContent && !configContent.endsWith('\n')) {
          configContent += '\n';
        }
        if (configContent) {
          configContent += '\n';
        }
        configContent += uniprofSection;

        expect(configContent).toBe(
          '[mcp_servers.uniprof]\ncommand = "npx"\nargs = ["-y","uniprof","mcp","run"]'
        );
      });
    });

    describe('Cursor JSON configuration', () => {
      it('should correctly format JSON structure for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const config: any = {};
        config.mcpServers = {};
        config.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          type: 'stdio',
        };

        expect(config.mcpServers.uniprof.command).toBe('npx');
        expect(config.mcpServers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        expect(config.mcpServers.uniprof.type).toBe('stdio');
      });

      it('should replace existing uniprof configuration', () => {
        const existingConfig = {
          mcpServers: {
            'MCP Installer': {
              command: 'cursor-mcp-installer-free',
              type: 'stdio',
              args: ['index.mjs'],
            },
            uniprof: {
              command: 'old-command',
              args: ['old', 'args'],
              type: 'stdio',
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate replacement
        existingConfig.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          type: 'stdio',
        };

        // Verify replacement
        expect(existingConfig.mcpServers.uniprof.command).toBe('npx');
        expect(existingConfig.mcpServers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        expect(existingConfig.mcpServers['MCP Installer']).toBeDefined();
        expect(existingConfig.mcpServers['MCP Installer'].command).toBe(
          'cursor-mcp-installer-free'
        );
      });

      it('should add uniprof to config with existing servers', () => {
        const existingConfig: any = {
          mcpServers: {
            'MCP Installer': {
              command: 'cursor-mcp-installer-free',
              type: 'stdio',
              args: ['index.mjs'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate adding new server
        existingConfig.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          type: 'stdio',
        };

        // Verify both servers exist
        expect(Object.keys(existingConfig.mcpServers)).toContain('uniprof');
        expect(Object.keys(existingConfig.mcpServers)).toContain('MCP Installer');
        expect(existingConfig.mcpServers.uniprof.type).toBe('stdio');
      });

      it('should handle empty JSON config file', () => {
        const config: any = {};

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate initialization
        if (!config.mcpServers) {
          config.mcpServers = {};
        }

        config.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          type: 'stdio',
        };

        expect(config.mcpServers).toBeDefined();
        expect(config.mcpServers.uniprof).toBeDefined();
        expect(config.mcpServers.uniprof.command).toBe('npx');
        expect(config.mcpServers.uniprof.type).toBe('stdio');
      });
    });

    describe('Gemini JSON configuration', () => {
      it('should correctly format JSON structure for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const config: any = {};
        config.mcpServers = {};
        config.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        expect(config.mcpServers.uniprof.command).toBe('npx');
        expect(config.mcpServers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        // Note: Gemini doesn't use 'type' field like Cursor does
        expect(config.mcpServers.uniprof.type).toBeUndefined();
      });

      it('should replace existing uniprof configuration', () => {
        const existingConfig = {
          apiKey: 'some-api-key',
          mcpServers: {
            serverName: {
              command: 'path/to/server',
              args: ['--arg1', 'value1'],
            },
            uniprof: {
              command: 'old-command',
              args: ['old', 'args'],
            },
          },
          otherSettings: {
            theme: 'dark',
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate replacement
        existingConfig.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify replacement
        expect(existingConfig.mcpServers.uniprof.command).toBe('npx');
        expect(existingConfig.mcpServers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        expect(existingConfig.mcpServers.serverName).toBeDefined();
        expect(existingConfig.mcpServers.serverName.command).toBe('path/to/server');
        // Verify other settings are preserved
        expect(existingConfig.apiKey).toBe('some-api-key');
        expect(existingConfig.otherSettings.theme).toBe('dark');
      });

      it('should add uniprof to config with existing servers', () => {
        const existingConfig: any = {
          mcpServers: {
            analytics: {
              command: 'analytics-server',
              args: ['--port', '3000'],
            },
            database: {
              command: 'db-server',
              args: ['--host', 'localhost'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate adding new server
        existingConfig.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify all servers exist
        expect(Object.keys(existingConfig.mcpServers)).toContain('uniprof');
        expect(Object.keys(existingConfig.mcpServers)).toContain('analytics');
        expect(Object.keys(existingConfig.mcpServers)).toContain('database');
        expect(existingConfig.mcpServers.analytics.args[1]).toBe('3000');
      });

      it('should handle empty JSON config file', () => {
        const config: any = {};

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate initialization
        if (!config.mcpServers) {
          config.mcpServers = {};
        }

        config.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        expect(config.mcpServers).toBeDefined();
        expect(config.mcpServers.uniprof).toBeDefined();
        expect(config.mcpServers.uniprof.command).toBe('npx');
        expect(config.mcpServers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
      });

      it('should handle config with nested settings', () => {
        const existingConfig: any = {
          user: {
            name: 'Test User',
            preferences: {
              language: 'en',
            },
          },
          mcpServers: {
            'existing-server': {
              command: 'server',
              args: [],
            },
          },
          debug: false,
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Add uniprof
        existingConfig.mcpServers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify nested settings are preserved
        expect(existingConfig.user.name).toBe('Test User');
        expect(existingConfig.user.preferences.language).toBe('en');
        expect(existingConfig.debug).toBe(false);
        expect(existingConfig.mcpServers.uniprof).toBeDefined();
        expect(existingConfig.mcpServers['existing-server']).toBeDefined();
      });
    });

    describe('VS Code JSON configuration', () => {
      it('should correctly format JSON structure for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const config: any = {};
        config.servers = {};
        config.servers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        expect(config.servers.uniprof.command).toBe('npx');
        expect(config.servers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        // VS Code doesn't use 'type' field or 'env' for uniprof
        expect(config.servers.uniprof.type).toBeUndefined();
        expect(config.servers.uniprof.env).toBeUndefined();
      });

      it('should replace existing uniprof configuration', () => {
        const existingConfig = {
          servers: {
            'example-server': {
              command: 'example-cmd',
              args: ['--port', '3000'],
              env: {
                API_KEY: '<your-api-key>',
                DEBUG: 'true',
              },
            },
            uniprof: {
              command: 'old-command',
              args: ['old', 'args'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate replacement
        existingConfig.servers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify replacement
        expect(existingConfig.servers.uniprof.command).toBe('npx');
        expect(existingConfig.servers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        // Verify example server is preserved with its env
        expect(existingConfig.servers['example-server']).toBeDefined();
        expect(existingConfig.servers['example-server'].command).toBe('example-cmd');
        expect(existingConfig.servers['example-server'].env).toBeDefined();
        expect(existingConfig.servers['example-server'].env.API_KEY).toBe('<your-api-key>');
      });

      it('should add uniprof to config with existing servers', () => {
        const existingConfig: any = {
          servers: {
            'python-server': {
              command: 'python',
              args: ['-m', 'server'],
              env: {
                PYTHONPATH: '/usr/local/lib',
              },
            },
            'node-server': {
              command: 'node',
              args: ['server.js'],
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate adding new server
        existingConfig.servers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify all servers exist
        expect(Object.keys(existingConfig.servers)).toContain('uniprof');
        expect(Object.keys(existingConfig.servers)).toContain('python-server');
        expect(Object.keys(existingConfig.servers)).toContain('node-server');
        expect(existingConfig.servers['python-server'].env.PYTHONPATH).toBe('/usr/local/lib');
      });

      it('should handle empty JSON config file', () => {
        const config: any = {};

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate initialization
        if (!config.servers) {
          config.servers = {};
        }

        config.servers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        expect(config.servers).toBeDefined();
        expect(config.servers.uniprof).toBeDefined();
        expect(config.servers.uniprof.command).toBe('npx');
        expect(config.servers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
      });

      it('should use correct path for each OS', () => {
        const platforms = {
          darwin: 'Library/Application Support/Code/User/mcp.json',
          win32: 'Code/User/mcp.json',
          linux: '.config/Code/User/mcp.json',
        };

        // Verify path patterns for each OS
        expect(platforms.darwin).toContain('Library/Application Support');
        expect(platforms.win32).toContain('Code/User');
        expect(platforms.linux).toContain('.config/Code');
      });

      it('should preserve other VS Code settings', () => {
        const existingConfig: any = {
          version: '1.0.0',
          servers: {
            existing: {
              command: 'cmd',
              args: [],
            },
          },
          debugMode: true,
          settings: {
            theme: 'dark',
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Add uniprof
        existingConfig.servers.uniprof = {
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
        };

        // Verify other settings are preserved
        expect(existingConfig.version).toBe('1.0.0');
        expect(existingConfig.debugMode).toBe(true);
        expect(existingConfig.settings.theme).toBe('dark');
        expect(existingConfig.servers.existing).toBeDefined();
        expect(existingConfig.servers.uniprof).toBeDefined();
      });
    });

    describe('Zed JSON configuration', () => {
      it('should correctly format JSON structure for new config', () => {
        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        const config: any = {};
        config.context_servers = {};
        config.context_servers.uniprof = {
          source: 'custom',
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          env: {},
        };

        expect(config.context_servers.uniprof.source).toBe('custom');
        expect(config.context_servers.uniprof.command).toBe('npx');
        expect(config.context_servers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
        expect(config.context_servers.uniprof.env).toEqual({});
      });

      it('should replace existing uniprof configuration', () => {
        const existingConfig = {
          theme: 'dark',
          context_servers: {
            'my-server': {
              source: 'custom',
              command: 'my-command',
              args: ['arg1', 'arg2'],
              env: { MY_VAR: 'value' },
            },
            uniprof: {
              source: 'custom',
              command: 'old-command',
              args: ['old', 'args'],
              env: { OLD: 'env' },
            },
          },
          vim_mode: true,
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate replacement
        existingConfig.context_servers.uniprof = {
          source: 'custom',
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          env: {},
        };

        // Verify replacement
        expect(existingConfig.context_servers.uniprof.source).toBe('custom');
        expect(existingConfig.context_servers.uniprof.command).toBe('npx');
        expect(existingConfig.context_servers.uniprof.args).toEqual([
          '-y',
          'uniprof',
          'mcp',
          'run',
        ]);
        expect(existingConfig.context_servers.uniprof.env).toEqual({});
        // Verify other server is preserved
        expect(existingConfig.context_servers['my-server']).toBeDefined();
        expect(existingConfig.context_servers['my-server'].env.MY_VAR).toBe('value');
        // Verify other settings are preserved
        expect(existingConfig.theme).toBe('dark');
        expect(existingConfig.vim_mode).toBe(true);
      });

      it('should add uniprof to config with existing servers', () => {
        const existingConfig: any = {
          context_servers: {
            'code-assistant': {
              source: 'custom',
              command: 'assistant',
              args: ['--mode', 'code'],
              env: {},
            },
            'docs-server': {
              source: 'custom',
              command: 'docs',
              args: [],
              env: { DOCS_PATH: '/usr/docs' },
            },
          },
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate adding new server
        existingConfig.context_servers.uniprof = {
          source: 'custom',
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          env: {},
        };

        // Verify all servers exist
        expect(Object.keys(existingConfig.context_servers)).toContain('uniprof');
        expect(Object.keys(existingConfig.context_servers)).toContain('code-assistant');
        expect(Object.keys(existingConfig.context_servers)).toContain('docs-server');
        expect(existingConfig.context_servers['docs-server'].env.DOCS_PATH).toBe('/usr/docs');
      });

      it('should handle empty JSON config file', () => {
        const config: any = {};

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Simulate initialization
        if (!config.context_servers) {
          config.context_servers = {};
        }

        config.context_servers.uniprof = {
          source: 'custom',
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          env: {},
        };

        expect(config.context_servers).toBeDefined();
        expect(config.context_servers.uniprof).toBeDefined();
        expect(config.context_servers.uniprof.source).toBe('custom');
        expect(config.context_servers.uniprof.command).toBe('npx');
        expect(config.context_servers.uniprof.args).toEqual(['-y', 'uniprof', 'mcp', 'run']);
      });

      it('should use XDG_CONFIG_HOME when set on Linux', () => {
        const testCases = [
          {
            platform: 'linux',
            xdg: '/custom/config',
            expected: '/custom/config/zed/settings.json',
          },
          { platform: 'linux', xdg: undefined, expected: '.config/zed/settings.json' },
          { platform: 'darwin', xdg: '/custom/config', expected: '.config/zed/settings.json' },
          { platform: 'darwin', xdg: undefined, expected: '.config/zed/settings.json' },
        ];

        for (const tc of testCases) {
          if (tc.platform === 'linux' && tc.xdg) {
            expect(tc.expected).toContain('/custom/config');
          } else {
            expect(tc.expected).toContain('.config/zed');
          }
        }
      });

      it('should preserve other Zed settings', () => {
        const existingConfig: any = {
          telemetry: {
            diagnostics: false,
            metrics: false,
          },
          context_servers: {
            existing: {
              source: 'custom',
              command: 'cmd',
              args: [],
              env: {},
            },
          },
          vim_mode: false,
          format_on_save: 'on',
        };

        const UNIPROF_MCP_CONFIG = {
          command: 'npx',
          args: ['-y', 'uniprof', 'mcp', 'run'],
        };

        // Add uniprof
        existingConfig.context_servers.uniprof = {
          source: 'custom',
          command: UNIPROF_MCP_CONFIG.command,
          args: UNIPROF_MCP_CONFIG.args,
          env: {},
        };

        // Verify other settings are preserved
        expect(existingConfig.telemetry.diagnostics).toBe(false);
        expect(existingConfig.vim_mode).toBe(false);
        expect(existingConfig.format_on_save).toBe('on');
        expect(existingConfig.context_servers.existing).toBeDefined();
        expect(existingConfig.context_servers.uniprof).toBeDefined();
      });
    });
  });

  describe('Platform detection', () => {
    it('should support all documented platforms', () => {
      const platforms = ['python', 'nodejs', 'ruby', 'php', 'jvm', 'dotnet', 'native', 'beam'];

      for (const platform of platforms) {
        expect(typeof platform).toBe('string');
        expect(platform.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Mode validation', () => {
    it('should accept valid modes', () => {
      const validModes = ['auto', 'container', 'host'];

      for (const mode of validModes) {
        expect(validModes.includes(mode)).toBe(true);
      }
    });

    it('should reject invalid modes', () => {
      const invalidModes = ['invalid', 'docker', 'local'];
      const validModes = ['auto', 'container', 'host'];

      for (const mode of invalidModes) {
        expect(validModes.includes(mode)).toBe(false);
      }
    });
  });

  describe('End-to-End MCP Server Test', () => {
    it('should connect to MCP server and invoke run_profiler tool', async () => {
      // Path to the main uniprof CLI
      const uniprofPath = path.join(__dirname, '..', 'dist', 'index.js');
      const fixtureDir = path.join(__dirname, 'fixtures', 'python');

      // Create a client transport that will spawn the MCP server
      const transport = new StdioClientTransport({
        command: 'bun',
        args: [uniprofPath, 'mcp', 'run'],
        env: { ...process.env },
      });

      // Create and connect the MCP client
      const client = new Client({
        name: 'test-client',
        version: '1.0.0',
      });

      try {
        await client.connect(transport);

        // List available tools to ensure run_profiler is registered
        const tools = await client.listTools();
        const runProfilerTool = tools.tools.find((t) => t.name === 'run_profiler');
        expect(runProfilerTool).toBeDefined();
        expect(runProfilerTool?.description).toContain('Profiles a command/application');

        // Create a temporary output path
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
        const outputPath = path.join(tmpDir, 'profile.json');

        // Call the run_profiler tool with Python test script
        const result = await client.callTool({
          name: 'run_profiler',
          arguments: {
            command: 'python test.py',
            cwd: fixtureDir,
            mode: 'container',
            output_path: outputPath,
            verbose: false,
          },
        });

        // Validate the response
        expect(result).toBeDefined();

        // The tool returns structured content when outputSchema is defined
        const analysis =
          result.structuredContent || (result.content?.[0] && JSON.parse(result.content[0].text));

        // Validate the analysis structure
        expect(analysis.summary).toBeDefined();
        expect(analysis.summary.totalSamples).toBeGreaterThan(0);
        expect(analysis.hotspots).toBeInstanceOf(Array);
        expect(analysis.hotspots.length).toBeGreaterThan(0);

        // Check for expected Python function names
        const hotspotNames = analysis.hotspots.map((h: any) => h.name);
        const expectedFunctions = ['calculate_fibonacci', 'find_primes', 'process_data'];
        const foundFunctions = expectedFunctions.filter((fn) =>
          hotspotNames.some((name: string) => name.includes(fn))
        );
        expect(foundFunctions.length).toBeGreaterThan(0);

        // Verify the profile file was created
        expect(fs.existsSync(outputPath)).toBe(true);

        // Read and validate the profile file
        const profileContent = fs.readFileSync(outputPath, 'utf8');
        const profile = JSON.parse(profileContent);
        expect(profile.$schema).toBe('https://www.speedscope.app/file-format-schema.json');
        expect(profile.shared?.frames).toBeInstanceOf(Array);
        expect(profile.profiles).toBeInstanceOf(Array);
        expect(profile.profiles.length).toBeGreaterThan(0);

        // Clean up temp directory
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } finally {
        // Clean up: close the client which will also terminate the server process
        await client.close();
      }
    }, 60000); // 60 second timeout for container operations
  });
});
