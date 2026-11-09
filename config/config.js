/**
 * Sequelize CLI database config (reads edtech-lms-rpi-api/.env if present).
 * Uses RPI_DB_* variables to match src/config.ts fallbacks.
 */
require('dotenv').config();

const base = {
  username: process.env.RPI_DB_USER || 'root',
  password: process.env.RPI_DB_PASSWORD || '',
  database: process.env.RPI_DB_NAME || 'edtech_lms_rpi',
  host: process.env.RPI_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.RPI_DB_PORT || '3306', 10),
  dialect: 'mysql',
  // Database statements are printed only when DB_LOG_SQL=1 (development).
  logging: process.env.DB_LOG_SQL === '1' ? console.log : false,
};

module.exports = {
  development: { ...base },
  test: { ...base },
  production: { ...base },
};
