const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is not set. Set it in your environment (see .env.example); never hardcode it.');
  process.exit(1);
}
const OWNER = 'b01054759687-del';
const REPO = 'amlaak-leads-dashboard';

function githubRequest(method, reqPath, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: reqPath,
      method: method,
      headers: {
        'User-Agent': 'Antigravity-Sync',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function syncFile(relPath, commitMsg) {
  const fullPath = path.resolve(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, 'utf8');
  const base64Content = Buffer.from(content, 'utf8').toString('base64');

  const getRes = await githubRequest('GET', `/repos/${OWNER}/${REPO}/contents/${relPath}`);
  let sha = null;
  if (getRes.status === 200 && getRes.data?.sha) {
    sha = getRes.data.sha;
  }

  const putPayload = {
    message: commitMsg,
    content: base64Content,
    branch: 'main'
  };
  if (sha) putPayload.sha = sha;

  console.log(`Pushing ${relPath} (${content.length} bytes)... `);
  const putRes = await githubRequest('PUT', `/repos/${OWNER}/${REPO}/contents/${relPath}`, putPayload);
  if (putRes.status === 200 || putRes.status === 201) {
    console.log(`✅ Updated ${relPath} successfully!`);
  } else {
    console.error(`❌ Failed to update ${relPath}:`, putRes.status);
  }
}

async function run() {
  await syncFile('index.html', 'Feat: Add Form SA tab and bypass all Google Sheet UI filters via GID export');
  await syncFile('scripts/build.js', 'Feat: Add Form SA tab and numeric GID export for all tabs & Meta Spend');
  console.log('\n🚀 GitHub Pages Live URL: https://b01054759687-del.github.io/amlaak-leads-dashboard/');
}

run().catch(console.error);
