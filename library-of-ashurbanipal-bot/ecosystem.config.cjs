module.exports = {
  apps: [{
    name: 'wiki-generator',
    script: 'src/wikiGenerator.js',
    args: '--watch',
    cwd: '/home/user/Bot/library-of-ashurbanipal-bot',
    env: {
      NODE_ENV: 'production'
    },
    // Restart if memory exceeds 500MB
    max_memory_restart: '500M',
    // Log settings
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true,
    // Auto-restart
    autorestart: true,
    watch: false, // We handle our own file watching
    max_restarts: 10,
    restart_delay: 5000
  }]
};
