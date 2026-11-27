// Configuration PM2 : pm2 start ecosystem.config.cjs
// Un seul processus (les tâches planifiées tournent dans le serveur). Réglages lus dans .env.
module.exports = {
  apps: [{
    name: 'tuktuk',
    script: './backend/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    time: true,
    env: { NODE_ENV: 'production' },
  }],
}
