// Type declarations for scripts/plugin-smoke-lib.mjs (CI-05, D-23a-17), so the
// strict TypeScript tests (tests/plugin-smoke-helpers.test.ts) can import it.

export declare const EXPECTED_SKILLS: readonly string[];
export declare const EXPECTED_HOOK_EVENTS: readonly string[];
export declare const EXPECTED_TOOLS: readonly string[];
export declare const PLUGIN_SERVER: string;

export declare function pathKey(env: Record<string, string | undefined>, platform?: NodeJS.Platform): string;
export declare function executableNames(name: string, platform?: NodeJS.Platform, pathext?: string): string[];
export declare function pathWithoutNode(pathValue: string | undefined, platform?: NodeJS.Platform, exists?: (file: string) => boolean): string;
export declare function findOnPath(
  name: string,
  pathValue: string | undefined,
  platform?: NodeJS.Platform,
  exists?: (file: string) => boolean,
  pathext?: string,
): string | null;
export declare function cmdShimTarget(shimPath: string, shimText: string): string | null;

export interface InventoryEntry {
  count: number;
  names: string[];
}
export interface PluginInventory {
  skills?: InventoryEntry;
  agents?: InventoryEntry;
  hooks?: InventoryEntry;
  mcpServers?: InventoryEntry;
  lspServers?: InventoryEntry;
  commands?: InventoryEntry;
}
export declare function parsePluginDetails(text: string): PluginInventory;

export interface McpListRow {
  name: string;
  command: string;
  statusText: string;
  connected: boolean;
}
export declare function parseMcpList(text: string): McpListRow[];

export declare function pluginListProblems(json: unknown, id?: string): string[];
export declare function installPathOf(json: unknown, id?: string): string | null;
export declare function expandPluginRoot(value: string, root: string): string;

export interface ClaudeLaunch {
  command: string;
  prefix: string[];
  path: string;
}
export declare function resolveClaude(env?: Record<string, string | undefined>, platform?: NodeJS.Platform): ClaudeLaunch;
export declare function runClaude(
  claude: ClaudeLaunch,
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs?: number; input?: string },
): { status: number | null; stdout: string; stderr: string; error: Error | null };
export declare function mcpHandshake(opts: {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  timeoutMs?: number;
}): Promise<{ serverInfo: { name?: string; version?: string } | null; tools: string[]; stderr: string }>;
