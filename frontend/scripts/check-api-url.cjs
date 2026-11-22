const { isIP } = require('node:net');
const value = process.env.REACT_APP_API_URL?.trim();
try {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password
      || !url.hostname.includes('.') || isIP(url.hostname) || url.hostname.endsWith('.localhost')
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error();
  }
} catch {
  console.error('Set REACT_APP_API_URL to the public HTTPS origin of the Render API.');
  process.exitCode = 1;
}
