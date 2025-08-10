const winston = require('winston');

// Configuration du logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      const emoji = {
        error: '❌',
        warn: '⚠️',
        info: 'ℹ️',
        debug: '🔍'
      }[level] || '📝';
      
      let logMessage = `${timestamp} ${emoji} [${level.toUpperCase()}] ${message}`;
      
      if (stack) {
        logMessage += `\n${stack}`;
      }
      
      return logMessage;
    })
  ),
  transports: [
    // Console avec couleurs en développement
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          const emoji = {
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️',
            debug: '🔍'
          }[level.replace(/\u001b\[.*?m/g, '')] || '📝';
          
          return `${timestamp} ${emoji} ${level}: ${message}`;
        })
      )
    }),
    
    // Fichier pour les erreurs
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Fichier pour tous les logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Créer le dossier logs s'il n'existe pas
const fs = require('fs');
const path = require('path');
const logsDir = path.join(__dirname, '..', '..', 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = logger;
