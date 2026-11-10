// Runs the built services (npm run build first) without Docker.
import concurrently from 'concurrently';

const services = ['db', 'gateway', 'identity', 'jobs', 'talent', 'assessment', 'interview', 'offer', 'onboarding', 'ai', 'notification'];

const { result } = concurrently(
  services.map((name) => ({ name, command: `node services/${name}/dist/index.js` })),
  { prefix: 'name', restartTries: 5, restartDelay: 3000 },
);

result.catch(() => process.exit(1));
