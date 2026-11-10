import dotenv from 'dotenv';

// APP_ENV picks the env file: development | staging | production.
// Hosts that inject real env vars win, since dotenv never overrides existing ones.
const appEnv = process.env.APP_ENV || 'development';
dotenv.config({ path: `.env.${appEnv}` });
