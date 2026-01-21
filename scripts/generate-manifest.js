const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function getEnv(rootDir) {
  dotenv.config({ path: path.join(rootDir, '.env') });
  return {
    HOST: process.env.HOST || 'localhost',
    PORT: process.env.PORT || '3000',
    PROTOCOL: process.env.PROTOCOL || 'https'
  };
}

function renderTemplate(template, env) {
  return template
    .replace(/\$\{HOST\}/g, env.HOST)
    .replace(/\$\{PORT\}/g, env.PORT)
    .replace(/\$\{PROTOCOL\}/g, env.PROTOCOL);
}

function generateManifest(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const templatePath = path.join(rootDir, 'manifest.template.xml');
  const outputPath = path.join(rootDir, 'manifest.xml');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing manifest template: ${templatePath}`);
  }

  const env = getEnv(rootDir);
  const template = fs.readFileSync(templatePath, 'utf8');
  const output = renderTemplate(template, env);

  fs.writeFileSync(outputPath, output, 'utf8');
  return outputPath;
}

if (require.main === module) {
  generateManifest();
}

module.exports = {
  generateManifest
};
