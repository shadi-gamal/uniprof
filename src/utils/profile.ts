import * as fs from 'node:fs';

/**
 * Set the exporter field on a Speedscope profile JSON file.
 * Gracefully no-ops if the file cannot be parsed or written.
 */
export async function setProfileExporter(profilePath: string, exporter: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(profilePath, 'utf8');
    const data = JSON.parse(raw);
    data.exporter = exporter;
    await fs.promises.writeFile(profilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    // Use dynamic import to avoid import cycles in ESM resolution order
    try {
      const { printWarning } = await import('./output-formatter.js');
      printWarning(`Could not set exporter on profile ${profilePath}: ${String(error)}`);
    } catch {
      // Swallow warnings if formatter is unavailable in this context
    }
  }
}
