// Runs every service (and the web app) in watch mode with one command.
// Usage: npm run dev            (services + web)
//        npm run dev:services   (services only)
import concurrently from 'concurrently';

const services = ['db', 'gateway', 'identity', 'jobs', 'talent', 'assessment', 'interview', 'offer', 'onboarding', 'ai', 'notification'];
const withWeb = !process.argv.includes('--no-web');

const commands = services.map((name) => ({
  name,
  command: `npm run dev -w services/${name}`,
}));
if (withWeb) commands.push({ name: 'web', command: 'npm run dev -w apps/web' });

const { result } = concurrently(commands, {
  prefix: 'name',
  killOthers: ['failure'],
  prefixColors: ['cyan', 'green', 'yellow', 'blue', 'magenta', 'red', 'white', 'gray', 'greenBright', 'blueBright', 'yellowBright'],
});

result.catch(() => process.exit(1));
