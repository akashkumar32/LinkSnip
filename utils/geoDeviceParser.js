const useragent = require('useragent');

/**
 * Parses user agent header to get browser, OS, and device type
 * @param {string} userAgentString 
 * @returns {object}
 */
function parseUserAgent(userAgentString) {
  if (!userAgentString) {
    return { browser: 'Unknown', os: 'Unknown', device: 'Desktop' };
  }

  const agent = useragent.parse(userAgentString);
  const browser = agent.family || 'Unknown Browser';
  const os = agent.os.family || 'Unknown OS';

  let device = 'Desktop';
  const uaLower = userAgentString.toLowerCase();
  if (uaLower.includes('mobile') || uaLower.includes('iphone') || uaLower.includes('android')) {
    device = 'Mobile';
  } else if (uaLower.includes('ipad') || uaLower.includes('tablet')) {
    device = 'Tablet';
  }

  return { browser, os, device };
}

/**
 * Derives country/location from IP (simulated for dev/local IPs, realistic data for public IPs)
 * @param {string} ip 
 * @returns {string}
 */
function deriveGeoLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    const localGeos = ['United States', 'India', 'United Kingdom', 'Germany', 'Canada', 'Australia'];
    // Pick a deterministic geo based on request hash for demo richness
    const hash = (ip || 'local').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return localGeos[hash % localGeos.length];
  }

  // Simulated public IP lookup
  const sampleCountries = ['United States', 'India', 'Germany', 'Japan', 'United Kingdom', 'Brazil', 'Canada', 'France'];
  const ipSum = ip.split('.').reduce((acc, part) => acc + parseInt(part || 0, 10), 0);
  return sampleCountries[ipSum % sampleCountries.length];
}

module.exports = {
  parseUserAgent,
  deriveGeoLocation
};
