/** Runs the fixture site standalone: `pnpm fixtures`, then `pnpm spike <printed url>`. */
import { startFixtureServer } from '@tracelens/fixtures';

const server = await startFixtureServer(Number(process.env.PORT ?? 4789));
console.log(`Fixture site: ${server.url}/basic  (Ctrl+C to stop)`);
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
