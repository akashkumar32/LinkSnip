const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = CHARSET.length;

/**
 * Encodes an integer ID to Base62 string
 * @param {number} num 
 * @returns {string}
 */
function encodeBase62(num) {
  if (num === 0) return CHARSET[0];
  let res = '';
  while (num > 0) {
    res = CHARSET[num % BASE] + res;
    num = Math.floor(num / BASE);
  }
  return res;
}

/**
 * Decodes a Base62 string back to an integer ID
 * @param {string} str 
 * @returns {number}
 */
function decodeBase62(str) {
  let num = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = CHARSET.indexOf(char);
    if (index === -1) return null;
    num = num * BASE + index;
  }
  return num;
}

/**
 * Generates a random Base62 short code of specified length
 * @param {number} length 
 * @returns {string}
 */
function generateRandomCode(length = 6) {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * BASE);
    result += CHARSET[randomIndex];
  }
  return result;
}

/**
 * Validates custom alias format (3-30 alphanumeric + hyphens/underscores)
 * @param {string} alias 
 * @returns {boolean}
 */
function isValidAlias(alias) {
  if (!alias || typeof alias !== 'string') return false;
  const aliasRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return aliasRegex.test(alias);
}

module.exports = {
  encodeBase62,
  decodeBase62,
  generateRandomCode,
  isValidAlias
};
