// validation.js
// Server-side input validation and sanitization. Never trust the client.

const config = require('./config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// At least 8 chars, containing at least one letter and one number.
function isStrongPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200 &&
    /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

// Trim, collapse excess whitespace, hard-cap length, strip control characters.
function sanitizeText(value, maxLen = 255) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeTags(value, maxTags = 10, maxTagLen = 30) {
  return sanitizeText(value, 500)
    .split(',')
    .map((t) => t.trim().slice(0, maxTagLen))
    .filter(Boolean)
    .slice(0, maxTags)
    .join(',');
}

function fileExtension(filename) {
  const parts = String(filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function isAllowedFileType(filename) {
  return config.ALLOWED_EXTENSIONS.includes(fileExtension(filename));
}

function isWithinUploadLimit(byteLength) {
  return byteLength <= config.MAX_UPLOAD_MB * 1024 * 1024;
}

module.exports = {
  isValidEmail,
  isStrongPassword,
  sanitizeText,
  sanitizeTags,
  fileExtension,
  isAllowedFileType,
  isWithinUploadLimit,
};
