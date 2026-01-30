const rateLimit = require("express-rate-limit");

// Check if we're in development mode
const isDev = process.env.NODE_ENV !== 'production';

// Skip rate limiting entirely in development
const skipInDev = (req) => isDev;

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 1000 : 5, // Unlimited in dev
  message: {
    error: "Too many login attempts from this IP, please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

// Rate limiter for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 1000 : 3, // Unlimited in dev
  message: {
    error: "Too many registration attempts from this IP, please try again after 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 10000 : 100, // Unlimited in dev
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  apiLimiter,
};
