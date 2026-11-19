import { startSkillDeckServer } from './index.js';

const port = Number(process.env.SKILLDECK_PORT ?? 4173);
const defaultMode = process.env.SKILLDECK_MODE === 'local' ? 'local' : 'demo';

startSkillDeckServer({ port, defaultMode })
  .then(({ url }) => {
    console.log(`[SkillDeck] API & Control Tower server listening at ${url} (defaultMode=${defaultMode})`);
  })
  .catch((err) => {
    console.error('[SkillDeck] Failed to start server:', err);
    process.exit(1);
  });
